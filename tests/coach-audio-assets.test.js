import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {COACH_MEOW_CLIPS} from '../extension/lib/coach-audio-clips.js';
const folder=new URL('../extension/sounds/coaches/',import.meta.url);
test('the expanded local sound bank contains 45 distinct documented real cat clips',async()=>{
 const manifest=JSON.parse(await readFile(new URL('provenance.json',folder),'utf8'));
 const files=(await readdir(folder)).filter(name=>name.endsWith('.wav')).sort();
 assert(COACH_MEOW_CLIPS.length>=45);assert.deepEqual(COACH_MEOW_CLIPS.map(c=>c.file).sort(),files);
 const digests=new Set(),newSources=new Set();
 for(const clip of COACH_MEOW_CLIPS){
  const bytes=await readFile(new URL(clip.file,folder)),record=manifest.clips.find(c=>c.file===clip.file);
  assert(record,clip.file+' needs provenance');assert.equal(record.source.license,'CC0-1.0');assert.match(record.source.page,/^https:\/\/freesound\.org\/people\/[^/]+\/sounds\/\d+\/$/);
  const hash=createHash('sha256').update(bytes).digest('hex');assert.equal(hash,record.sha256,clip.file+' provenance hash');assert(!digests.has(hash),clip.file+' duplicates existing audio');digests.add(hash);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');assert.equal(bytes.readUInt16LE(20),1);assert.equal(bytes.readUInt16LE(22),1);assert.equal(bytes.readUInt32LE(24),32000);assert.equal(bytes.readUInt16LE(34),16);
  const samples=bytes.readUInt32LE(40)/2,duration=samples/32000;assert(duration>.05&&duration<5,clip.file+' duration');assert.equal(bytes.length,44+samples*2);
  let energy=0,peak=0;for(let n=0;n<samples;n++){const value=bytes.readInt16LE(44+n*2)/32768;peak=Math.max(peak,Math.abs(value));energy+=value*value;}
  assert(peak>.05&&peak<1,clip.file+' must be audible without clipped samples');assert(energy/samples>.00001,clip.file+' must contain a real signal');
  if(Number(clip.id.slice(5))>=26){newSources.add(record.source.id);assert(record.source.checked>='2026-11-04');assert.match(record.processing,/Original pitch and speed preserved/);assert.equal(bytes.readInt16LE(44),0);assert.equal(bytes.readInt16LE(bytes.length-2),0);}
 }
 assert(newSources.size>=10,'New calls come from10distinct recordings, not pitch variants of old clips.');
});

test('Baby and Mellow have real kitten and purr voices with distinct reaction choices',()=>{
 const kitten=COACH_MEOW_CLIPS.filter(c=>c.sound==='kitten-meow'&&c.coaches?.includes('baby'));
 const purr=COACH_MEOW_CLIPS.filter(c=>c.sound==='purr'&&c.coaches?.includes('mellow'));
 assert(kitten.length>=4,'Baby needs several genuine kitten calls');
 for(const kind of ['talk','greeting','curious','encourage','brilliant','celebrate']) assert(kitten.filter(c=>c.kinds.includes(kind)).length>=3,kind+' needs a varied kitten bank');
 assert.notDeepEqual(kitten.filter(c=>c.kinds.includes('talk')).map(c=>c.id),kitten.filter(c=>c.kinds.includes('brilliant')).map(c=>c.id));
 for(const kind of ['talk','greeting','encourage']) assert(purr.filter(c=>c.kinds.includes(kind)).length>=2,kind+' needs calm purr choices');
});
