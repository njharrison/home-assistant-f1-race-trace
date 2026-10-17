import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/timing-alignment.js',import.meta.url),'utf8');
const ctx=vm.createContext({});
vm.runInContext(source,ctx);
test('first 1→2 lap transition wins and rounds to timing precision',()=>{
  const anchors=ctx.RaceTraceTiming.lapTwoAnchors([['44',1,320],['44',2,429.775],['44',2,430],['63',2,442.24]]);
  assert.equal(anchors['44'],429.78);
  assert.equal(anchors['63'],442.24);
});
test('reject missing timing stream',()=>assert.throws(()=>ctx.RaceTraceTiming.lapTwoAnchors(null)));
