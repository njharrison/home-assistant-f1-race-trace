import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
for(const file of ['circuit-alignment.js','start-finish-calibration.js','recording-sync.js'])
 vm.runInContext(fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),context);
test('multi-driver crossings calibrate circuit phase and reject an outlier',()=>{
 const geometry=context.RaceTraceCircuit.prepare([[0,0],[10,0],[10,10],[0,10]]);
 const frames=[],crossings=[];
 for(let i=0;i<8;i++){
  const id=String(i+1),time=100+i;
  frames.push({t:time,d:[[id,i===7?0:5, i===7?10:0]]});
  crossings.push([id,2,time]);
 }
 const result=context.RaceTraceCalibration.calibrate(geometry,frames,crossings);
 assert.ok(Math.abs(result.distance-5)<0.01);
 assert.equal(result.count,8);
 assert.equal(result.acceptedCount,7);
 assert.equal(result.confidence,true);
});
test('timing and GPS recordings use recorded-at wall-clock',()=>{
 const events=context.RaceTraceRecordingSync.crossings({schema_version:1,samples:[
  {timestamp:100,drivers:[{id:'44',completed_laps:1}]},
  {timestamp:101,drivers:[{id:'44',completed_laps:2}]}
 ]});
 const frames=context.RaceTraceRecordingSync.gpsFrames({schema_version:1,samples:[
  {timestamp:42,recorded_at:101,drivers:[{id:'44',x:5,y:0}]}
 ]});
 assert.equal(events[0][2],frames[0].t);
 assert.equal(events[0][1],2);
});
