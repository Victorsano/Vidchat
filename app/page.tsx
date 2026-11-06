'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, Mic, MicOff, Video, VideoOff, PhoneOff, ShieldCheck, Globe2, Users, Copy, Check, Sparkles, Maximize2 } from 'lucide-react';
import { createFaceEffects, type FaceEffects, type FilterState } from '../lib/face-effects';
import type { FaceFilter } from '../lib/face-art';
type Participant={id:string;stream?:MediaStream;mic:boolean;camera:boolean;status?:string};
type Link={pc:RTCPeerConnection;pending:RTCIceCandidateInit[]};
function Tile({person,self=false}:{person:Participant;self?:boolean}) {
 const video=useRef<HTMLVideoElement>(null); const [blocked,setBlocked]=useState(false);
 useEffect(()=>{const el=video.current;if(el && person.stream){el.srcObject=person.stream;el.play().catch(()=>setBlocked(true));}},[person.stream]);
 return <div className={`video-tile ${self?'self':''}`}>
  <video ref={video} autoPlay playsInline muted={self} className={person.camera && person.stream?'':'hidden-video'}/>
  {(!person.camera || !person.stream) && <div className="avatar">{self?<VideoOff size={32}/>:<Users size={32}/>}</div>}
  <span className="tile-label">{self?'You':`Guest ${person.id.slice(0,4).toUpperCase()}`} {self && <small>• just you</small>}</span>
  <span className="tile-mic">{person.mic?<Mic size={15}/>:<MicOff size={15}/>}</span>
  {person.status && <span className="tile-status">{person.status}</span>}
  {blocked && <button className="play-audio" onClick={()=>video.current?.play().then(()=>setBlocked(false))}>Tap to play audio</button>}
 </div>
}
export default function Home(){
 const [phase,setPhase]=useState<'idle'|'joining'|'live'>('idle');const [stream,setStream]=useState<MediaStream>();
 const [people,setPeople]=useState<Participant[]>([]);const [mic,setMic]=useState(true);const [camera,setCamera]=useState(true);
 const [filter,setFilter]=useState<FaceFilter>('none');const [filterState,setFilterState]=useState<FilterState>('off');const [effectsAvailable,setEffectsAvailable]=useState(true);const effects=useRef<FaceEffects|null>(null);
 const [error,setError]=useState('');const [copied,setCopied]=useState(false);const [elapsed,setElapsed]=useState(0);
 const socket=useRef<WebSocket|null>(null);const local=useRef<MediaStream|null>(null);const links=useRef(new Map<string,Link>());const attempt=useRef(0);const joined=useRef(false);const timeout=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 function cleanup(){attempt.current++;joined.current=false;clearTimeout(timeout.current);socket.current?.close();socket.current=null;links.current.forEach(l=>l.pc.close());links.current.clear();local.current?.getTracks().forEach(t=>t.stop());local.current=null;effects.current?.stop();effects.current=null;setFilter('none');setFilterState('off');setStream(undefined);setPeople([]);setPhase('idle');setElapsed(0);}
 useEffect(()=>()=>{attempt.current++;socket.current?.close();links.current.forEach(l=>l.pc.close());local.current?.getTracks().forEach(t=>t.stop());effects.current?.stop();clearTimeout(timeout.current)},[]);
 useEffect(()=>{if(phase!=='live')return;const t=setInterval(()=>setElapsed(s=>s+1),1000);return()=>clearInterval(t)},[phase]);
 function send(data:unknown){if(socket.current?.readyState===WebSocket.OPEN)socket.current.send(JSON.stringify(data))}
 function update(id:string,patch:Partial<Participant>){setPeople(ps=>ps.map(p=>p.id===id?{...p,...patch}:p))}
 function makePeer(id:string){
  const pc=new RTCPeerConnection({iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']}]});
  const link={pc,pending:[] as RTCIceCandidateInit[]};links.current.set(id,link);
  local.current!.getTracks().forEach(t=>pc.addTrack(t,local.current!));
  pc.onicecandidate=e=>{if(e.candidate)send({type:'signal',to:id,data:{candidate:e.candidate.toJSON()}})};
  pc.ontrack=e=>update(id,{stream:e.streams[0]});
  pc.onconnectionstatechange=()=>{update(id,{status:pc.connectionState==='connected'?undefined:pc.connectionState==='failed'?'Connection failed · try rejoining':pc.connectionState==='disconnected'?'Reconnecting…':'Connecting…'});};
  return link;
 }
 async function join(){
  setError('');setPhase('joining');const current=++attempt.current;
  try{
   if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)throw new Error('Camera access needs HTTPS (or localhost). See the testing guide.');
   const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:{width:{ideal:640},height:{ideal:360},frameRate:{ideal:24,max:30},facingMode:'user'}});
   if(current!==attempt.current){media.getTracks().forEach(t=>t.stop());return;}
   local.current=media;
   const pipeline=await createFaceEffects(media,state=>{if(current===attempt.current)setFilterState(state)});
   if(current!==attempt.current){pipeline.stop();return;}
   effects.current=pipeline;setEffectsAvailable(pipeline.available);local.current=pipeline.stream;setStream(pipeline.stream);setMic(true);setCamera(true);
   const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/signal`);socket.current=ws;
   timeout.current=setTimeout(()=>{if(current===attempt.current){cleanup();setError('The room took too long to respond. Please try again.')}},12000);
   ws.onopen=()=>send({type:'join'});
   ws.onmessage=async event=>{
    if(current!==attempt.current)return;
    try{
     const m=JSON.parse(event.data);
     if(m.type==='welcome'){
      clearTimeout(timeout.current);joined.current=true;setPhase('live');setPeople(m.peers.map((p:Participant)=>({...p,status:'Connecting…'})));
      for(const p of m.peers){const {pc}=makePeer(p.id);await pc.setLocalDescription(await pc.createOffer());send({type:'signal',to:p.id,data:{description:pc.localDescription}})}
     }else if(m.type==='joined'){setPeople(ps=>[...ps,{id:m.id,mic:m.mic,camera:m.camera,status:'Connecting…'}]);}
     else if(m.type==='left'){links.current.get(m.id)?.pc.close();links.current.delete(m.id);setPeople(ps=>ps.filter(p=>p.id!==m.id));}
     else if(m.type==='media')update(m.id,{mic:m.mic,camera:m.camera});
     else if(m.type==='full'){cleanup();setError('The room is full. Six people are already here. Try again in a moment.');}
     else if(m.type==='signal'){
      const link=links.current.get(m.from)||makePeer(m.from);const {pc}=link;
      if(m.data.description){await pc.setRemoteDescription(m.data.description);for(const c of link.pending)await pc.addIceCandidate(c);link.pending=[];
       if(m.data.description.type==='offer'){await pc.setLocalDescription(await pc.createAnswer());send({type:'signal',to:m.from,data:{description:pc.localDescription}})}
      }else if(m.data.candidate){if(pc.remoteDescription)await pc.addIceCandidate(m.data.candidate);else link.pending.push(m.data.candidate);}
     }
    }catch{if(current===attempt.current)setError('A peer could not connect. Leave and rejoin to retry.');}
   };
   ws.onclose=()=>{if(current!==attempt.current)return;const wasJoined=joined.current;cleanup();setError(wasJoined?'Connection to the room was lost. Join again to reconnect.':'Could not connect to the room. Please try again.');};
   ws.onerror=()=>ws.close();
  }catch(e){if(current!==attempt.current)return;cleanup();setError(e instanceof DOMException?(e.name==='NotAllowedError'?'Camera and microphone permission is needed. Allow access in your browser, then try again.':e.name==='NotFoundError'?'No camera or microphone found. Connect both, then try again.':`Could not start your devices: ${e.message}`):e instanceof Error?e.message:'Unable to join. Please try again.');}
 }
 function toggle(kind:'mic'|'camera'){const next=kind==='mic'?!mic:!camera;local.current?.getTracks().filter(t=>t.kind===(kind==='mic'?'audio':'video')).forEach(t=>t.enabled=next);if(kind==='mic')setMic(next);else {setCamera(next);effects.current?.setCamera(next);}send({type:'media',mic:kind==='mic'?next:mic,camera:kind==='camera'?next:camera});}
 function selectFilter(value:FaceFilter){setFilter(value);effects.current?.setFilter(value)}
 async function copy(){try{await navigator.clipboard.writeText(location.origin);setCopied(true);setTimeout(()=>setCopied(false),2000)}catch{setError('Copy the address from your browser to invite someone.')}}
 return <div className="shell"><header><a className="brand" href="/" aria-label="Dorcas match home"><span className="brand-mark">DM<span>•</span></span>Dorcas match<span className="beta">BETA</span></a><div className="header-right"><span className="live-dot"/> One room. Everyone welcome.<span className="divider"/><a href="#how">How it works <ArrowUpRight size={14}/></a></div></header>
 <main><section className="intro"><div className="eyebrow"><span/> LESS SCROLLING. MORE CONNECTING.</div><h1>A little closer.<br/><span>Just one click away.</span></h1><p>No profiles. No planning. Just real people, in real time.<br className="desktop-break"/> Step into our shared room and see who’s here.</p></section>
 <section className={`room ${phase==='live'?'in-call':''}`} aria-label="Shared video room"><div className="room-top"><div><span className="room-icon"><Globe2 size={18}/></span><strong>The shared room</strong><span className="room-badge">PUBLIC</span></div><span className="room-count"><Users size={15}/>{phase==='live'?`${people.length+1} / 6 in room`:'Up to 6 people'}</span></div>
 {phase!=='live'?<div className="lobby"><div className="orbital"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="floating-dot dot-one"/><span className="floating-dot dot-two"/><div className="video-symbol"><Video size={39} strokeWidth={1.7}/><span className="spark"><Sparkles size={15}/></span></div></div><h2>Good conversations start with hello.</h2><p>Your seat in the room is ready.</p><button className="join" onClick={join} disabled={phase==='joining'}>{phase==='joining'?<><span className="spinner"/>Connecting…</>:<>Join Call <ArrowRight size={18}/></>}</button>{phase==='joining' && <button className="cancel" onClick={cleanup}>Cancel</button>}<div className="permission-note"><ShieldCheck size={14}/> We’ll ask for your camera & microphone</div></div>:<><div className="call-meta"><span><span className="live-dot"/> LIVE <b>{Math.floor(elapsed/60).toString().padStart(2,'0')}:{(elapsed%60).toString().padStart(2,'0')}</b></span><button onClick={copy}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'Copied':'Invite someone'}</button></div><div className={`video-grid ${people.length===0?'solo':''}`}><Tile person={{id:'you',stream,mic,camera}} self/>{people.map(p=><Tile key={p.id} person={p}/>)}{people.length===0 && <div className="waiting"><div><Users size={28}/></div><h3>You’re the first one here.</h3><p>A little company is one link away.</p><button onClick={copy}>{copied?'Link copied':'Copy invite link'} <ArrowUpRight size={14}/></button></div>}</div><div className="filters" aria-label="Face filters"><div className="filters-heading"><span><Sparkles size={14}/> Face filters</span><small role="status" aria-live="polite">{!effectsAvailable?'Filters aren’t supported in this browser':!camera?'Turn on your camera to use filters':filterState==='loading'?'Loading filters…':filterState==='searching'?'Look toward the camera':filterState==='tracking'?'Your filter is live':filterState==='unavailable'?'Couldn’t load filters. Try another option.':'A little extra personality.'}</small></div><div className="filter-options">{([{id:'none',icon:'○',label:'None'},{id:'bunny',icon:'🐰',label:'Bunny ears'},{id:'mask',icon:'😷',label:'Nose mask'},{id:'patch',icon:'🏴‍☠️',label:'Eye patch'}] as const).map(item=><button key={item.id} aria-pressed={filter===item.id} disabled={item.id!=='none'&&(!camera||!effectsAvailable)} className={filter===item.id?'selected':''} onClick={()=>selectFilter(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}</div></div><div className="controls"><div className="control-group"><button className={!mic?'off':''} onClick={()=>toggle('mic')} aria-label={mic?'Mute microphone':'Unmute microphone'} aria-pressed={!mic}>{mic?<Mic size={20}/>:<MicOff size={20}/>}</button><button className={!camera?'off':''} onClick={()=>toggle('camera')} aria-label={camera?'Turn camera off':'Turn camera on'} aria-pressed={!camera}>{camera?<Video size={20}/>:<VideoOff size={20}/>}</button></div><span className="control-caption">You’re in. Say hello.</span><button className="leave" onClick={cleanup}><PhoneOff size={18}/><span>Leave Call</span></button></div></>}
 <div className="room-bottom"><span><span className="live-dot"/> {phase==='live'?'You’re connected':'The room is open'}</span><span><ShieldCheck size={13}/> Peer-to-peer connection</span></div></section>
 {error && <div className="error" role="alert">{error}<button aria-label="Dismiss message" onClick={()=>setError('')}>×</button></div>}
 <section className="benefits" id="how"><article><span className="feature-icon"><Users size={19}/></span><div><h3>Come as you are</h3><p>No sign-ups. No names. Just you.</p></div></article><article><span className="feature-icon"><Video size={19}/></span><div><h3>Real face time</h3><p>Direct audio & video. In the moment.</p></div></article><article><span className="feature-icon"><ShieldCheck size={19}/></span><div><h3>Your call, your control</h3><p>Mute, turn off video, or leave anytime.</p></div></article></section><div className="kind-note"><span>✳</span> A shared space works best with a little kindness. Be respectful.</div></main><footer><span className="footer-brand">Dorcas match <small>Made for a little human connection.</small></span><span>No accounts. No recordings. Just conversation.<ArrowUpRight size={13}/></span></footer></div>
}
