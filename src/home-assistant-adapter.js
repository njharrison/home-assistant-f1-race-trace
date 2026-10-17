/* Convert the Home Assistant GPS recorder's schema into the shared trace input.
 * No assumptions about Singapore track keys or start/finish coordinates.
 * Returns the same {track,frames} contract used by the offline test harness.
 */
(function(root){
  'use strict';
  function point(p){
    if(Array.isArray(p)) return [Number(p[0]),Number(p[1])];
    if(p && typeof p==='object') return [Number(p.x ?? p.X),Number(p.y ?? p.Y)];
    return [NaN,NaN];
  }
  function geometryPoints(geometry){
    const raw=Array.isArray(geometry)?geometry:
      (geometry?.points ?? geometry?.track ?? geometry?.coordinates ?? geometry?.centreline ?? geometry?.centerline);
    if(!Array.isArray(raw)) throw new Error('GPS recording has no supported centreline');
    return raw.map(point);
  }
  function convert(recording){
    if(recording?.schema_version!==1||!Array.isArray(recording.samples))
      throw new Error('Expected GPS recording schema_version 1 and samples array');
    const track=geometryPoints(recording.geometry);
    const samples=recording.samples.filter(s=>Number.isFinite(Number(s.timestamp)))
      .slice().sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
    if(!samples.length) throw new Error('No timestamped GPS samples');
    const origin=Number(samples[0].timestamp);
    const frames=samples.map(sample=>({
      t:Number(sample.timestamp)-origin,
      d:(sample.drivers||[]).filter(d=>d&&Number.isFinite(Number(d.x))&&Number.isFinite(Number(d.y)))
        .map(d=>[String(d.id??d.racing_number??''),Number(d.x),Number(d.y)])
        .filter(d=>d[0])
    }));
    return root.RaceTraceDataSources.validate({track,frames});
  }
  const api=Object.freeze({convert});
  root.RaceTraceHomeAssistantAdapter=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
