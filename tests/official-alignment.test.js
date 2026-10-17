import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../src/official-alignment.js',import.meta.url),'utf8'),ctx);
test('official alignment works for every driver without pit-specific rules',()=>{
 const tracks=new Map([
  ['63',[[0,0.1,0],[1,0.9,10],[2,1.3,20]]],
  ['44',[[0,0.3,0],[1,1.1,10],[2,1.5,20]]]
 ]);
 const report=ctx.RaceTraceOfficialAlignment.align(tracks,[['63',2,15],['44',2,15]]);
 assert.equal(report.aligned.length,2);
 for(const points of tracks.values()){
  const midpoint=(points[1][1]+points[2][1])/2;
  assert.ok(Math.abs(midpoint-1)<1e-9);
 }
});
test('missing official timing leaves the driver unchanged',()=>{
 const tracks=new Map([['5',[[0,0.2,0],[1,0.4,10]]]]);
 const report=ctx.RaceTraceOfficialAlignment.align(tracks,[]);
 assert.equal(report.missing.length,1);
 assert.equal(tracks.get('5')[0][1],0.2);
});
