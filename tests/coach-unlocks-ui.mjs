import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root=resolve(import.meta.dirname,'..'),temporary=resolve(tmpdir());
const prefix='MeowlChess-unlock-ui-',bundlePrefix='MeowlChess-unlock-bundle-';
const profile=await mkdtemp(join(temporary,prefix)),bundle=await mkdtemp(join(temporary,bundlePrefix)),extension=join(bundle,'extension');
const fixture=String.raw`
import {createReviewLibrary,createIndexedDBReviewStore} from './lib/library.js';
import {analyzeGame,ANALYSIS_VERSION} from './lib/review.js';
import {importPgn} from './lib/pgn.js';
import {subscribeCoachUnlockProgress} from './lib/coach-unlocks.js';
const settings={engineId:'stockfish',engineName:'Stockfish 18',moveTimeMs:50,multiPV:1,smartAnalysis:false,analysisVersion:ANALYSIS_VERSION};
async function fixture(index){
 const pgn='[Event "Unlock '+index+'"]\n[White "Player'+index+'"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0';
 return{game:importPgn(pgn),result:await analyzeGame(pgn,{smartAnalysis:false,engineFactory:()=>({async init(){},dispose(){},async evaluate(){return{cp:0,mate:null,depth:8,bestMove:null,pv:[],candidates:[]};}})})};
}
function dbOpen(name,version){return new Promise((resolve,reject)=>{const request=indexedDB.open(name,version);request.onupgradeneeded=()=>request.result.createObjectStore('reviews',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function legacyRows(){
 const rows=new Map(),store={async readAll(){return [...rows.values()];},async transact(update){const changes=update([...rows.values()]);for(const record of changes.put||[])rows.set(record.id,record);return changes.value;}};
 const library=createReviewLibrary({store,analysisVersion:ANALYSIS_VERSION});
 for(let index=0;index<9;index++){const data=await fixture(index);await library.saveReview(data.game,data.result,settings);}
 const sample=await fixture(90);sample.game.sample=true;await library.saveReview(sample.game,sample.result,settings);
 const invalid=await fixture(91),saved=await library.saveReview(invalid.game,invalid.result,settings);rows.get(saved.id).result.positions[0].pv=['e7e5'];
 return [...rows.values()];
}
window.unlock={
 async seed(name,blocked=false){
  const db=await dbOpen(name,1);window.legacyDb=db;
  if(!blocked)db.onversionchange=()=>{window.closedForUpgrade=true;db.close();};
  const rows=await legacyRows();
  await new Promise((resolve,reject)=>{const transaction=db.transaction('reviews','readwrite');for(const row of rows)transaction.objectStore('reviews').put(row);transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);});
 },
 open(name){window.store=createIndexedDBReviewStore({databaseName:name});window.library=createReviewLibrary({store:window.store,analysisVersion:ANALYSIS_VERSION});},
 progress(){return window.library.getCoachUnlockProgress();},
 async save(index,abort=false){
  const data=await fixture(index);
  const target=abort?createReviewLibrary({analysisVersion:ANALYSIS_VERSION,store:{...window.store,transact:update=>window.store.transact((rows,progress)=>{const changes=update(rows,progress);return{...changes,put:[...(changes.put||[]),{id:'uncloneable',value:()=>{}}]};})}}):window.library;
  return target.saveReview(data.game,data.result,settings);
 },
 watch(){window.changeEvents=0;window.unsubscribe=subscribeCoachUnlockProgress(()=>window.changeEvents++);},
 async close(){window.unsubscribe?.();await window.library?.close();window.legacyDb?.close();},
};window.fixtureReady=true;
`;
let context;
try{
 await cp(join(root,'extension'),extension,{recursive:true});
 await writeFile(join(extension,'unlock-fixture.html'),'<!doctype html><meta charset="utf-8"><script type="module" src="unlock-fixture.js"></script>');
 await writeFile(join(extension,'unlock-fixture.js'),fixture);
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await context.route(/^https?:\/\//,route=>route.abort());
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),origin='chrome-extension://'+new URL(worker.url()).hostname;
 const pages=await Promise.all([context.newPage(),context.newPage(),context.newPage()]),errors=[];
 for(const page of pages){page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/unlock-fixture.html');await page.waitForFunction(()=>window.fixtureReady);}
 const [a,b,c]=pages,name='MeowlChess-real-milestone';
 await a.evaluate(name=>unlock.seed(name),name);
 for(const page of pages)await page.evaluate(name=>{unlock.open(name);unlock.watch();},name);
 const migrated=await Promise.all(pages.map(page=>page.evaluate(()=>unlock.progress())));
 assert.ok(migrated.every(value=>value.count===9&&!value.unlocked));
 assert.equal(await a.evaluate(()=>window.closedForUpgrade),true);
 assert.equal(await a.evaluate(async()=>{try{await unlock.save(9,true);return false;}catch{return true;}}),true);
 assert.equal((await b.evaluate(()=>unlock.progress())).count,9,'Aborted review+milestone must not unlock.');
 await b.evaluate(()=>{window.changeEvents=0;});
 await Promise.all([a.evaluate(()=>unlock.save(9)),b.evaluate(()=>unlock.save(9)),c.evaluate(()=>unlock.progress())]);
 await b.waitForFunction(()=>window.changeEvents>0);
 assert.deepEqual(await c.evaluate(()=>unlock.progress()),{count:10,required:10,unlocked:true});
 const count=await a.evaluate(async()=>{const rows=await window.store.readAll();return rows.length;});
 assert.equal(count,12,'Nine original reviews, sample, corrupt row, and one distinct new review.');
 await a.evaluate(async()=>{for(const row of await window.library.listReviews())await window.library.deleteReview(row.id);});
 assert.deepEqual(await c.evaluate(()=>unlock.progress()),{count:10,required:10,unlocked:true});
 await Promise.all(pages.map(page=>page.evaluate(()=>unlock.close())));
 await a.evaluate(async name=>{await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=resolve;request.onerror=()=>reject(request.error);});unlock.open(name);},name);
 assert.deepEqual(await a.evaluate(()=>unlock.progress()),{count:0,required:10,unlocked:false});
 await a.evaluate(()=>unlock.close());

 const blockedName='MeowlChess-blocked-upgrade';
 await a.evaluate(name=>unlock.seed(name,true),blockedName);
 await b.evaluate(name=>unlock.open(name),blockedName);
 assert.equal(await b.evaluate(async()=>{try{await unlock.progress();return null;}catch(error){return error.code;}}),'unavailable');
 await a.evaluate(()=>window.legacyDb.close());
 assert.equal((await b.evaluate(()=>unlock.progress())).count,9,'A blocked upgrade must recover without losing old reviews.');
 await Promise.all(pages.map(page=>page.evaluate(()=>unlock.close())));
 assert.deepEqual(errors,[]);
 console.log('Real IndexedDB migration, atomic abort, competing tenth saves, notifications, deletion/reset, and blocked upgrade recovery passed.');
}finally{
 await closeTestContext(context,profile,prefix);
 if(dirname(bundle)===temporary&&basename(bundle).startsWith(bundlePrefix))await rm(bundle,{recursive:true,force:true,maxRetries:3});
}
