import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFaceEffects} from '../lib/face-effects';
test('filtered stream keeps microphone, disables both cameras, and stops all capture on leave',async()=>{
 const original=new Map<string,PropertyDescriptor|undefined>();
 function stub(key:string,value:unknown){original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
 const track=(kind:string)=>({kind,enabled:true,stopped:false,stop(){this.stopped=true}});
 const camera=track('video'),audio=track('audio'),output=track('video');
 class Stream{constructor(public tracks:ReturnType<typeof track>[]){ }getTracks(){return this.tracks}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video')}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio')}}
 let paused=false,cancelled=false;const video={muted:false,autoplay:false,playsInline:false,srcObject:null,videoWidth:640,videoHeight:360,play:async()=>{},pause:()=>{paused=true}};
 const canvas={width:0,height:0,getContext:()=>({drawImage:()=>{}}),captureStream:()=>new Stream([output])};
 stub('document',{createElement:(type:string)=>type==='video'?video:canvas});stub('MediaStream',Stream);stub('requestAnimationFrame',()=>1);stub('cancelAnimationFrame',()=>{cancelled=true});
 try{
  const source=new Stream([camera,audio]);
  const effects=await createFaceEffects(source as unknown as MediaStream,()=>{});
  assert.equal(effects.available,true);assert.equal(effects.stream.getAudioTracks()[0],audio);assert.equal(effects.stream.getVideoTracks()[0],output);
  effects.setCamera(false);assert.equal(camera.enabled,false);assert.equal(output.enabled,false);assert.equal(audio.enabled,true);
  effects.setCamera(true);assert.equal(camera.enabled,true);assert.equal(output.enabled,true);
  effects.stop();assert(camera.stopped&&audio.stopped&&output.stopped);assert(paused&&cancelled);assert.equal(video.srcObject,null);
 }finally{for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}}
});
