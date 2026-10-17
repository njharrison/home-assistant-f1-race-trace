/* Experimental timing-led alignment of already-unwrapped driver tracks.
 * A track point is [frameIndex, unwrappedLapDistance, raceTime].
 * Never infer lap count from a pit-lane shortcut alone.
 */
(function(root){
'use strict';
function align(tracks,official,{windowSeconds=45}={}){
 const diagnostics={aligned:[],missing:[]};
 for(const [id,points] of tracks){
  const events=official.filter(e=>String(e[0])===String(id)&&e[1]>=2)
    .sort((a,b)=>a[2]-b[2]);
  const first=events[0];
  if(!first||points.length<2){diagnostics.missing.push(String(id));continue;}
  const time=first[2];
  let closest=null;
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i];
   if(a[2]>time||b[2]<time||b[2]===a[2])continue;
   const fraction=(time-a[2])/(b[2]-a[2]);
   const value=a[1]+fraction*(b[1]-a[1]);
   const proximity=Math.min(time-a[2],b[2]-time);
   if(!closest||proximity<closest.proximity)
    closest={value,proximity,interval:b[2]-a[2]};
  }
  if(!closest||closest.interval>windowSeconds*2){
   diagnostics.missing.push(String(id));continue;
  }
  // Lap 1 is the first racing lap. Official 1->2 occurs at its end.
  const shift=1-closest.value;
  for(const point of points)point[1]+=shift;
  diagnostics.aligned.push({driver:String(id),shift,interval:closest.interval});
 }
 return diagnostics;
}
root.RaceTraceOfficialAlignment=Object.freeze({align});
if(typeof module!=='undefined'&&module.exports)module.exports=root.RaceTraceOfficialAlignment;
})(typeof globalThis!=='undefined'?globalThis:this);
