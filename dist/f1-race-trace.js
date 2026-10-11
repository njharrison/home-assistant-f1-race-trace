/* F1 Race Trace prototype — Nicxe F1 Sensor. Historical archive integration pending. */
class F1RaceTrace extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:"open"});
    this.config = {};
    this.reference = "AVERAGE";
    this.hiddenDrivers = new Set();
    this.signature = "";
    this.archive = null;
    this.archiveError = "";
    this.archiveUrl = "";
    this.archiveLoading = false;
    this.fixedPace = null;
    this.fixedScale = null;
    this.lastLap = null;
    this.liveHistory = new Map();
    this.sectorHistory = new Map();
    this.sectorPace = null;
    this.gapSamples = new Map();
    this.gapTraceHistory = new Map();
    this.gapClock = null;
    this.gapBaseline = null;
    this.persistedRecording = null;
    this.recordingFetchAt = 0;
    this.recordingRun = null;
    this.recordingSignature = null;
    this.recordingTimer = null;
    this.recordingLoading = false;
    this.xWindow = null;
    this.yWindow = null;
  }
  connectedCallback(){
    if(!this.recordingTimer)this.recordingTimer=setInterval(()=>this.loadRecording(),1000);
  }
  disconnectedCallback(){
    if(this.recordingTimer)clearInterval(this.recordingTimer);
    this.recordingTimer=null;
  }
  setConfig(config) {
    this.config = {entity:"sensor.f1_drivers_driver_positions",lap_entity:"sensor.f1_race_lap_count",height:"85vh",archive_url:null,...config};
    this.fixedPace=null;
    this.fixedScale=null;
    this.liveHistory.clear();
    this.sectorHistory.clear();
    this.sectorPace=null;
    this.gapSamples.clear();
    this.gapTraceHistory.clear();
    this.gapClock=null;
    this.gapBaseline=null;
    this.persistedRecording=null;
    this.recordingFetchAt=0;
    this.recordingRun=null;
    this.recordingSignature=null;
    this.xWindow=null;
    this.yWindow=null;
    this.loadArchive();
    this.render();
  }
  set hass(hass) {
    this._hass = hass;
    const s=hass.states[this.config.entity];
    const sig=JSON.stringify([s?.last_updated,s?.attributes?.drivers,hass.states[this.config.lap_entity]?.state]);
    if(sig!==this.signature){this.signature=sig;this.render();}
    this.loadRecording();
  }
  async loadRecording(){
    if(this.config.recording_url===false||this.config.timing_engine==="legacy")return;
    const now=Date.now();
    if(this.recordingLoading||now-this.recordingFetchAt<900)return;
    this.recordingFetchAt=now;
    this.recordingLoading=true;
    try{
      const fullUrl=this.config.recording_url||"/local/f1-race-trace/live-recording.json";
      // Default delta is adjacent to the full archive; an explicit URL
      // supports custom recorder installations.
      const deltaUrl=this.config.recording_delta_url||
        fullUrl.replace(/\.json(?=\?|$)/,"-delta.json");
      let data=null;
      if(this.persistedRecording&&deltaUrl!==fullUrl){
        try{
          const response=await fetch(deltaUrl,{cache:"no-store"});
          if(response.ok){
            const delta=await response.json();
            const previous=this.persistedRecording;
            const currentSamples=previous.samples.length;
            const currentEvents=(previous.race_control||[]).length;
            // The rolling window must cover every sample since our last
            // poll. A rewind, missed window, or stale file triggers a full
            // reload rather than silently losing observations.
            if(delta.schema_version===1&&delta.run===previous.run
              &&Array.isArray(delta.samples)&&Array.isArray(delta.race_control)
              &&delta.sample_start<=currentSamples
              &&delta.event_start<=currentEvents
              &&delta.sample_count>=currentSamples
              &&delta.event_count>=currentEvents
              &&delta.sample_start+delta.samples.length===delta.sample_count
              &&delta.event_start+delta.race_control.length===delta.event_count){
              if(delta.sample_count===currentSamples&&delta.event_count===currentEvents)return;
              data={...previous,
                samples:previous.samples.concat(delta.samples.slice(currentSamples-delta.sample_start)),
                race_control:(previous.race_control||[]).concat(
                  delta.race_control.slice(currentEvents-delta.event_start))};
            }
          }
        }catch(err){
          if(this.config.debug)console.warn("[F1 Race Trace] Delta unavailable; loading archive",err);
        }
      }
      if(!data){
        const response=await fetch(fullUrl,{cache:"no-store"});
        if(!response.ok)return;
        data=await response.json();
      }
      if(data.schema_version!==1||!Array.isArray(data.samples))return;
      const tail=data.samples.at(-1);
      const events=data.race_control||[];
      const signature=JSON.stringify([data.run,data.samples.length,
        tail?.timestamp,tail?.lap,events.length,events.at(-1)?.event_id]);
      if(signature===this.recordingSignature)return;
      this.recordingSignature=signature;
      if(this.recordingRun!==null&&this.recordingRun!==data.run){
        this.gapTraceHistory.clear();
        this.gapClock=null;
        this.gapBaseline=null;
      }
      this.recordingRun=data.run;
      this.persistedRecording=data;
      this.render();
    }catch(err){if(this.config.debug)console.warn("[F1 Race Trace] Recording unavailable",err);}
    finally{this.recordingLoading=false;}
  }
  getCardSize(){return 12;}
  static getStubConfig(){return {type:"custom:f1-race-trace"};}
  seconds(raw) {
    if(typeof raw==="number")return Number.isFinite(raw)?raw:null;
    const s=String(raw??"").trim().replace(/^\+/,"");
    if(!s||/LAP|PIT|RET|DNF|OUT/i.test(s))return null;
    if(/^\d+(\.\d+)?$/.test(s))return Number(s);
    const m=s.match(/^(?:(\d+):)?(\d+)\.(\d+)$/);
    return m?Number(m[1]||0)*60+Number(m[2])+Number("0."+m[3]):null;
  }
  escape(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  data(drivers){
    // Some F1 Sensor updates omit current_position for the front runners.
    // A "LAP N" gap identifies the leader; numeric gaps rank everyone else.
    const rank=d=>{
      const gap=String(d.gap_to_leader??"").trim();
      if(/^LAP\s+\d+$/i.test(gap))return 0;
      const seconds=this.seconds(gap);
      if(seconds!==null)return seconds;
      const position=Number(d.current_position);
      return Number.isFinite(position)&&position>0?1e6+position:Infinity;
    };
    const sorted=[...drivers].sort((a,b)=>rank(a)-rank(b));
    const leader=sorted[0];
    if(!leader)return [];
    const laps=d=>new Map(Object.entries(d.laps||{}).map(([k,v])=>[Number(k),this.seconds(v)]).filter(([k,v])=>Number.isFinite(k)&&v!==null));
    const lead=laps(leader);
    // Deleted lap times are absent from the sensor's laps map. Estimate only
    // the missing duration; don't discard all earlier timing observations.
    const all=sorted.map(laps);
    const median=values=>{
      const v=values.filter(Number.isFinite).sort((a,b)=>a-b);
      return v.length?v[Math.floor(v.length/2)]:null;
    };
    const raceMedian=new Map();
    for(const m of all)for(const n of m.keys())
      if(!raceMedian.has(n))raceMedian.set(n,median(all.map(t=>t.get(n))));
    const estimate=(times,n)=>{
      if(times.has(n))return {time:times.get(n),estimated:false};
      const nearby=[...times].filter(([k,v])=>Math.abs(k-n)<=2&&Number.isFinite(v)).sort((a,b)=>Math.abs(a[0]-n)-Math.abs(b[0]-n));
      const local=median(nearby.slice(0,2).map(([,v])=>v));
      return {time:local??raceMedian.get(n)??null,estimated:true};
    };
    const earliest=Math.min(...all.flatMap(m=>[...m.keys()]).filter(Number.isFinite));
    return sorted.map(d=>{
      const own=laps(d),gap=d===leader?0:this.seconds(d.gap_to_leader);
      const common=[...own.keys()].filter(k=>lead.has(k)).sort((a,b)=>a-b);
      const points=[];
      if(gap!==null&&common.length&&Number.isFinite(earliest)){
        let value=gap;
        const last=common.at(-1);
        // At a lap boundary, the difference in lap durations determines
        // the change in gap. Estimate a deleted duration instead of breaking
        // the whole earlier trace.
        for(let n=last;n>=earliest;n--){
          const ownTime=estimate(own,n),leaderTime=estimate(lead,n);
          points.push({lap:n,y:value,estimated:ownTime.estimated||leaderTime.estimated});
          if(n>earliest){
            if(ownTime.time===null||leaderTime.time===null)break;
            value-=ownTime.time-leaderTime.time;
          }
        }
      }
      return {id:String(d.racing_number||d.tla),label:d.tla||d.name||"?",color:/^#[0-9a-f]{6}$/i.test(d.team_color||"")?d.team_color:"#aeb9c8",position:d.current_position,points:points.filter(p=>Number.isFinite(p.y)).reverse(),retired:!!d.retired};
    });
  }
  async loadArchive(){
    const url=this.config.archive_url;
    if(!url||this.archiveLoading||this.archiveUrl===url&&this.archive)return;
    this.archiveLoading=true;
    this.archiveError="";
    try {
      const response=await fetch(url,{cache:"no-cache"});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const data=await response.json();
      if(data.schema_version!==1||!Array.isArray(data.laps))throw new Error("Unsupported archive format");
      this.archive=data;
      this.archiveUrl=url;
    }catch(e){this.archive=null;this.archiveError=String(e);}
    finally{this.archiveLoading=false;this.render();}
  }
  archiveDrivers(drivers){
    if(!this.archive?.laps?.length)return null;
    const meta=new Map(drivers.map(d=>[String(d.tla||"").toUpperCase(),d]));
    const byDriver=new Map();
    const leaders=new Map();
    const all=this.archive.laps.filter(r=>Number.isFinite(r.lap_end_session_seconds)&&Number.isInteger(r.lap));
    for(const row of all){
      if(!byDriver.has(row.driver))byDriver.set(row.driver,[]);
      byDriver.get(row.driver).push(row);
      if(Number(row.position)===1){
        const old=leaders.get(row.lap);
        if(!old||row.lap_end_session_seconds<old.lap_end_session_seconds)leaders.set(row.lap,row);
      }
    }
    // A leader can temporarily lack a Position value. Use earliest crossing
    // only as an explicitly provisional fallback for that lap.
    for(const row of all){
      if(!leaders.has(row.lap)){
        const old=leaders.get(row.lap);
        if(!old||row.lap_end_session_seconds<old.lap_end_session_seconds)leaders.set(row.lap,row);
      }
    }
    return [...byDriver].map(([tla,rows])=>{
      const m=meta.get(String(tla).toUpperCase())||{};
      const points=rows.sort((a,b)=>a.lap-b.lap).flatMap(r=>{
        const leader=leaders.get(r.lap);
        if(!leader)return [];
        const delta=r.lap_end_session_seconds-leader.lap_end_session_seconds;
        // Crossing the same numbered lap more than a lap behind the leader
        // is NOT a current race gap; omit instead of drawing a misleading line.
        const threshold=Number(leader.lap_time_seconds)||100;
        if(delta<-.05||delta>=threshold)return [];
        return [{lap:r.lap,y:Math.max(0,delta),pit:!!r.pit_in_session_seconds,compound:r.compound}];
      });
      return {id:String(m.racing_number||rows[0]?.driver_number||tla),
        label:tla,color:/^#[0-9a-f]{6}$/i.test(m.team_color||"")?m.team_color:"#9faec2",
        position:m.current_position??rows.at(-1)?.position,
        points,retired:!!m.retired};
    });
  }
  render(){
    if(!this.shadowRoot)return;
    const hass=this._hass,s=hass?.states?.[this.config.entity];
    const raw=s?.attributes?.drivers;
    const liveDrivers=Array.isArray(raw)?raw:[];
    const drivers=(this.config.archive_url&&this.archiveDrivers(liveDrivers))||this.data(liveDrivers);
    // Teammates normally share the same team hex. Give the second driver
    // a subtly lighter tint, consistently ordered by racing number.
    const colorGroups=new Map();
    for(const d of drivers){
      const key=String(d.color||"").toLowerCase();
      if(!/^#[0-9a-f]{6}$/.test(key))continue;
      if(!colorGroups.has(key))colorGroups.set(key,[]);
      colorGroups.get(key).push(d);
    }
    for(const [base,group] of colorGroups){
      if(group.length<2)continue;
      group.sort((a,b)=>(Number(a.id)||999)-(Number(b.id)||999));
      group.slice(1).forEach(d=>{
        const rgb=[1,3,5].map(i=>parseInt(base.slice(i,i+2),16));
        d.color="#"+rgb.map(v=>Math.round(v*.76+255*.24).toString(16).padStart(2,"0")).join("");
      });
    }
    const lap=Math.max(1,Number(hass?.states?.[this.config.lap_entity]?.state)||1);
    if(this.lastLap!==null&&lap<this.lastLap){this.liveHistory.clear();this.sectorHistory.clear();this.gapSamples.clear();this.gapTraceHistory.clear();this.gapClock=null;this.gapBaseline=null;this.fixedScale=null;this.fixedPace=null;}
    this.lastLap=lap;
    const active=drivers.filter(d=>!this.hiddenDrivers.has(d.id)&&((this.config.archive_url&&d.points.some(p=>p.lap<=lap))||!this.config.archive_url));
    const reference=drivers.find(d=>d.id===this.reference);
    const refMap=new Map(reference?.points.filter(p=>p.lap<=lap).map(p=>[p.lap,p.y])||[]);
    // Race trace: subtract cumulative reference pace from each driver's elapsed
    // time. A fixed per-lap baseline is common to every driver, preserving
    // relative ordering while allowing the leader's trace to rise and fall.
    const archived=!!(this.config.archive_url&&this.archive);
    const allLapTimes=archived?this.archive.laps.filter(r=>r.lap<=lap&&Number.isFinite(r.lap_time_seconds)&&r.lap_time_seconds>0).map(r=>r.lap_time_seconds):liveDrivers.flatMap(d=>Object.values(d.laps||{}).map(v=>this.seconds(v)).filter(v=>v!==null));
    const sortedTimes=allLapTimes.sort((a,b)=>a-b);
    // Trim extreme pit/safety-car laps; estimate representative green-flag pace.
    const start=Math.floor(sortedTimes.length*.15),end=Math.ceil(sortedTimes.length*.75);
    const sample=sortedTimes.slice(start,end);
    const estimatedPace=sample.length?sample.reduce((a,b)=>a+b,0)/sample.length:95;
    if(this.fixedPace===null&&sample.length>=8)this.fixedPace=estimatedPace;
    const averagePace=this.fixedPace??estimatedPace;
    // Live gap-to-leader is only a relative offset. Add the leader's
    // cumulative pace deviation to give every car a common average baseline.
    // Only use consecutive known laps; missing laps cannot be invented.
    const leaderLive=liveDrivers.find(d=>/^LAP\s+\d+$/i.test(String(d.gap_to_leader??"").trim())) || liveDrivers.find(d=>String(d.racing_number||d.tla)===drivers[0]?.id);
    const leaderTimes=new Map(Object.entries(leaderLive?.laps||{}).map(([k,v])=>[Number(k),this.seconds(v)]).filter(([k,v])=>Number.isInteger(k)&&v!==null));
    const leaderDeviation=new Map();
    let deviation=0,previous=null;
    for(const n of [...leaderTimes.keys()].sort((a,b)=>a-b)){
      if(previous!==null&&n!==previous+1)deviation=NaN;
      if(Number.isFinite(deviation))deviation+=leaderTimes.get(n)-averagePace;
      leaderDeviation.set(n,deviation);
      previous=n;
    }
    const traces=active.map(d=>({...d,points:d.points.filter(p=>p.lap<=lap&&(this.reference==="AVERAGE"||this.reference==="LEADER"||refMap.has(p.lap))).map(p=>({...p,y:archived&&this.reference==="AVERAGE" ? -( (this.archive.laps.find(r=>r.driver===d.label&&r.lap===p.lap)?.lap_end_session_seconds ?? 0) - this.archive.laps.filter(r=>r.lap===1).reduce((min,r)=>Math.min(min,r.lap_end_session_seconds),Infinity) - (p.lap-1)*averagePace ) : this.reference==="AVERAGE" ? -(p.y+(leaderDeviation.get(p.lap)??0)) : -(p.y-(refMap.get(p.lap)||0))}))}));
    const useGapEngine=!archived&&this.config.timing_engine!=="legacy"&&this.reference==="AVERAGE";
    if(!useGapEngine)for(let i=traces.length-1;i>=0;i--)if(!traces[i].points.length)traces.splice(i,1);
    // Calculate a stable, race-wide reference for each sector. Scale the
    // observed proportions to the same lap baseline used by the full laps.
    if(!archived&&!useGapEngine){
      if(!this.sectorPace){
        const samples=[[],[],[]];
        for(const raw of liveDrivers)for(let i=1;i<=3;i++){
          const t=this.seconds(raw["sector_"+i]);
          if(t!==null&&t>10&&t<120)samples[i-1].push(t);
        }
        if(samples.every(a=>a.length>=5)){
          const means=samples.map(a=>{
            const v=a.sort((x,y)=>x-y);
            const mid=v.slice(Math.floor(v.length*.15),Math.max(Math.floor(v.length*.15)+1,Math.ceil(v.length*.85)));
            return mid.reduce((x,y)=>x+y,0)/mid.length;
          });
          const total=means.reduce((a,b)=>a+b,0);
          this.sectorPace=means.map(v=>v/total*averagePace);
        }
      }
      const liveById=new Map(liveDrivers.map(d=>[String(d.racing_number||d.tla),d]));
      for(const d of traces){
        const raw=liveById.get(d.id);
        if(!raw)continue;
        if(!this.sectorHistory.has(d.id))this.sectorHistory.set(d.id,new Map());
        const history=this.sectorHistory.get(d.id);
        for(let sector=1;sector<=3;sector++){
          const n=Number(raw["sector_"+sector+"_lap"]);
          const duration=this.seconds(raw["sector_"+sector]);
          if(!Number.isInteger(n)||n<1||n>lap||duration===null||n<=Number(raw.completed_laps||0))continue;
          const key=n+":"+sector;
          if(history.has(key))continue;
          // Use the driver's last known completed-lap trace as a fixed
          // anchor, then accumulate sector deviations from reference pace.
          const anchor=[...d.points,...history.values()].filter(p=>p.lap<=n-1+1e-6).sort((a,b)=>b.lap-a.lap)[0];
          if(!anchor||!this.sectorPace)continue;
          let base=anchor.y;
          // Sparse lap history is common: use the latest known anchor, but
          // never claim the missing intervening laps were observed.
          const preceding=[...history.values()].filter(p=>p.lap>n-1&&p.lap<n-1+sector/3).sort((a,b)=>b.lap-a.lap)[0];
          if(preceding)base=preceding.y;
          else if(sector>1){
            // The sensor may expose S2 before this card has seen S1.
            // Recover available earlier sectors for this same lap.
            for(let prior=1;prior<sector;prior++){
              const priorTime=this.seconds(raw["sector_"+prior]);
              if(priorTime!==null&&Number(raw["sector_"+prior+"_lap"])===n)
                base+=this.sectorPace[prior-1]-priorTime;
              else {base=NaN;break;}
            }
            if(!Number.isFinite(base))continue;
          }
          const y=base+(this.sectorPace[sector-1]-duration);
          history.set(key,{lap:n-1+sector/3,y,estimated:false,sector});
        }
        d.points.push(...history.values());
        d.points.sort((a,b)=>a.lap-b.lap);
      }
    }
    // Lock the already observed live points so a fresh gap cannot rewrite
    // the entire historical trace every second.
    if(!archived&&!useGapEngine){
      for(const d of traces){
        if(!this.liveHistory.has(d.id))this.liveHistory.set(d.id,new Map());
        const history=this.liveHistory.get(d.id);
        for(const p of d.points)if(!history.has(p.lap))history.set(p.lap,{...p});
        // Fill gaps between *observed* completed-lap anchors. In particular,
        // replay may begin collecting a driver's points after the race starts.
        // Do not extrapolate before the first anchor: there is no evidence for
        // that part of the trace unless actual earlier lap times are present.
        const known=[...history.values()]
          .filter(p=>Number.isInteger(p.lap)&&Number.isFinite(p.y))
          .sort((a,b)=>a.lap-b.lap);
        for(let i=1;i<known.length;i++){
          const a=known[i-1],b=known[i],span=b.lap-a.lap;
          if(span<=1||span>30)continue;
          for(let n=a.lap+1;n<b.lap;n++){
            if(!history.has(n))
              history.set(n,{lap:n,y:a.y+(b.y-a.y)*(n-a.lap)/span,estimated:true,interpolated:true});
          }
        }
        // Sector events have their own fractional-lap keys; retain them
        // alongside frozen lap points instead of replacing them.
        // Prefer measured sector points over reconstructed lap points at the
        // same X. A polyline must never join conflicting Y values vertically.
        const merged=new Map();
        for(const p of history.values())if(Number.isFinite(p.lap))merged.set(p.lap.toFixed(6),p);
        for(const p of this.sectorHistory.get(d.id)?.values()||[])
          if(Number.isFinite(p.lap)&&p.lap>Number(liveDrivers.find(raw=>String(raw.racing_number||raw.tla)===d.id)?.completed_laps||0))merged.set(p.lap.toFixed(6),p);
        d.points=[...merged.values()].filter(p=>p.lap<=lap).sort((a,b)=>a.lap-b.lap);
      }
    }
    // Intra-sector snapshots: infer fractional progress from the time since
    // the most recently observed sector transition. The source supplies gaps,
    // not distance, so these points are estimates and never replace anchors.
    if(!archived&&!useGapEngine&&this.sectorPace){
      const now=Date.now();
      const liveById=new Map(liveDrivers.map(d=>[String(d.racing_number||d.tla),d]));
      for(const d of traces){
        const raw=liveById.get(d.id);
        if(!raw)continue;
        const gap=/^LAP\s+\d+$/i.test(String(raw.gap_to_leader??"").trim())?0:this.seconds(raw.gap_to_leader);
        if(gap===null)continue;
        const completed=Number(raw.completed_laps)||0;
        const sectorLap=Number(raw.sector_current_lap)||0;
        const currentLap=Math.max(completed+1,sectorLap);
        if(!Number.isInteger(currentLap)||currentLap<1)continue;
        const done=raw.sector_state==="s3_done"?3:raw.sector_state==="s2_done"?2:raw.sector_state==="s1_done"?1:0;
        const nextSector=Math.min(3,done+1);
        const stage=currentLap+":"+done;
        const id=d.id;
        let state=this.gapSamples.get(id);
        const anchorX=currentLap-1+done/3;
        const anchor=[...d.points].filter(p=>p.lap<=anchorX+1e-5).sort((a,b)=>b.lap-a.lap)[0] || [...d.points].sort((a,b)=>b.lap-a.lap)[0];
        // A driver may have no complete lap history at all. Anchor the first
        // live observation to the current leader-relative gap instead.
        const baseY=anchor?.y ?? -gap;
        if(!state||state.stage!==stage){
          state={stage,start:now,baseGap:gap,baseY,samples:[]};
          this.gapSamples.set(id,state);
        }
        // At most 95% of the current sector until its actual timing
        // measurement arrives; avoid fabricated sector crossings.
        const duration=this.sectorPace[nextSector-1];
        const fraction=Math.min(.95,Math.max(0,(now-state.start)/1000/duration));
        const x=anchorX+fraction/3;
        // Relative gap changes are real observations; the baseline's
        // fractional pace correction is an estimate between sector lines.
        const y=state.baseY-(gap-state.baseGap);
        if(fraction>0.005&&(!state.samples.length||x>state.samples.at(-1).lap+0.0001)){
          state.samples.push({lap:x,y,estimated:true});
          if(state.samples.length>180)state.samples.shift();
        }
        d.points.push(...state.samples.filter(p=>p.lap>Math.max(anchorX,completed)&&p.lap<anchorX+1/3));
        const unique=new Map();
        for(const p of d.points)if(Number.isFinite(p.lap)&&Number.isFinite(p.y))unique.set(p.lap.toFixed(6),p);
        d.points=[...unique.values()].sort((a,b)=>a.lap-b.lap);
      }
    }
    // v0.3: freeze one gap-based sample stream per driver. A completed lap
    // changes the x-axis stage, not the y-axis origin.
    if(useGapEngine){
      const now=Date.now();
      if(!this.gapClock)this.gapClock={lap,start:now};
      if(lap!==this.gapClock.lap){
        // The race clock can advance more than one lap on a replay seek.
        this.gapClock={lap,start:now};
      }
      const fraction=Math.min(.98,Math.max(0,(now-this.gapClock.start)/1000/Math.max(1,averagePace)));
      const liveX=Math.max(1,lap-1+fraction);
      const rawById=new Map(liveDrivers.map(d=>[String(d.racing_number||d.tla),d]));
      const leaderId=String(leaderLive?.racing_number||leaderLive?.tla||"");
      const leaderRaw=rawById.get(leaderId);
      const leaderGap=leaderRaw?0:null;
      // Recorded observations are the canonical history. Rebuild them on
      // every fetch, including when the card has already drawn a live trace.
      const saved=this.persistedRecording?.samples||[];
      const byLap=new Map();
      for(const sample of saved){
        const n=Number(sample.lap);
        if(!Number.isInteger(n)||n<1||n>lap)continue;
        if(!byLap.has(n))byLap.set(n,[]);
        byLap.get(n).push(sample);
      }
      const byId=new Map();
      // Keep the metadata of drivers who disappear from the live sensor
      // after retirement. Their recorded trace must remain visible.
      const recordedDrivers=new Map();
      for(const rows of byLap.values())for(const sample of rows)
        for(const row of sample.drivers||[]){
          const id=String(row.id??"");
          if(!id)continue;
          const entry=recordedDrivers.get(id)||{id,tla:row.tla,hasGap:false};
          if(row.tla)entry.tla=row.tla;
          const gapText=String(row.gap??"").trim();
          const numericGap=/^LAP\s+\d+$/i.test(gapText)?0:this.seconds(gapText);
          if(numericGap!==null||/^\+?\s*(\d+)\s+L(?:AP(?:S)?)?$/i.test(gapText))entry.hasGap=true;
          recordedDrivers.set(id,entry);
        }
      // The saved recording, not the current sensor's driver list, defines
      // who belongs on a historical race trace.
      for(const [id,row] of recordedDrivers){
        if(this.hiddenDrivers.has(id)||!row.hasGap)continue;
        if(traces.some(d=>d.id===id))continue;
        const previous=this.gapTraceHistory.get(id);
        const source=drivers.find(d=>d.id===id);
        traces.push({id,label:row.tla||source?.label||id,
          color:source?.color||previous?.color||"#9faec2",
          position:source?.position,retired:!liveDrivers.some(d=>String(d.racing_number||d.tla)===id),
          points:[]});
      }
      const lapsSorted=[...byLap.keys()].sort((a,b)=>a-b);
      // Race-wide lap transition timestamps form a single replay clock.
      // The next lap's first observation closes the previous interval.
      const startByLap=new Map();
      for(const n of lapsSorted){
        const rows=byLap.get(n).sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
        startByLap.set(n,Number(rows[0].timestamp));
      }
      const durations=[];
      for(const n of lapsSorted){
        if(startByLap.has(n+1)){
          const duration=startByLap.get(n+1)-startByLap.get(n);
          if(duration>0)durations.push(duration);
        }
      }
      durations.sort((a,b)=>a-b);
      const replayLapDuration=durations.length?durations[Math.floor(durations.length/2)]:averagePace;
      // The recorded race clock is the timing authority for BOTH the
      // intra-lap detail and the average-pace reference. A baseline built
      // from a different lap-time source causes a repeated sawtooth.
      // Ignore lap 1: this recording begins before its actual start.
      // Prefix sums avoid summing every earlier lap for every plotted point.
      // With thousands of samples the previous loop was quadratic in laps.
      const deviationByLap=new Map([[1,0]]);
      let cumulativeDeviation=0;
      for(let n=2;n<=lap+1;n++){
        const t0=startByLap.get(n),t1=startByLap.get(n+1);
        if(t0!==undefined&&t1!==undefined&&t1>t0)
          cumulativeDeviation+=averagePace-(t1-t0);
        deviationByLap.set(n,cumulativeDeviation);
      }
      const baselineAt=x=>{
        const whole=Math.max(1,Math.floor(x));
        const fraction=Math.max(0,Math.min(1,x-whole));
        const value=deviationByLap.get(Math.min(whole,lap+1))??0;
        const t0=startByLap.get(whole+1),t1=startByLap.get(whole+2);
        // The current lap has no end timestamp yet. Carry forward the
        // previous completed leader/race-clock lap's pace if plausible,
        // rather than defaulting to average pace (a horizontal leader).
        let duration=t0!==undefined&&t1!==undefined&&t1>t0?t1-t0:null;
        if(duration===null){
          const priorStart=startByLap.get(whole);
          const priorEnd=startByLap.get(whole+1);
          const prior=priorStart!==undefined&&priorEnd!==undefined?priorEnd-priorStart:null;
          // Exclude pit/SC anomalies and implausibly short replay intervals.
          duration=prior!==null&&prior>averagePace*.8&&prior<averagePace*1.2
            ?prior:averagePace;
        }
        return value+fraction*(averagePace-duration);
      };
      // Position the observation by its driver's own sector progress before
      // subtracting its gap expressed as a fraction of a reference lap.
      // Recorded sector states are snapshots of the last timing event,
      // NOT continuous progress. Applying them as an X floor on every
      // observation creates long horizontal shelves and abrupt jumps.
      // Use the shared race clock and gap alone for historical positions.
      const plottedX=(raceX,gap)=>raceX-Math.max(0,gap)/averagePace;
      const advanceX=(previous,target)=>previous?Math.max(previous.lap,target):target;
      // Derive reference sector fractions from measured sector durations,
      // rather than assuming that each sector takes exactly a third of a lap.
      const sectorDurations=[[],[],[]];
      for(const rows of byLap.values())for(const sample of rows)
        for(const row of sample.drivers||[])for(let k=1;k<=3;k++){
          const duration=this.seconds(row["sector_"+k]);
          if(duration!==null&&duration>10&&duration<90)
            sectorDurations[k-1].push(duration);
        }
      const median=values=>{
        const sorted=values.sort((a,b)=>a-b);
        return sorted.length?sorted[Math.floor(sorted.length/2)]:null;
      };
      const sectorMedians=sectorDurations.map(median);
      const sectorTotal=sectorMedians.every(Number.isFinite)
        ?sectorMedians.reduce((a,b)=>a+b,0):0;
      const sectorFractions=sectorTotal>0
        ?sectorMedians.map(v=>v/sectorTotal):[1/3,1/3,1/3];
      const sectorBoundary=[0,sectorFractions[0],
        sectorFractions[0]+sectorFractions[1],1];
      // Collect all observations before reconstruction so sector transitions
      // can be interpolated using the actual recorded timestamps.
      const rawHistory=new Map();
      for(const n of lapsSorted){
        const rows=byLap.get(n);
        const first=startByLap.get(n),next=startByLap.get(n+1);
        const duration=next!==undefined&&next>first?next-first:replayLapDuration;
        for(const sample of rows){
          const at=Number(sample.timestamp);
          const elapsed=Math.max(0,at-first);
          const raceX=Math.max(1,n-1+Math.min(.999,elapsed/Math.max(1,duration)));
          for(const row of sample.drivers||[]){
            const id=String(row.id);
            if(!rawHistory.has(id))rawHistory.set(id,[]);
            const completed=Number(row.completed_laps)||0;
            // Each sector's own *_lap field identifies the lap it
            // belongs to. sector_current_lap is only a display hint and
            // can refer to a different timing event.
            const events=[1,2,3].map(k=>{
              const eventLap=Number(row["sector_"+k+"_lap"]);
              const duration=this.seconds(row["sector_"+k]);
              return Number.isInteger(eventLap)&&eventLap>0&&duration!==null
                ?eventLap-1+sectorBoundary[k]:null;
            }).filter(Number.isFinite);
            const sectorProgress=events.length?Math.max(...events):completed;
            rawHistory.get(id).push({row,at,raceX,progress:Math.max(completed,sectorProgress)});
          }
        }
      }
      for(const [id,rows] of rawHistory){
        rows.sort((a,b)=>a.at-b.at);
        // Independently reconstruct the driver's progress from timing
        // checkpoints. A sector is a crossing event, not a duration to add
        // on every polling update. Its own *_lap field is authoritative.
        const milestones=[];
        const seen=new Set();
        for(const obs of rows){
          const completed=Number(obs.row.completed_laps)||0;
          const events=[];
          if(completed>0)events.push({key:"lap:"+completed,progress:completed});
          for(let k=1;k<=3;k++){
            const sectorLap=Number(obs.row["sector_"+k+"_lap"]);
            const duration=this.seconds(obs.row["sector_"+k]);
            if(Number.isInteger(sectorLap)&&sectorLap>0&&duration!==null)
              events.push({key:sectorLap+":"+k,progress:sectorLap-1+sectorBoundary[k]});
          }
          for(const event of events){
            if(seen.has(event.key))continue;
            seen.add(event.key);
            milestones.push({at:obs.at,progress:event.progress});
          }
        }
        milestones.sort((a,b)=>a.at-b.at||a.progress-b.progress);
        // Ignore stale or out-of-order sector readings. A checkpoint must
        // represent strictly increasing distance.
        const crossings=[];
        for(const event of milestones)
          if(!crossings.length||event.progress>crossings.at(-1).progress+0.00001)
            crossings.push(event);
        let eventIndex=0,anchor=null;
        const history=[];
        for(const obs of rows){
          while(eventIndex+1<crossings.length&&crossings[eventIndex+1].at<=obs.at)
            eventIndex++;
          const before=crossings[eventIndex];
          const after=crossings[eventIndex+1];
          let progress=null;
          if(before&&after&&after.at>before.at){
            const fraction=Math.max(0,Math.min(1,(obs.at-before.at)/(after.at-before.at)));
            progress=before.progress+(after.progress-before.progress)*fraction;
          }else if(before){
            const prior=crossings[eventIndex-1];
            const speed=prior&&before.at>prior.at
              ?(before.progress-prior.progress)/(before.at-prior.at)
              :1/Math.max(1,averagePace);
            // Limit the live tail to one sector without a further timing
            // crossing; a stopped or retired car must not circulate forever.
            const maxAdvance=sectorFractions.reduce((a,b)=>Math.max(a,b),0);
            progress=before.progress+Math.min(maxAdvance,Math.max(0,obs.at-before.at)*Math.max(0,speed));
          }else if(after){
            progress=after.progress-Math.max(0,after.at-obs.at)/Math.max(1,averagePace);
          }
          const gapText=String(obs.row.gap??"").trim();
          const leaderMarker=/^LAP\s+\d+$/i.test(gapText);
          const lapDeficit=gapText.match(/^\+?\s*(\d+)\s+L(?:AP(?:S)?)?$/i);
          // The leader marker is "LAP N", but the recording may also
          // contain a numeric zero gap. Both are authoritative and must
          // bypass the sector fallback entirely.
          const measuredGap=leaderMarker?0:this.seconds(gapText);
          let gap=measuredGap;
          if(measuredGap!==null){
            // Measured gaps are authoritative. Re-anchor the independent
            // sector timeline only when the feed actually reports seconds.
            if(Number.isFinite(progress))anchor={at:obs.at,progress,gap:measuredGap};
          }else if(anchor&&Number.isFinite(progress)&&(lapDeficit||!gapText)){
            gap=Math.max(0,anchor.gap+(obs.at-anchor.at)
              -(progress-anchor.progress)*averagePace);
          }else if(lapDeficit&&!anchor){
            gap=Number(lapDeficit[1])*averagePace;
            if(Number.isFinite(progress))anchor={at:obs.at,progress,gap};
          }
          if(gap===null)continue;
          const previous=history.at(-1);
          // Keep the leader on the race-clock X axis. If a stale or
          // temporarily absent leader marker arrives, the fallback must
          // not shift their whole trace a lap behind.
          // During the opening lap, gaps change rapidly as the field spreads
          // out from the grid. Subtracting those gaps from X and then
          // enforcing monotonic X pins many points to the same coordinate,
          // creating artificial vertical bars. Plot lap-one gaps against
          // the shared race clock; retain normal offset geometry afterwards.
          // A discontinuous switch from race-clock X to gap-offset X at
          // lap two makes trailing cars jump backwards. The monotonic-X
          // clamp then pins them in place, creating vertical drops and
          // long horizontal shelves. Keep a continuous race-clock X for
          // the entire recording; the Y coordinate already carries gap.
          const driverX=advanceX(previous,obs.raceX);
          history.push({lap:driverX,raceLap:obs.raceX,gap,at:obs.at});
        }
        byId.set(id,history);
      }
      if(this.config.debug){
        const bor=[...recordedDrivers.values()].filter(d=>d.tla==="BOR");
        console.info("[F1 Race Trace] Retired-driver reconstruction",bor.map(d=>({
          id:d.id,hasNumericGap:d.hasGap,recordedPoints:byId.get(d.id)?.length||0,
          includedInTraces:traces.some(t=>t.id===d.id),
          hidden:this.hiddenDrivers.has(d.id)
        })));
      }
      // The recorder is the authoritative live clock. Derive the current
      // position from its latest observation, not a separate render timer.
      const currentRows=byLap.get(lap)||[];
      const latestSample=currentRows.at(-1);
      const currentLapStart=startByLap.get(lap);
      const recorderX=latestSample&&Number.isFinite(currentLapStart)
        ?Math.max(1,lap-1+Math.min(.999,Math.max(0,(Number(latestSample.timestamp)-currentLapStart)/Math.max(1,replayLapDuration))))
        :null;
      const recorderFresh=latestSample&&now-Number(latestSample.timestamp)*1000<6000;
      // Rebuild both history and live points against the SAME baseline.
      for(const d of traces){
        const observations=byId.get(d.id)||[];
        const restored=[];
        for(const observation of observations){
          const x=observation.lap;
          const y=baselineAt(observation.raceLap)-observation.gap;
          // Retain identical X coordinates: they represent vertical timing
          // movement (a stopped car, pit loss, or a timing correction).
          restored.push({lap:x,y,estimated:true,gap:observation.gap,raceLap:observation.raceLap});
        }
        const raw=rawById.get(d.id);
        const rawGapText=String(raw?.gap_to_leader??"").trim();
        const isLeader=d.id===leaderId||/^LAP\s+\d+$/i.test(rawGapText);
        const lapDeficit=rawGapText.match(/^\+?\s*(\d+)\s+L(?:AP(?:S)?)?$/i);
        let gap=isLeader?0:this.seconds(raw?.gap_to_leader);
        if(lapDeficit){
          const minimum=Number(lapDeficit[1])*averagePace;
          const prior=restored.at(-1)?.gap??this.gapTraceHistory.get(d.id)?.lastGap;
          gap=Number.isFinite(prior)?Math.max(prior,minimum-averagePace*.5):minimum;
        }
        const lastRecordedRaceX=restored.at(-1)?.raceLap??-Infinity;
        const existing=this.gapTraceHistory.get(d.id);
        const liveTail=(existing?.points||[]).filter(p=>p.live&&(p.raceLap??p.lap)>lastRecordedRaceX+.0001)
          .map(p=>({...p,y:baselineAt(p.raceLap??p.lap)-p.gap}));
        const points=[...restored,...liveTail];
        // When recording is fresh, its per-second snapshots already contain
        // the current gap. Never overwrite those with an older HA sensor.
        if(gap!==null&&!recorderFresh){
          const raceX=recorderX??liveX;
          const previous=points.at(-1);
          const rawX=plottedX(raceX,gap);
          const x=advanceX(previous,rawX);
          // Retain stationary samples; they produce genuine vertical traces.
          if(!previous||Math.abs(previous.raceLap-raceX)>.00001||Math.abs(previous.gap-gap)>.0001)
            points.push({lap:x,y:baselineAt(raceX)-gap,gap,raceLap:raceX,live:true,estimated:true});
        }
        this.gapTraceHistory.set(d.id,{points,lastGap:gap,color:d.color});
        d.points=points.filter(p=>p.raceLap===undefined||p.raceLap<=lap);
      }
    }
    if(this.config.debug){
      const summarize=points=>({count:points.length,first:points[0]?.lap,last:points.at(-1)?.lap,
        early:points.filter(p=>p.lap<=30).length,
        nonFinite:points.filter(p=>!Number.isFinite(p.y)).slice(0,8).map(p=>({lap:p.lap,y:String(p.y)}))});
      const antRaw=liveDrivers.find(d=>d.tla==="ANT");
      const antSource=drivers.find(d=>d.label==="ANT");
      const antTrace=traces.find(d=>d.label==="ANT");
      console.info("[F1 Race Trace] ANT diagnostics",{
        reference:this.reference,lap,leader:leaderLive?.tla,
        recordedLapNumbers:Object.keys(antRaw?.laps||{}).map(Number),
        source:summarize(antSource?.points||[]),
        plottedBeforeFiniteFilter:summarize(antTrace?.points||[]),
        leaderDeviationEarly:[2,3,10,20,29,30,31].map(n=>({lap:n,deviation:String(leaderDeviation.get(n))})),
        hidden:this.hiddenDrivers.has(antSource?.id)
      });
    }
    for(const d of traces)d.points=d.points.filter(p=>Number.isFinite(p.y));
    // Include the lap-ahead dotted copies in the horizontal domain.
    const chartLap=traces.reduce((max,d)=>d.points.reduce((m,p)=>Number.isFinite(p.lap)?Math.max(m,p.lap+1):m,max),Math.max(1,lap));
    const chartEnd=Math.max(lap+0.35,chartLap+0.1);
    // A fixed, symmetrical window spanning exactly one reference lap.
    // Keep out-of-range data intact; the SVG plot clip hides it until
    // lap-wrapping is enabled, without rescaling the Y axis.
    const halfReferenceLap=Math.max(1,averagePace)/2;
    const defaultLow=-halfReferenceLap,defaultHigh=halfReferenceLap;
    const low=this.yWindow?.low??defaultLow;
    const high=this.yWindow?.high??defaultHigh;
    const W=1400,H=720,L=78,R=110,T=40,B=60;
    const fullStart=1,fullEnd=Math.max(2,chartEnd);
    const viewStart=this.xWindow?.start??fullStart;
    const viewEnd=this.xWindow?.end??fullEnd;
    const x=n=>L+(n-viewStart)/Math.max(.001,viewEnd-viewStart)*(W-L-R);
    const y=n=>T+(high-n)/Math.max(.001,high-low)*(H-T-B);
    let grid="";
    for(let i=0;i<=8;i++){const v=low+(high-low)*i/8;grid+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#263245"/><text x="${L-9}" y="${y(v)+5}" text-anchor="end" fill="#93a4b9" font-size="17">${v.toFixed(1)}s</text>`;}
    const tickStep=Math.max(1,Math.ceil((viewEnd-viewStart)/14));
    for(let n=Math.max(1,Math.ceil(viewStart/tickStep)*tickStep);n<=viewEnd;n+=tickStep)grid+=`<line x1="${x(n)}" y1="${T}" x2="${x(n)}" y2="${H-B}" stroke="#202b39"/><text x="${x(n)}" y="${H-20}" text-anchor="middle" fill="#93a4b9" font-size="17">${n}</text>`;
    // FIA race-control events are stored independently of the timing trace.
    // Draw neutralised periods behind the cars; never infer them from gaps.
    const controlEvents=this.persistedRecording?.race_control||[];
    const recordedSamples=this.persistedRecording?.samples||[];
    const raceXAt=time=>{
      if(!recordedSamples.length)return null;
      let lo=0,hi=recordedSamples.length-1;
      while(lo<hi){
        const mid=(lo+hi)>>1;
        if(Number(recordedSamples[mid].timestamp)<time)lo=mid+1;
        else hi=mid;
      }
      const a=recordedSamples[Math.max(0,lo-1)];
      const b=recordedSamples[lo];
      const ta=Number(a.timestamp),tb=Number(b.timestamp);
      const xa=Number(a.lap)-1,xb=Number(b.lap)-1;
      if(!Number.isFinite(ta)||!Number.isFinite(tb))return null;
      return ta<time&&tb>ta?xa+(xb-xa)*(time-ta)/(tb-ta):xb;
    };
    const controlPeriods=[];
    let caution=null;
    for(const event of controlEvents){
      const message=String(event.message||"").toUpperCase();
      const category=String(event.category||"").toUpperCase();
      const flag=String(event.flag||"").toUpperCase();
      const at=Number(event.observed_at);
      if(!Number.isFinite(at))continue;
      const vscStart=/VIRTUAL SAFETY CAR DEPLOYED|VSC DEPLOYED/.test(message);
      const scStart=!vscStart&&/SAFETY CAR DEPLOYED/.test(message);
      const vscEnd=/VSC ENDING|VIRTUAL SAFETY CAR ENDING|VSC ENDED/.test(message);
      const scEnd=/SAFETY CAR IN THIS LAP|SAFETY CAR ENDING/.test(message);
      const green=/GREEN FLAG|TRACK CLEAR/.test(message)||flag==="GREEN"&&["TRACK","SAFETYCAR","VSC"].includes(category);
      if(vscStart||scStart){
        if(caution)controlPeriods.push({...caution,end:at});
        caution={start:at,type:vscStart?"VSC":"SC"};
      }else if(caution&&(green||(caution.type==="VSC"&&vscEnd)||(caution.type==="SC"&&scEnd))){
        controlPeriods.push({...caution,end:at});
        caution=null;
      }
    }
    if(caution){
      const latest=Number(recordedSamples.at(-1)?.timestamp);
      if(Number.isFinite(latest)&&latest>=caution.start)
        controlPeriods.push({...caution,end:latest});
    }
    // Isochrones in the race trace satisfy x*referencePace - y = constant.
    // Consequently an event occurring at one instant is a diagonal line,
    // not a vertical lap boundary. The recorder's first observation anchors
    // wall-clock time to reference-lap coordinate x=1, y=0.
    const timeOrigin=Number(recordedSamples[0]?.timestamp);
    const timeBoundaryX=(time,ySeconds)=>
      x(1+(time-timeOrigin+ySeconds)/averagePace);
    const cautionBands=Number.isFinite(timeOrigin)?controlPeriods.map(p=>{
      if(!(p.end>p.start))return "";
      const color=p.type==="VSC"?"#e5b84b":"#f5a15b";
      const top=high,bottom=low;
      const xStartTop=timeBoundaryX(p.start,top);
      const xStartBottom=timeBoundaryX(p.start,bottom);
      const xEndTop=timeBoundaryX(p.end,top);
      const xEndBottom=timeBoundaryX(p.end,bottom);
      const polygon=[xStartTop+","+y(top),xEndTop+","+y(top),
        xEndBottom+","+y(bottom),xStartBottom+","+y(bottom)].join(" ");
      return `<polygon points="${polygon}" fill="${color}" opacity=".10"/>
        <line x1="${xStartTop}" y1="${y(top)}" x2="${xStartBottom}" y2="${y(bottom)}" stroke="${color}" stroke-width="2" stroke-dasharray="6 5"/>
        <text x="${Math.max(L+5,Math.min(W-R-35,xStartTop+5))}" y="${T+18}" fill="${color}" font-size="13" font-weight="700">${p.type}</text>`;
    }).join(""):"";
    const lines=traces.filter(d=>d.points.length>0).map(d=>{
      // The dotted copy represents the same car one reference lap ahead:
      // shift BOTH its circuit position (X) and its time offset (Y).
      // Draw it independently, so no vertical wrap connector is introduced.
      // Simplify only the SVG geometry. Preserve raw timing points,
      // local extrema, and any sharp pit-stop transitions.
      const rawPoints=d.points;
      const points=[];
      const toleranceX=Math.max(.002,(viewEnd-viewStart)/(W-L-R)*.6);
      const toleranceY=Math.max(.15,(high-low)/(H-T-B)*.6);
      for(let i=0;i<rawPoints.length;i++){
        const p=rawPoints[i];
        const prev=points.at(-1);
        const next=rawPoints[i+1];
        if(prev&&next&&!p.pit&&Number.isFinite(p.lap)&&Number.isFinite(p.y)){
          const dx=next.lap-prev.lap;
          const expected=dx>0?prev.y+(next.y-prev.y)*(p.lap-prev.lap)/dx:prev.y;
          if(p.lap-prev.lap<toleranceX&&Math.abs(p.y-expected)<toleranceY
            &&Math.abs(p.y-prev.y)<toleranceY&&Math.abs(next.y-p.y)<toleranceY)
            continue;
        }
        points.push(p);
      }
      const coords=(lapOffset,timeOffset)=>points.map(p=>`${x(p.lap+lapOffset).toFixed(1)},${y(p.y+timeOffset).toFixed(1)}`).join(" ");
      const original=`<polyline points="${coords(0,0)}" fill="none" stroke="${d.color}" stroke-width="3.2" ${d.retired?'stroke-dasharray="7 6"':''}/>`;
      const duplicate=`<polyline points="${coords(1,averagePace)}" fill="none" stroke="${d.color}" stroke-width="2.5" stroke-dasharray="5 7" opacity=".8"/>`;
      const last=points.at(-1);
      const pitDots=points.filter(p=>p.pit).map(p=>`<rect x="${x(p.lap)-5}" y="${y(p.y)-5}" width="10" height="10" fill="#0b121d" stroke="${d.color}" stroke-width="2"/>`).join("");
      const dottedY=last.y+averagePace;
      const dottedLabel=`<circle cx="${x(last.lap+1)}" cy="${y(dottedY)}" r="3" fill="${d.color}" opacity=".8"/><text x="${Math.min(W-R+9,x(last.lap+1)+9)}" y="${y(dottedY)+5}" fill="${d.color}" opacity=".8" font-size="15" font-weight="600">${this.escape(d.label)}</text>`;
      return `${duplicate}${original}${dottedLabel}<circle cx="${x(last.lap)}" cy="${y(last.y)}" r="4" fill="${d.color}"/><text x="${Math.min(W-R+9,x(last.lap)+9)}" y="${y(last.y)+5}" fill="${d.color}" font-size="17" font-weight="700">${this.escape(d.label)}</text>${pitDots}`;
    }).join("");
    const opts=[{id:"AVERAGE",label:"Average race pace"},{id:"LEADER",label:"Race leader"},...drivers.map(d=>({id:d.id,label:d.label}))];
    this.shadowRoot.innerHTML=`<style>
      :host{display:block;font-family:Inter,Roboto,Arial,sans-serif;color:#eaf2fb}
      ha-card{background:#0b121d;color:inherit;overflow:hidden;border-radius:12px}
      .head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 24px;flex-wrap:wrap}
      .title{font-size:26px;font-weight:800;letter-spacing:.1em}.subtitle{font-size:12px;color:#91a2b8;margin-top:5px}
      select{background:#162333;color:#fff;border:1px solid #3b4b60;border-radius:6px;padding:9px}
      .chart{height:${this.escape(this.config.height)};min-height:350px;position:relative}svg{width:100%;height:100%;touch-action:none;cursor:grab}svg:active{cursor:grabbing}
      .zoom-controls{display:flex;gap:6px;align-items:center}.zoom-controls button{min-width:36px}
      .legend{display:flex;gap:7px;flex-wrap:wrap;padding:10px 24px 18px}
      button{background:#101b2b;color:#eaf2fb;border:1px solid #26364a;padding:7px 10px;border-radius:5px;cursor:pointer}
      button.off{opacity:.35}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}
      .note{font-size:12px;color:#9eacbd;padding:0 24px 18px}.empty{padding:40px}
    </style><ha-card>
      <div class="head"><div><div class="title">RACE TRACE <span style="color:#ff8700">/ F1</span></div><div class="subtitle">LAP ${lap} · ${drivers.length} DRIVERS · ${traces.length} TRACES · ${archived?"ARCHIVE":"LIVE"}</div></div><div class="zoom-controls"><button id="zoom-in" title="Zoom in horizontally">+</button><button id="zoom-out" title="Zoom out horizontally">−</button><button id="zoom-reset" title="Show full race">Reset</button></div><label>REFERENCE <select id="reference">${opts.map(o=>`<option value="${this.escape(o.id)}" ${this.reference===o.id?"selected":""}>${this.escape(o.label)}</option>`).join("")}</select></label></div>
      ${traces.length?`<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><clipPath id="race-trace-plot"><rect x="${L}" y="${T}" width="${W-L-R}" height="${H-T-B}"/></clipPath></defs><rect width="${W}" height="${H}" fill="#0b121d"/>${grid}<g clip-path="url(#race-trace-plot)">${cautionBands}<line x1="${L}" y1="${y(0)}" x2="${W-R}" y2="${y(0)}" stroke="#8393a6" stroke-dasharray="8 7"/>${lines}</g></svg></div>`:'<div class="empty">Waiting for replay driver timing data.</div>'}
      <div class="legend">${drivers.map(d=>`<button data-driver="${this.escape(d.id)}" class="${this.hiddenDrivers.has(d.id)?"off":""}"><span class="dot" style="background:${d.color}"></span>${this.escape(d.label)} · P${this.escape(d.position)}</button>`).join("")}</div>
      <div class="note">${archived?"Historical FastF1 lap-end timing. Gaps measured at the timing line, not simultaneous car positions; lapped cars are omitted when not comparable. Squares indicate pit-in laps.":"Live: shared race-clock gap traces; lap times seed historical data and do not snap live positions. "+(this.archiveError?"Archive unavailable: "+this.escape(this.archiveError):"Waiting for historical archive.")}</div>
    </ha-card>`;
    // Pan and zoom a true 2D viewport. Do not clamp X at the race
    // extents: clamping caused dragging to feel like unwanted zoom.
    const changeView=(factorX,factorY,fx=.5,fy=.5)=>{
      const xr=this.xWindow||{start:fullStart,end:fullEnd};
      const yr=this.yWindow||{low:defaultLow,high:defaultHigh};
      const xSpan=Math.max(.1,(xr.end-xr.start)*factorX);
      const ySpan=Math.min(2*halfReferenceLap,Math.max(.1,(yr.high-yr.low)*factorY));
      const cx=xr.start+fx*(xr.end-xr.start);
      const cy=yr.high-fy*(yr.high-yr.low);
      this.xWindow={start:cx-fx*xSpan,end:cx+(1-fx)*xSpan};
      this.yWindow={low:cy-(1-fy)*ySpan,high:cy+fy*ySpan};
      this.render();
    };
    this.shadowRoot.getElementById("zoom-in")?.addEventListener("click",()=>changeView(.7,.7));
    this.shadowRoot.getElementById("zoom-out")?.addEventListener("click",()=>changeView(1/.7,1/.7));
    this.shadowRoot.getElementById("zoom-reset")?.addEventListener("click",()=>{
      this.xWindow=null;this.yWindow=null;this.render();
    });
    const svg=this.shadowRoot.querySelector(".chart svg");
    if(svg){
      const coords=e=>{
        const rect=svg.getBoundingClientRect();
        return {
          x:Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*W-L)/(W-L-R))),
          y:Math.max(0,Math.min(1,((e.clientY-rect.top)/rect.height*H-T)/(H-T-B)))
        };
      };
      svg.addEventListener("wheel",e=>{
        e.preventDefault();
        const c=coords(e),factor=e.deltaY>0?1.18:1/1.18;
        changeView(e.shiftKey?1:factor,e.altKey?1:factor,c.x,c.y);
      },{passive:false});
      svg.addEventListener("pointerdown",e=>{
        if(e.pointerType==="mouse"&&e.button!==0)return;
        e.preventDefault();
        if(!this._panPointers)this._panPointers=new Map();
        this._panPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
        this._panPrevious=null;
        if(this._panMove)return;
        this._panMove=event=>{
          if(!this._panPointers?.has(event.pointerId))return;
          this._panPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
          const pts=[...this._panPointers.values()];
          const center={x:pts.reduce((a,p)=>a+p.x,0)/pts.length,y:pts.reduce((a,p)=>a+p.y,0)/pts.length};
          const distance=pts.length>1?Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y):null;
          if(this._panPrevious){
            const rect=this.shadowRoot.querySelector(".chart svg")?.getBoundingClientRect();
            if(!rect)return;
            const xr=this.xWindow||{start:1,end:Math.max(2,this.lastLap+.35)};
            const yr=this.yWindow||{low:-halfReferenceLap,high:halfReferenceLap};
            const spanX=xr.end-xr.start,spanY=yr.high-yr.low;
            const dx=(center.x-this._panPrevious.center.x)/rect.width*W/(W-L-R)*spanX;
            const dy=(center.y-this._panPrevious.center.y)/rect.height*H/(H-T-B)*spanY;
            let factor=1;
            if(distance!==null&&this._panPrevious.distance!==null&&distance>8&&this._panPrevious.distance>8)
              factor=Math.max(.5,Math.min(2,this._panPrevious.distance/distance));
            const fx=Math.max(0,Math.min(1,((center.x-rect.left)/rect.width*W-L)/(W-L-R)));
            const fy=Math.max(0,Math.min(1,((center.y-rect.top)/rect.height*H-T)/(H-T-B)));
            const nextX=spanX*factor,nextY=Math.min(2*halfReferenceLap,spanY*factor);
            const anchorX=xr.start+fx*spanX-dx;
            const anchorY=yr.high-fy*spanY+dy;
            this.xWindow={start:anchorX-fx*nextX,end:anchorX+(1-fx)*nextX};
            this.yWindow={low:anchorY-(1-fy)*nextY,high:anchorY+fy*nextY};
            this.render();
          }
          this._panPrevious={center,distance};
        };
        this._panEnd=event=>{
          this._panPointers?.delete(event.pointerId);
          this._panPrevious=null;
          if(!this._panPointers?.size){
            window.removeEventListener("pointermove",this._panMove);
            window.removeEventListener("pointerup",this._panEnd);
            window.removeEventListener("pointercancel",this._panEnd);
            this._panMove=null;
          }
        };
        window.addEventListener("pointermove",this._panMove);
        window.addEventListener("pointerup",this._panEnd);
        window.addEventListener("pointercancel",this._panEnd);
      });
    }
    this.shadowRoot.getElementById("reference")?.addEventListener("change",e=>{this.reference=e.target.value;this.render();});
    this.shadowRoot.querySelectorAll("[data-driver]").forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.driver;this.hiddenDrivers.has(id)?this.hiddenDrivers.delete(id):this.hiddenDrivers.add(id);this.render();}));
  }
}
if(!customElements.get("f1-race-trace"))customElements.define("f1-race-trace",F1RaceTrace);
window.customCards=window.customCards||[];
if(!window.customCards.some(c=>c.type==="f1-race-trace"))window.customCards.push({type:"f1-race-trace",name:"F1 Race Trace",description:"Race timing trace for Nicxe F1 Sensor"});
