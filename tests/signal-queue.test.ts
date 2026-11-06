import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSignalQueue} from '../lib/signal-queue';
test('ICE waits for an in-flight remote description before being applied',async()=>{
 let finish!:()=>void;const description=new Promise<void>(r=>finish=r);const events:string[]=[];let ready=false;
 const queue=createSignalQueue<string>(async message=>{if(message==='offer'){events.push('offer-start');await description;ready=true;events.push('offer-ready')}else{assert(ready,'ICE applied before remote description');events.push('candidate')}},e=>{throw e});
 const offer=queue.push('offer');await Promise.resolve();const candidate=queue.push('candidate');await Promise.resolve();assert.deepEqual(events,['offer-start']);finish();await Promise.all([offer,candidate]);assert.deepEqual(events,['offer-start','offer-ready','candidate']);
});
test('bad signaling does not block the queue, and closing drops pending events',async()=>{
 const handled:string[]=[],errors:unknown[]=[];const queue=createSignalQueue<string>(async m=>{if(m==='bad')throw new Error('bad signal');handled.push(m)},e=>errors.push(e));
 await queue.push('bad');await queue.push('good');assert.equal(errors.length,1);assert.deepEqual(handled,['good']);const pending=queue.push('late');queue.close();await pending;assert.deepEqual(handled,['good']);
});
