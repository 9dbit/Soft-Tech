// Synthetic wallet fixture: ephemeral TLS keys, loopback listeners and fixed
// test credentials only. Its process is separate from the measured client.
import https from 'node:https';
import {readFileSync} from 'node:fs';
import {signer,signerV2} from '../../lib/security.mjs';

const tls={key:readFileSync(process.argv[2]),cert:readFileSync(process.argv[3])};
const modes=new Set(['profile','slow-headers','slow-body','drip','oversize','interrupt','invalid-json','wrong-currency','wrong-scale','wrong-transaction','wrong-amount','invalid-balance','redirect','commit-close','pending','not-found','rejected']);
const sockets=new Set(),receipts=new Map(),nonces=new Set();
const counts={requests:0,connections:0,active:0,max_active:0,invalid_signatures:0,repeated_nonces:0,debits:0,credits:0,status:0,applications:0,by_server:[0,0,0],by_mode:{}};
const secretFor=id=>(id==='fixture-b'?'fixture-b-secret-':'fixture-a-secret-').repeat(4);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function create(index){
 const server=https.createServer(tls,async(req,res)=>{
  counts.requests++;counts.by_server[index]++;counts.active++;counts.max_active=Math.max(counts.max_active,counts.active);
  res.once('close',()=>counts.active--);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString('utf8'),payload=JSON.parse(body);
  const action=req.url.split('/').at(-1),secret=secretFor(payload.operator_id),version=req.headers['x-wallet-version'];
  const signature=version==='2'
   ?signerV2(secret,'softtech.wallet.v2','preproduction','fixture-core-preproduction','POST',req.url,body,req.headers['x-softtech-timestamp'],req.headers['x-softtech-nonce']).signature
   :signer(secret,'softtech.wallet.v1','POST',req.url,body,req.headers['x-softtech-timestamp'],req.headers['x-softtech-nonce']).signature;
  if(signature!==req.headers['x-softtech-signature']||req.headers['x-softtech-key']!=='wallet-'+payload.operator_id||version==='2'&&(req.headers['x-wallet-environment']!=='preproduction'||req.headers['x-wallet-audience']!=='fixture-core-preproduction')){
   counts.invalid_signatures++;res.writeHead(401);res.end('{}');return;
  }
  const nonce=req.headers['x-softtech-nonce'];if(nonces.has(nonce))counts.repeated_nonces++;nonces.add(nonce);
  const hint=payload.fixture||payload.player_ref,mode=modes.has(hint)?hint:'normal';counts.by_mode[mode]=(counts.by_mode[mode]||0)+1;
  const identity={currency:payload.currency,scale:payload.scale,fixture_server:index,fixture_operator:payload.operator_id};
  let result={...identity,balance_minor:'1000'};
  if(action==='status'){
   counts.status++;result=receipts.get(payload.operator_id+':'+payload.transaction_id)||{...identity,transaction_id:payload.transaction_id,status:'not_found'};
  }else if(action!=='balance'){
   if(action==='debit')counts.debits++;if(action==='credit')counts.credits++;
   const id=payload.operator_id+':'+payload.transaction_id,prior=receipts.get(id);
   result=prior||{...identity,transaction_id:payload.transaction_id,status:'applied',amount_minor:payload.amount_minor,balance_minor:action==='debit'?'900':'950'};
   if(!prior){receipts.set(id,result);counts.applications++;if(mode==='commit-close'&&action==='debit'){req.socket.destroy();return;}}
  }
  if(mode==='slow-headers')await delay(200);
  if(mode==='profile')await delay(25);
  if(mode==='invalid-json'){res.end('{');return;}
  if(mode==='wrong-currency')result={...result,currency:'OTHER'};
  if(mode==='wrong-scale')result={...result,scale:7};
  if(mode==='wrong-transaction')result={...result,transaction_id:'different'};
  if(mode==='wrong-amount')result={...result,amount_minor:'1'};
  if(mode==='invalid-balance')result={...result,balance_minor:'1.5'};
  if(['pending','not-found','rejected'].includes(mode))result={...identity,transaction_id:payload.transaction_id,status:mode==='not-found'?'not_found':mode};
  if(mode==='redirect'){res.writeHead(307,{location:origins[2]+'/wallet/balance'});res.end('{}');return;}
  if(mode==='oversize')result={...result,padding:'x'.repeat(65536)};
  res.setHeader('content-type','application/json');
  if(mode==='interrupt'){res.writeHead(200,{'content-length':200});res.write('{"balance_minor":');setTimeout(()=>req.socket.destroy(),10);return;}
  if(mode==='slow-body'){res.write(' ');await delay(200);res.end(JSON.stringify(result));return;}
  if(mode==='drip'){res.write(' ');const timer=setInterval(()=>res.write(' '),10);res.once('close',()=>clearInterval(timer));return;}
  res.end(JSON.stringify(result));
 });
 server.keepAliveTimeout=30000;
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 server.on('secureConnection',()=>counts.connections++);
 return server;
}
const servers=[create(0),create(1),create(2)];
await new Promise(resolve=>servers[0].listen(0,'127.0.0.1',2048,resolve));
const port=servers[0].address().port;
await new Promise(resolve=>servers[1].listen(port,'127.0.0.2',2048,resolve));
await new Promise(resolve=>servers[2].listen(0,'127.0.0.1',2048,resolve));
const origins=['https://localhost:'+port,'https://localhost:'+port,'https://localhost:'+servers[2].address().port];
process.send({origins});
process.on('message',message=>{
 if(message==='counts')process.send({...counts});
 if(message==='close'){for(const socket of sockets)socket.destroy();for(const server of servers)server.close();process.exit(0);}
});
