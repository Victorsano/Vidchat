export type FaceFilter = 'none' | 'bunny' | 'mask' | 'patch';
type Point={x:number;y:number};
export function facePose(points:Point[],width:number,height:number){
 if(points.length<3 || !points.slice(0,3).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))return null;
 const eyes=points.slice(0,2).sort((a,b)=>a.x-b.x);
 const dx=(eyes[1].x-eyes[0].x)*width,dy=(eyes[1].y-eyes[0].y)*height;
 const scale=Math.hypot(dx,dy);if(scale<8)return null;
 const x=(eyes[0].x+eyes[1].x)*width/2,y=(eyes[0].y+eyes[1].y)*height/2;
 const angle=Math.atan2(dy,dx),nx=points[2].x*width-x,ny=points[2].y*height-y;
 return {x,y,scale,angle,noseX:(nx*Math.cos(angle)+ny*Math.sin(angle))/scale,noseY:(-nx*Math.sin(angle)+ny*Math.cos(angle))/scale};
}
export function drawFaceArt(ctx:CanvasRenderingContext2D,filter:FaceFilter,pose:NonNullable<ReturnType<typeof facePose>>){
 ctx.save();ctx.translate(pose.x,pose.y);ctx.rotate(pose.angle);ctx.scale(pose.scale,pose.scale);ctx.lineCap='round';ctx.lineJoin='round';
 if(filter==='bunny'){
  for(const side of [-1,1]){
   ctx.save();ctx.translate(side*.65,-.75);ctx.rotate(side*.18);
   ctx.fillStyle='#fffaf5';ctx.strokeStyle='#dbc9bf';ctx.lineWidth=.035;
   ctx.beginPath();ctx.ellipse(0,-.74,.25,.87,0,0,Math.PI*2);ctx.fill();ctx.stroke();
   ctx.fillStyle='#f2b5c4';ctx.beginPath();ctx.ellipse(0,-.76,.13,.64,0,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  ctx.translate(pose.noseX,pose.noseY);ctx.fillStyle='#ed9fb3';ctx.beginPath();ctx.moveTo(-.15,0);ctx.quadraticCurveTo(0,-.11,.15,0);ctx.quadraticCurveTo(.07,.18,0,.2);ctx.quadraticCurveTo(-.07,.18,-.15,0);ctx.fill();
  ctx.strokeStyle='#fff7ed';ctx.lineWidth=.025;
  for(const side of [-1,1])for(const y of [0,.13,.26]){ctx.beginPath();ctx.moveTo(side*.23,.17);ctx.lineTo(side*.77,y);ctx.stroke();}
 }else if(filter==='mask'){
  ctx.translate(pose.noseX,pose.noseY+.25);
  ctx.strokeStyle='#e6f4f3';ctx.lineWidth=.035;
  for(const side of [-1,1]){ctx.beginPath();ctx.ellipse(side*.82,0,.22,.27,side*.2,0,Math.PI*2);ctx.stroke();}
  ctx.fillStyle='#b8d9d7';ctx.strokeStyle='#78aaa7';ctx.lineWidth=.025;
  ctx.beginPath();ctx.moveTo(-.77,-.24);ctx.quadraticCurveTo(-.35,-.23,0,-.39);ctx.quadraticCurveTo(.35,-.23,.77,-.24);ctx.lineTo(.71,.26);ctx.quadraticCurveTo(0,.63,-.71,.26);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.strokeStyle='#8dbbb8';ctx.lineWidth=.02;
  for(const y of [-.08,.08,.24]){ctx.beginPath();ctx.moveTo(-.58,y);ctx.quadraticCurveTo(0,y+.14,.58,y);ctx.stroke();}
 }else if(filter==='patch'){
  ctx.strokeStyle='#292a2c';ctx.lineWidth=.065;ctx.beginPath();ctx.moveTo(-1.05,-.27);ctx.lineTo(1.03,.15);ctx.stroke();
  ctx.save();ctx.translate(-.5,0);ctx.rotate(-.08);ctx.fillStyle='#25272a';ctx.strokeStyle='#505357';ctx.lineWidth=.025;
  ctx.beginPath();ctx.moveTo(-.35,-.23);ctx.quadraticCurveTo(0,-.36,.35,-.23);ctx.lineTo(.3,.19);ctx.quadraticCurveTo(0,.45,-.3,.19);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.strokeStyle='#777a7d';ctx.lineWidth=.014;ctx.beginPath();ctx.moveTo(-.23,-.16);ctx.quadraticCurveTo(0,-.23,.22,-.16);ctx.stroke();ctx.restore();
 }
 ctx.restore();
}
