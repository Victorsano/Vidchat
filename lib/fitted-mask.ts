type Point={x:number;y:number};
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
export function fittedMask(points:Point[],width:number,height:number){
 const indices=[6,1,234,93,454,323,172,397,152];
 if(width<=0||height<=0||!indices.every(i=>points[i]&&Number.isFinite(points[i].x)&&Number.isFinite(points[i].y)))return null;
 const p=(i:number)=>({x:points[i].x*width,y:points[i].y*height});
 const bridge=p(6),nose=p(1),chin=p(152);
 const a={cheek:mix(p(234),p(93),.35),jaw:p(172),ear:p(234)};
 const b={cheek:mix(p(454),p(323),.35),jaw:p(397),ear:p(454)};
 const [left,right]=[a,b].sort((a,b)=>a.cheek.x-b.cheek.x);
 const span=Math.hypot(right.cheek.x-left.cheek.x,right.cheek.y-left.cheek.y);
 if(span<15||Math.hypot(chin.x-bridge.x,chin.y-bridge.y)<10)return null;
 return {bridge,nose,chin,left,right,span};
}
export function drawFittedMask(ctx:CanvasRenderingContext2D,fit:NonNullable<ReturnType<typeof fittedMask>>){
 const {bridge,nose,chin,left,right,span}=fit;
 const leftLow=mix(left.jaw,chin,.15),rightLow=mix(right.jaw,chin,.15);
 ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
 // Ear loops follow each side independently as the head turns.
 ctx.strokeStyle='#e5f2ef';ctx.lineWidth=span*.017;
 for(const side of [left,right]){
  const bottom=side===left?leftLow:rightLow;
  ctx.beginPath();ctx.moveTo(side.cheek.x,side.cheek.y);
  const outer=mix(side.ear,side.cheek,-.12);
  ctx.quadraticCurveTo(outer.x,outer.y,side.ear.x,side.ear.y);
  ctx.quadraticCurveTo(side.ear.x,side.ear.y+span*.27,bottom.x,bottom.y);ctx.stroke();
 }
 ctx.beginPath();ctx.moveTo(left.cheek.x,left.cheek.y);
 const topLeft=mix(left.cheek,bridge,.5),topRight=mix(right.cheek,bridge,.5);
 ctx.quadraticCurveTo(topLeft.x,topLeft.y+span*.04,bridge.x,bridge.y);
 ctx.quadraticCurveTo(topRight.x,topRight.y+span*.04,right.cheek.x,right.cheek.y);
 ctx.quadraticCurveTo(right.jaw.x,right.jaw.y,rightLow.x,rightLow.y);
 ctx.quadraticCurveTo(mix(rightLow,chin,.5).x,chin.y,chin.x,chin.y);
 ctx.quadraticCurveTo(mix(leftLow,chin,.5).x,chin.y,leftLow.x,leftLow.y);
 ctx.quadraticCurveTo(left.jaw.x,left.jaw.y,left.cheek.x,left.cheek.y);ctx.closePath();
 const fabric=ctx.createLinearGradient(bridge.x,bridge.y,chin.x,chin.y);
 fabric.addColorStop(0,'#c8e2df');fabric.addColorStop(.45,'#b8d9d7');fabric.addColorStop(1,'#9fc7c4');
 ctx.fillStyle=fabric;ctx.strokeStyle='#78aaa7';ctx.lineWidth=span*.012;ctx.fill();ctx.stroke();
 // Clip the folds to the face-fitted silhouette.
 ctx.save();ctx.clip();
 for(const t of [.3,.5,.7]){
  const start=mix(left.cheek,leftLow,t),end=mix(right.cheek,rightLow,t);
  const center=mix(nose,chin,t);
  ctx.strokeStyle='#8fbab7';ctx.lineWidth=span*.009;
  ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.quadraticCurveTo(center.x,center.y,end.x,end.y);ctx.stroke();
  ctx.strokeStyle='#d2e8e4';ctx.lineWidth=span*.007;
  ctx.beginPath();ctx.moveTo(start.x,start.y-span*.012);ctx.quadraticCurveTo(center.x,center.y-span*.012,end.x,end.y-span*.012);ctx.stroke();
 }
 ctx.restore();
 // A subtle seam contours around the bridge rather than floating above it.
 const seamLeft=mix(bridge,left.cheek,.23),seamRight=mix(bridge,right.cheek,.23);
 ctx.strokeStyle='#e0efeb';ctx.lineWidth=span*.013;ctx.beginPath();ctx.moveTo(seamLeft.x,seamLeft.y+span*.024);ctx.quadraticCurveTo(bridge.x,bridge.y-span*.01,seamRight.x,seamRight.y+span*.024);ctx.stroke();ctx.restore();
}
