import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Core} from '../lib/core.mjs';
import {random,sha,signer} from '../lib/security.mjs';
import {WalletError} from '../lib/wallet.mjs';
import {AdmissionWallet} from './fixtures/admission-wallet.mjs';

const key={game:'uno-luck'},code=expected=>error=>error.code===expected;
function fixture(t,{initial='1000'}={}){
 const dir=mkdtempSync(join(tmpdir(),'core-fresh-admission-'));
 const walletPath=join(dir,'wallet.sqlite'),wallet=new AdmissionWallet(walletPath,initial);
 const engineSecret=random(40);
 const env={NODE_ENV:'test',PANEL_SESSION_SECRET:random(40),CORE_DB_PATH:join(dir,'core.sqlite'),CORE_ENGINE_KEYS_JSON:JSON.stringify([{id:'admission-engine',game:key.game,secret:engineSecret}]),UNO_PROVIDER_ORIGIN:'http://127.0.0.1:18111'};
 let transport=async(op,_secret,action,payload)=>wallet.execute(op,action,payload);
 let core=new Core({env,transport:(...args)=>transport(...args)});
 const created=core.createOperator({name:'Admission review fixture',games:[key.game],wallet_mode:'seamless',wallet_url:'https://wallet.example/callback',currency:'VCOIN',scale:2});
 const operatorId=created.operator.id;
 const launch=core.createLaunch(core.operator(operatorId),{game_id:key.game,player_ref:'admission-player'},'admission-launch');
 const token=new URLSearchParams(new URL(launch.launch_url).hash.slice(1)).get('softtech_launch');
 const session=core.redeem(key,{token,request_id:'admission-redeem'});
 const params={tenant_id:operatorId,session_id:session.session_id,round_ref:'admission-round',stake:'100',max_payout:'1000'};
 t.after(()=>{core?.close();wallet.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,env,wallet,walletPath,engineSecret,operatorId,session,params,get core(){return core;},
  setTransport(fn){transport=fn;},
  close(){core?.close();core=null;},
  restart(){core?.close();core=new Core({env,transport:(...args)=>transport(...args)});return core;},
  reserve(){return core.reserve(key,params);},
  row(action='debit'){return core.get('SELECT * FROM wallet_ops WHERE action=?',action);},
  round(){return core.get('SELECT * FROM rounds WHERE round_ref=?',params.round_ref);}
 };
}
async function intent(f){
 const external=f.core.external;
 f.core.external=async()=>{throw Error('STOP_AT_ROUND_INTENT');};
 try{await assert.rejects(f.reserve(),/STOP_AT_ROUND_INTENT/);}finally{f.core.external=external;}
 return f.round();
}
function seed(f,r,{status='pending',attempts=1,response=null,changedAmount=false}={}){
 const player=f.core.get('SELECT * FROM players WHERE id=?',r.player_id);
 const payload={transaction_id:r.id+':debit',player_ref:player.player_ref,session_id:r.session_id,round_id:r.id,game_id:r.game_id,amount_minor:changedAmount?'101':r.stake_minor};
 const encoded=JSON.stringify(payload),now=Date.now();
 f.core.transaction(()=>f.core.run('INSERT INTO wallet_ops(id,operator_id,round_id,action,payload_json,payload_hash,status,response_json,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',payload.transaction_id,r.operator_id,r.id,'debit',encoded,sha(encoded),status,response?JSON.stringify(response):null,attempts,now,now));
 return payload;
}
function applied(f,r){return {status:'applied',transaction_id:r.id+':debit',amount_minor:r.stake_minor,currency:'VCOIN',scale:2,balance_minor:'900'};}
async function crashChild(f,action,params,point){
 f.close();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/admission-crash-child.mjs',import.meta.url))],{env:{...process.env,...f.env,ADMISSION_CRASH_INPUT:JSON.stringify({action,params,walletPath:f.walletPath,point})},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Crash fixture timeout'));},10000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
 });
 assert.equal(result.signal,'SIGKILL',output);assert.equal(result.code,null,output);f.restart();
}
async function invoke(f,action,params){
 if(action==='debit')return f.core.reserve(key,params);
 if(action==='credit')return f.core.settle(key,params);
 return f.core.voidRound(key,params);
}

test('fresh debit, credit and reversal expose committed intent and first marker before callback with one fewer admission',async t=>{
 const f=fixture(t),observer=new DatabaseSync(f.env.CORE_DB_PATH);t.after(()=>observer.close());
 f.setTransport(async(op,_secret,action,payload)=>{
  assert.notEqual(action,'status','fresh operation must not query status');
  const row=observer.prepare('SELECT * FROM wallet_ops WHERE id=?').get(payload.transaction_id);
  assert.equal(row?.attempts,1);assert.equal(row.status,'pending');
  assert.equal(row.payload_json,JSON.stringify(payload));assert.equal(row.payload_hash,sha(row.payload_json));
  assert.equal(observer.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
  assert.equal(f.core.get('PRAGMA synchronous').synchronous,2);
  return f.wallet.execute(op,action,payload);
 });
 let before=f.core.journal.status().operations;
 const r=await f.reserve();assert.equal(f.core.journal.status().operations-before,4);
 before=f.core.journal.status().operations;
 await f.core.settle(key,{tenant_id:f.operatorId,round_id:r.id,payout:'50',evidence:'admission-proof'});
 assert.equal(f.core.journal.status().operations-before,4);
 const other=await f.core.reserve(key,{...f.params,round_ref:'reversal-round'});
 before=f.core.journal.status().operations;
 await f.core.voidRound(key,{tenant_id:f.operatorId,round_id:other.id});
 assert.equal(f.core.journal.status().operations-before,4);
 assert.equal(f.core.reconciliation(f.operatorId).status,'matched');
});

for(const action of ['debit','credit','reversal'])for(const point of ['admission_committed','wallet_applied']){
 test(`${action}: process crash at ${point} recovers status first without duplicate movement`,async t=>{
  const f=fixture(t);let params=f.params;
  if(action!=='debit'){
   const r=await f.reserve();params={tenant_id:f.operatorId,round_id:r.id,...(action==='credit'?{payout:'50',evidence:'crash-proof'}:{})};
  }
  const beforeCalls=f.wallet.calls().length;
  await crashChild(f,action,params,point);
  const row=f.row(action),immutable={payload_json:row.payload_json,payload_hash:row.payload_hash};
  assert.equal(row.status,'pending');assert.equal(row.attempts,1);
  assert.equal(f.core.get('SELECT count(*) n FROM ledger WHERE kind=?',action).n,0);
  const targetCalls=()=>f.wallet.calls().slice(beforeCalls).map(call=>call.action);
  assert.deepEqual(targetCalls(),point==='admission_committed'?[]:[action]);
  await f.core.recover();
  assert.equal(f.row(action).status,'ok');
  assert.equal(f.row(action).attempts,point==='admission_committed'?2:1);
  assert.equal(f.row(action).payload_json,immutable.payload_json);assert.equal(f.row(action).payload_hash,immutable.payload_hash);
  assert.deepEqual(targetCalls(),point==='admission_committed'?['status',action]:[action,'status']);
  assert.equal(f.core.get('SELECT count(*) n FROM ledger WHERE kind=?',action).n,1);
  assert.equal(f.round().status,{debit:'reserved',credit:'settled',reversal:'voided'}[action]);
  const callCount=f.wallet.calls().length;
  await invoke(f,action,params);await f.core.recover();
  assert.equal(f.wallet.calls().length,callCount);
  if(action==='debit')await f.core.settle(key,{tenant_id:f.operatorId,round_id:f.round().id,payout:'0',evidence:'finish-crash-fixture'});
  assert.equal(f.core.reconciliation(f.operatorId).status,'matched');
 });
}

test('failed combined COMMIT rolls back intent and attempt and sends no callback, then recovery succeeds',async t=>{
 const f=fixture(t),db=f.core.db,observer=new DatabaseSync(f.env.CORE_DB_PATH);t.after(()=>observer.close());
 f.core.journal.db={exec(sql){
  if(sql==='COMMIT'&&f.core.get("SELECT id FROM wallet_ops WHERE attempts=1 AND status='pending'"))throw Error('INJECTED_COMMIT_FAILURE');
  return db.exec(sql);
 }};
 await assert.rejects(f.reserve(),/INJECTED_COMMIT_FAILURE/);
 assert.equal(f.core.journal.status().failed_commits,1);
 assert.equal(observer.prepare('SELECT count(*) n FROM wallet_ops').get().n,0);
 assert.equal(observer.prepare('SELECT count(*) n FROM ledger').get().n,0);
 assert.equal(f.round().status,'intent');assert.deepEqual(f.wallet.calls(),[]);
 f.core.journal.db=db;f.restart();await f.core.recover();
 assert.equal(f.round().status,'reserved');assert.equal(f.row().attempts,1);
 assert.deepEqual(f.wallet.calls().map(call=>call.action),['debit']);
});

test('failed first-marker statement rolls back the whole operation savepoint and never calls the wallet',async t=>{
 const f=fixture(t),run=f.core.run;
 f.core.run=function(sql,...args){if(sql.startsWith('UPDATE wallet_ops SET attempts='))throw Error('INJECTED_MARKER_FAILURE');return run.call(this,sql,...args);};
 await assert.rejects(f.reserve(),/INJECTED_MARKER_FAILURE/);
 assert.equal(f.row(),undefined);assert.equal(f.round().status,'intent');assert.deepEqual(f.wallet.calls(),[]);
 f.core.run=run;f.restart();await f.core.recover();assert.equal(f.row().attempts,1);assert.equal(f.round().status,'reserved');
});

test('credential failure commits the unattempted immutable intent and never dispatches or marks an attempt',async t=>{
 const f=fixture(t),secret=f.core.operator(f.operatorId).wallet_secret;
 f.core.run('UPDATE operators SET wallet_secret=? WHERE id=?','invalid-box',f.operatorId);
 await assert.rejects(f.reserve());
 const before={...f.row()};assert.equal(before.status,'pending');assert.equal(before.attempts,0);assert.deepEqual(f.wallet.calls(),[]);
 f.restart();await assert.rejects(f.reserve());assert.equal(f.row().attempts,0);assert.deepEqual(f.wallet.calls(),[]);
 f.core.run('UPDATE operators SET wallet_secret=? WHERE id=?',secret,f.operatorId);
 await f.core.recover();assert.equal(f.row().attempts,1);assert.equal(f.row().payload_hash,before.payload_hash);
 assert.deepEqual(f.wallet.calls().map(call=>call.action),['debit']);assert.equal(f.round().status,'reserved');
});

test('failed retry-marker commit after not_found cannot dispatch a second debit',async t=>{
 const f=fixture(t),r=await intent(f);seed(f,r,{status:'unknown',attempts:1});
 const db=f.core.db;let failed=false;
 f.core.journal.db={exec(sql){
  if(sql==='COMMIT'&&!failed&&f.row()?.attempts===2){failed=true;throw Error('INJECTED_RETRY_COMMIT_FAILURE');}
  return db.exec(sql);
 }};
 await assert.rejects(f.reserve(),/INJECTED_RETRY_COMMIT_FAILURE/);
 assert.equal(f.row().attempts,1);assert.equal(f.row().status,'unknown');
 assert.deepEqual(f.wallet.calls().map(call=>call.action),['status']);
 f.core.journal.db=db;f.restart();await f.core.recover();
 assert.equal(f.row().attempts,2);assert.deepEqual(f.wallet.calls().map(call=>call.action),['status','status','debit']);
});

test('failed receipt commit after wallet apply recovers by status without repeating money movement',async t=>{
 const f=fixture(t),db=f.core.db;let failed=false;
 f.core.journal.db={exec(sql){
  if(sql==='COMMIT'&&!failed&&f.row()?.status==='ok'){failed=true;throw Error('INJECTED_RECEIPT_COMMIT_FAILURE');}
  return db.exec(sql);
 }};
 await assert.rejects(f.reserve(),/INJECTED_RECEIPT_COMMIT_FAILURE/);
 assert.equal(f.row().status,'unknown');assert.equal(f.row().attempts,1);assert.equal(f.wallet.balance(),'900');
 assert.equal(f.core.get('SELECT count(*) n FROM ledger').n,0);
 f.core.journal.db=db;f.restart();await f.core.recover();
 assert.deepEqual(f.wallet.calls().map(call=>call.action),['debit','status']);assert.equal(f.wallet.balance(),'900');
 assert.equal(f.core.get('SELECT count(*) n FROM ledger').n,1);
});

for(const state of ['pending','unknown'])for(const outcome of ['applied','rejected','pending','not_found']){
 test(`existing ${state} attempted row: wallet ${outcome} preserves recovery policy`,async t=>{
  const f=fixture(t),r=await intent(f);seed(f,r,{status:state,attempts:3});
  const immutable=f.row().payload_json,calls=[];
  f.setTransport(async(op,_secret,action,payload)=>{
   calls.push(action);
   if(action==='status')return outcome==='applied'?applied(f,r):{status:outcome};
   assert.equal(f.row().attempts,4);assert.equal(f.row().payload_json,immutable);
   return f.wallet.execute(op,action,payload);
  });
  if(outcome==='rejected')await assert.rejects(f.reserve(),code('WALLET_REJECTED'));
  else if(outcome==='pending')await assert.rejects(f.reserve(),code('WALLET_OUTCOME_UNKNOWN'));
  else await f.reserve();
  assert.deepEqual(calls,outcome==='not_found'?['status','debit']:['status']);
  assert.equal(f.row().attempts,outcome==='not_found'?4:3);assert.equal(f.row().payload_json,immutable);
  assert.equal(f.row().status,{applied:'ok',rejected:'rejected',pending:'unknown',not_found:'ok'}[outcome]);
  assert.equal(f.core.get('SELECT count(*) n FROM ledger').n,['applied','not_found'].includes(outcome)?1:0);
 });
}

for(const state of ['pending','unknown'])test(`existing ${state} row with zero attempts records its first attempt before callback`,async t=>{
 const f=fixture(t),r=await intent(f);seed(f,r,{status:state,attempts:0});
 f.setTransport(async(op,_secret,action,payload)=>{
  assert.equal(action,'debit');assert.equal(f.row().attempts,1);return f.wallet.execute(op,action,payload);
 });
 await f.reserve();assert.equal(f.row().status,'ok');assert.equal(f.row().attempts,1);
});

for(const state of ['ok','rejected'])test(`existing ${state} result replays without credentials or callbacks`,async t=>{
 const f=fixture(t),r=await intent(f);seed(f,r,{status:state,attempts:2,response:state==='ok'?applied(f,r):{status:'rejected'}});
 f.core.run('UPDATE operators SET wallet_secret=? WHERE id=?','invalid-box',f.operatorId);
 if(state==='ok'){await f.reserve();await f.reserve();assert.equal(f.core.get('SELECT count(*) n FROM ledger').n,1);}
 else{await assert.rejects(f.reserve(),code('WALLET_REJECTED'));await assert.rejects(f.reserve(),code('ROUND_NOT_RESERVABLE'));}
 assert.deepEqual(f.wallet.calls(),[]);assert.equal(f.row().attempts,2);
});

for(const state of ['pending','unknown','ok','rejected'])test(`immutable payload conflict wins before ${state} replay or any callback`,async t=>{
 const f=fixture(t),r=await intent(f);seed(f,r,{status:state,attempts:2,response:applied(f,r),changedAmount:true});const before={...f.row()};
 await assert.rejects(f.reserve(),code('IDEMPOTENCY_CONFLICT'));assert.deepEqual({...f.row()},before);
 assert.deepEqual(f.wallet.calls(),[]);assert.equal(f.core.get('SELECT count(*) n FROM ledger').n,0);
});

for(const [name,corrupt]of [
 ['transaction ID',receipt=>({...receipt,transaction_id:'wrong'})],
 ['amount',receipt=>({...receipt,amount_minor:'101'})],
 ['currency',receipt=>({...receipt,currency:'WRONG'})],
 ['scale',receipt=>({...receipt,scale:3})],
 ['balance',receipt=>({...receipt,balance_minor:'1.5'})],
 ['outcome',receipt=>({...receipt,status:'pending'})]
])test(`invalid ${name} receipt cannot finalize and recovery uses status without another debit`,async t=>{
 const f=fixture(t);
 f.setTransport(async(op,_secret,action,payload)=>{
  const receipt=f.wallet.execute(op,action,payload);return action==='debit'?corrupt(receipt):receipt;
 });
 await assert.rejects(f.reserve());const immutable=f.row().payload_json;
 assert.equal(f.row().status,'unknown');assert.equal(f.row().attempts,1);assert.equal(f.core.get('SELECT count(*) n FROM ledger').n,0);
 f.restart();await f.core.recover();assert.equal(f.row().status,'ok');assert.equal(f.row().payload_json,immutable);
 assert.deepEqual(f.wallet.calls().map(call=>call.action),['debit','status']);assert.equal(f.wallet.balance(),'900');
 assert.equal(f.core.get('SELECT count(*) n FROM ledger').n,1);
});

test('response loss after apply recovers by status and duplicate reserve cannot move money twice',async t=>{
 const f=fixture(t);f.setTransport(async(op,_secret,action,payload)=>{
  const receipt=f.wallet.execute(op,action,payload);if(action==='debit')throw new WalletError('WALLET_OUTCOME_UNKNOWN');return receipt;
 });
 await assert.rejects(f.reserve(),code('WALLET_OUTCOME_UNKNOWN'));assert.equal(f.row().status,'unknown');f.restart();await f.core.recover();
 await Promise.all(Array.from({length:8},()=>f.reserve()));
 assert.deepEqual(f.wallet.calls().map(call=>call.action),['debit','status']);assert.equal(f.wallet.balance(),'900');
 assert.equal(f.core.get('SELECT count(*) n FROM ledger').n,1);
});

test('same-player concurrent duplicate and distinct reserves remain serialized and cannot overspend',async t=>{
 const f=fixture(t,{initial:'100'});let active=0,maxActive=0;
 f.setTransport(async(op,_secret,action,payload)=>{
  active++;maxActive=Math.max(maxActive,active);
  try{await new Promise(resolve=>setImmediate(resolve));return f.wallet.execute(op,action,payload);}finally{active--;}
 });
 const results=await Promise.allSettled([...Array.from({length:8},()=>f.reserve()),f.core.reserve(key,{...f.params,round_ref:'other-round'})]);
 assert(results.slice(0,8).every(result=>result.status==='fulfilled'));assert.equal(new Set(results.slice(0,8).map(result=>result.value.id)).size,1);
 assert.equal(results[8].reason.code,'WALLET_REJECTED');assert.equal(maxActive,1);assert.equal(f.wallet.balance(),'0');
 assert.equal(f.core.get("SELECT count(*) n FROM ledger WHERE kind='debit'").n,1);
 assert.equal(f.wallet.calls().filter(call=>call.action==='debit').length,2);
});

test('fresh authenticated reserve uses five admissions and persisted nonce replay cannot trigger another callback',async t=>{
 const f=fixture(t),path='/api/v4/agency-game/reserve',body=JSON.stringify(f.params),sig=signer(f.engineSecret,'agency.v1','POST',path,body);
 const request={method:'POST',path,body,headers:{'x-agency-key':'admission-engine','x-agency-timestamp':sig.timestamp,'x-agency-nonce':sig.nonce,'x-agency-signature':sig.signature}};
 const before=f.core.journal.status().operations,principal=await f.core.authenticateDurable(request,true);
 await f.core.engineAction(principal,'reserve',f.params);assert.equal(f.core.journal.status().operations-before,5);
 f.restart();await assert.rejects(f.core.authenticateDurable(request,true),code('REPLAY_DETECTED'));
 await f.reserve();assert.deepEqual(f.wallet.calls().map(call=>call.action),['debit']);assert.equal(f.wallet.balance(),'900');
});

test('accepted seamless settlement survives session revocation, disabled operator and maintenance with one credit',async t=>{
 const f=fixture(t),r=await f.reserve();
 f.core.revoke(f.operatorId,f.session.session_id);f.core.updateOperator(f.operatorId,{status:'disabled'});f.core.setGame(key.game,{maintenance:true});
 const params={tenant_id:f.operatorId,round_id:r.id,payout:'50',evidence:'accepted-outcome'};
 await f.core.settle(key,params);await f.core.settle(key,params);
 await assert.rejects(f.core.reserve(key,{...f.params,round_ref:'new-round'}),code('OPERATOR_DISABLED'));
 await assert.rejects(f.core.settle(key,{...params,payout:'51'}),code('SETTLEMENT_CONFLICT'));
 assert.equal(f.round().status,'settled');assert.deepEqual(f.wallet.calls().map(call=>call.action),['debit','credit']);assert.equal(f.wallet.balance(),'950');
 assert.equal(f.core.reconciliation(f.operatorId).status,'matched');
});
