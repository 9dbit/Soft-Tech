// Fixed-size, content-free transport observations. No URL, header, payload,
// error message, cookie, signature or socket address is retained in a report.
import {AsyncLocalStorage} from 'node:async_hooks';
import {channel} from 'node:diagnostics_channel';
import {createHistogram,monitorEventLoopDelay,performance} from 'node:perf_hooks';

const context=new AsyncLocalStorage();
const names=['setup','running','reconciliation','cleanup'];
let active;
const round=x=>Math.round(x*1000)/1000;
class Timing {
 constructor(){this.h=createHistogram({lowest:1,highest:3600000000,figures:3});this.sum=0;this.max=0;this.count=0;}
 record(ms){if(!Number.isFinite(ms)||ms<0)return;this.count++;this.sum+=ms;this.max=Math.max(this.max,ms);this.h.record(Math.min(3600000000,Math.max(1,Math.round(ms*1000))));}
 summary(){return {count:this.count,mean_ms:this.count?round(this.sum/this.count):null,p50_ms:this.count?round(this.h.percentile(50)/1000):null,p95_ms:this.count?round(this.h.percentile(95)/1000):null,p99_ms:this.count?round(this.h.percentile(99)/1000):null,max_ms:this.count?round(this.max):null};}
}
class Phase {
 constructor(loop){this.started=performance.now();this.cpu=process.cpuUsage();this.elu=performance.eventLoopUtilization();this.loop=loop||monitorEventLoopDelay({resolution:10});if(loop)this.loop.reset();else this.loop.enable();this.timerLag=new Timing();this.counts={requests:0,completed:0,transport_errors:0,active_requests:0,peak_active_requests:0,undici_created:0,request_sent:0,response_headers:0,sockets_started:0,dns_lookups:0,dns_errors:0,tcp_connected:0,tls_connected:0,socket_errors:0,reused_socket_requests:0,fresh_socket_requests:0,unobserved_sockets:0};this.timings=Object.fromEntries(['request_to_created','request_to_sent','sent_to_headers','headers_to_body','total','dns_lookup','socket_to_tcp','tcp_to_tls','fetch_resolution_after_headers'].map(k=>[k,new Timing()]));}
 runtime(){const cpu=process.cpuUsage(this.cpu),elu=performance.eventLoopUtilization(this.elu),elapsed=performance.now()-this.started;return {elapsed_ms:round(elapsed),cpu_user_ms:round(cpu.user/1000),cpu_system_ms:round(cpu.system/1000),cpu_cores_average:elapsed?round((cpu.user+cpu.system)/(elapsed*1000)):0,event_loop_utilization:round(elu.utilization),event_loop_active_ms:round(elu.active),event_loop_idle_ms:round(elu.idle),event_loop_delay:{resolution_ms:10,sample_count:this.loop.count,p50_ms:this.loop.count?round(this.loop.percentile(50)/1e6):null,p95_ms:this.loop.count?round(this.loop.percentile(95)/1e6):null,max_ms:this.loop.count?round(this.loop.max/1e6):null},memory_rss_bytes:process.memoryUsage().rss};}
 stop(){if(!this.ended)this.ended=this.runtime();}
 snapshot(){return {counts:{...this.counts},timings:Object.fromEntries(Object.entries(this.timings).map(([k,v])=>[k+'_ms',v.summary()])),runtime:{...(this.ended||this.runtime()),scheduled_timer_lag_ms:{resolution_ms:10,...this.timerLag.summary()}}};}
}

export class RunnerDiagnostics {
 constructor(){if(active)throw Error('RUNNER_DIAGNOSTICS_ALREADY_ACTIVE');this.phases={setup:new Phase()};this.phaseName='setup';this.requests=new WeakMap();this.usedSockets=new WeakSet();this.sockets=new Map();this.subscriptions=[];this.closed=false;active=this;this.timerLast=performance.now();this.timer=setInterval(()=>{const now=performance.now();this.phases[this.phaseName].timerLag.record(Math.max(0,now-this.timerLast-10));this.timerLast=now;},10);this.timer.unref();
  const subscribe=(name,fn)=>{const cb=value=>{try{fn(value);}catch{this.observer_errors=(this.observer_errors||0)+1;}};channel(name).subscribe(cb);this.subscriptions.push([name,cb]);};
  subscribe('undici:request:create',({request})=>{const c=context.getStore();if(c?.owner!==this)return;this.requests.set(request,c);c.phase.counts.undici_created++;c.phase.timings.request_to_created.record(performance.now()-c.start);});
  subscribe('undici:client:sendHeaders',({request,socket})=>{const c=this.requests.get(request);if(c)this.sent(c,socket);});
  subscribe('undici:request:headers',({request})=>{const c=this.requests.get(request);if(c)this.headers(c);});
  // The public socket event is independent of Undici's pooled connector events;
  // connection timing is per socket, never falsely paired by hostname/FIFO.
  subscribe('net.client.socket',({socket})=>{if(context.getStore()?.owner===this)this.socket(socket);});
 }
 setPhase(name){if(!names.includes(name))throw Error('INVALID_DIAGNOSTICS_PHASE');if(this.closed)throw Error('DIAGNOSTICS_CLOSED');if(name===this.phaseName)return;if(this.phases[name])throw Error('DIAGNOSTICS_PHASE_REPEATED');const previous=this.phases[this.phaseName];previous.stop();this.phaseName=name;this.phases[name]=new Phase(previous.loop);}
 socket(socket){if(this.sockets.has(socket))return;const p=this.phases[this.phaseName];if(this.sockets.size>=4096){p.counts.unobserved_sockets++;return;}p.counts.sockets_started++;const started=performance.now();let tcp;
  const lookup=error=>{p.counts.dns_lookups++;if(error)p.counts.dns_errors++;p.timings.dns_lookup.record(performance.now()-started);};
  const connected=()=>{tcp=performance.now();p.counts.tcp_connected++;p.timings.socket_to_tcp.record(tcp-started);};
  const secure=()=>{p.counts.tls_connected++;if(tcp!==undefined)p.timings.tcp_to_tls.record(performance.now()-tcp);};
  const error=()=>{p.counts.socket_errors++;};
  const close=()=>{socket.removeListener('lookup',lookup);socket.removeListener('connect',connected);socket.removeListener('secureConnect',secure);socket.removeListener('error',error);socket.removeListener('close',close);this.sockets.delete(socket);};
  this.sockets.set(socket,close);socket.once('lookup',lookup);socket.once('connect',connected);socket.once('secureConnect',secure);socket.once('error',error);socket.once('close',close);
 }
 sent(c,socket){if(c.sent!==undefined)return;c.sent=performance.now();c.phase.counts.request_sent++;c.phase.timings.request_to_sent.record(c.sent-c.start);if(socket){if(this.usedSockets.has(socket))c.phase.counts.reused_socket_requests++;else{this.usedSockets.add(socket);c.phase.counts.fresh_socket_requests++;}}}
 headers(c){if(c.headers!==undefined)return;c.headers=performance.now();c.phase.counts.response_headers++;if(c.sent!==undefined)c.phase.timings.sent_to_headers.record(c.headers-c.sent);}
 snapshot(){return {schema_version:1,classification:'content_free_runner_transport_observation',node_version:process.version,undici_version:process.versions.undici||null,scope:'Only requests made through qualification/client.mjs; timings include all client work and are never subtracted from latency gates',histogram_precision_significant_digits:3,observer_errors:this.observer_errors||0,phases:Object.fromEntries(Object.entries(this.phases).map(([k,v])=>[k,v.snapshot()]))};}
 stop(){if(!this.closed){this.closed=true;clearInterval(this.timer);this.phases[this.phaseName].stop();this.phases[this.phaseName].loop.disable();for(const [name,fn]of this.subscriptions)channel(name).unsubscribe(fn);for(const close of [...this.sockets.values()])close();if(active===this)active=undefined;}return this.snapshot();}
}

export async function observeRequest(fn){const owner=active;if(!owner)return fn(null);const p=owner.phases[owner.phaseName],c={owner,phase:p,start:performance.now()};p.counts.requests++;p.counts.active_requests++;p.counts.peak_active_requests=Math.max(p.counts.peak_active_requests,p.counts.active_requests);
 const trace={sent:socket=>owner.sent(c,socket),headers:()=>owner.headers(c),resolved:()=>{if(c.headers!==undefined)p.timings.fetch_resolution_after_headers.record(performance.now()-c.headers);}};
 try{return await context.run(c,()=>fn(trace));}catch(e){p.counts.transport_errors++;throw e;}finally{p.counts.active_requests--;p.counts.completed++;const end=performance.now();if(c.headers!==undefined)p.timings.headers_to_body.record(end-c.headers);p.timings.total.record(end-c.start);}
}
