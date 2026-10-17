/* Shared Race Trace input contract. No Home Assistant dependency. */
(function(root){
  'use strict';
  function validate(snapshot){
    if(!snapshot || !Array.isArray(snapshot.track) || snapshot.track.length<3) throw new Error('Race Trace requires a circuit centreline with at least three [x,y] points');
    if(!Array.isArray(snapshot.frames) || !snapshot.frames.length) throw new Error('Race Trace requires nonempty GPS frames');
    for(const p of snapshot.track) if(!Array.isArray(p)||p.length<2||!Number.isFinite(+p[0])||!Number.isFinite(+p[1])) throw new Error('Invalid centreline coordinate');
    let previous=-Infinity;
    for(const frame of snapshot.frames){
      if(!Number.isFinite(frame.t)||frame.t<previous||!Array.isArray(frame.d)) throw new Error('GPS frames must have increasing timestamps and a driver array');
      previous=frame.t;
      for(const driver of frame.d) if(!Array.isArray(driver)||driver.length<3||!Number.isFinite(+driver[1])||!Number.isFinite(+driver[2])) throw new Error('Invalid driver position');
    }
    return snapshot;
  }
  function fixture(data){return {kind:'fixture',snapshot(){return validate(data)}}}
  function fromHomeAssistant({track, frames, getTrack, getFrames}={}){
    return {kind:'home-assistant',snapshot(){
      // The HA wrapper supplies decoded circuit coordinates and GPS samples.
      // No assumptions about entity IDs, recorder attributes, or event schema.
      const currentTrack=typeof getTrack==='function'?getTrack():track;
      const currentFrames=typeof getFrames==='function'?getFrames():frames;
      return validate({track:currentTrack,frames:currentFrames});
    }};
  }
  const api=Object.freeze({validate,fixture,fromHomeAssistant});
  root.RaceTraceDataSources=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);