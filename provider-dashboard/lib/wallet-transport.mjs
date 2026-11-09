import https from 'node:https';
import http from 'node:http';
import {createSecureContext} from 'node:tls';
import {Fault} from './security.mjs';

export class WalletError extends Fault {
 constructor(code,message=code){super(503,code,message);}
}

const LIMITS=Object.freeze({maxSockets:128,maxTotalSockets:256,maxPending:1024,maxPools:128,maxCachedSessions:256,localHttpSockets:32,idleTimeoutMs:1000,deadlineMs:6000,bodyBytes:65536});
const BOUNDS=[0.25,0.5,1,2,4,8,16,32,64,128,256,512,1000,2000,4000,6000,Infinity];
const PHASES=['dns','pool_wait','tcp','tls','request_sent','headers','body','total'];
let secureContext;

class Histogram {
 constructor(){this.buckets=Array(BOUNDS.length).fill(0);this.count=0;this.sum=0;this.min=Infinity;this.max=0;}
 observe(value){value=Math.max(0,value);this.count++;this.sum+=value;this.min=Math.min(this.min,value);this.max=Math.max(this.max,value);this.buckets[BOUNDS.findIndex(b=>value<=b)]++;}
 status(){const quantile=p=>{let seen=0;for(let i=0;i<this.buckets.length;i++){seen+=this.buckets[i];if(seen>=Math.ceil(this.count*p))return Math.min(BOUNDS[i],this.max);}return 0;};return {count:this.count,min_ms:this.count?this.min:0,max_ms:this.max,mean_ms:this.count?this.sum/this.count:0,p50_ms:this.count?quantile(.5):0,p95_ms:this.count?quantile(.95):0,p99_ms:this.count?quantile(.99):0};}
}

// Every request has one validated origin/address identity. Keeping the original
// URL hostname preserves Host, SNI, certificate verification and credential scope.
// A later DNS result cannot borrow an older address's established connection.
const poolName=options=>{
 if(typeof options.walletPoolKey!=='string')throw Error('Validated wallet pool identity required');
 return options.walletPoolKey;
};
class PinnedHttpsAgent extends https.Agent {getName(options){return poolName(options);}}
class PinnedHttpAgent extends http.Agent {getName(options){return poolName(options);}}
const lengthOf=groups=>Object.values(groups).reduce((n,items)=>n+items.length,0);

/** Process-local transport. No DNS cache, automatic retry or redirect handling.
 * Limits may only be lowered by a caller (useful for deterministic local tests).
 * TLS trust is the process default; callers cannot replace certificate checks. */
export function createWalletTransport(options={}){
 const limits={...LIMITS};
 for(const key of ['maxSockets','maxTotalSockets','maxPending','maxPools','localHttpSockets','idleTimeoutMs']){
  if(options[key]!==undefined){if(!Number.isInteger(options[key])||options[key]<1||options[key]>limits[key])throw Error('Invalid wallet transport bound');limits[key]=options[key];}
 }
 limits.maxSockets=Math.min(limits.maxSockets,limits.maxTotalSockets);
 const pools=new Map(),calls=new Set(),histograms=Object.fromEntries(PHASES.map(name=>[name,new Histogram()]));
 const metrics={requests:0,completed:0,failures:0,timed_out:0,rejected:0,connections:0,reused:0,max_pending:0,max_pool_entries:0};
 let tlsAgent=null,httpAgent=null,closed=false;
 const observe=(name,start)=>histograms[name].observe(performance.now()-start);
 const agents=()=>[tlsAgent,httpAgent].filter(Boolean);
 function agentFor(protocol){
  if(protocol==='https:'){
   if(!tlsAgent){
    secureContext??=createSecureContext();
    tlsAgent=new PinnedHttpsAgent({keepAlive:true,maxSockets:limits.maxSockets,maxTotalSockets:limits.maxTotalSockets,maxFreeSockets:limits.maxSockets,maxCachedSessions:limits.maxCachedSessions,timeout:limits.idleTimeoutMs,secureContext});
    // Node's per-name queue can otherwise wait for unrelated idle sockets to
    // expire at the global cap. Free only idle sockets, never active callbacks.
    tlsAgent.on('free',()=>{if(lengthOf(tlsAgent.requests))for(const sockets of Object.values(tlsAgent.freeSockets))for(const socket of sockets)socket.destroy();});
   }
   return tlsAgent;
  }
  // Cleartext exists only behind walletCall's explicit loopback test guard.
  httpAgent??=new PinnedHttpAgent({keepAlive:false,maxSockets:limits.localHttpSockets,maxTotalSockets:limits.localHttpSockets});
  return httpAgent;
 }
 function forget(key,entry){
  for(const socket of entry.agent.freeSockets[key]||[])socket.destroy();
  pools.delete(key);
 }
 function acquire(url,address){
  const key=JSON.stringify([url.origin,address.address,address.family]);
  let entry=pools.get(key);
  if(!entry){
   if(pools.size>=limits.maxPools){
    let oldest;
    for(const candidate of pools)if(!candidate[1].users&&(!oldest||candidate[1].lastUsed<oldest[1].lastUsed))oldest=candidate;
    if(!oldest){metrics.rejected++;throw new WalletError('WALLET_BACKPRESSURE');}
    forget(...oldest);
   }
   entry={agent:agentFor(url.protocol),users:0,lastUsed:performance.now()};pools.set(key,entry);metrics.max_pool_entries=Math.max(metrics.max_pool_entries,pools.size);
  }
  entry.users++;
  // Reclaim old origins' idle capacity immediately when the global cap is full.
  if(!entry.agent.freeSockets[key]?.length&&lengthOf(entry.agent.sockets)+lengthOf(entry.agent.freeSockets)>=entry.agent.maxTotalSockets){
   for(const [other,sockets]of Object.entries(entry.agent.freeSockets))if(other!==key)for(const socket of sockets)socket.destroy();
  }
  return {key,entry,release(){entry.users--;entry.lastUsed=performance.now();}};
 }
 async function run(work,{timeout=limits.deadlineMs}={}){
  const started=performance.now();metrics.requests++;
  if(!Number.isFinite(timeout)||timeout<=0){metrics.failures++;throw new WalletError('WALLET_INVALID_TIMEOUT');}
  if(closed||calls.size>=limits.maxPending){metrics.rejected++;metrics.failures++;throw new WalletError(closed?'WALLET_TRANSPORT_CLOSED':'WALLET_BACKPRESSURE');}
  // A test can shorten the deadline but cannot extend the production six seconds.
  const deadline=started+Math.min(timeout,limits.deadlineMs);
  let terminal=false,request=null,requestClosed=false,pendingDns=0,rejectDeadline;
  // Cancellation cannot stop getaddrinfo, and a destroyed Node request may
  // remain in the agent queue until a socket is assigned. Retain its admission
  // slot until those resources actually finish, so timeout churn is bounded.
  const releaseAdmission=()=>{if(terminal&&!pendingDns&&(!request||requestClosed))calls.delete(scope);};
  const cancelled=new Promise((_,reject)=>{rejectDeadline=reject;});
  const expire=()=>{if(terminal)return;terminal=true;metrics.timed_out++;request?.destroy();rejectDeadline(new WalletError('WALLET_OUTCOME_UNKNOWN'));};
  const scope={
   ensure(){if(terminal||performance.now()>=deadline){expire();throw new WalletError('WALLET_OUTCOME_UNKNOWN');}},
   observe,
   async resolve(lookup,host){
    scope.ensure();const start=performance.now();
    pendingDns++;
    const resolved=Promise.resolve().then(()=>lookup(host,{all:true,verbatim:true})).finally(()=>{pendingDns--;releaseAdmission();});
    try{return await Promise.race([resolved,cancelled]);}
    catch(error){scope.ensure();throw new WalletError('WALLET_DNS_FAILED');}
    finally{observe('dns',start);}
   },
   async request(url,address,body,headers){
    scope.ensure();
    if(Buffer.byteLength(body)>limits.bodyBytes)throw new WalletError('WALLET_REQUEST_TOO_LARGE');
    const lease=acquire(url,address);
    try{return await new Promise((resolve,reject)=>{
     let done=false,socketAt=0,connectedAt=0,readyAt=0,sentAt=0,headersAt=0;
     const start=performance.now(),finish=(error,value)=>{if(done)return;done=true;if(error)reject(error);else resolve(value);};
     request=(url.protocol==='https:'?https:http).request(url,{
      method:'POST',agent:lease.entry.agent,walletPoolKey:lease.key,
      lookup:(_host,opts,callback)=>opts?.all?callback(null,[address]):callback(null,address.address,address.family)
     },res=>{
      headersAt=performance.now();if(sentAt)observe('headers',sentAt);
      const chunks=[];let length=0;
      res.on('data',chunk=>{
       length+=chunk.length;
       if(length>limits.bodyBytes){finish(new WalletError('WALLET_OUTCOME_UNKNOWN'));request.destroy();res.destroy();return;}
       chunks.push(chunk);
      });
      res.on('end',()=>{observe('body',headersAt);if(!res.complete){finish(new WalletError('WALLET_RESPONSE_INTERRUPTED'));return;}finish(null,{status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')});});
      res.on('error',()=>finish(new WalletError('WALLET_RESPONSE_INTERRUPTED')));
      res.on('aborted',()=>finish(new WalletError('WALLET_RESPONSE_INTERRUPTED')));
     });
     request.on('socket',socket=>{
      if(done||terminal){request.destroy();return;}
      socketAt=performance.now();observe('pool_wait',start);
      if(socket.connecting){
       metrics.connections++;
       socket.once('connect',()=>{connectedAt=performance.now();observe('tcp',socketAt);if(url.protocol!=='https:')readyAt=connectedAt;});
       if(url.protocol==='https:')socket.once('secureConnect',()=>{readyAt=performance.now();if(connectedAt)observe('tls',connectedAt);});
      }else{metrics.reused++;readyAt=socketAt;}
      try{
       scope.ensure();
       // Generate a fresh signature only when this attempt obtains its socket.
       for(const [name,value]of Object.entries(headers()))request.setHeader(name,value);
       request.end(body);
      }catch(error){finish(error);request.destroy();}
     });
     request.on('finish',()=>{sentAt=performance.now();if(readyAt)observe('request_sent',readyAt);});
     request.on('error',()=>finish(new WalletError('WALLET_OUTCOME_UNKNOWN')));
     request.on('close',()=>{requestClosed=true;releaseAdmission();if(!done)finish(new WalletError('WALLET_RESPONSE_INTERRUPTED'));});
    });}finally{lease.release();}
   },
   cancel(){if(terminal)return;terminal=true;request?.destroy();rejectDeadline(new WalletError('WALLET_TRANSPORT_CLOSED'));},
   retiring(){return terminal;}
  };
  calls.add(scope);metrics.max_pending=Math.max(metrics.max_pending,calls.size);
  const timer=setTimeout(expire,Math.max(1,deadline-performance.now()));
  try{const result=await Promise.race([Promise.resolve().then(()=>work(scope)),cancelled]);scope.ensure();metrics.completed++;return result;}
  catch(error){metrics.failures++;throw error;}
  finally{terminal=true;clearTimeout(timer);releaseAdmission();observe('total',started);}
 }
 return {
  run,
  status(){return {policy:'fresh DNS and address-bound verified TLS; no retry; fixed deadline',...metrics,pending:calls.size,retiring_calls:[...calls].filter(call=>call.retiring()).length,pool_entries:pools.size,active_sockets:agents().reduce((n,a)=>n+lengthOf(a.sockets),0),idle_sockets:agents().reduce((n,a)=>n+lengthOf(a.freeSockets),0),queued_requests:agents().reduce((n,a)=>n+lengthOf(a.requests),0),limits:{...limits},timing_quantiles:'fixed-bucket upper bounds',timings_ms:Object.fromEntries(PHASES.map(name=>[name,histograms[name].status()]))};},
  close(){closed=true;for(const call of calls)call.cancel();for(const agent of agents())agent.destroy();pools.clear();}
 };
}

export const walletTransport=createWalletTransport();
export const walletTransportStatus=()=>walletTransport.status();
