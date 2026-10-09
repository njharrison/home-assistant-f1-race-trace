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
  }
  setConfig(config) {
    this.config = {entity:"sensor.f1_drivers_driver_positions",lap_entity:"sensor.f1_race_lap_count",height:"85vh",archive_url:null,...config};
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
    const active=drivers.filter(d=>d.points.some(p=>p.lap<=lap)&&!this.hiddenDrivers.has(d.id));
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
    const averagePace=sample.length?sample.reduce((a,b)=>a+b,0)/sample.length:95;
    const traces=active.map(d=>({...d,points:d.points.filter(p=>p.lap<=lap&&(this.reference==="AVERAGE"||this.reference==="LEADER"||refMap.has(p.lap))).map(p=>({...p,y:archived&&this.reference==="AVERAGE" ? -( (this.archive.laps.find(r=>r.driver===d.label&&r.lap===p.lap)?.lap_end_session_seconds ?? 0) - this.archive.laps.filter(r=>r.lap===1).reduce((min,r)=>Math.min(min,r.lap_end_session_seconds),Infinity) - (p.lap-1)*averagePace ) : this.reference==="AVERAGE" ? -(p.y-p.lap*0) : -(p.y-(refMap.get(p.lap)||0))}))})).filter(d=>d.points.length);
    const values=traces.flatMap(d=>d.points.map(p=>p.y));
    let low=Math.min(0,...values),high=Math.max(0,...values);
    const margin=Math.max(3,(high-low)*.08);low-=margin;high+=margin;
    const W=1400,H=720,L=78,R=110,T=40,B=60;
    const x=n=>L+(Math.max(1,n)-1)/Math.max(1,lap-1)*(W-L-R);
    const y=n=>T+(high-n)/(high-low)*(H-T-B);
    let grid="";
    for(let i=0;i<=8;i++){const v=low+(high-low)*i/8;grid+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#263245"/><text x="${L-9}" y="${y(v)+5}" text-anchor="end" fill="#93a4b9" font-size="17">${v.toFixed(1)}s</text>`;}
    for(let n=1;n<=lap;n+=Math.max(1,Math.ceil(lap/14)))grid+=`<line x1="${x(n)}" y1="${T}" x2="${x(n)}" y2="${H-B}" stroke="#202b39"/><text x="${x(n)}" y="${H-20}" text-anchor="middle" fill="#93a4b9" font-size="17">${n}</text>`;
    const lines=traces.map(d=>{
      const path=d.points.map(p=>`${x(p.lap).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
      const last=d.points.at(-1);
      const pitDots=d.points.filter(p=>p.pit).map(p=>`<rect x="${x(p.lap)-5}" y="${y(p.y)-5}" width="10" height="10" fill="#0b121d" stroke="${d.color}" stroke-width="2"/>`).join("");
      return `<polyline points="${path}" fill="none" stroke="${d.color}" stroke-width="3.2" ${d.retired?'stroke-dasharray="7 6"':''}/><circle cx="${x(last.lap)}" cy="${y(last.y)}" r="4" fill="${d.color}"/><text x="${Math.min(W-R+9,x(last.lap)+9)}" y="${y(last.y)+5}" fill="${d.color}" font-size="17" font-weight="700">${this.escape(d.label)}</text>${pitDots}`;
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
      <div class="note">${archived?"Historical FastF1 lap-end timing. Gaps measured at the timing line, not simultaneous car positions; lapped cars are omitted when not comparable. Squares indicate pit-in laps.":"Live fallback: gaps estimated from available replay laps. "+(this.archiveError?"Archive unavailable: "+this.escape(this.archiveError):"Waiting for historical archive.")}</div>
    </ha-card>`;
    this.shadowRoot.getElementById("reference")?.addEventListener("change",e=>{this.reference=e.target.value;this.render();});
    this.shadowRoot.querySelectorAll("[data-driver]").forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.driver;this.hiddenDrivers.has(id)?this.hiddenDrivers.delete(id):this.hiddenDrivers.add(id);this.render();}));
  }
}
if(!customElements.get("f1-race-trace"))customElements.define("f1-race-trace",F1RaceTrace);
window.customCards=window.customCards||[];
if(!window.customCards.some(c=>c.type==="f1-race-trace"))window.customCards.push({type:"f1-race-trace",name:"F1 Race Trace",description:"Race timing trace for Nicxe F1 Sensor"});
