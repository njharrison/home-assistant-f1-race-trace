// Singapore 2026: extracted unchanged from the validated offline preview.
// Expects track segments, cumulative lengths and diagnostics from the host engine.
function project(x,y){let best=Infinity,s=0;for(let i=0;i<seg.length;i++){let e=seg[i],u=Math.max(0,Math.min(1,((x-e.a[0])*e.dx+(y-e.a[1])*e.dy)/(e.l*e.l)));let px=e.a[0]+u*e.dx,py=e.a[1]+u*e.dy,dd=(px-x)**2+(py-y)**2;if(dd<best){best=dd;s=cum[i]+u*e.l}}return s}
function projectionCandidates(x,y,tx,ty){
 const out=[],hasTangent=Math.hypot(tx,ty)>1e-7;
 for(let i=0;i<seg.length;i++){
  const e=seg[i],ax=e.a[0],ay=e.a[1],dx=e.dx,dy=e.dy;
  const nearestU=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(e.l*e.l)));
  const nearX=ax+nearestU*dx,nearY=ay+nearestU*dy;
  const nearestError=Math.hypot(nearX-x,nearY-y);
  // Intersection of centreline A+u*(B-A) with the line normal to
  // trajectory: dot(A+u*(B-A)-P, tangent)=0.
  const denom=dx*tx+dy*ty;
  let u=nearestU,normal=false;
  if(hasTangent&&Math.abs(denom)>1e-7*e.l*Math.hypot(tx,ty)){
   const candidate=((x-ax)*tx+(y-ay)*ty)/denom;
   if(candidate>=0&&candidate<=1){u=candidate;normal=true;}
  }
  const px=ax+u*dx,py=ay+u*dy;
  const error=Math.hypot(px-x,py-y);
  out.push({s:cum[i]+u*e.l,error,nearestError,normal,segment:i});
 }
 return out;
}
function correctedProjectionSamples(samples,dir){
 let accepted=null,lastTime=null,unwrapped=0;
 const output=[];
 for(let j=0;j<samples.length;j++){
  const prev=samples[Math.max(0,j-1)],mid=samples[j],next=samples[Math.min(samples.length-1,j+1)];
  // Centred three-point smoothing; don't smooth across long sample gaps.
  const continuous=prev!==mid&&next!==mid&&mid.t-prev.t>0&&next.t-mid.t>0&&
   mid.t-prev.t<8&&next.t-mid.t<8;
  const x=continuous?(prev.x+2*mid.x+next.x)/4:mid.x;
  const y=continuous?(prev.y+2*mid.y+next.y)/4:mid.y;
  const tx=next.x-prev.x,ty=next.y-prev.y;
  const candidates=projectionCandidates(x,y,tx,ty);
  const dt=lastTime===null?0:mid.t-lastTime;
  const maxStep=Math.max(1200,dt*1100);
  let chosen=null,best=Infinity,delta=0;
  for(const c of candidates){
   let d=accepted===null?0:(c.s-accepted.s)*dir;
   if(d>length/2)d-=length;if(d<-length/2)d+=length;
   if(accepted!==null&&(dt<=0||d>maxStep||d< -Math.max(350,dt*120)))continue;
   // Continuity dominates small geometry differences near overlapping segments.
   const cost=c.error+ (accepted===null?0:Math.abs(d-Math.max(0,dt*390))*0.22)
    +(!c.normal?Math.min(300,c.nearestError)*0.12:0);
   if(cost<best){best=cost;chosen=c;delta=d;}
  }
  if(!chosen){projectionDiagnostics.rejected++; // Keep last accepted position.
   output.push({frame:mid.frame,t:mid.t,s:unwrapped,accepted:false});continue;
  }
  if(accepted!==null)unwrapped+=delta;
  accepted=chosen;lastTime=mid.t;
  projectionDiagnostics[chosen.normal?'normal':'fallback']++;
  output.push({frame:mid.frame,t:mid.t,s:unwrapped,accepted:true});
 }
 return output;
}