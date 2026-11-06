// WebSocket events arrive in order, but async handlers otherwise overlap.
// In particular, an ICE candidate must wait for setRemoteDescription to finish.
export function createSignalQueue<T>(handle:(message:T)=>Promise<void>,onError:(error:unknown)=>void){
 let tail=Promise.resolve();let closed=false;
 return {push(message:T){tail=tail.then(async()=>{if(!closed)await handle(message)}).catch(error=>{if(!closed)onError(error)});return tail},close(){closed=true}};
}
