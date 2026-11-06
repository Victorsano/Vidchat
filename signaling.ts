import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
export function attachSignaling(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const peers = new Map<string, { ws: WebSocket; alive: boolean; media: {mic:boolean;camera:boolean} }>();
  const send = (ws: WebSocket, message: unknown) => { if(ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
  const broadcast = (message: unknown, except?: string) => peers.forEach((p,id) => {if(id!==except)send(p.ws,message)});
  server.on('upgrade', (req,socket,head) => {
    if(new URL(req.url || '/', 'http://localhost').pathname !== '/signal') return;
    // Reject cross-origin browser connections; allow the same host through HTTPS proxies.
    if(req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; }
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection', ws => {
    let id: string | undefined;
    let messages = 0;
    const rate = setInterval(()=>messages=0,1000);
    const joinTimeout = setTimeout(()=>{if(!id)ws.close(1008,'Join timeout')},10000);
    ws.on('pong',()=>{if(id && peers.has(id))peers.get(id)!.alive=true});
    ws.on('message', raw => {
      if(++messages>150){ws.close(1008,'Too many messages');return;}
      try {
        const m=JSON.parse(raw.toString());
        if(m.type==='join' && !id) {
          if(peers.size>=6){send(ws,{type:'full'});ws.close(1000);return;}
          id=randomUUID();
          const existing=[...peers].map(([id,p])=>({id,...p.media}));
          peers.set(id,{ws,alive:true,media:{mic:true,camera:true}});
          clearTimeout(joinTimeout);
          send(ws,{type:'welcome',id,peers:existing});
          broadcast({type:'joined',id,mic:true,camera:true},id);
        } else if(id && m.type==='signal' && typeof m.to==='string' && m.data && ['description','candidate'].some(k=>k in m.data)) {
          const target=peers.get(m.to); if(target)send(target.ws,{type:'signal',from:id,data:m.data});
        } else if(id && m.type==='media' && typeof m.mic==='boolean' && typeof m.camera==='boolean') {
          peers.get(id)!.media={mic:m.mic,camera:m.camera}; broadcast({type:'media',id,mic:m.mic,camera:m.camera},id);
        }
      } catch { ws.close(1008,'Invalid message'); }
    });
    ws.on('error',()=>{});
    ws.on('close',()=>{clearInterval(rate);clearTimeout(joinTimeout);if(id){peers.delete(id);broadcast({type:'left',id})}});
  });
  const heartbeat=setInterval(()=>peers.forEach(p=>{if(!p.alive){p.ws.terminate();return;}p.alive=false;p.ws.ping()}),15000);
  wss.on('close',()=>clearInterval(heartbeat));
  return wss;
}
