import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {walletCall} from '../../lib/wallet.mjs';
import {createWalletTransport} from '../../lib/wallet-transport.mjs';
import {Core} from '../../lib/core.mjs';
import {random,sha} from '../../lib/security.mjs';

const [mode,encoded]=process.argv.slice(2),origins=JSON.parse(encoded);
const secretA='fixture-a-secret-'.repeat(4),secretB='fixture-b-secret-'.repeat(4);
const op={id:'fixture-a',wallet_url:origins[0]+'/wallet',currency:'VCOIN',scale:2};
const address=ip=>({address:ip,family:4}),loopback=async()=>[address('127.0.0.1')];
const code=expected=>error=>error.code===expected;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const transports=[];
const pool=options=>{const transport=createWalletTransport(options);transports.push(transport);return transport;};
const transport=pool();
const call=(action='balance',payload={},options={})=>walletCall(op,secretA,action,payload,{allowLocal:true,lookup:loopback,transport,...options});
let proof={mode};
try{
 if(mode==='trust'){
  assert.equal((await call()).balance_minor,'1000');
  await assert.rejects(walletCall({...op,wallet_url:origins[0].replace('localhost','127.0.0.1')+'/wallet'},secretA,'balance',{}, {allowLocal:true,lookup:loopback,transport}),code('WALLET_OUTCOME_UNKNOWN'));
  proof=transport.status();assert.equal(proof.completed,1);assert.equal(proof.failures,1);
 }else if(mode==='untrusted'){
  await assert.rejects(call(),code('WALLET_OUTCOME_UNKNOWN'));assert.equal(transport.status().completed,0);
 }else if(mode==='dns'){
  let lookups=0;
  const fresh=async(host,options)=>{assert.equal(host,'localhost');assert.deepEqual(options,{all:true,verbatim:true});lookups++;return [address(lookups<3?'127.0.0.1':'127.0.0.2')];};
  assert.equal((await call('balance',{}, {lookup:fresh})).fixture_server,0);
  assert.equal((await call('balance',{}, {lookup:fresh})).fixture_server,0);
  assert.equal((await call('balance',{}, {lookup:fresh})).fixture_server,1);
  assert.equal((await call('balance',{}, {lookup:fresh})).fixture_server,1);
  assert.equal(lookups,4);assert.equal(transport.status().connections,2);assert.equal(transport.status().reused,2);
  // An already pooled socket never suppresses this call's public-address check.
  await assert.rejects(call('balance',{}, {allowLocal:false}),code('PRIVATE_CALLBACK'));
  for(const resolved of [[],[{address:'not-an-ip',family:4}],[{address:'1.1.1.1',family:6}],[address('1.1.1.1'),address('10.0.0.1')],[{address:'::ffff:127.0.0.1',family:6}]]){
   await assert.rejects(walletCall({...op,wallet_url:'https://callback.example/wallet'},secretA,'balance',{}, {lookup:async()=>resolved,transport}),code('PRIVATE_CALLBACK'));
  }
  for(const host of ['callback.local','callback.internal'])await assert.rejects(walletCall({...op,wallet_url:'https://'+host},secretA,'balance',{}, {lookup:()=>{throw Error('must not resolve');},transport}),code('PRIVATE_CALLBACK'));
  await assert.rejects(call('balance',{}, {lookup:async()=>{throw Error('synthetic resolver failure');}}),code('WALLET_DNS_FAILED'));
  proof=transport.status();
 }else if(mode==='credentials'){
  for(let i=0;i<3;i++)for(const [operator,secret]of [[op,secretA],[{...op,id:'fixture-b'},secretB],[{...op,id:'fixture-b',wallet_url:origins[2]+'/other-wallet'},secretB]]){
   const result=await walletCall(operator,secret,'balance',{}, {allowLocal:true,lookup:loopback,transport});assert.equal(result.fixture_operator,operator.id);
  }
  const v2={...op,wallet_protocol_version:2,environment:'preproduction',deployment_id:'fixture-core-preproduction'};
  assert.equal((await walletCall(v2,secretA,'balance',{}, {allowLocal:true,lookup:loopback,transport})).balance_minor,'1000');
  await assert.rejects(walletCall({...v2,deployment_id:'wrong-audience'},secretA,'balance',{}, {allowLocal:true,lookup:loopback,transport}),code('WALLET_HTTP_401'));
  await assert.rejects(walletCall({...v2,environment:'production'},secretA,'balance',{}, {allowLocal:true,lookup:loopback,transport}),code('WALLET_IDENTITY_REQUIRED'));
  await assert.rejects(walletCall({...op,environment:'preproduction'},secretA,'balance',{}, {allowLocal:true,lookup:loopback,transport}),code('LEGACY_WALLET_FORBIDDEN'));
  proof=transport.status();
 }else if(mode==='receipts'){
  for(const [fixture,expected]of [['wrong-currency','WALLET_CURRENCY_MISMATCH'],['wrong-scale','WALLET_CURRENCY_MISMATCH'],['wrong-transaction','WALLET_INVALID_RECEIPT'],['wrong-amount','WALLET_AMOUNT_MISMATCH'],['invalid-balance','WALLET_INVALID_BALANCE'],['invalid-json','WALLET_INVALID_JSON'],['oversize','WALLET_OUTCOME_UNKNOWN'],['interrupt','WALLET_RESPONSE_INTERRUPTED'],['redirect','WALLET_HTTP_307']]){
   await assert.rejects(call('debit',{transaction_id:'receipt-'+fixture,amount_minor:'100',fixture}),code(expected));
  }
  for(const [fixture,expected]of [['pending','pending'],['not-found','not_found'],['rejected','rejected']])assert.equal((await call('status',{transaction_id:'status-'+fixture,fixture})).status,expected);
  await assert.rejects(call('balance',{padding:'x'.repeat(65536)}),code('WALLET_REQUEST_TOO_LARGE'));
  proof=transport.status();
 }else if(mode==='deadline'){
  let lookupFinished=false;
  const start=performance.now();
  await assert.rejects(call('balance',{}, {timeout:40,lookup:async()=>{await delay(150);lookupFinished=true;return [address('127.0.0.1')];}}),code('WALLET_OUTCOME_UNKNOWN'));
  assert.ok(performance.now()-start<500);await delay(170);assert.equal(lookupFinished,true);assert.equal(transport.status().connections,0);
  const blackholeSockets=new Set(),blackhole=createServer(socket=>{blackholeSockets.add(socket);socket.on('close',()=>blackholeSockets.delete(socket));});
  await new Promise(resolve=>blackhole.listen(0,'127.0.0.1',resolve));
  try{await assert.rejects(walletCall({...op,wallet_url:'https://localhost:'+blackhole.address().port+'/wallet'},secretA,'balance',{}, {allowLocal:true,lookup:loopback,transport,timeout:50}),code('WALLET_OUTCOME_UNKNOWN'));}
  finally{for(const socket of blackholeSockets)socket.destroy();await new Promise(resolve=>blackhole.close(resolve));}
  for(const fixture of ['slow-headers','slow-body','drip'])await assert.rejects(call('balance',{fixture},{timeout:80}),code('WALLET_OUTCOME_UNKNOWN'));
  const serial=pool({maxSockets:1,maxTotalSockets:1});
  const first=call('balance',{fixture:'slow-headers'},{transport:serial,timeout:1000});await delay(30);
  const queued=assert.rejects(call('balance',{}, {transport:serial,timeout:40}),code('WALLET_OUTCOME_UNKNOWN'));await queued;await first;
  await delay(30);assert.equal(serial.status().timings_ms.pool_wait.count,1,'Expired queued request must never acquire a socket or send');
  assert.equal(serial.status().completed,1);assert.equal(serial.status().timed_out,1);
  proof={main:transport.status(),serial:serial.status()};
 }else if(mode==='bounds'){
  const bounded=pool({maxSockets:1,maxTotalSockets:2,maxPending:2,maxPools:2});let lookups=0;const release=[];
  const held=()=>{lookups++;return new Promise(resolve=>release.push(()=>resolve([address('127.0.0.1')])));};
  const a=call('balance',{}, {lookup:held,transport:bounded}),b=call('balance',{}, {lookup:held,transport:bounded});
  await assert.rejects(call('balance',{}, {lookup:held,transport:bounded}),code('WALLET_BACKPRESSURE'));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(lookups,2);release.forEach(resolve=>resolve());await Promise.all([a,b]);
  assert.equal(bounded.status().max_pending,2);assert.equal(bounded.status().rejected,1);
  // Late DNS still occupies its slot after the caller's deadline. Otherwise
  // repeated timeouts could build an unbounded native DNS work queue.
  const stalled=pool({maxPending:1});let finishDns;
  await assert.rejects(call('balance',{}, {transport:stalled,timeout:30,lookup:()=>new Promise(resolve=>finishDns=resolve)}),code('WALLET_OUTCOME_UNKNOWN'));
  assert.equal(stalled.status().retiring_calls,1);
  await assert.rejects(call('balance',{}, {transport:stalled}),code('WALLET_BACKPRESSURE'));
  finishDns([address('127.0.0.1')]);await new Promise(resolve=>setImmediate(resolve));assert.equal(stalled.status().pending,0);assert.equal(stalled.status().connections,0);
  const one=pool({maxPools:1,maxTotalSockets:1,maxSockets:1});
  const active=call('balance',{fixture:'slow-headers'},{transport:one});await delay(30);
  await assert.rejects(walletCall({...op,wallet_url:origins[2]+'/wallet'},secretA,'balance',{}, {allowLocal:true,lookup:loopback,transport:one}),code('WALLET_BACKPRESSURE'));await active;
  const start=performance.now();assert.equal((await walletCall({...op,wallet_url:origins[2]+'/wallet'},secretA,'balance',{}, {allowLocal:true,lookup:loopback,transport:one})).fixture_server,2);
  assert.ok(performance.now()-start<700,'New origin must reclaim an old idle pool before its one-second timeout');
  assert.equal(one.status().pool_entries,1);assert.equal(one.status().max_pool_entries,1);
  assert.equal(one.status().limits.maxCachedSessions,256);assert.equal(one.status().limits.deadlineMs,6000);
  proof={bounded:bounded.status(),single:one.status()};
 }else if(mode==='core-recovery'){
  const dir=mkdtempSync(join(tmpdir(),'wallet-tls-core-')),game='uno-luck';let core;
  const env={NODE_ENV:'test',PANEL_SESSION_SECRET:random(40),CORE_DB_PATH:join(dir,'core.sqlite'),CORE_ENGINE_KEYS_JSON:JSON.stringify([{id:'fixture-engine',game,secret:random(40)}]),UNO_PROVIDER_ORIGIN:'http://127.0.0.1:18111',CORE_PUBLIC_ORIGIN:'http://127.0.0.1:18080'};
  const options={env,transport:(operator,secret,action,payload,opts)=>walletCall(operator,secret,action,payload,{...opts,lookup:loopback,transport})};
  try{
   core=new Core(options);const created=core.createOperator({name:'Synthetic TLS Wallet',games:[game],currency:'VCOIN',scale:2,wallet_mode:'seamless',wallet_url:op.wallet_url,return_origins:['https://operator.example']},'test',{id:'fixture-core'});
   core.run('UPDATE operators SET wallet_secret=? WHERE id=?',core.vault.seal(secretA),created.operator.id);
   const launch=core.createLaunch(core.operator(created.operator.id),{game_id:game,player_ref:'commit-close',return_url:'https://operator.example'},'fixture-launch');
   const token=new URLSearchParams(new URL(launch.launch_url).hash.slice(1)).get('softtech_launch');
   const session=core.redeem({game},{token,request_id:'fixture-redeem-'+sha(token)});
   const reserve={tenant_id:created.operator.id,session_id:session.session_id,round_ref:'tls-commit-disconnect',stake:'100',max_payout:'1000'};
   await assert.rejects(core.reserve({game},reserve),code('WALLET_OUTCOME_UNKNOWN'));
   assert.equal(core.get('SELECT count(*) n FROM ledger').n,0);assert.equal(core.get('SELECT status FROM wallet_ops').status,'unknown');
   core.close();core=new Core(options);await core.recover();const round=await core.reserve({game},reserve);
   assert.equal(core.get('SELECT count(*) n FROM ledger').n,1);assert.equal(core.get('SELECT attempts FROM wallet_ops').attempts,1);
   await core.settle({game},{tenant_id:created.operator.id,round_id:round.id,payout:'50',evidence:'synthetic-server-outcome'});
   assert.equal(core.reconciliation(created.operator.id).status,'matched');assert.deepEqual(core.all('SELECT kind FROM ledger ORDER BY created_at').map(row=>row.kind),['debit','credit']);
   proof={wallet_operations:core.all('SELECT action,status,attempts FROM wallet_ops ORDER BY action'),transport:transport.status()};
  }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
 }else if(mode==='profile'){
  let lookups=0;const lookup=async(host,options)=>{lookups++;return (await dns.lookup(host,options)).filter(item=>item.family===4);};
  const histogram=monitorEventLoopDelay({resolution:5});histogram.enable();await delay(10);const phases=[];
  for(const phase of ['cold','warm']){
   const latencies=[],start=performance.now(),cpu=process.cpuUsage();
   await Promise.all(Array.from({length:500},async(_,i)=>{const sent=performance.now();await call('balance',{player_ref:'synthetic-'+i,fixture:'profile'},{lookup});latencies.push(performance.now()-sent);}));
   latencies.sort((a,b)=>a-b);const used=process.cpuUsage(cpu);phases.push({phase,requests:500,elapsed_ms:performance.now()-start,user_cpu_ms:used.user/1000,system_cpu_ms:used.system/1000,p50_ms:latencies[249],p95_ms:latencies[474],p99_ms:latencies[494],max_ms:latencies[499]});
  }
  histogram.disable();assert.equal(lookups,1000);proof={classification:'synthetic_local_tls_500_callback_fixture',lookup_calls:lookups,phases,event_loop_max_ms:histogram.max/1e6,transport:transport.status()};
  assert.equal(proof.transport.requests,1000);assert.equal(proof.transport.completed,1000);assert.equal(proof.transport.failures,0);assert.ok(proof.transport.connections<=128);assert.ok(proof.transport.reused>=872);assert.equal(proof.transport.max_pending,500);assert.equal(proof.transport.timings_ms.dns.count,1000);assert.equal(proof.transport.timings_ms.total.count,1000);
 }else throw Error('Unknown synthetic test mode');
 // Public diagnostics must contain only fixed labels and numeric aggregates.
 const status=JSON.stringify(proof);for(const marker of ['localhost','127.0.0.1','fixture-a-secret','fixture-b-secret','fixture-core-preproduction','x-softtech','fixture_operator','https://','/wallet'])assert.ok(!status.includes(marker),marker);
 console.log(JSON.stringify(proof));
}finally{for(const item of transports)item.close();}
