/* Race timing adapter: derives first racing-lap crossing from completed-lap transitions. */
(function(root){
  'use strict';
  function lapTwoAnchors(crossings){
    if(!Array.isArray(crossings)) throw new Error('Missing timing lap crossings');
    const anchors={};
    for(const [driver,completed,time] of crossings){
      if(completed===2 && Number.isFinite(time) && anchors[String(driver)]===undefined)
        anchors[String(driver)]=Math.round((time+Number.EPSILON)*100)/100;
    }
    return anchors;
  }
  root.RaceTraceTiming=Object.freeze({lapTwoAnchors});
})(typeof globalThis!=='undefined'?globalThis:this);
