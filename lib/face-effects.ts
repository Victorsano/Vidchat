import { drawFaceArt, facePose, type FaceFilter } from './face-art';
import { fittedMask, drawFittedMask } from './fitted-mask';
import type { FaceDetector, FaceLandmarker } from '@mediapipe/tasks-vision';
export type FilterState='off'|'loading'|'tracking'|'searching'|'unavailable';
export type FaceEffects={stream:MediaStream;available:boolean;setFilter:(filter:FaceFilter)=>void;setCamera:(enabled:boolean)=>void;stop:()=>void};
// Source frames stay in this browser. Only the composited video track goes to peers.
export async function createFaceEffects(source:MediaStream,onState:(state:FilterState)=>void):Promise<FaceEffects>{
 const video=document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;video.srcObject=source;
 const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d');
 let stopped=false,enabled=true,filter:FaceFilter='none',detector:FaceDetector|undefined,loading:Promise<void>|undefined,raf=0;
 let landmarker:FaceLandmarker|undefined,maskLoading:Promise<void>|undefined;
 let mask:ReturnType<typeof fittedMask>=null;
 let pose:ReturnType<typeof facePose>=null,lastDetection=-Infinity,lastVideoTime=-1,lastPaint=0,lastState:FilterState='off';
 const state=(s:FilterState)=>{if(!stopped&&s!==lastState){lastState=s;onState(s)}};
 const fallback=()=>({stream:source,available:false,setFilter:()=>{},setCamera:(value:boolean)=>source.getVideoTracks().forEach(t=>t.enabled=value),stop:()=>{stopped=true;video.pause();video.srcObject=null;source.getTracks().forEach(t=>t.stop())}});
 if(!ctx || !canvas.captureStream)return fallback();
 try{await video.play()}catch{return fallback()}
 canvas.width=video.videoWidth||640;canvas.height=video.videoHeight||360;
 ctx.drawImage(video,0,0,canvas.width,canvas.height);
 const captured=canvas.captureStream(24);const stream=new MediaStream([...captured.getVideoTracks(),...source.getAudioTracks()]);
 async function loadMask(){
  if(landmarker||maskLoading)return maskLoading;
  state('loading');
  maskLoading=(async()=>{
   try{
    const {FaceLandmarker,FilesetResolver}=await import('@mediapipe/tasks-vision');
    const files=await FilesetResolver.forVisionTasks('/face-effects/wasm');
    const instance=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/face-effects/face-landmarker.task'},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.5,minTrackingConfidence:.5});
    if(stopped){instance.close();return}landmarker=instance;
   }catch{if(filter==='mask')state('unavailable')}finally{maskLoading=undefined}
  })();return maskLoading;
 }
 async function load(){
  if(detector||loading)return loading;
  state('loading');
  loading=(async()=>{
   try{
    const {FaceDetector,FilesetResolver}=await import('@mediapipe/tasks-vision');
    const files=await FilesetResolver.forVisionTasks('/face-effects/wasm');
    const instance=await FaceDetector.createFromOptions(files,{baseOptions:{modelAssetPath:'/face-effects/face-detector.tflite'},runningMode:'VIDEO',minDetectionConfidence:.55});
    if(stopped){instance.close();return}detector=instance;
   }catch{if(filter!=='none')state('unavailable')}finally{loading=undefined}
  })();return loading;
 }
 function frame(now:number){
  if(stopped)return;raf=requestAnimationFrame(frame);
  if(now-lastPaint<1000/24)return;lastPaint=now;
  if(!enabled){ctx!.fillStyle='#000';ctx!.fillRect(0,0,canvas.width,canvas.height);pose=null;mask=null;return;}
  if(video.readyState<2)return;
  if(canvas.width!==video.videoWidth||canvas.height!==video.videoHeight){canvas.width=video.videoWidth;canvas.height=video.videoHeight;pose=null;mask=null;}
  ctx!.drawImage(video,0,0,canvas.width,canvas.height);
  if(filter==='none'){pose=null;mask=null;state('off');return;}
  if(filter==='mask'){
   if(landmarker&&now-lastDetection>=80&&video.currentTime!==lastVideoTime){
    lastDetection=now;lastVideoTime=video.currentTime;
    try{
     const points=landmarker.detectForVideo(video,now).faceLandmarks[0];
     mask=points?fittedMask(points,canvas.width,canvas.height):null;
     state(mask?'tracking':'searching');
    }catch{mask=null;landmarker.close();landmarker=undefined;state('unavailable');}
   }
   if(mask)drawFittedMask(ctx!,mask);
   return;
  }
  // Run detection at most 10 times/second, draw video at 24 fps.
  if(detector&&now-lastDetection>=100&&video.currentTime!==lastVideoTime){
   lastDetection=now;lastVideoTime=video.currentTime;
   try{
    const faces=detector.detectForVideo(video,now).detections;
    const face=faces.sort((a,b)=>(b.boundingBox?.width||0)-(a.boundingBox?.width||0))[0];
    pose=face?facePose(face.keypoints,canvas.width,canvas.height):null;
    state(pose?'tracking':'searching');
   }catch{pose=null;detector.close();detector=undefined;state('unavailable');}
  }
  if(pose)drawFaceArt(ctx!,filter,pose);
 }
 raf=requestAnimationFrame(frame);
 return {stream,available:true,setFilter(value){filter=value;pose=null;mask=null;lastDetection=-Infinity;if(value==='none')state('off');else if(value==='mask'){if(!landmarker)void loadMask();else state('searching')}else if(!detector)void load();else state('searching')},setCamera(value){enabled=value;source.getVideoTracks().forEach(t=>t.enabled=value);captured.getVideoTracks().forEach(t=>t.enabled=value);pose=null;mask=null;lastDetection=-Infinity},stop(){stopped=true;cancelAnimationFrame(raf);detector?.close();landmarker?.close();video.pause();video.srcObject=null;source.getTracks().forEach(t=>t.stop());captured.getTracks().forEach(t=>t.stop());canvas.width=canvas.height=0}};
}
