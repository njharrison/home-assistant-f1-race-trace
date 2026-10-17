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

test('real recorder envelope with geometry.points and driver status converts',()=>{
  const snapshot=ctx.RaceTraceHomeAssistantAdapter.convert({
    schema_version:1,
    source:'F1 Sensor Track Map',
    run:1,
    geometry:{source:'static_circuit_geometry',circuit_key:'61',rotation:0.2,
      points:[[-13163,-1691],[-13203,-2097],[-13001,-2469],[-13163,-1691]]},
    samples:[
      {timestamp:1791719991.831127,recorded_at:1792189709.988,replay_state:'playing',
        drivers:[{id:'63',x:0,y:0,status:'OnTrack',pit_lane:null},
                 {id:'44',x:1081,y:-629,status:'OnTrack',pit_lane:null}]},
      {timestamp:1791719992.73099,drivers:[{id:'44',x:1070,y:-600,status:'OnTrack'}]}
    ]
  });
  assert.equal(snapshot.track.length,4);
  assert.equal(snapshot.frames.length,2);
  assert.ok(Math.abs(snapshot.frames[1].t-0.899863)<0.00001);
  assert.equal(snapshot.frames[0].d.length,2);
});
