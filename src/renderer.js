// UI controls and canvas rendering; depends on race-trace.js and reference-profile.js.
function profileInfo(){if(modeSelect.value==='driver'){const available=[...driverProfiles.values()].filter(validProfile).length;document.getElementById('profileStatus').textContent=`Driver-specific references: ${available}/${ids.length} drivers have at least two qualifying clean laps. Others fall back to the shared profile. Every driver uses the same reference lap duration; only the normalised speed shape differs. Select a driver below to inspect its reference.`;return;}if(modeSelect.value==='mini'){document.getElementById('profileStatus').textContent=validMini(miniProfile)?`Mini-sector reference: ${miniProfile.sector_count} fixed-distance sectors (~2 s each), ${miniProfile.lap_count} clean lap observations. No leader-time offsets; interpolated sector crossing times. Export/import supports reuse.`:'Mini-sector reference unavailable; constant-speed fallback.';return;}document.getElementById('profileStatus').textContent=validProfile(learnedProfile)?`Learned reference from ${learnedProfile.lap_count} clean full laps; median duration ${learnedProfile.reference_lap_seconds.toFixed(1)} s; phase aligned to GPS S/F; median cumulative crossing-time curve with shape-preserving cubic interpolation. Export saves normalised pace shape independently of lap time.`:'Not enough clean full laps for learning; constant-speed fallback active.'}
profileInfo();
modeSelect.onchange=()=>{profileInfo();resetTraceView()};
function refreshProjectionStatus(){document.getElementById('projectionStatus').textContent=projectionMode.value==='legacy'?'Original nearest-segment projection':`Trajectory-normal: ${projectionDiagnostics.normal} normal intersections, ${projectionDiagnostics.fallback} fallbacks, ${projectionDiagnostics.rejected} rejected samples`;}
refreshProjectionStatus();
projectionMode.onchange=()=>{
 projectionDiagnostics.normal=0;projectionDiagnostics.fallback=0;projectionDiagnostics.rejected=0;
 rebuildTracks();alignRaceLaps();
 learnedProfile=learnProfile();driverProfiles=new Map([...tracks.keys()].map(id=>[id,learnProfile(id)]));
 miniProfile=buildMiniProfile(learnedProfile);learnedPhase=0;
 refreshProjectionStatus();profileInfo();resetTraceView();drawDiagnostics();
};

document.getElementById('saveProfile').onclick=()=>{
 const exportProfile=modeSelect.value==='driver'?{schema_version:1,type:'f1-race-trace-driver-references',track_key:'61',circuit:'Singapore',shared:learnedProfile,drivers:Object.fromEntries([...driverProfiles].filter(([id,p])=>validProfile(p)))}:modeSelect.value==='mini'?miniProfile:learnedProfile;
 if(!(exportProfile?.type==='f1-race-trace-driver-references'||validMini(exportProfile)||validProfile(exportProfile))){alert('No valid profile to export');return}
 const blob=new Blob([JSON.stringify(exportProfile,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=modeSelect.value==='driver'?'singapore-driver-references-v1.json':modeSelect.value==='mini'?'singapore-mini-sectors-v1.json':'singapore-normalised-reference-v1.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
};
document.getElementById('importProfile').onchange=async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{const data=JSON.parse(await file.text());if(data.track_key!=='61')throw Error('Profile is not for Singapore (track key 61)');if(data.type==='f1-race-trace-driver-references'&&validProfile(data.shared)&&data.drivers&&typeof data.drivers==='object'){learnedProfile=data.shared;for(const [id,p] of Object.entries(data.drivers)){if(ids.includes(id)&&validProfile(p))driverProfiles.set(id,p)}modeSelect.value='driver'}else if(validMini(data)){miniProfile=data;modeSelect.value='mini'}else if(validProfile(data)){learnedProfile=data;miniProfile=buildMiniProfile(learnedProfile);learnedPhase=0;modeSelect.value='learned'}else throw Error('Invalid reference profile');profileInfo();resetTraceView()}catch(err){alert('Could not load profile: '+err.message)}
};

// Display-only, time-domain Gaussian smoothing. Do not cross GPS gaps,
// backward timestamps or lap-position discontinuities. No changes to
// reference learning, GPS data, or diagnostic curves.
function traceSegments(id,seconds){
 const arr=tracks.get(id)||[],segments=[];let segment=[],prev=null;
 for(let j=0;j<arr.length;j++){
  const p=arr[j];if(p[2]<raceStart)continue;
  if(!activeAt(id,p[2]))break;
  if(prev&&(p[2]-prev[2]>8||p[2]<=prev[2]||Math.abs(p[1]-prev[1])>0.16)){
   if(segment.length)segments.push(segment);segment=[];
  }
  segment.push({frame:p[0],t:p[2],lap:p[1],raw:refTime(p[1],seconds,id,j)-p[2]});
  prev=p;
 }
 if(segment.length)segments.push(segment);
 const sigma=Number(document.getElementById('traceSmooth').value)/2;
 for(const seg of segments){
  for(let i=0;i<seg.length;i++){
   if(!sigma){seg[i].value=seg[i].raw;continue}
   let sum=0,weight=0;
   for(let k=i;k>=0&&seg[i].t-seg[k].t<=3*sigma;k--){
    const w=Math.exp(-.5*((seg[i].t-seg[k].t)/sigma)**2);sum+=seg[k].raw*w;weight+=w;
   }
   for(let k=i+1;k<seg.length&&seg[k].t-seg[i].t<=3*sigma;k++){
    const w=Math.exp(-.5*((seg[k].t-seg[i].t)/sigma)**2);sum+=seg[k].raw*w;weight+=w;
   }
   seg[i].value=sum/weight;
  }
 }
 return segments;
}
const traceSmooth=document.getElementById('traceSmooth');
traceSmooth.oninput=()=>{document.getElementById('smoothValue').textContent=traceSmooth.value+' s';draw()};
const traceView={x0:0,x1:1,y0:null,y1:null};
function resetTraceView(){traceView.x0=0;traceView.x1=1;traceView.y0=null;traceView.y1=null;draw()}
// Horizontal coordinate is each driver's aligned, unwrapped centreline distance.
// This deliberately does NOT use race time or the leader's distance.
function distanceBounds(){
 let lo=Infinity,hi=-Infinity;
 for(const id of ids)for(const p of tracks.get(id)||[]){
  if(p[2]<raceStart||!activeAt(id,p[2]))continue;
  lo=Math.min(lo,p[1]);hi=Math.max(hi,p[1]);
 }
 if(!Number.isFinite(lo))return [0,1];
 return [Math.floor(lo),Math.ceil(hi+0.001)];
}
function traceBounds(){
 const ref=Number(refLap.value)||90,idx=+scrub.value,values=[];
 for(const id of ids)for(const seg of traceSegments(id,ref))for(const p of seg){
  if(p.frame<=idx)values.push(p.value);
 }
 const lo=Math.min(...values),hi=Math.max(...values);
 if(!Number.isFinite(lo))return [-10,10];
 const span=Math.max(20,hi-lo);return [lo-span*.07,hi+span*.07];
}
function draw(){drawProfileChart();drawSpeedChart();drawSignChart();let referenceSeconds=Number(refLap.value)||90;let idx=+scrub.value,f=frames[idx];document.getElementById('readout').textContent=`${f.t<raceStart?"PRE-RACE · ":""}${f.t.toFixed(1)}s / ${frames.at(-1).t.toFixed(1)}s · ${f.d.length} cars · ${direction>0?'forward':'reverse'} centreline`;let ctx=map.getContext('2d');ctx.clearRect(0,0,720,460);let xs=track.map(p=>p[0]),ys=track.map(p=>p[1]),minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys),scale=Math.min(680/(maxx-minx),420/(maxy-miny));let xy=(x,y)=>[20+(x-minx)*scale,20+(maxy-y)*scale];ctx.strokeStyle='#64748b';ctx.lineWidth=3;ctx.beginPath();track.forEach((p,i)=>{let [x,y]=xy(...p);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.stroke();let [sx,sy]=xy(917,403);ctx.fillStyle='#facc15';ctx.fillRect(sx-5,sy-5,10,10);f.d.filter(d=>activeAt(d[0],f.t)).forEach(d=>{let [x,y]=xy(d[1],d[2]);ctx.fillStyle=colors[ids.indexOf(d[0])%colors.length];ctx.beginPath();ctx.arc(x,y,4,0,7);ctx.fill()});ctx.fillStyle='#e5e7eb';ctx.font='12px system-ui';ctx.fillText('Yellow = provisional S/F',15,448);
ctx=trace.getContext('2d');ctx.clearRect(0,0,720,460);let [autoLo,autoHi]=traceBounds();let lo=traceView.y0??autoLo,hi=traceView.y1??autoHi;const x0=traceView.x0,x1=traceView.x1;
const [distMin,distMax]=distanceBounds();
const xCoord=lap=>50+(((lap-distMin)/(distMax-distMin)-x0)/(x1-x0))*655;
ctx.save();ctx.beginPath();ctx.rect(50,20,658,435);ctx.clip();ctx.strokeStyle='#475569';ctx.lineWidth=1;for(let i=0;i<=4;i++){let y=25+i*100;ctx.beginPath();ctx.moveTo(50,y);ctx.lineTo(708,y);ctx.stroke();ctx.fillStyle='#94a3b8';ctx.fillText((hi-(hi-lo)*i/4).toFixed(0)+'s',5,y)}// Lap boundary markers: one complete circuit per integer of aligned progress.
ctx.save();ctx.lineWidth=1;ctx.font='11px system-ui';ctx.textAlign='center';
for(let lap=Math.ceil(distMin);lap<=Math.floor(distMax);lap++){
 if(655/((distMax-distMin)*(x1-x0))<23 && lap%2)continue;
 const x=xCoord(lap);if(x<50||x>708)continue;
 ctx.strokeStyle='#475569';ctx.setLineDash([3,6]);ctx.beginPath();ctx.moveTo(x,20);ctx.lineTo(x,425);ctx.stroke();
 ctx.setLineDash([]);ctx.fillStyle='#cbd5e1';ctx.fillText('L'+lap,x,443);
}
ctx.restore();
for(const id of ids){
 const color=colors[ids.indexOf(id)%colors.length];ctx.strokeStyle=color;ctx.lineWidth=1.5;
 let last=null;
 for(const seg of traceSegments(id,referenceSeconds)){
  ctx.beginPath();let started=false;
  for(const p of seg){
   if(p.frame>idx)break;
   const x=xCoord(p.lap);
   const y=25+(hi-p.value)/(hi-lo)*400;
   if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y);
   last=[x,y];
  }
  ctx.stroke();
 }
 if(last&&last[0]>=50&&last[0]<=708){ctx.fillStyle=color;ctx.fillText(id,Math.min(last[0]+3,694),last[1])}
}
// Overlay the exact diagnostic (+) values in main-chart coordinates.
// Draw it over HAM's existing trace, and verify both values at every sample.
if(document.getElementById('hamOverlay').checked){
 const id='44',arr=tracks.get(id)||[],seconds=referenceSeconds;
 ctx.strokeStyle='#facc15';ctx.lineWidth=2.4;ctx.setLineDash([6,4]);ctx.beginPath();
 let last=null,count=0,maxDiff=0;
 for(let j=0;j<arr.length;j++){
  const p=arr[j];if(p[0]>idx)break;if(p[2]<raceStart)continue;if(!activeAt(id,p[2]))break;
  const baseline=p[1]*seconds-p[2];
  const correction=refTime(p[1],seconds,id,j)-p[1]*seconds;
  const diagnostic=baseline+correction;
  const main=refTime(p[1],seconds,id,j)-p[2];
  maxDiff=Math.max(maxDiff,Math.abs(diagnostic-main));count++;
  const x=xCoord(p[1]);
  const y=25+(hi-diagnostic)/(hi-lo)*400;
  const discontinuity=last&&(p[2]-last[2]>8||p[2]<=last[2]||Math.abs(p[1]-last[3])>0.16);
  if(discontinuity){ctx.stroke();ctx.beginPath();ctx.moveTo(x,y)}
  else if(last)ctx.lineTo(x,y);else ctx.moveTo(x,y);
  last=[x,y,p[2],p[1]];
 }
 ctx.stroke();ctx.setLineDash([]);
 document.getElementById('overlayStatus').textContent=`HAM: ${count} matching samples · max difference ${maxDiff.toExponential(2)} s`;
}else document.getElementById('overlayStatus').textContent='';
ctx.restore();}
document.getElementById('hamOverlay').onchange=()=>draw();

// Diagnostic speed plot: both curves are evaluated against the same car-specific
// lap-distance coordinate, never leader time. This does not change the trace.
const speedDriver=document.getElementById('speedDriver'),speedLap=document.getElementById('speedLap');
for(const id of ids){const opt=document.createElement('option');opt.value=id;opt.textContent=id;speedDriver.appendChild(opt)}
speedDriver.value=ids.includes('44')?'44':ids[0];
function updateSpeedLaps(){
 const id=speedDriver.value,arr=tracks.get(id)||[],laps=new Set();
 for(const p of arr)if(p[2]>=raceStart&&activeAt(id,p[2]))laps.add(Math.floor(p[1]));
 const previous=speedLap.value;speedLap.replaceChildren();
 for(const n of [...laps].sort((a,b)=>a-b)){const o=document.createElement('option');o.value=String(n);o.textContent=String(n);speedLap.appendChild(o)}
 if([...speedLap.options].some(o=>o.value===previous))speedLap.value=previous;
 else if(speedLap.options.length)speedLap.value=speedLap.options[Math.min(2,speedLap.options.length-1)].value;
}
speedDriver.onchange=()=>{updateSpeedLaps();drawSpeedChart();drawProfileChart();drawSignChart()};
speedLap.onchange=()=>drawSpeedChart();
updateSpeedLaps();
function profileAt(f){
 if(modeSelect.value==='mini'&&validMini(miniProfile))return miniFraction(f);
 if(modeSelect.value==='driver'){const p=driverProfiles.get(speedDriver.value);return phasedFraction(f,learnedPhase,validProfile(p)?p:learnedProfile)}
 if(modeSelect.value==='learned'&&validProfile(learnedProfile))return phasedFraction(f,learnedPhase);
 return f;
}
function drawSignChart(){
 const canvas=document.getElementById('signChart');if(!canvas)return;
 const c=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
 c.clearRect(0,0,W,H);
 const id=speedDriver.value,seconds=Number(refLap.value)||106.5;
 const arr=(tracks.get(id)||[]).filter(p=>p[2]>=raceStart&&activeAt(id,p[2]));
 if(arr.length<2)return;
 const model=modeSelect.value;
 const values=arr.map(p=>{
  const baseline=p[1]*seconds-p[2];
  const correction=refTime(p[1],seconds,id)-p[1]*seconds;
  return {t:p[2],baseline,plus:baseline+correction,minus:baseline-correction,correction};
 });
 const all=values.flatMap(v=>[v.baseline,v.plus,v.minus]);
 let lo=Math.min(...all),hi=Math.max(...all),pad=Math.max(5,(hi-lo)*.06);lo-=pad;hi+=pad;
 const t0=values[0].t,t1=values.at(-1).t;
 const X=t=>65+(t-t0)/(t1-t0||1)*(W-90),Y=v=>H-45-(v-lo)/(hi-lo)*(H-75);
 c.font='12px system-ui';c.lineWidth=1;c.strokeStyle='#334155';c.fillStyle='#94a3b8';
 for(let i=0;i<=5;i++){const v=lo+(hi-lo)*i/5,y=Y(v);c.beginPath();c.moveTo(65,y);c.lineTo(W-25,y);c.stroke();c.fillText(v.toFixed(0)+' s',8,y+4)}
 for(let i=0;i<=6;i++){const t=t0+(t1-t0)*i/6,x=X(t);c.beginPath();c.moveTo(x,20);c.lineTo(x,H-45);c.stroke();c.fillText(((t-t0)/60).toFixed(1)+' min',x-16,H-18)}
 for(const [key,color] of [['baseline','#cbd5e1'],['plus','#facc15'],['minus','#34d399']]){
  c.strokeStyle=color;c.lineWidth=1.7;c.beginPath();values.forEach((v,i)=>{const x=X(v.t),y=Y(v[key]);i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke();
 }
 const rms=Math.sqrt(values.reduce((a,v)=>a+v.correction*v.correction,0)/values.length);
 document.getElementById('signInfo').textContent=`Driver ${id} · ${values.length} GPS samples · reference mode: ${model} · correction RMS ${rms.toFixed(2)} s. Compare which coloured line has fewer lap-periodic oscillations; this is a diagnostic, not an automatic choice.`;
}
function drawSpeedChart(){
 const canvas=document.getElementById('speedChart'),ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
 ctx.clearRect(0,0,W,H);
 const id=speedDriver.value,lap=Number(speedLap.value),arr=tracks.get(id)||[],ref=Number(refLap.value)||106.5;
 if(!Number.isFinite(lap))return;
 const points=[];let rejected=0;
 for(let j=1;j<arr.length;j++){
  const a=arr[j-1],b=arr[j];if(a[2]<raceStart||!activeAt(id,b[2]))continue;
  const dt=b[2]-a[2],ds=b[1]-a[1],mid=(a[1]+b[1])/2;
  if(!(dt>.01&&dt<8&&ds>0&&ds<.12)){rejected++;continue}
  if(Math.floor(mid)!==lap)continue;
  points.push({x:(mid-lap)*100,y:100*ds/dt});
 }
 const reference=[];
 for(let i=0;i<=400;i++){
  const f=Math.min(.9995,Math.max(.0005,i/400)),eps=.001;
  const driverProfile=driverProfiles.get(id),selectedProfile=modeSelect.value==='driver'&&validProfile(driverProfile)?driverProfile:learnedProfile;
  const slope=(modeSelect.value==='learned'||modeSelect.value==='driver')&&validProfile(selectedProfile)?profileEval(f,selectedProfile).slope:(profileAt(Math.min(1,f+eps))-profileAt(Math.max(0,f-eps)))/(Math.min(1,f+eps)-Math.max(0,f-eps));
  reference.push({x:f*100,y:100/(ref*Math.max(.0001,slope))});
 }
 const combined=[...points,...reference].map(p=>p.y).filter(v=>Number.isFinite(v)&&v>0&&v<8);
 const ymax=Math.max(1,Math.min(8,(combined.sort((a,b)=>a-b)[Math.floor(combined.length*.98)]||1)*1.25));
 const L=66,R=W-25,T=20,B=H-45,X=x=>L+x/100*(R-L),Y=y=>B-y/ymax*(B-T);
 ctx.font='12px system-ui';ctx.lineWidth=1;
 for(let i=0;i<=5;i++){const y=i*ymax/5;ctx.strokeStyle='#334155';ctx.beginPath();ctx.moveTo(L,Y(y));ctx.lineTo(R,Y(y));ctx.stroke();ctx.fillStyle='#94a3b8';ctx.fillText(y.toFixed(2),12,Y(y)+4)}
 for(let i=0;i<=10;i++){const x=i*10;ctx.strokeStyle='#243244';ctx.beginPath();ctx.moveTo(X(x),T);ctx.lineTo(X(x),B);ctx.stroke();ctx.fillStyle='#94a3b8';ctx.fillText(x+'%',X(x)-12,H-17)}
 function line(data,color,width){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();let last=null;for(const p of data){if(p.y<0||p.y>ymax*1.3)continue;if(last&&p.x-last.x>6){ctx.stroke();ctx.beginPath();ctx.moveTo(X(p.x),Y(p.y))}else if(last)ctx.lineTo(X(p.x),Y(p.y));else ctx.moveTo(X(p.x),Y(p.y));last=p}ctx.stroke()}
 line(reference,'#facc15',2.5);line(points,colors[ids.indexOf(id)%colors.length],1.8);
 ctx.fillStyle='#facc15';ctx.fillText('— Reference speed',L+12,35);ctx.fillStyle=colors[ids.indexOf(id)%colors.length];ctx.fillText('— Car '+id+' GPS speed',L+185,35);
 document.getElementById('speedInfo').textContent=`${points.length} speed samples on lap ${lap} · ${rejected} samples filtered across recording · x = lap distance, y = % lap / s`;
}
function drawProfileChart(){
 const canvas=document.getElementById('profileChart'),c=canvas.getContext('2d'),W=1100,H=290;
 c.clearRect(0,0,W,H);if(modeSelect.value==='constant')return;
 if(modeSelect.value==='mini'&&!validMini(miniProfile))return;
 if((modeSelect.value==='learned'||modeSelect.value==='driver')&&!validProfile(learnedProfile))return;
 const vals=Array.from({length:PROFILE_BINS+1},(_,i)=>{const f=i/PROFILE_BINS;return (modeSelect.value==='mini'?miniFraction(f):phasedFraction(f,learnedPhase,modeSelect.value==='driver'&&validProfile(driverProfiles.get(speedDriver.value))?driverProfiles.get(speedDriver.value):learnedProfile))-f});
 const max=Math.max(.015,...vals.map(v=>Math.abs(v)))*1.15;
 const X=i=>55+i/PROFILE_BINS*(W-85),Y=v=>H/2-v/max*(H/2-30);
 c.strokeStyle='#334155';c.lineWidth=1;c.beginPath();c.moveTo(55,H/2);c.lineTo(W-30,H/2);c.stroke();
 c.strokeStyle='#38bdf8';c.lineWidth=2;c.beginPath();vals.forEach((v,i)=>i?c.lineTo(X(i),Y(v)):c.moveTo(X(i),Y(v)));c.stroke();
 c.fillStyle='#94a3b8';c.font='13px system-ui';
 c.fillText('0% distance',55,H-8);c.fillText('50%',X(50)-15,H-8);c.fillText('100%',W-85,H-8);
 c.fillText('+'+(max*Number(refLap.value)).toFixed(1)+' s',5,20);
 c.fillText('−'+(max*Number(refLap.value)).toFixed(1)+' s',5,H-25);
}
const diagnostics=document.getElementById('diagnostics');
function drawDiagnostics(){
 const c=diagnostics.getContext('2d'),W=1100,H=430; c.clearRect(0,0,W,H);
 const xmax=frames.at(-1).t, xmin=0, left=65, right=W-20, top=25,bottom=H-45;
 const all=ids.flatMap(id=>tracks.get(id).filter(p=>p[2]>=raceStart&&activeAt(id,p[2])).map(p=>p[1]));let low=Math.floor(Math.min(...all)),high=Math.ceil(Math.max(...all));
 const X=t=>left+(t-xmin)/(xmax-xmin)*(right-left),Y=v=>bottom-(v-low)/(high-low||1)*(bottom-top);
 c.strokeStyle='#334155';c.lineWidth=1;c.font='12px system-ui';c.fillStyle='#94a3b8';
 for(let lap=low;lap<=high;lap++){let y=Y(lap);c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();c.fillText(lap+' laps',8,y+4)}
 for(let t=0;t<=xmax;t+=300){let x=X(t);c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke();c.fillText(Math.round(t/60)+' min',x-12,H-16)}
 let lines=0,crossings=0;
 for(let id of ids){let arr=tracks.get(id),color=colors[ids.indexOf(id)%colors.length];c.strokeStyle=color;c.lineWidth=1.1;c.beginPath();let prev=null;
  for(let p of arr){if(p[2]<raceStart)continue;if(!activeAt(id,p[2]))break;let x=X(p[2]),y=Y(p[1]);if(!prev)c.moveTo(x,y);else c.lineTo(x,y);
   if(prev&&Math.floor(p[1])>Math.floor(prev[1])&&p[1]-prev[1]<0.2){c.fillStyle=color;c.fillRect(x-2,y-2,4,4);crossings++}prev=p}
  c.stroke();lines++;if(prev){c.fillStyle=color;c.fillText(id,Math.min(X(prev[2])+3,right-16),Y(prev[1]))}
 }
 document.getElementById('diagReadout').textContent=`${anchoredDrivers} race-anchored drivers (${unanchoredDrivers.join(", ")||"none"} unanchored) · ${crossings} detected lap boundaries (small squares) · each horizontal gridline is one complete centreline lap · x-axis is elapsed recording time. A normal race shows steadily rising diagonal lines; flat sections or jumps reveal tracking faults.`;
}
drawDiagnostics();
let drag=null;
trace.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,x0:traceView.x0,x1:traceView.x1,y0:traceView.y0,y1:traceView.y1,bounds:traceBounds()};trace.setPointerCapture(e.pointerId);trace.style.cursor='grabbing'});
trace.addEventListener('pointermove',e=>{if(!drag)return;const r=trace.getBoundingClientRect(),dx=(e.clientX-drag.x)*720/r.width,dy=(e.clientY-drag.y)*460/r.height;const [lo,hi]=drag.y0===null?drag.bounds:[drag.y0,drag.y1];const sx=dx/655*(drag.x1-drag.x0),sy=dy/400*(hi-lo);traceView.x0=drag.x0-sx;traceView.x1=drag.x1-sx;traceView.y0=lo+sy;traceView.y1=hi+sy;draw()});
trace.addEventListener('pointerup',()=>{drag=null;trace.style.cursor='grab'});trace.addEventListener('pointercancel',()=>{drag=null;trace.style.cursor='grab'});
trace.addEventListener('wheel',e=>{e.preventDefault();const r=trace.getBoundingClientRect(),px=Math.max(0,Math.min(1,((e.clientX-r.left)*720/r.width-50)/655)),py=Math.max(0,Math.min(1,((e.clientY-r.top)*460/r.height-25)/400));const zoom=e.deltaY<0?0.8:1.25;const vx=traceView.x0+px*(traceView.x1-traceView.x0);const [lo,hi]=traceView.y0===null?traceBounds():[traceView.y0,traceView.y1];const vy=hi-py*(hi-lo);const nw=(traceView.x1-traceView.x0)*zoom,nh=(hi-lo)*zoom;traceView.x0=vx-px*nw;traceView.x1=traceView.x0+nw;traceView.y1=vy+py*nh;traceView.y0=traceView.y1-nh;draw()},{passive:false});
trace.addEventListener('dblclick',resetTraceView);document.getElementById('resetZoom').onclick=resetTraceView;
scrub.oninput=draw;refLap.oninput=draw;document.getElementById('play').onclick=()=>{running=!running;document.getElementById('play').textContent=running?'⏸ Pause':'▶ Play';clearInterval(timer);if(running)timer=setInterval(()=>{scrub.value=(+scrub.value+1)%frames.length;draw()},55)};draw();