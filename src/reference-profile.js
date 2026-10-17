// Singapore 2026: reference profiles extracted unchanged from the validated preview.
// Requires the race state (tracks, raceStart, activeAt) defined by race-trace.js.
// Reference profiles use dimensionless lap-distance -> lap-time fractions, allowing
// reuse with different reference lap durations. GPS coordinate geometry is not exported.
const PROFILE_BINS=100;
function interpolate(arr,t){
 if(t<=arr[0][2])return arr[0][1];if(t>=arr.at(-1)[2])return arr.at(-1)[1];
 let lo=0,hi=arr.length-1;while(hi-lo>1){let m=(lo+hi)>>1;if(arr[m][2]<t)lo=m;else hi=m}
 let a=arr[lo],b=arr[hi],f=(t-a[2])/(b[2]-a[2]||1);return a[1]+(b[1]-a[1])*f;
}
function lapTimeAtDistance(arr,target,start,end){
 let lo=0,hi=arr.length-1;
 while(hi-lo>1){let m=(lo+hi)>>1;if(arr[m][1]<target)lo=m;else hi=m}
 const a=arr[lo],b=arr[hi];
 if(target<a[1]||target>b[1]||b[1]===a[1])return null;
 return a[2]+(target-a[1])/(b[1]-a[1])*(b[2]-a[2]);
}
function median(vals){vals.sort((a,b)=>a-b);return vals.length?vals[Math.floor(vals.length/2)]:null}
function learnProfile(driverId=null){
 const laps=[];
 for(const [id,all] of tracks){
  if(driverId!==null&&id!==driverId)continue;
  const arr=all.filter(p=>p[2]>=raceStart&&activeAt(id,p[2]));
  if(arr.length<30)continue;
  const minLap=Math.ceil(arr[0][1]),maxLap=Math.floor(arr.at(-1)[1]);
  for(let n=minLap;n<maxLap;n++){
   const times=[];let valid=true;
   for(let k=0;k<=PROFILE_BINS;k++){
    const t=lapTimeAtDistance(arr,n+k/PROFILE_BINS);
    if(t===null){valid=false;break}times.push(t);
   }
   if(!valid)continue;
   const duration=times.at(-1)-times[0];
   if(duration<85||duration>135)continue;
   if(times.some((t,i)=>i&&t-times[i-1]<=0))continue;
   if(times.some((t,i)=>i&&t-times[i-1]>duration*.075))continue;
   laps.push({id,duration,values:times.map(t=>(t-times[0])/duration)});
  }
 }
 if(laps.length<(driverId===null?5:2))return null;
 const pace=median(laps.map(l=>l.duration));
 const selected=laps.filter(l=>Math.abs(l.duration-pace)<12);
 if(selected.length<(driverId===null?5:2))return null;
 // Construct a median cumulative time-vs-distance curve, rather than
 // independently combining sector speeds (which introduces stair-steps).
 const cumulative=Array.from({length:PROFILE_BINS+1},(_,k)=>k===0?0:k===PROFILE_BINS?1:median(selected.map(l=>l.values[k])));
 const radius=5,sigma=2.1;
 const values=cumulative.map((v,i)=>{
  if(i===0)return 0;if(i===PROFILE_BINS)return 1;
  let total=0,weight=0;
  for(let j=-radius;j<=radius;j++){
   const k=Math.max(0,Math.min(PROFILE_BINS,i+j));
   const w=Math.exp(-.5*(j/sigma)**2);total+=w*cumulative[k];weight+=w;
  }
  return total/weight;
 });
 for(let i=1;i<PROFILE_BINS;i++)values[i]=Math.max(values[i],values[i-1]+1e-7);
 if(values.at(-2)>=1)return null;
 return {schema_version:1,type:'f1-race-trace-normalised-reference',driver_id:driverId,circuit:'Singapore',track_key:'61',bins:PROFILE_BINS,lap_count:selected.length,source:'median cumulative crossing times, Gaussian-smoothed, monotone cubic interpolation',reference_lap_seconds:pace,values};
}
let learnedProfile=learnProfile();
let driverProfiles=new Map([...tracks.keys()].map(id=>[id,learnProfile(id)]));

// Independent mini-sector reference. Fixed DISTANCE boundaries are placed at
// ~2-second intervals along the learned median lap. Every driver traverses the
// same boundaries; no leader-relative timing enters the reference lookup.
function buildMiniProfile(base){
 if(!validProfile(base))return null;
 const sectors=Math.max(20,Math.round(base.reference_lap_seconds/2));
 const boundary=[0];
 for(let j=1;j<sectors;j++){
  const target=j/sectors;let lo=0,hi=base.bins;
  while(hi-lo>1){const m=(lo+hi)>>1;if(base.values[m]<target)lo=m;else hi=m}
  const v0=base.values[lo],v1=base.values[hi];
  boundary.push((lo+(target-v0)/Math.max(1e-9,v1-v0))/base.bins);
 }
 boundary.push(1);
 const observations=Array.from({length:sectors},()=>[]);
 let accepted=0;
 for(const [id,all] of tracks){
  const arr=all.filter(p=>p[2]>=raceStart&&activeAt(id,p[2]));
  if(arr.length<30)continue;
  for(let lap=Math.ceil(arr[0][1]);lap<Math.floor(arr.at(-1)[1]);lap++){
   const times=boundary.map(f=>lapTimeAtDistance(arr,lap+f));
   if(times.some(t=>t===null))continue;
   const duration=times.at(-1)-times[0];
   if(duration<85||duration>135||times.some((t,i)=>i&&t<=times[i-1]))continue;
   if(times.some((t,i)=>i&&t-times[i-1]>duration*.075))continue;
   accepted++;
   for(let i=0;i<sectors;i++)observations[i].push((times[i+1]-times[i])/duration);
  }
 }
 if(accepted<5)return null;
 const weights=observations.map(vals=>median(vals));
 if(weights.some(v=>!Number.isFinite(v)||v<=0))return null;
 const total=weights.reduce((a,b)=>a+b,0);
 const values=[0];for(const w of weights)values.push(values.at(-1)+w/total);
 values[sectors]=1;
 return {schema_version:1,type:'f1-race-trace-mini-sectors',track_key:'61',circuit:'Singapore',sector_count:sectors,lap_count:accepted,reference_lap_seconds:base.reference_lap_seconds,boundaries:boundary,values,source:'GPS interpolated boundary crossing times; median normalised mini-sector durations'};
}
function validMini(p){return p&&p.schema_version===1&&p.type==='f1-race-trace-mini-sectors'&&p.track_key==='61'&&Number.isInteger(p.sector_count)&&p.sector_count>=20&&p.sector_count<=200&&Array.isArray(p.boundaries)&&Array.isArray(p.values)&&p.boundaries.length===p.sector_count+1&&p.values.length===p.boundaries.length&&[p.boundaries,p.values].every(a=>a.every((v,i)=>Number.isFinite(v)&&v>=0&&v<=1&&(i===0||v>a[i-1]))&&Math.abs(a[0])<1e-7&&Math.abs(a.at(-1)-1)<1e-7)}
function miniFraction(frac){
 const p=miniProfile;if(!validMini(p))return frac;
 const f=((frac%1)+1)%1;let lo=0,hi=p.sector_count;
 while(hi-lo>1){const m=(lo+hi)>>1;if(p.boundaries[m]<=f)lo=m;else hi=m}
 const u=(f-p.boundaries[lo])/(p.boundaries[hi]-p.boundaries[lo]);
 return p.values[lo]+u*(p.values[hi]-p.values[lo]);
}

let miniProfile=buildMiniProfile(learnedProfile);
const modeSelect=document.getElementById('profileMode');
function validProfile(p){return p&&p.schema_version===1&&p.type==='f1-race-trace-normalised-reference'&&p.bins===PROFILE_BINS&&Array.isArray(p.values)&&p.values.length===PROFILE_BINS+1&&p.values.every((v,i)=>Number.isFinite(v)&&v>=0&&v<=1&&(i===0||v>=p.values[i-1]))&&Math.abs(p.values[0])<1e-7&&Math.abs(p.values.at(-1)-1)<1e-7}
// The learned curve's zero is the GPS lap boundary, not necessarily the
// physical start/finish point. Align the reference phase to actual GPS speed
// changes; keep this ONE global offset for all cars, never a leader-time offset.
// Monotone cubic Hermite interpolation. Evaluate time and analytic derivative
// from exactly the same function so reference speed agrees with reference time.
function profileEval(f,profile=learnedProfile){
 if(!validProfile(profile))return {value:f,slope:1};
 const n=profile.bins,y=profile.values;
 const u=Math.max(0,Math.min(1,f))*n,i=Math.min(n-1,Math.floor(u)),t=u-i,h=1/n;
 const d=j=>n*(y[j+1]-y[j]);
 const tangent=j=>{
  if(j===0)return Math.max(0,(3*d(0)-d(1))/2);
  if(j===n)return Math.max(0,(3*d(n-1)-d(n-2))/2);
  const a=d(j-1),b=d(j);return a*b<=0?0:2*a*b/(a+b);
 };
 const m0=tangent(i),m1=tangent(i+1);
 const value=(2*t**3-3*t*t+1)*y[i]+(t**3-2*t*t+t)*h*m0+(-2*t**3+3*t*t)*y[i+1]+(t**3-t*t)*h*m1;
 const slope=((6*t*t-6*t)*y[i]+(3*t*t-4*t+1)*h*m0+(-6*t*t+6*t)*y[i+1]+(3*t*t-2*t)*h*m1)/h;
 return {value,slope:Math.max(1e-6,slope)};
}
function rawProfile(f,profile=learnedProfile){return profileEval(((f%1)+1)%1,profile).value;}
function phasedFraction(f,shift,profile=learnedProfile){
 const a=rawProfile(shift,profile),v=f+shift;
 return Math.floor(v)+rawProfile(v,profile)-a;
}
// Profile samples are already indexed by the same GPS lap coordinate used
// for each driver's position. A second phase fit shifts braking zones away
// from their true distance and introduces periodic sawtooths.
let learnedPhase=0;
// Circular Gaussian low-pass applied to median *distance-bin pace*, not
// to individual car traces. Preserve positive speed and exact [0,1] endpoints.
function smoothProfile(profile,fromIncrements=false){
 if(!profile)return null;
 const n=profile.bins;
 const pace=fromIncrements?profile.values.slice(1):Array.from({length:n},(_,i)=>profile.values[i+1]-profile.values[i]);
 const radius=8,sigma=3.5;
 const filtered=pace.map((_,i)=>{
  let sum=0,weight=0;
  for(let j=-radius;j<=radius;j++){
   const w=Math.exp(-.5*(j/sigma)**2);
   sum+=w*Math.max(1e-7,pace[(i+j+n)%n]);weight+=w;
  }
  return sum/weight;
 });
 const total=filtered.reduce((a,b)=>a+b,0);
 const values=[0];for(const v of filtered)values.push(values.at(-1)+v/total);
 values[n]=1;
 return {...profile,values,smoothed:true};
}
function rawCorrection(laps,profile=learnedProfile){
 const frac=((laps%1)+1)%1;
 return phasedFraction(frac,learnedPhase,profile)-frac;
}
function refTime(laps,seconds,id,index){
 if(modeSelect.value==='mini'&&validMini(miniProfile)){const whole=Math.floor(laps),fraction=laps-whole;return (whole+miniFraction(fraction))*seconds;}
 if(modeSelect.value==='driver'){
  const profile=driverProfiles.get(id);
  const chosen=validProfile(profile)?profile:learnedProfile;
  return validProfile(chosen)?(laps+rawCorrection(laps,chosen))*seconds:laps*seconds;
 }
 if(modeSelect.value!=='learned'||!validProfile(learnedProfile))return laps*seconds;
 const correction=rawCorrection(laps);
 return (laps+correction)*seconds;
}