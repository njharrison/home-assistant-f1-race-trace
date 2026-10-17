/* Identify pit-lane intervals from HA timing snapshots.
 * Intervals are advisory: never synthesize an official lap crossing.
 */
(function(root){
'use strict';
function intervals(recording){
 if(!Array.isArray(recording?.samples))throw Error('Missing timing samples');
 const open=new Map(),result=new Map(),last=new Map();
 for(const sample of recording.samples){
  const time=Number(sample.timestamp);
  if(!Number.isFinite(time))continue;
  for(const driver of sample.drivers||[]){
   const id=String(driver.id??'');
   if(!id)continue;
   const status=String(driver.status??'').toLowerCase();
   const pit=status==='pit_in'||status==='pit_out'||status==='in_pit'||status==='pit';
   if(pit&&!open.has(id))open.set(id,time);
   if(!pit&&open.has(id)){
    if(!result.has(id))result.set(id,[]);
    result.get(id).push([open.get(id),time]);
    open.delete(id);
   }
   last.set(id,time);
  }
 }
 for(const [id,start] of open){
  if(!result.has(id))result.set(id,[]);
  result.get(id).push([start,last.get(id)]);
 }
 return result;
}
function flagged(pitIntervals,id,time,{margin=2}={}){
 return (pitIntervals.get(String(id))||[]).some(([start,end])=>time>=start-margin&&time<=end+margin);
}
root.RaceTracePitLane=Object.freeze({intervals,flagged});
if(typeof module!=='undefined'&&module.exports)module.exports=root.RaceTracePitLane;
})(typeof globalThis!=='undefined'?globalThis:this);
