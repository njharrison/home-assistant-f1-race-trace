import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../src/pit-lane.js',import.meta.url),'utf8'),ctx);
test('pit intervals are driver independent',()=>{
 const samples=[
  {timestamp:10,drivers:[{id:'63',status:'on_track'},{id:'44',status:'on_track'}]},
  {timestamp:11,drivers:[{id:'63',status:'pit_in'},{id:'44',status:'on_track'}]},
  {timestamp:14,drivers:[{id:'63',status:'pit_out'},{id:'44',status:'pit_in'}]},
  {timestamp:16,drivers:[{id:'63',status:'on_track'},{id:'44',status:'on_track'}]}
 ];
 const pits=ctx.RaceTracePitLane.intervals({samples});
 assert.equal(ctx.RaceTracePitLane.flagged(pits,'63',12,{margin:0}),true);
 assert.equal(ctx.RaceTracePitLane.flagged(pits,'63',17,{margin:0}),false);
 assert.equal(ctx.RaceTracePitLane.flagged(pits,'44',15,{margin:0}),true);
});
