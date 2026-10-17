import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../src/lap-matching.js',import.meta.url),'utf8'),ctx);
test('a geometric crossing cannot validate two official laps',()=>{
 const projected=new Map([['44',[{time:100}]]]);
 const result=ctx.RaceTraceLapMatching.match(projected,[['44',2,100],['44',3,101]],{toleranceSeconds:5});
 assert.equal(result.matched.length,1);
 assert.equal(result.unmatched.length,1);
});
