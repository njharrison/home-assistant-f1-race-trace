/* Offline replay diagnostics. Inputs are prepared geometry, GPS frames with
 * wall-clock timestamps, and official completed-lap transitions.
 * Crossing candidates are geometric only; never increment laps without timing.
 */
(function(root){
'use strict';
function inspect(geometry,frames,events,finishDistance,direction,{toleranceSeconds=40}={}){
 const prior=new Map(),crossings=new Map();
 for(const frame of frames){
  for(const [id,x,y] of frame.d){
   if(!Number.isFinite(x)||!Number.isFinite(y)||(x===0&&y===0))continue;
   const phase=root.RaceTraceCircuit.phase(geometry,x,y,finishDistance,direction);
   const key=String(id),last=prior.get(key);
   if(last&&last.phase>0.8&&phase<0.2&&frame.t>last.time){
    const jump=(1-last.phase)+phase;
    if(jump<0.3){
     const fraction=(1-last.phase)/jump;
     if(!crossings.has(key))crossings.set(key,[]);
     crossings.get(key).push({time:last.time+fraction*(frame.t-last.time)});
    }
   }
   prior.set(key,{phase,time:frame.t});
  }
 }
 const result=root.RaceTraceLapMatching.match(crossings,events,{toleranceSeconds});
 const errors=result.matched.map(m=>m.error).sort((a,b)=>a-b);
 return {candidateCount:[...crossings.values()].reduce((n,a)=>n+a.length,0),
  officialCount:events.length,matchedCount:result.matched.length,
  unmatchedCount:result.unmatched.length,
  medianErrorSeconds:errors.length?errors[Math.floor(errors.length/2)]:null,
  surplusCount:result.surplus.length,
  surplusByReason:result.surplus.reduce((counts,item)=>{counts[item.classification]=(counts[item.classification]||0)+1;return counts;},{}),
  matched:result.matched,unmatched:result.unmatched,surplus:result.surplus};
}
root.RaceTraceReplayValidation=Object.freeze({inspect});
if(typeof module!=='undefined'&&module.exports)module.exports=root.RaceTraceReplayValidation;
})(typeof globalThis!=='undefined'?globalThis:this);
