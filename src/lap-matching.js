/* Match projected centreline crossings to official lap counter increments.
 * A geometric crossing is only a candidate, never proof of a completed lap.
 */
(function(root){
'use strict';
function match(projected,official,{toleranceSeconds=45,pitIntervals=null,pitMargin=2}={}){
 const matched=[],unmatched=[],used=new Map();
 for(const [driver,lap,time] of official){
  const points=projected.get(String(driver))||[];
  let nearest=null;
  const claimed=used.get(String(driver))||new Set();
  for(const p of points){
   const error=Math.abs(p.time-time);
   if(!claimed.has(p)&&error<=toleranceSeconds&&(!nearest||error<nearest.error))
    nearest={driver:String(driver),lap,time,projectedTime:p.time,error,pit:!!(pitIntervals&&root.RaceTracePitLane.flagged(pitIntervals,driver,p.time,{margin:pitMargin}))};
  }
  if(nearest){
   const chosen=points.find(p=>p.time===nearest.projectedTime&&!claimed.has(p));
   if(chosen){claimed.add(chosen);used.set(String(driver),claimed);}
   matched.push(nearest);
  }
  else unmatched.push({driver:String(driver),lap,time});
 }
 const surplus=[];
 for(const [driver,points] of projected){
  const driverEvents=official.filter(e=>String(e[0])===String(driver));
  const first=Math.min(...driverEvents.map(e=>e[2]));
  const last=Math.max(...driverEvents.map(e=>e[2]));
  const claimed=used.get(String(driver))||new Set();
  for(const p of points){
   if(claimed.has(p))continue;
   const classification=!driverEvents.length?'no_official_timing':
     p.time<first?'before_first_official_lap':
     p.time>last?'after_last_official_lap':'unmatched_within_timing';
   surplus.push({driver:String(driver),time:p.time,classification});
  }
 }
 return {matched,unmatched,surplus};
}
root.RaceTraceLapMatching=Object.freeze({match});
if(typeof module!=='undefined'&&module.exports)module.exports=root.RaceTraceLapMatching;
})(typeof globalThis!=='undefined'?globalThis:this);
