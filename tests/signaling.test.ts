import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachSignaling } from '../signaling';
test('shared room announces joins, relays only to target, and removes disconnected peers',async()=>{
 const server=createServer();const wss=attachSignaling(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address() as {port:number};const clients:WebSocket[]=[];
 const connect=async()=>{const ws=new WebSocket(`ws://127.0.0.1:${address.port}/signal`);clients.push(ws);await new Promise(r=>ws.once('open',r));return ws};
 const message=(ws:WebSocket)=>new Promise<any>((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('message timeout')),2000);ws.once('message',raw=>{clearTimeout(t);resolve(JSON.parse(raw.toString()))})});
 try{
  const a=await connect();let p=message(a);a.send(JSON.stringify({type:'join'}));const welcome=await p;assert.equal(welcome.peers.length,0);
  const b=await connect();p=message(b);let notice=message(a);b.send(JSON.stringify({type:'join'}));const wb=await p;assert.equal(wb.peers[0].id,welcome.id);assert.equal((await notice).id,wb.id);
  p=message(a);b.send(JSON.stringify({type:'signal',to:welcome.id,data:{description:{type:'offer',sdp:'test'}}}));const relay=await p;assert.equal(relay.from,wb.id);assert.equal(relay.data.description.sdp,'test');
  p=message(a);b.send(JSON.stringify({type:'media',mic:false,camera:false}));assert.equal((await p).mic,false);
  p=message(a);b.close();assert.equal((await p).type,'left');
  for(let n=0;n<5;n++){const c=await connect();p=message(c);c.send(JSON.stringify({type:'join'}));assert.equal((await p).type,'welcome')}
  const full=await connect();p=message(full);full.send(JSON.stringify({type:'join'}));assert.equal((await p).type,'full');
 }finally{clients.forEach(c=>c.terminate());await new Promise<void>(r=>wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));}
});
