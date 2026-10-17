/* F1 Race Trace experimental Home Assistant card.
 * Separate custom element/resource; production card remains untouched.
 * Consumes GPS and timing recording schema_version 1.
 */
class F1RaceTraceExperimental extends HTMLElement {
 constructor(){
  super();this.attachShadow({mode:'open'});this.gps=null;this.timing=null;
  this.busy=false;this.lastRefresh=0;this.timer=null;this.error='';
 }
 setConfig(config){
  this.config={gps_url:'/local/f1-race-trace/gps-recording.json',
   timing_url:'/local/f1-race-trace/live-recording.json',height:460,...config};
  this.draw();
 }
 set hass(hass){this._hass=hass;}
 connectedCallback(){this.refresh();this.timer=setInterval(()=>this.refresh(),5000);}
 disconnectedCallback(){clearInterval(this.timer);this.timer=null;}
 getCardSize(){return 9;}
 static getStubConfig(){return {};}
 async refresh(){
  if(!this.config||this.busy)return;
  this.busy=true;
  try{
   const [gps,timing]=await Promise.all([this.config.gps_url,this.config.timing_url]
    .map(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(url+': HTTP '+r.status);return r.json();}));
   if(gps.schema_version!==1||timing.schema_version!==1)throw Error('Expected recording schema_version 1');
   if(!Array.isArray(gps.geometry?.points)||!Array.isArray(gps.samples)||!Array.isArray(timing.samples))
    throw Error('Missing GPS geometry or samples');
   this.gps=gps;this.timing=timing;this.error='';this.draw();
  }catch(e){this.error=String(e);this.draw();}
  finally{this.busy=false;}
 }
 draw(){
  if(!this.shadowRoot||!this.config)return;
  if(!this.shadowRoot.querySelector('canvas')){
   this.shadowRoot.innerHTML='<style>:host{display:block}ha-card{display:block;padding:16px;background:var(--ha-card-background,var(--card-background-color,#18202d));color:var(--primary-text-color,#eee)}canvas{width:100%;height:auto;display:block}p{font:12px system-ui;color:var(--secondary-text-color,#aab)}</style><ha-card><h3>F1 Race Trace — Experimental</h3><p id="status"></p><canvas width="1100" height="460"></canvas></ha-card>';
  }
  const status=this.shadowRoot.querySelector('#status'),canvas=this.shadowRoot.querySelector('canvas');
  canvas.style.height=this.config.height+'px';
  if(!this.gps||!this.timing){status.textContent=this.error||'Waiting for GPS and timing recordings';return;}
  try{
   const points=this.gps.geometry.points.map(p=>Array.isArray(p)?p:[p.x,p.y]);
   const geometry=RaceTraceCircuit.prepare(points);
   const frames=RaceTraceRecordingSync.gpsFrames(this.gps);
   const events=RaceTraceRecordingSync.crossings(this.timing).filter(e=>e[1]>=2);
   const calibration=RaceTraceCalibration.calibrate(geometry,frames,events);
   if(!calibration.confidence)throw Error('Start/finish calibration confidence insufficient');
   const traces=new Map(),previous=new Map();
   // Direction from robust signed centreline displacement across nearby samples.
   const changes=[];
   for(const frame of frames.slice(0,Math.min(frames.length,250))){
    for(const [id,x,y] of frame.d){
     const d=RaceTraceCircuit.project(geometry,x,y).distance,prev=previous.get(id);
     if(prev){let delta=d-prev.d;if(delta>geometry.length/2)delta-=geometry.length;if(delta< -geometry.length/2)delta+=geometry.length;
      if(frame.t-prev.t>0&&frame.t-prev.t<8&&Math.abs(delta)>20&&Math.abs(delta)<geometry.length*.08)changes.push(delta);}
     previous.set(id,{d,t:frame.t});
    }
   }
   changes.sort((a,b)=>a-b);
   const direction=(changes[Math.floor(changes.length/2)]||1)<0?-1:1;
   const last=new Map();
   for(const frame of frames)for(const [id,x,y] of frame.d){
    const phase=RaceTraceCircuit.phase(geometry,x,y,calibration.distance,direction);
    const prev=last.get(id);
    if(!traces.has(id))traces.set(id,[]);
    let unwrapped=phase;
    if(prev){
     let step=phase-prev.phase;if(step>0.5)step-=1;if(step< -0.5)step+=1;
     unwrapped=prev.value+(step>=-.03&&step<.2?step:0);
    }
    traces.get(id).push([0,unwrapped,frame.t]);
    last.set(id,{phase,value:unwrapped});
   }
   const aligned=RaceTraceOfficialAlignment.align(traces,events);
   const all=[...traces.values()].flat(),minT=Math.min(...all.map(p=>p[2])),maxT=Math.max(...all.map(p=>p[2]));
   const minX=Math.min(...all.map(p=>p[1])),maxX=Math.max(...all.map(p=>p[1]));
   const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
   ctx.clearRect(0,0,w,h);ctx.fillStyle='#0b1220';ctx.fillRect(0,0,w,h);
   const x=v=>45+(v-minX)/Math.max(.001,maxX-minX)*(w-65);
   const y=t=>h-30-(t-minT)/Math.max(1,maxT-minT)*(h-55);
   ctx.strokeStyle='#334155';ctx.lineWidth=1;
   for(let lap=Math.ceil(minX);lap<=maxX;lap++){ctx.beginPath();ctx.moveTo(x(lap),15);ctx.lineTo(x(lap),h-30);ctx.stroke();ctx.fillStyle='#aab';ctx.fillText('Lap '+lap,x(lap)+3,h-12);}
   const colors=['#fb7185','#38bdf8','#a3e635','#fbbf24','#c084fc','#2dd4bf','#f472b6','#93c5fd'];
   let i=0;
   for(const [id,trace] of traces){
    ctx.strokeStyle=colors[i++%colors.length];ctx.lineWidth=1.5;ctx.beginPath();
    trace.forEach((p,j)=>j?ctx.lineTo(x(p[1]),y(p[2])):ctx.moveTo(x(p[1]),y(p[2])));
    ctx.stroke();
   }
   status.textContent=traces.size+' drivers · '+events.length+' official crossings · '+aligned.aligned.length+' aligned · '+(direction===1?'forward':'reverse')+' direction'+(this.error?' · '+this.error:'');
  }catch(e){status.textContent='Experimental diagnostics: '+e.message;}
 }
}
if(!customElements.get('f1-race-trace-experimental'))customElements.define('f1-race-trace-experimental',F1RaceTraceExperimental);
