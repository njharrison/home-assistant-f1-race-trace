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
  }
  setConfig(config) {
    this.config = {entity:"sensor.f1_drivers_driver_positions",lap_entity:"sensor.f1_race_lap_count",height:"85vh",archive_url:null,...config};
    this.fixedPace=null;
    this.fixedScale=null;
    this.liveHistory.clear();
    this.sectorHistory.clear();
    this.sectorPace=null;
    this.gapSamples.clear();
    this.loadArchive();
    this.render();
  }
  set hass(hass) {
    this._hass = hass;
    const s=hass.states[this.config.entity];
    const sig=JSON.stringify([s?.last_updated,s?.attributes?.drivers,hass.states[this.config.lap_entity]?.state]);
    if(sig!==this.signature){this.signature=sig;this.render();}
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
    const sorted=[...drivers].sort((a,b)=>Number(a.current_position||999)-Number(b.current_position||999));
    const leader=sorted[0];
    if(!leader)return [];
    const laps=d=>new Map(Object.entries(d.laps||{}).map(([k,v])=>[Number(k),this.seconds(v)]).filter(([k,v])=>Number.isFinite(k)&&v!==null));
    const lead=laps(leader);
    return sorted.map(d=>{
      const own=laps(d), gap=d===leader?0:this.seconds(d.gap_to_leader);
      const common=[...own.keys()].filter(k=>lead.has(k)).sort((a,b)=>a-b);
      const points=[];
      if(gap!==null&&common.length){
        let value=gap;
        for(let i=common.length-1;i>=0;i--){
          const lap=common[i];points.push({lap,y:value});
          if(i>0&&common[i-1]===lap-1)value-=own.get(lap)-lead.get(lap);
          else if(i>0)value=NaN;
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
    const lap=Math.max(1,Number(hass?.states?.[this.config.lap_entity]?.state)||1);
    if(this.lastLap!==null&&lap<this.lastLap){this.liveHistory.clear();this.fixedScale=null;this.fixedPace=null;}
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
    const leaderLive=[...liveDrivers].sort((a,b)=>Number(a.current_position||999)-Number(b.current_position||999))[0];
    const leaderTimes=new Map(Object.entries(leaderLive?.laps||{}).map(([k,v])=>[Number(k),this.seconds(v)]).filter(([k,v])=>Number.isInteger(k)&&v!==null));
    const leaderDeviation=new Map();
    let deviation=0,previous=null;
    for(const n of [...leaderTimes.keys()].sort((a,b)=>a-b)){
      if(previous!==null&&n!==previous+1)deviation=NaN;
      if(Number.isFinite(deviation))deviation+=leaderTimes.get(n)-averagePace;
      leaderDeviation.set(n,deviation);
      previous=n;
    }
    const traces=active.map(d=>({...d,points:d.points.filter(p=>p.lap<=lap&&(this.reference==="AVERAGE"||this.reference==="LEADER"||refMap.has(p.lap))).map(p=>({...p,y:archived&&this.reference==="AVERAGE" ? -( (this.archive.laps.find(r=>r.driver===d.label&&r.lap===p.lap)?.lap_end_session_seconds ?? 0) - this.archive.laps.filter(r=>r.lap===1).reduce((min,r)=>Math.min(min,r.lap_end_session_seconds),Infinity) - (p.lap-1)*averagePace ) : this.reference==="AVERAGE" ? -(p.y+(leaderDeviation.get(p.lap)??0)) : -(p.y-(refMap.get(p.lap)||0))}))})).filter(d=>d.points.length);
    // Calculate a stable, race-wide reference for each sector. Scale the
    // observed proportions to the same lap baseline used by the full laps.
    if(!archived){
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
          if(!Number.isInteger(n)||n<1||n>lap||duration===null)continue;
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
    if(!archived){
      for(const d of traces){
        if(!this.liveHistory.has(d.id))this.liveHistory.set(d.id,new Map());
        const history=this.liveHistory.get(d.id);
        for(const p of d.points)if(!history.has(p.lap))history.set(p.lap,{...p});
        // Sector events have their own fractional-lap keys; retain them
        // alongside frozen lap points instead of replacing them.
        // Prefer measured sector points over reconstructed lap points at the
        // same X. A polyline must never join conflicting Y values vertically.
        const merged=new Map();
        for(const p of history.values())if(Number.isFinite(p.lap))merged.set(p.lap.toFixed(6),p);
        for(const p of this.sectorHistory.get(d.id)?.values()||[])
          if(Number.isFinite(p.lap))merged.set(p.lap.toFixed(6),p);
        d.points=[...merged.values()].filter(p=>p.lap<=lap).sort((a,b)=>a.lap-b.lap);
      }
    }
    // Intra-sector snapshots: infer fractional progress from the time since
    // the most recently observed sector transition. The source supplies gaps,
    // not distance, so these points are estimates and never replace anchors.
    if(!archived&&this.sectorPace){
      const now=Date.now();
      const liveById=new Map(liveDrivers.map(d=>[String(d.racing_number||d.tla),d]));
      for(const d of traces){
        const raw=liveById.get(d.id);
        if(!raw)continue;
        const gap=Number(raw.current_position)===1?0:this.seconds(raw.gap_to_leader);
        if(gap===null)continue;
        const currentLap=Number(raw.sector_current_lap)||Number(raw.completed_laps)+1;
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
        d.points.push(...state.samples.filter(p=>p.lap>anchorX&&p.lap<anchorX+1/3));
        const unique=new Map();
        for(const p of d.points)if(Number.isFinite(p.lap)&&Number.isFinite(p.y))unique.set(p.lap.toFixed(6),p);
        d.points=[...unique.values()].sort((a,b)=>a.lap-b.lap);
      }
    }
    for(const d of traces)d.points=d.points.filter(p=>Number.isFinite(p.y));
    const chartLap=Math.max(lap,...traces.flatMap(d=>d.points.map(p=>p.lap)).filter(Number.isFinite),1);
    const chartEnd=Math.max(lap+0.35,chartLap+0.1);
    const values=traces.flatMap(d=>d.points.map(p=>p.y));
    let low=Math.min(0,...values),high=Math.max(0,...values);
    const margin=Math.max(3,(high-low)*.08);low-=margin;high+=margin;
    if(!this.fixedScale)this.fixedScale={low,high};
    else {this.fixedScale.low=Math.min(this.fixedScale.low,low);this.fixedScale.high=Math.max(this.fixedScale.high,high);}
    ({low,high}=this.fixedScale);
    const W=1400,H=720,L=78,R=110,T=40,B=60;
    const x=n=>L+(Math.max(1,n)-1)/Math.max(1,chartEnd-1)*(W-L-R);
    const y=n=>T+(high-n)/(high-low)*(H-T-B);
    let grid="";
    for(let i=0;i<=8;i++){const v=low+(high-low)*i/8;grid+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#263245"/><text x="${L-9}" y="${y(v)+5}" text-anchor="end" fill="#93a4b9" font-size="17">${v.toFixed(1)}s</text>`;}
    for(let n=1;n<=chartEnd;n+=Math.max(1,Math.ceil(chartEnd/14)))grid+=`<line x1="${x(n)}" y1="${T}" x2="${x(n)}" y2="${H-B}" stroke="#202b39"/><text x="${x(n)}" y="${H-20}" text-anchor="middle" fill="#93a4b9" font-size="17">${n}</text>`;
    const lines=traces.filter(d=>d.points.length>0).map(d=>{
      // Split discontinuities rather than drawing artificial near-vertical
      // connections between estimates and timing-line observations.
      const segments=[];
      let segment=[];
      for(const p of d.points){
        const prev=segment.at(-1);
        if(prev&&(p.lap-prev.lap<0.025&&Math.abs(p.y-prev.y)>1.5)){
          if(segment.length)segments.push(segment);
          segment=[];
        }
        segment.push(p);
      }
      if(segment.length)segments.push(segment);
      const paths=segments.map(points=>`<polyline points="${points.map(p=>`${x(p.lap).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ")}" fill="none" stroke="${d.color}" stroke-width="3.2" ${d.retired?'stroke-dasharray="7 6"':''}/>`).join("");
      const last=d.points.at(-1);
      const pitDots=d.points.filter(p=>p.pit).map(p=>`<rect x="${x(p.lap)-5}" y="${y(p.y)-5}" width="10" height="10" fill="#0b121d" stroke="${d.color}" stroke-width="2"/>`).join("");
      return `${paths}<circle cx="${x(last.lap)}" cy="${y(last.y)}" r="4" fill="${d.color}"/><text x="${Math.min(W-R+9,x(last.lap)+9)}" y="${y(last.y)+5}" fill="${d.color}" font-size="17" font-weight="700">${this.escape(d.label)}</text>${pitDots}`;
    }).join("");
    const opts=[{id:"AVERAGE",label:"Average race pace"},{id:"LEADER",label:"Race leader"},...drivers.map(d=>({id:d.id,label:d.label}))];
    this.shadowRoot.innerHTML=`<style>
      :host{display:block;font-family:Inter,Roboto,Arial,sans-serif;color:#eaf2fb}
      ha-card{background:#0b121d;color:inherit;overflow:hidden;border-radius:12px}
      .head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 24px;flex-wrap:wrap}
      .title{font-size:26px;font-weight:800;letter-spacing:.1em}.subtitle{font-size:12px;color:#91a2b8;margin-top:5px}
      select{background:#162333;color:#fff;border:1px solid #3b4b60;border-radius:6px;padding:9px}
      .chart{height:${this.escape(this.config.height)};min-height:350px;position:relative}svg{width:100%;height:100%}
      .legend{display:flex;gap:7px;flex-wrap:wrap;padding:10px 24px 18px}
      button{background:#101b2b;color:#eaf2fb;border:1px solid #26364a;padding:7px 10px;border-radius:5px;cursor:pointer}
      button.off{opacity:.35}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}
      .note{font-size:12px;color:#9eacbd;padding:0 24px 18px}.empty{padding:40px}
    </style><ha-card>
      <div class="head"><div><div class="title">RACE TRACE <span style="color:#ff8700">/ F1</span></div><div class="subtitle">LAP ${lap} · ${drivers.length} DRIVERS · ${traces.length} TRACES · ${archived?"ARCHIVE":"LIVE"}</div></div><label>REFERENCE <select id="reference">${opts.map(o=>`<option value="${this.escape(o.id)}" ${this.reference===o.id?"selected":""}>${this.escape(o.label)}</option>`).join("")}</select></label></div>
      ${traces.length?`<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect width="${W}" height="${H}" fill="#0b121d"/>${grid}<line x1="${L}" y1="${y(0)}" x2="${W-R}" y2="${y(0)}" stroke="#8393a6" stroke-dasharray="8 7"/>${lines}</svg></div>`:'<div class="empty">Waiting for replay driver timing data.</div>'}
      <div class="legend">${drivers.map(d=>`<button data-driver="${this.escape(d.id)}" class="${this.hiddenDrivers.has(d.id)?"off":""}"><span class="dot" style="background:${d.color}"></span>${this.escape(d.label)} · P${this.escape(d.position)}</button>`).join("")}</div>
      <div class="note">${archived?"Historical FastF1 lap-end timing. Gaps measured at the timing line, not simultaneous car positions; lapped cars are omitted when not comparable. Squares indicate pit-in laps.":"Live: sector points are captured as approximate gap snapshots; they are not exact sector-crossing gaps. "+(this.archiveError?"Archive unavailable: "+this.escape(this.archiveError):"Waiting for historical archive.")}</div>
    </ha-card>`;
    this.shadowRoot.getElementById("reference")?.addEventListener("change",e=>{this.reference=e.target.value;this.render();});
    this.shadowRoot.querySelectorAll("[data-driver]").forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.driver;this.hiddenDrivers.has(id)?this.hiddenDrivers.delete(id):this.hiddenDrivers.add(id);this.render();}));
  }
}
if(!customElements.get("f1-race-trace"))customElements.define("f1-race-trace",F1RaceTrace);
window.customCards=window.customCards||[];
if(!window.customCards.some(c=>c.type==="f1-race-trace"))window.customCards.push({type:"f1-race-trace",name:"F1 Race Trace",description:"Race timing trace for Nicxe F1 Sensor"});
