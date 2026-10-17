import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});
for(const name of ['circuit-alignment','pit-lane','lap-matching','replay-validation']){
 vm.runInContext(fs.readFileSync(new URL('../src/'+name+'.js',import.meta.url),'utf8'),ctx);
}
test('replay validation matches projected crossings to official timing',()=>{
 const geometry=ctx.RaceTraceCircuit.prepare([[0,0],[10,0],[10,10],[0,10]]);
 const frames=[
  {t:100,d:[['44',0,2]]},
  {t:101,d:[['44',0,0.5]]},
  {t:102,d:[['44',1,0]]},
  {t:103,d:[['44',4,0]]}
 ];
 const result=ctx.RaceTraceReplayValidation.inspect(geometry,frames,[['44',2,101.5]],0,1,{toleranceSeconds:2});
 assert.equal(result.officialCount,1);
 assert.equal(result.matchedCount,1);
 assert.equal(result.unmatchedCount,0);
});
