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

test('pit shortcut and VSC pauses do not change the official lap anchor',()=>{
 const tracks=new Map([
  ['63',[[0,0.1,0],[1,0.95,8],[2,1.02,10],[3,1.06,25],[4,1.4,40]]],
  ['44',[[0,0.2,0],[1,0.6,8],[2,0.61,10],[3,0.62,25],[4,1.1,40]]]
 ]);
 const before=new Map([...tracks].map(([id,p])=>[id,p.map(x=>x[1])]));
 const report=ctx.RaceTraceOfficialAlignment.align(tracks,[['63',2,30],['44',2,30]]);
 assert.equal(report.aligned.length,2);
 for(const [id,points] of tracks){
  const shift=points[0][1]-before.get(id)[0];
  for(let i=0;i<points.length;i++)assert.ok(Math.abs(points[i][1]-before.get(id)[i]-shift)<1e-9);
  const fraction=(30-25)/(40-25);
  assert.ok(Math.abs(points[3][1]+fraction*(points[4][1]-points[3][1])-1)<1e-9);
 }
});
