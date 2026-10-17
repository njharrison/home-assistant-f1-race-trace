/* Convert the HA timing recorder's completed-lap counters into
 * lap-crossing events in the same wall-clock domain as GPS recorded_at.
 * Do not confuse GPS timestamp (race replay clock) with recorded_at.
 */
(function(root){
'use strict';
function crossings(recording){
 if(recording?.schema_version!==1||!Array.isArray(recording.samples))throw Error('Invalid timing recording');
 const previous=new Map(),events=[];
 for(const sample of recording.samples){
  if(!Number.isFinite(sample.timestamp))continue;
  for(const driver of sample.drivers||[]){
   const id=String(driver.id??'');
   const lap=driver.completed_laps;
   if(!id||!Number.isInteger(lap))continue;
   const prior=previous.get(id);
   if(prior!==undefined&&lap>prior&&lap-prior===1)
    events.push([id,lap,sample.timestamp]);
   previous.set(id,lap);
  }
 }
 return events;
}
function gpsFrames(recording){
 if(recording?.schema_version!==1||!Array.isArray(recording.samples))throw Error('Invalid GPS recording');
 return recording.samples.filter(s=>Number.isFinite(s.recorded_at)).map(s=>({
  t:s.recorded_at,
  d:(s.drivers||[]).filter(d=>d&&Number.isFinite(d.x)&&Number.isFinite(d.y)&&!(d.x===0&&d.y===0))
    .map(d=>[String(d.id),d.x,d.y])
 }));
}
root.RaceTraceRecordingSync=Object.freeze({crossings,gpsFrames});
if(typeof module!=='undefined'&&module.exports)module.exports=root.RaceTraceRecordingSync;
})(typeof globalThis!=='undefined'?globalThis:this);
