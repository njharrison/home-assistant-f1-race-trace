/* F1 Race Trace prototype — Nicxe F1 Sensor. Historical archive integration pending. */
class F1RaceTrace extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:"open"});
    this.config = {};
    this.reference = "LEADER";
    this.hiddenDrivers = new Set();
    this.signature = "";
  }
  setConfig(config) {
    this.config = {entity:"sensor.f1_drivers_driver_positions",lap_entity:"sensor.f1_race_lap_count",height:"85vh",...config};
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
  render(){
    if(!this.shadowRoot)return;
    const hass=this._hass,s=hass?.states?.[this.config.entity];
    const raw=s?.attributes?.drivers;
    const drivers=this.data(Array.isArray(raw)?raw:[]);
    const lap=Math.max(1,Number(hass?.states?.[this.config.lap_entity]?.state)||1);
    const active=drivers.filter(d=>d.points.length&&!this.hiddenDrivers.has(d.id));
    const reference=drivers.find(d=>d.id===this.reference);
    const refMap=new Map(reference?.points.map(p=>[p.lap,p.y])||[]);
    const traces=active.map(d=>({...d,points:d.points.filter(p=>this.reference==="LEADER"||refMap.has(p.lap)).map(p=>({lap:p.lap,y:p.y-(refMap.get(p.lap)||0)}))})).filter(d=>d.points.length);
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
      return `<polyline points="${path}" fill="none" stroke="${d.color}" stroke-width="3.2" ${d.retired?'stroke-dasharray="7 6"':''}/><circle cx="${x(last.lap)}" cy="${y(last.y)}" r="4" fill="${d.color}"/><text x="${Math.min(W-R+9,x(last.lap)+9)}" y="${y(last.y)+5}" fill="${d.color}" font-size="17" font-weight="700">${this.escape(d.label)}</text>`;
    }).join("");
    const opts=[{id:"LEADER",label:"Race leader"},...drivers.map(d=>({id:d.id,label:d.label}))];
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
      <div class="head"><div><div class="title">RACE TRACE <span style="color:#ff8700">/ F1</span></div><div class="subtitle">LAP ${lap} · ${drivers.length} DRIVERS · ${traces.length} TRACES</div></div><label>REFERENCE <select id="reference">${opts.map(o=>`<option value="${this.escape(o.id)}" ${this.reference===o.id?"selected":""}>${this.escape(o.label)}</option>`).join("")}</select></label></div>
      ${traces.length?`<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect width="${W}" height="${H}" fill="#0b121d"/>${grid}<line x1="${L}" y1="${y(0)}" x2="${W-R}" y2="${y(0)}" stroke="#8393a6" stroke-dasharray="8 7"/>${lines}</svg></div>`:'<div class="empty">Waiting for replay driver timing data.</div>'}
      <div class="legend">${drivers.map(d=>`<button data-driver="${this.escape(d.id)}" class="${this.hiddenDrivers.has(d.id)?"off":""}"><span class="dot" style="background:${d.color}"></span>${this.escape(d.label)} · P${this.escape(d.position)}</button>`).join("")}</div>
      <div class="note">Prototype: estimated gaps anchored to current timing; replay seeking may leave missing laps. Historical FastF1 archive is not connected yet.</div>
    </ha-card>`;
    this.shadowRoot.getElementById("reference")?.addEventListener("change",e=>{this.reference=e.target.value;this.render();});
    this.shadowRoot.querySelectorAll("[data-driver]").forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.driver;this.hiddenDrivers.has(id)?this.hiddenDrivers.delete(id):this.hiddenDrivers.add(id);this.render();}));
  }
}
if(!customElements.get("f1-race-trace"))customElements.define("f1-race-trace",F1RaceTrace);
window.customCards=window.customCards||[];
if(!window.customCards.some(c=>c.type==="f1-race-trace"))window.customCards.push({type:"f1-race-trace",name:"F1 Race Trace",description:"Race timing trace for Nicxe F1 Sensor"});
