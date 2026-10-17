import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../src/circuit-alignment.js',import.meta.url),'utf8'),ctx);
const circuit=ctx.RaceTraceCircuit;
test('generic circuit projection',()=>{
 const g=circuit.prepare([[0,0],[10,0],[10,10],[0,10]]);
 assert.equal(g.length,40);
 assert.equal(circuit.project(g,5,1).distance,5);
});
test('phase uses supplied start-finish location and direction',()=>{
 const g=circuit.prepare([[0,0],[10,0],[10,10],[0,10]]);
 assert.equal(circuit.phase(g,5,0,5,1),0);
 assert.equal(circuit.phase(g,10,0,5,1),0.125);
 assert.equal(circuit.phase(g,10,0,5,-1),0.875);
});
