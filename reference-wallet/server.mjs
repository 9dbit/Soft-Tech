import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ReferenceWallet,WalletFault} from './wallet.mjs';
import {platformHealth} from './native-volume.mjs';
const bodyLimit=65536;
async function body(req){let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>bodyLimit)throw new WalletFault(413,'BODY_TOO_LARGE');parts.push(chunk);}return Buffer.concat(parts).toString('utf8');}
function json(raw){try{const p=JSON.parse(raw);if(!p||typeof p!=='object'||Array.isArray(p))throw Error();return p;}catch{throw new WalletFault(400,'INVALID_JSON');}}
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
export function createWalletServer({env=process.env,clock=Date.now}={}){
 const wallet=new ReferenceWallet({env,clock});const rate=new Map();const processBootId=randomUUID();
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://wallet'),pathname=u.pathname;
   if(req.method==='GET'&&pathname==='/health'){const volume=platformHealth(env);send(res,200,{ok:true,service:'softtech-reference-wallet',classification:'internal-test-reference',production_enabled:false,identity:wallet.identity,platform_deployment_id:volume.platform_deployment_id,persistent_volume:volume.native_volume,source_commit:env.RAILWAY_GIT_COMMIT_SHA||env.SOURCE_COMMIT||null,process_boot_id:processBootId,uptime_seconds:Math.floor(process.uptime()),memory_rss_bytes:process.memoryUsage().rss,cpu_usage_microseconds:process.cpuUsage(),durable_journal:wallet.journal.status(),sqlite_writes:wallet.writeMetrics});return;}
   if(u.search)throw new WalletFault(400,'QUERY_NOT_ALLOWED');
   const ip=req.socket.remoteAddress||'unknown',now=clock(),bucket=rate.get(ip)||{t:now,n:0};if(now-bucket.t>60000){bucket.t=now;bucket.n=0;}bucket.n++;rate.set(ip,bucket);if(rate.size>10000)for(const [k,v]of rate)if(now-v.t>60000)rate.delete(k);if(bucket.n>120000)throw new WalletFault(429,'RATE_LIMITED');
   if(pathname.startsWith('/admin/')){
    wallet.admin(String(req.headers.authorization||'').replace(/^Bearer /,''));
    if(req.method==='GET'&&/^\/admin\/operators\/[^/]+\/report$/.test(pathname)){send(res,200,wallet.report(decodeURIComponent(pathname.split('/')[3])));return;}
    if(req.method!=='POST')throw new WalletFault(405,'METHOD_NOT_ALLOWED');const p=json(await body(req));
    if(pathname==='/admin/operators'){send(res,201,await wallet.durable(()=>wallet.register(p)));return;}
    if(pathname==='/admin/accounts'){send(res,200,await wallet.durable(()=>wallet.seed(p)));return;}
    if(pathname==='/admin/faults'){send(res,201,await wallet.durable(()=>wallet.setFault(p)));return;}
    if(pathname==='/admin/faults/clear'){send(res,200,await wallet.durable(()=>wallet.clearFaults(p.operator_id)));return;}
    if(pathname==='/admin/report'){send(res,200,wallet.report(p.operator_id,{limit:p.limit,offset:p.offset,includeReconciliation:p.include_reconciliation!==false}));return;}
    throw new WalletFault(404,'NOT_FOUND');
   }
   const action=pathname.match(/^\/wallet\/(balance|debit|credit|reversal|status)$/)?.[1];if(!action||req.method!=='POST')throw new WalletFault(404,'NOT_FOUND');
   const raw=await body(req);let p,parseError;
   try{p=json(raw);}catch(error){parseError=error;}
   // Authentication has its own durable boundary. Even invalid JSON/business
   // payloads consume a valid nonce, and cannot roll it back in the next phase.
   const {op,fault}=await wallet.durable(()=>{const op=wallet.authenticate(req.method,pathname,raw,req.headers);return {op,fault:parseError?null:wallet.takeFault(op.id,action)};});
   if(parseError)throw parseError;
   if(fault?.kind==='before_disconnect'){req.socket.destroy();return;}
   if(fault?.kind==='network_partition'){send(res,503,{error:'TEST_NETWORK_PARTITION'});return;}
   if(fault?.kind==='before_timeout'){await new Promise(r=>setTimeout(r,fault.delay_ms));if(req.destroyed)return;}
   if(fault?.kind==='pending_once'){send(res,200,{transaction_id:p.transaction_id,status:'pending',currency:op.currency,scale:op.scale});return;}
   // These business actions only SELECT. The awaited authentication above has
   // already committed the nonce and fault selection; synchronous reads now see
   // committed state without a second writer admission. Mutations stay durable.
   const perform=()=>wallet.perform(op,action,p,{reject:fault?.kind==='reject'});
   const receipt=action==='balance'||action==='status'?perform():await wallet.durable(perform);
   if(fault?.kind==='after_disconnect'){req.socket.destroy();return;}
   if(fault?.kind==='after_timeout')await new Promise(r=>setTimeout(r,fault.delay_ms));
   if(!res.destroyed)send(res,200,receipt);
  }catch(e){if(!res.destroyed)send(res,e instanceof WalletFault?e.status:500,{error:e instanceof WalletFault?e.code:'INTERNAL_ERROR'});}
 });
 server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=5000;
 server.on('close',()=>wallet.close());return {server,wallet};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const {server}=createWalletServer();server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('reference-wallet.ready',JSON.stringify({environment:process.env.WALLET_ENVIRONMENT,production_enabled:false})));for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>server.close(()=>process.exit(0)));}
