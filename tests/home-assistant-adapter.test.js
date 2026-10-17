import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});
for(const name of ['data-source.js','home-assistant-adapter.js'])
  vm.runInContext(fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),ctx);
test('GPS recorder timestamps and positions convert to shared frames',()=>{
  const result=ctx.RaceTraceHomeAssistantAdapter.convert({
    schema_version:1,
    geometry:[[0,0],[1,0],[1,1]],
    samples:[
      {timestamp:102,drivers:[{id:'44',x:1,y:0}]},
      {timestamp:100,drivers:[{id:'5',x:0,y:0}]}
    ]
  });
  assert.deepEqual(Array.from(result.frames,f=>f.t),[0,2]);
  assert.equal(result.frames[0].d[0][0],'5');
  assert.equal(result.track.length,3);
});
test('missing centreline is rejected',()=>{
  assert.throws(()=>ctx.RaceTraceHomeAssistantAdapter.convert({
    schema_version:1,geometry:null,samples:[{timestamp:100,drivers:[]}]
  }));
});
