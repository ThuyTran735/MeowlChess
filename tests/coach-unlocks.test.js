import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewLibrary } from '../extension/lib/library.js';
import { analyzeGame } from '../extension/lib/review.js';
import { importPgn } from '../extension/lib/pgn.js';

const SETTINGS={engineId:'stockfish',engineName:'Stockfish 18',moveTimeMs:50,multiPV:1,smartAnalysis:false,analysisVersion:'unlock-test'};
const copy=value=>structuredClone(value);
function memoryStore(){
  const rows=new Map();let progress=null,queue=Promise.resolve(),fail=false;
  return {
    rows,
    get progress(){return copy(progress);},set progress(value){progress=copy(value);},
    failNext(){fail=true;},
    async read(id){return copy(rows.get(id)||null);},async readAll(){return copy([...rows.values()]);},async readCoachProgress(){return copy(progress);},
    transact(update){
      const pending=queue.then(()=>{
        const changes=update(copy([...rows.values()]),copy(progress)),next=new Map(rows);
        for(const id of changes.remove||[])next.delete(id);
        for(const record of changes.put||[])next.set(record.id,copy(record));
        if(fail){fail=false;throw new DOMException('Injected storage failure','QuotaExceededError');}
        rows.clear();for(const [id,record]of next)rows.set(id,record);
        if(changes.coachProgress)progress=copy(changes.coachProgress);
        return copy(changes.value);
      });queue=pending.catch(()=>{});return pending;
    },
  };
}
function library(store,options={}){return createReviewLibrary({store,analysisVersion:SETTINGS.analysisVersion,...options});}
async function fixture(index=0,headers=''){
  const pgn=`[Event "Milestone ${index}"]\n[White "Player${index}"]\n[Black "Opponent"]\n[Result "1-0"]\n${headers}\n1. e4 e5 2. Nf3 1-0`;
  const result=await analyzeGame(pgn,{smartAnalysis:false,engineFactory:()=>({async init(){},dispose(){},async evaluate(){return{cp:0,mate:null,depth:8,bestMove:null,pv:[],candidates:[]};}})});
  result.analysis.version=SETTINGS.analysisVersion;
  return{game:importPgn(pgn),result};
}
const save=(reviewLibrary,data)=>reviewLibrary.saveReview(data.game,data.result,SETTINGS);

test('ten distinct saved reviews unlock permanently; repeats, deletion, and restarts do not reset progress',async()=>{
  const store=memoryStore(),first=library(store),data=await fixture();
  const saved=await save(first,data);
  await first.saveReview(data.game,data.result,{...SETTINGS,moveTimeMs:500});
  await first.deleteReview(saved.id);
  assert.deepEqual(await library(store).getCoachUnlockProgress(),{count:1,required:10,unlocked:false});
  await save(first,data);
  for(let index=1;index<13;index++)await save(first,await fixture(index));
  assert.deepEqual(await library(store).getCoachUnlockProgress(),{count:10,required:10,unlocked:true});
  for(const record of await first.listReviews())await first.deleteReview(record.id);
  assert.equal((await first.listReviews()).length,0);
  assert.deepEqual(await library(store).getCoachUnlockProgress(),{count:10,required:10,unlocked:true});
  assert.equal(store.progress.gameKeys.length,10);
});

test('website variants share a normalized game key and PGN formatting does not earn another review',async()=>{
  const store=memoryStore(),reviews=library(store);
  await save(reviews,await fixture(1,'[Link "https://www.chess.com/game/live/123456"]'));
  await save(reviews,await fixture(2,'[Link "https://chess.com/analysis/game/live/123456/review?move=7"]'));
  await save(reviews,await fixture(3,'[Site "https://lichess.org/aB12cd34/black#9"]'));
  await save(reviews,await fixture(4,'[Link "https://lichess.org/aB12cd34EF56"]'));
  const imported=await fixture(5);
  await save(reviews,imported);
  await save(reviews,{...imported,game:{...imported.game,pgn:imported.game.pgn.replace('e4 e5','e4 {A comment} e5').replaceAll('\n','\r\n')}});
  assert.equal((await reviews.getCoachUnlockProgress()).count,3);
});

test('samples, invalid analysis, unfinished games, quota failures, and capacity failures earn no progress',async()=>{
  const store=memoryStore(),reviews=library(store);
  const sample=await fixture(0);sample.game.sample=true;await save(reviews,sample);
  const sampleClass=await fixture(1);sampleClass.game.time_class='sample';await save(reviews,sampleClass);
  const sampleHeader=await fixture(2,'[Site "Local sample"]');await save(reviews,sampleHeader);
  assert.equal((await reviews.getCoachUnlockProgress()).count,0);
  const data=await fixture(3),invalid=copy(data);invalid.result.positions.pop();
  await assert.rejects(save(reviews,invalid));
  await assert.rejects(save(reviews,{...data,game:{...data.game,pgn:'[Result "*"]\n\n1. e4 *'}}));
  store.failNext();await assert.rejects(save(reviews,data),error=>error.code==='quota');
  assert.equal((await reviews.getCoachUnlockProgress()).count,0);
  const limitedStore=memoryStore(),limited=library(limitedStore,{maxReviews:1});
  await save(limited,data);
  await assert.rejects(save(limited,await fixture(4)),error=>error.code==='limit');
  assert.equal((await limited.getCoachUnlockProgress()).count,1);
});

test('migration counts only valid completed historical rows and preserves lifetime credit before first deletion',async()=>{
  const store=memoryStore(),reviews=library(store);
  const first=await save(reviews,await fixture(0));
  const second=await save(reviews,await fixture(1));
  const sample=await fixture(2);sample.game.sample=true;await save(reviews,sample);
  const broken=await save(reviews,await fixture(3));store.rows.get(broken.id).result.positions[0].pv=['e7e5'];
  const future=await save(reviews,await fixture(4));store.rows.get(future.id).schemaVersion=999;
  const fake='game-'+'a'.repeat(64);store.rows.set(fake,{...copy(store.rows.get(second.id)),id:fake});
  store.progress=null;
  const before=copy([...store.rows.values()]);
  assert.deepEqual(await library(store).getCoachUnlockProgress(),{count:2,required:10,unlocked:false});
  assert.deepEqual([...store.rows.values()],before,'Migration must not rewrite saved reviews.');
  store.progress=null;
  await library(store).deleteReview(first.id);
  assert.equal((await library(store).getCoachUnlockProgress()).count,2);
});

test('concurrent migration, duplicate saves, and the ninth-to-tenth transition commit once per game',async()=>{
  const store=memoryStore(),a=library(store),b=library(store);
  for(let index=0;index<9;index++)await save(a,await fixture(index));
  store.progress=null;
  const tenth=await fixture(9);
  await Promise.all([a.getCoachUnlockProgress(),b.getCoachUnlockProgress(),save(a,tenth),save(b,tenth)]);
  assert.deepEqual(await b.getCoachUnlockProgress(),{count:10,required:10,unlocked:true});
  assert.equal(store.rows.size,10);
  assert.equal(new Set(store.progress.gameKeys).size,10);
});

test('initialized progress reads avoid loading saved game payloads',async()=>{
  const store=memoryStore(),reviews=library(store);
  await save(reviews,await fixture(0));
  const lightweight={...store,async readAll(){throw new Error('The review payloads should not be loaded.');}};
  assert.equal((await library(lightweight).getCoachUnlockProgress()).count,1);
});
