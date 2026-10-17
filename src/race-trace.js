const raceTraceSource = globalThis.RaceTraceDataSource || RaceTraceDataSources.fixture(DATA);
const {track, frames} = raceTraceSource.snapshot();
const seg=[],cum=[0];let length=0;for(let i=0;i<track.length;i++){let a=track[i],b=track[(i+1)%track.length],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);seg.push({a,dx,dy,l});length+=l;cum.push(length)}
// Projection functions are shared with the eventual Home Assistant adapter.
// One-sample delayed trajectory-aware projection. The central GPS sample
// retains its own timestamp; the following sample is used only for geometry.
const rawByDriver=new Map();
for(let fi=0;fi<frames.length;fi++)for(const d of frames[fi].d){
 const id=String(d[0]);if(!rawByDriver.has(id))rawByDriver.set(id,[]);
 rawByDriver.get(id).push({frame:fi,t:frames[fi].t,x:d[1],y:d[2]});
}
const projectionDiagnostics={fallback:0,normal:0,rejected:0};
const sf=project(917,403);let states=new Map(),tracks=new Map();
// Track ordering may be opposite to race direction; infer it from the observed median displacement.
let directions=[];for(let j=1;j<Math.min(100,frames.length);j++){const prev=new Map(frames[j-1].d.map(d=>[d[0],project(d[1],d[2])]));for(let d of frames[j].d){let p=prev.get(d[0]);if(p===undefined)continue;let delta=project(d[1],d[2])-p;if(delta>length/2)delta-=length;if(delta<-length/2)delta+=length;if(Math.abs(delta)<300)directions.push(delta)}}
directions.sort((a,b)=>a-b);const direction=(directions.filter(v=>Math.abs(v)>30).sort((a,b)=>a-b).at(Math.floor(directions.filter(v=>Math.abs(v)>30).length/2))||1)<0?-1:1;
const projectionMode=document.getElementById('projectionMode');
function rebuildTracks(){
 tracks=new Map();states=new Map();
 if(projectionMode.value==='legacy'){
  for(let i=0;i<frames.length;i++){let f=frames[i];for(let d of f.d){let id=String(d[0]),ss=((project(d[1],d[2])-sf)*direction%length+length)%length,old=states.get(id);if(!old){old={last:ss,unwrapped:ss};states.set(id,old);tracks.set(id,[])}else{let delta=ss-old.last;if(delta>length/2)delta-=length;if(delta<-length/2)delta+=length;if(Math.abs(delta)<Math.max(1200,(f.t-(old.t||0))*1100))old.unwrapped+=delta;old.last=ss}old.t=f.t;tracks.get(id).push([i,old.unwrapped/length,f.t])}}
 }else{
  for(const [id,samples] of rawByDriver){
   const corrected=correctedProjectionSamples(samples,direction);
   // Preserve the same absolute lap phase as the legacy projection at the first sample.
   const first=samples[0],phase=((project(first.x,first.y)-sf)*direction%length+length)%length;
   tracks.set(id,corrected.map(p=>[p.frame,(p.s+phase)/length,p.t]));
  }
 }
}
rebuildTracks();
// Race-only alignment: the first reported completed lap includes pre-race activity.
// Use the 1->2 timing transition to identify the first racing-lap S/F crossing.
// Lap-two anchors come from the timing stream, not a circuit-specific table.
// The timing adapter records transitions in completed_laps from 1 to 2.
const lap2Anchors=RaceTraceTiming.lapTwoAnchors(
  (globalThis.RaceTraceTimingSource || TIMING).lapCrossings
);
const raceStart=Math.max(0,Math.min(...Object.values(lap2Anchors))-110);
let anchoredDrivers=0,unanchoredDrivers=[];
function alignRaceLaps(){
anchoredDrivers=0;unanchoredDrivers=[];
for(const [id,arr] of tracks){
 const anchor=lap2Anchors[id];if(!Number.isFinite(anchor)){unanchoredDrivers.push(id);continue;}
 const crossings=[];
 for(let j=1;j<arr.length;j++){
  const a=arr[j-1],b=arr[j],na=Math.floor(a[1]),nb=Math.floor(b[1]);
  if(nb>na&&b[2]>=raceStart&&b[2]<anchor+50){
   const fraction=(na+1-a[1])/(b[1]-a[1]);
   if(fraction>=0&&fraction<=1)crossings.push({time:a[2]+fraction*(b[2]-a[2]),lap:na+1});
  }
 }
 crossings.sort((a,b)=>Math.abs(a.time-anchor)-Math.abs(b.time-anchor));
 const closest=crossings[0];
 if(!closest||Math.abs(closest.time-anchor)>55){unanchoredDrivers.push(id);continue;}
 let lapShift=1-closest.lap;
 // Pitlane shortcut exception: car 63 crosses the projected S/F early
 // (~28 s before the official lap increment). Anchor its *fractional*
 // lap position to the official counter rather than treating the pitlane
 // crossing as a completed racing lap.
 if(id==="63"){
   let near=arr[0];
   for(const p of arr)if(Math.abs(p[2]-anchor)<Math.abs(near[2]-anchor))near=p;
   lapShift=1-near[1];
 }
 for(const point of arr)point[1]+=lapShift;
 anchoredDrivers++;
}
}
alignRaceLaps();
const retirementEvents={"5":{"time":1375.758,"status":"out"}};
function activeAt(id,t){return !retirementEvents[id]||t<retirementEvents[id].time;}
const colors=['#fb7185','#38bdf8','#a3e635','#fbbf24','#c084fc','#2dd4bf','#f472b6','#93c5fd','#fdba74','#4ade80'];const ids=[...tracks.keys()].sort((a,b)=>Number(a)-Number(b));let refLap=document.getElementById('refLap'),scrub=document.getElementById('scrub'),map=document.getElementById('map'),trace=document.getElementById('trace');scrub.max=frames.length-1;let running=false,timer;

// State and track alignment initialized; load reference-profile.js next, then renderer.js.