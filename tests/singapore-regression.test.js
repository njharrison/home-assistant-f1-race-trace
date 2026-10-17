import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const fixture = fs.readFileSync(new URL('fixtures/singapore-data.js', root), 'utf8');
const timingFixture = fs.readFileSync(new URL('fixtures/singapore-timing.js', root), 'utf8');
const timingAdapter = fs.readFileSync(new URL('src/timing-alignment.js', root), 'utf8');
const dataSource = fs.readFileSync(new URL('src/data-source.js', root), 'utf8');
const projection = fs.readFileSync(new URL('src/gps-projection.js', root), 'utf8');
const engine = fs.readFileSync(new URL('src/race-trace.js', root), 'utf8');
const reference = fs.readFileSync(new URL('src/reference-profile.js', root), 'utf8');
const renderer = fs.readFileSync(new URL('src/renderer.js', root), 'utf8');

function createHarness() {
  const elements = new Map();
  const ctx = new Proxy({}, {get(target, name) {if (!(name in target)) target[name] = () => {}; return target[name];}});
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: {projectionMode:'trajectory',profileMode:'driver',refLap:'106.5',traceSmooth:'8',scrub:'0',speedDriver:'44'}[id] ?? '',
      checked: id === 'hamOverlay', style:{}, options:[], textContent:'', innerHTML:'',
      getContext:()=>ctx, addEventListener:()=>{}, setPointerCapture:()=>{},
      getBoundingClientRect:()=>({width:720,height:460,left:0,top:0}),
      appendChild(){}, removeChild(){}, replaceChildren(){}, click(){},
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    console, document:{getElementById:element,createElement:()=>element('__created')},
    window:{}, Blob, URL, setTimeout:()=>0, clearTimeout:()=>{},
    setInterval:()=>0, clearInterval:()=>{}, alert:()=>{},
  });
  vm.runInContext(fixture,context,{filename:'singapore-data.js',timeout:15000});
  vm.runInContext(timingFixture,context,{filename:'singapore-timing.js',timeout:15000});
  vm.runInContext(timingAdapter,context,{filename:'timing-alignment.js',timeout:15000});
  vm.runInContext(dataSource,context,{filename:'data-source.js',timeout:15000});
  vm.runInContext(projection,context,{filename:'gps-projection.js',timeout:15000});
  vm.runInContext(engine,context,{filename:'race-trace.js',timeout:45000});
  vm.runInContext(reference,context,{filename:'reference-profile.js',timeout:45000});
  vm.runInContext(renderer,context,{filename:'renderer.js',timeout:45000});
  return {context,elements, evaluate:code=>vm.runInContext(code,context,{timeout:15000})};
}
let harness;
test('recorded Singapore fixture loads and trajectory projection produces finite, forward progress',()=>{
  harness=createHarness();
  const result=harness.evaluate(`({drivers:tracks.size, frames:frames.length, trackPoints:track.length,
    normal:projectionDiagnostics.normal, fallback:projectionDiagnostics.fallback,rejected:projectionDiagnostics.rejected,
    bad:[...tracks].flatMap(([id,points])=>points.filter(p=>!Number.isFinite(p[1])||!Number.isFinite(p[2])).map(()=>id)),
    reverse:[...tracks].flatMap(([id,points])=>points.slice(1).filter((p,i)=>p[1]<points[i][1]-0.02).map(()=>id))})`);
  assert.equal(result.drivers,22);
  assert.ok(result.frames>100);
  assert.ok(result.trackPoints>50);
  assert.ok(result.normal>0);
  assert.deepEqual([...result.bad],[]);
  assert.deepEqual([...result.reverse],[]);
});
test('driver-specific reference is bounded, monotonic, and preserves lap endpoints',()=>{
  const result=harness.evaluate(`({shared:validProfile(learnedProfile),
    valid:[...driverProfiles.values()].filter(validProfile).length,
    broken:[...driverProfiles].filter(([id,p])=>p && (!validProfile(p)||Math.abs(profileEval(0,p).value)>1e-7||Math.abs(profileEval(1,p).value-1)>1e-7)).map(([id])=>id),
    periodic:Math.abs(rawCorrection(3.37,learnedProfile)-rawCorrection(4.37,learnedProfile))})`);
  assert.equal(result.shared,true);
  assert.ok(result.valid>0);
  assert.deepEqual([...result.broken],[]);
  assert.ok(result.periodic<1e-8);
});
test('reference correction does not change lap-duration differences',()=>{
  const r=harness.evaluate(`(()=>{const id='44',t=106.5;return {gap:refTime(4.23,t,id)-refTime(3.23,t,id),baseline:refTime(3,t,id)-refTime(2,t,id)}})()`);
  assert.ok(Math.abs(r.gap-106.5)<1e-7);
  assert.ok(Math.abs(r.baseline-106.5)<1e-7);
});
test('retirement stops car 5 and projection switch can rebuild tracks',()=>{
  const r=harness.evaluate(`({before:activeAt('5',1375),after:activeAt('5',1376),last:tracks.get('5').at(-1)[2]})`);
  assert.equal(r.before,true);assert.equal(r.after,false);
  const legacy=harness.evaluate(`(()=>{projectionMode.value='legacy';rebuildTracks();return {count:tracks.size,samples:tracks.get('44').length}})()`);
  assert.equal(legacy.count,22);assert.ok(legacy.samples>20);
  const restored=harness.evaluate(`(()=>{projectionMode.value='trajectory';rebuildTracks();alignRaceLaps();return tracks.get('44').length})()`);
  assert.equal(restored,legacy.samples);
});

// Golden-master: capture actual projected distance and reference-relative time
// at fixed sample indices for every driver, plus the VSC/retirement neighbourhood.
// Regenerate ONLY after intentionally approving a changed trace:
//   UPDATE_GOLDEN=1 npm test
// Review the JSON diff before accepting it.
test('golden-master: Singapore distance and corrected-time traces remain unchanged',()=>{
  const h=createHarness();
  const snapshot=h.evaluate(`(()=>{
    const round=n=>Number(n.toFixed(5));
    const ids=[...tracks.keys()].sort((a,b)=>Number(a)-Number(b));
    const drivers={};
    for(const id of ids){
      const arr=tracks.get(id);
      const positions=new Set([0,1,2,Math.floor(arr.length*.1),Math.floor(arr.length*.25),Math.floor(arr.length*.5),Math.floor(arr.length*.75),arr.length-3,arr.length-2,arr.length-1]);
      // Include observations around the recorded retirement and the middle of the race.
      for(const t of [600,1000,1375]){
        let best=0;
        for(let j=1;j<arr.length;j++)if(Math.abs(arr[j][2]-t)<Math.abs(arr[best][2]-t))best=j;
        positions.add(best);
      }
      drivers[id]=[...positions].sort((a,b)=>a-b).map(i=>{
        const p=arr[i];return [i,round(p[2]),round(p[1]),round(refTime(p[1],106.5,id)-p[2])];
      });
    }
    return {schema:1,fixture:'Singapore 2026-10-16',projection:'trajectory',profile:'driver',referenceLapSeconds:106.5,
      driverCount:tracks.size,frameCount:frames.length,
      projectionDiagnostics:{normal:projectionDiagnostics.normal,fallback:projectionDiagnostics.fallback,rejected:projectionDiagnostics.rejected},
      drivers};
  })()`);
  const path=new URL('golden/singapore-traces.json',root);
  if(process.env.UPDATE_GOLDEN==='1'){
    fs.mkdirSync(new URL('golden/',root),{recursive:true});
    fs.writeFileSync(path,JSON.stringify(snapshot,null,2)+'\n');
  }else{
    const expected=JSON.parse(fs.readFileSync(path,'utf8'));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(snapshot)),expected,
      'Singapore trace changed. Inspect projection/reference changes; update golden only after review.');
  }
});

test('shared input adapter accepts Singapore fixture and rejects malformed live data',()=>{
  const h=createHarness();
  const r=h.evaluate(`(()=>{
    const source=RaceTraceDataSources.fixture(DATA);
    const live=RaceTraceDataSources.fromHomeAssistant({getTrack:()=>DATA.track,getFrames:()=>DATA.frames});
    let invalid=false;try{RaceTraceDataSources.fromHomeAssistant({track:DATA.track,frames:[{t:1,d:[[44,NaN,3]]}]}).snapshot()}catch(e){invalid=true}
    return {fixture:source.snapshot().frames.length,live:live.snapshot().frames.length,invalid};
  })()`);
  assert.ok(r.fixture>100);assert.equal(r.fixture,r.live);assert.equal(r.invalid,true);
});

test('lap-two anchors are derived from timing events for all Singapore drivers',()=>{
 const h=createHarness();
 const r=h.evaluate(`({count:Object.keys(lap2Anchors).length,ham:lap2Anchors['44'],pit:lap2Anchors['63'],
    aligned:anchoredDrivers,missing:unanchoredDrivers})`);
 assert.equal(r.count,22);assert.equal(r.ham,429.78);assert.equal(r.pit,442.24);
 assert.equal(r.aligned,22);assert.deepEqual([...r.missing],[]);
});