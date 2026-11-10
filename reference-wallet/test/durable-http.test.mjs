import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createWalletServer} from '../server.mjs';
import {DurableWrites} from '../durable-writes.mjs';
import {adminCall,walletCall,signedHeaders} from '../../qualification/client.mjs';

async function fixture(t,{seed='1000'}={}){
 const dir=mkdtempSync(join(tmpdir(),'wallet-grouped-http-')),env={WALLET_ENVIRONMENT:'preproduction',WALLET_DEPLOYMENT_ID:'grouped-fixture-wallet',WALLET_CORE_AUDIENCE:'grouped-fixture-core',WALLET_MASTER_KEY:randomBytes(32).toString('hex'),WALLET_ADMIN_TOKEN:randomBytes(32).toString('hex'),WALLET_DB_PATH:join(dir,'wallet.sqlite'),WALLET_TEST_CONTROL_ENABLED:'true'};
 let service=createWalletServer({env});
 const listen=async port=>{await new Promise(r=>service.server.listen(port,'127.0.0.1',r));return service.server.address().port;};
 let port=await listen(0),base='http://127.0.0.1:'+port;
 const config={environment:'preproduction',core_audience:env.WALLET_CORE_AUDIENCE,wallet_url:base,wallet_admin_token:env.WALLET_ADMIN_TOKEN,operator:{id:'op-grouped-fixture',wallet_secret:randomBytes(32).toString('hex'),protocol_version:2}};
 const stop=async()=>{service.server.closeAllConnections();await new Promise(r=>service.server.close(r));};
 const observer=new DatabaseSync(env.WALLET_DB_PATH,{readOnly:true});
 t.after(async()=>{observer.close();await stop();rmSync(dir,{recursive:true,force:true});});
 assert.equal((await adminCall(config,'/admin/operators',{operator_id:config.operator.id,secret:config.operator.wallet_secret,currency:'VCOIN',scale:2,protocol_version:2})).status,201);
 assert.equal((await adminCall(config,'/admin/accounts',{operator_id:config.operator.id,player_ref:'alice',amount_minor:seed})).status,200);
 const payload=id=>({player_ref:'alice',transaction_id:id,round_id:'round-'+id,session_id:'fixture-session',game_id:'uno-luck',amount_minor:'1'});
 const signed=(action,data,{raw}={})=>{const pathname='/wallet/'+action,body=raw??JSON.stringify({operator_id:config.operator.id,currency:'VCOIN',scale:2,...data});return {pathname,body,headers:signedHeaders(config,{kind:'wallet',pathname,body})};};
 const send=async request=>{const response=await fetch(base+request.pathname,{method:'POST',headers:request.headers,body:request.body,signal:AbortSignal.timeout(5000)});return {status:response.status,data:await response.json()};};
 // A fresh listener avoids reusing the test client's just-closed keepalive
 // sockets. The same on-disk database and wallet identity are reopened.
 return {env,config,observer,payload,signed,send,get base(){return base;},get service(){return service;},restart:async()=>{await stop();service=createWalletServer({env});port=await listen(0);base='http://127.0.0.1:'+port;config.wallet_url=base;}};
}

const businessState=db=>Object.fromEntries([
 ['accounts','operator_id,player_ref'],['transactions','operator_id,id'],['ledger','seq'],['audit','seq']
].map(([table,order])=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY '+order).all()]));

test('balance and status read committed data after one durable authentication without a business write',async t=>{
 const f=await fixture(t),debit=await walletCall(f.config,'debit',f.payload('read-receipt'));
 assert.equal(debit.data.status,'applied');
 const wallet=f.service.wallet,before=businessState(f.observer),observations=[],perform=wallet.perform;
 const healthBefore=await (await fetch(f.base+'/health')).json();let currentNonce;
 wallet.perform=function(op,action,p,options){
  const observation={action,inOperation:this.journal.inOperation,transactionDepth:this.transactionDepth,
   nonceCommitted:!!f.observer.prepare('SELECT 1 FROM nonces WHERE nonce=?').get(currentNonce)};
  const writes=this.writeMetrics.statements,result=perform.call(this,op,action,p,options);
  observations.push({...observation,businessWrites:this.writeMetrics.statements-writes});return result;
 };
 for(const [action,payload,expected] of [
  ['balance',{player_ref:'alice'},{currency:'VCOIN',scale:2,balance_minor:'999'}],
  ['status',{player_ref:'alice',transaction_id:'read-receipt'},debit.data],
  ['status',{player_ref:'alice',transaction_id:'missing-receipt'},{currency:'VCOIN',scale:2,transaction_id:'missing-receipt',status:'not_found'}]
 ]){
  const request=f.signed(action,payload),operations=wallet.journal.status().operations;currentNonce=request.headers['x-softtech-nonce'];
  const result=await f.send(request);assert.equal(result.status,200);assert.deepEqual(result.data,expected);
  assert.equal(wallet.journal.status().operations-operations,1,'read queued a second durable operation');
 }
 assert.deepEqual(observations.map(({action,...observation})=>observation),Array.from({length:3},()=>({inOperation:false,transactionDepth:0,nonceCommitted:true,businessWrites:0})));
 assert.deepEqual(businessState(f.observer),before);
 const healthAfter=await (await fetch(f.base+'/health')).json();
 assert.equal(healthAfter.durable_journal.operations-healthBefore.durable_journal.operations,3);
 assert.equal(healthAfter.sqlite_writes.statements-healthBefore.sqlite_writes.statements,3,'only the three required nonce inserts should write');
 assert.equal(healthAfter.durable_journal.pending,0);
});

test('failed authentication commits prevent balance and status reads and preserve their unconsumed faults',async t=>{
 const f=await fixture(t),wallet=f.service.wallet,perform=wallet.perform;let reads=0;
 wallet.perform=function(...args){reads++;return perform.apply(this,args);};
 for(const action of ['balance','status']){
  const armed=await adminCall(f.config,'/admin/faults',{operator_id:f.config.operator.id,action,kind:'after_disconnect',count:1});
  const request=f.signed(action,{player_ref:'alice',transaction_id:'auth-failure-'+action}),original=wallet.journal.db,beforeReads=reads;let injected=false;
  wallet.journal.db={exec(sql){if(sql==='COMMIT'&&!injected){injected=true;throw Error('INJECTED_READ_AUTH_COMMIT_FAILURE');}return original.exec(sql);}};
  try{assert.deepEqual(await f.send(request),{status:500,data:{error:'INTERNAL_ERROR'}});}finally{wallet.journal.db=original;}
  assert.equal(injected,true);assert.equal(reads,beforeReads,'business read ran before the authentication commit succeeded');
  assert.equal(f.observer.prepare('SELECT 1 FROM nonces WHERE nonce=?').get(request.headers['x-softtech-nonce']),undefined);
  assert.equal(f.observer.prepare('SELECT remaining FROM faults WHERE id=?').get(armed.data.id).remaining,1);
  // Retrying the same nonce can now authenticate; its one-shot fault closes the
  // socket only after the successful durable boundary and the read itself.
  await assert.rejects(f.send(request));assert.equal(reads,beforeReads+1);
  assert.ok(f.observer.prepare('SELECT 1 FROM nonces WHERE nonce=?').get(request.headers['x-softtech-nonce']));
  assert.equal(f.observer.prepare('SELECT remaining FROM faults WHERE id=?').get(armed.data.id).remaining,0);
  assert.equal((await f.send(request)).data.error,'REPLAY_DETECTED');
 }
 assert.equal(f.observer.prepare('SELECT count(*) n FROM transactions').get().n,0);
 assert.equal(f.observer.prepare("SELECT balance_minor FROM accounts WHERE player_ref='alice'").get().balance_minor,'1000');
});

test('debit, credit and reversal still use a durable business boundary before acknowledging receipts',async t=>{
 const f=await fixture(t),wallet=f.service.wallet,perform=wallet.perform,observations=[];
 wallet.perform=function(op,action,p,options){
  const result=perform.call(this,op,action,p,options);
  observations.push({action,inOperation:this.journal.inOperation,visibleBeforeCommit:!!f.observer.prepare('SELECT 1 FROM transactions WHERE id=?').get(p.transaction_id)});
  return result;
 };
 const steps=[
  ['debit',f.payload('credit-debit')],
  ['credit',{...f.payload('credit-receipt'),round_id:'round-credit-debit',amount_minor:'2'}],
  ['debit',f.payload('reversal-debit')],
  ['reversal',{...f.payload('reversal-receipt'),round_id:'round-reversal-debit',original_transaction_id:'reversal-debit'}]
 ];
 for(const [action,payload] of steps){
  const operations=wallet.journal.status().operations,result=await walletCall(f.config,action,payload);
  assert.equal(result.status,200);assert.equal(result.data.status,'applied');
  assert.equal(wallet.journal.status().operations-operations,2);
  assert.deepEqual(JSON.parse(f.observer.prepare('SELECT receipt_json FROM transactions WHERE id=?').get(payload.transaction_id).receipt_json),result.data);
 }
 assert.deepEqual(observations,steps.map(([action])=>({action,inOperation:true,visibleBeforeCommit:false})));
 assert.equal(f.observer.prepare("SELECT balance_minor FROM accounts WHERE player_ref='alice'").get().balance_minor,'1001');
 assert.equal(wallet.reconcile(f.config.operator.id).status,'matched');
});

test('overlapping reads may precede a queued mutation but never expose its uncommitted balance or receipt', {timeout:10000},async t=>{
 const f=await fixture(t),wallet=f.service.wallet,journal=wallet.journal,schedule=journal.schedule,perform=wallet.perform,waiters=[],requests=[],insideMutation=[];
 const waitForPending=count=>journal.pending.length>=count?Promise.resolve():new Promise(resolve=>waiters.push({count,resolve}));
 // Hold real queue batches at explicit boundaries, without sleeping or changing
 // their operations. HTTP authentication and all commits still use the queue.
 journal.schedule=function(){for(const waiter of [...waiters])if(this.pending.length>=waiter.count){waiters.splice(waiters.indexOf(waiter),1);waiter.resolve();}};
 const start=(action,payload)=>{const promise=f.send(f.signed(action,payload));promise.catch(()=>{});requests.push(promise);return promise;};
 wallet.perform=function(op,action,p,options){
  const result=perform.call(this,op,action,p,options);
  if(action==='debit')insideMutation.push({balance:f.observer.prepare("SELECT balance_minor FROM accounts WHERE player_ref='alice'").get().balance_minor,receipt:f.observer.prepare('SELECT 1 FROM transactions WHERE id=?').get(p.transaction_id)});
  return result;
 };
 try{
  const debit=start('debit',f.payload('queued-debit'));await waitForPending(1);
  const balance=start('balance',{player_ref:'alice'});await waitForPending(2);
  const status=start('status',{player_ref:'alice',transaction_id:'queued-debit'});await waitForPending(3);
  journal.flush(); // Commit all three nonces; the debit business phase is still queued.
  const [beforeBalance,beforeStatus]=await Promise.all([balance,status]);
  assert.equal(beforeBalance.data.balance_minor,'1000');assert.equal(beforeStatus.data.status,'not_found');
  assert.equal(journal.pending.length,1);assert.equal(f.observer.prepare('SELECT count(*) n FROM transactions').get().n,0);
  journal.flush();const applied=await debit;assert.equal(applied.data.status,'applied');
  assert.deepEqual(insideMutation,[{balance:'1000',receipt:undefined}],'independent reader observed an uncommitted mutation');
  const afterBalance=start('balance',{player_ref:'alice'});await waitForPending(1);
  const afterStatus=start('status',{player_ref:'alice',transaction_id:'queued-debit'});await waitForPending(2);
  journal.flush();const acknowledged=await Promise.all([afterBalance,afterStatus]);
  assert.equal(acknowledged[0].data.balance_minor,'999');assert.deepEqual(acknowledged[1].data,applied.data);
  assert.equal(journal.pending.length,0);assert.equal(wallet.reconcile(f.config.operator.id).status,'matched');
 }finally{journal.schedule=schedule;wallet.perform=perform;journal.flush();await Promise.allSettled(requests);}
});

test('direct reads retain operator, currency, scale and player validation while consuming authenticated nonces',async t=>{
 const f=await fixture(t),before=businessState(f.observer);
 for(const action of ['balance','status'])for(const [change,status,error] of [
  [{operator_id:'another-operator'},403,'OPERATOR_MISMATCH'],[{currency:'USD'},422,'CURRENCY_MISMATCH'],
  [{scale:3},422,'CURRENCY_MISMATCH'],[{player_ref:'missing-player'},404,'PLAYER_NOT_FOUND']
 ]){
  const request=f.signed(action,{player_ref:'alice',transaction_id:'validation-receipt',...change}),operations=f.service.wallet.journal.status().operations;
  assert.deepEqual(await f.send(request),{status,data:{error}});
  assert.equal(f.service.wallet.journal.status().operations-operations,1);
  assert.ok(f.observer.prepare('SELECT 1 FROM nonces WHERE nonce=?').get(request.headers['x-softtech-nonce']));
 }
 assert.deepEqual(businessState(f.observer),before);
});

test('balance and status preserve one-shot fault selection and before/after business behavior',async t=>{
 const f=await fixture(t),debit=await walletCall(f.config,'debit',f.payload('fault-read-receipt')),wallet=f.service.wallet,perform=wallet.perform;let reads=0;
 wallet.perform=function(...args){assert.equal(this.journal.inOperation,false);reads++;return perform.apply(this,args);};
 for(const action of ['balance','status'])for(const kind of ['before_disconnect','after_disconnect','network_partition','pending_once','reject']){
  const armed=await adminCall(f.config,'/admin/faults',{operator_id:f.config.operator.id,action,kind,count:1});
  const request=f.signed(action,{player_ref:'alice',transaction_id:'fault-read-receipt'}),before=businessState(f.observer),beforeReads=reads,operations=wallet.journal.status().operations;
  if(kind.endsWith('_disconnect'))await assert.rejects(f.send(request));
  else{
   const result=await f.send(request);
   if(kind==='network_partition')assert.deepEqual(result,{status:503,data:{error:'TEST_NETWORK_PARTITION'}});
   else if(kind==='pending_once')assert.deepEqual(result,{status:200,data:{transaction_id:'fault-read-receipt',status:'pending',currency:'VCOIN',scale:2}});
   else{assert.equal(result.status,200);assert.deepEqual(result.data,action==='status'?debit.data:{currency:'VCOIN',scale:2,balance_minor:'999'});}
  }
  assert.equal(reads-beforeReads,['after_disconnect','reject'].includes(kind)?1:0);
  assert.equal(wallet.journal.status().operations-operations,1);
  assert.equal(f.observer.prepare('SELECT remaining FROM faults WHERE id=?').get(armed.data.id).remaining,0);
  assert.ok(f.observer.prepare('SELECT 1 FROM nonces WHERE nonce=?').get(request.headers['x-softtech-nonce']));
  assert.deepEqual(businessState(f.observer),before);
  const recovered=await walletCall(f.config,action,{player_ref:'alice',transaction_id:'fault-read-receipt'});
  assert.equal(recovered.status,200);assert.deepEqual(recovered.data,action==='status'?debit.data:{currency:'VCOIN',scale:2,balance_minor:'999'});
 }
});

test('500 real HTTP charges on one account commit serial balances and exactly-once receipts before every acknowledgement',async t=>{
 const f=await fixture(t,{seed:'250'}),receipt=f.observer.prepare('SELECT receipt_json FROM transactions WHERE operator_id=? AND id=?'),ledger=f.observer.prepare("SELECT count(*) n FROM ledger WHERE operator_id=? AND transaction_id=? AND kind='debit'");
 const outcomes=await Promise.all(Array.from({length:500},(_,i)=>walletCall(f.config,'debit',f.payload('concurrent-'+i)).then(result=>{
  assert.equal(result.status,200);const id=result.data.transaction_id;
  assert.deepEqual(JSON.parse(receipt.get(f.config.operator.id,id).receipt_json),result.data,'HTTP receipt preceded visibility to another SQLite connection');
  assert.equal(ledger.get(f.config.operator.id,id).n,result.data.status==='applied'?1:0,'receipt and ledger were not committed together');
  return result;
 })));
 assert.equal(outcomes.filter(r=>r.data.status==='applied').length,250);assert.equal(outcomes.filter(r=>r.data.status==='rejected').length,250);
 assert.equal(f.observer.prepare("SELECT balance_minor FROM accounts WHERE player_ref='alice'").get().balance_minor,'0');
 assert.equal(f.service.wallet.reconcile(f.config.operator.id).status,'matched');
 const chosen=outcomes.find(r=>r.data.status==='applied').data,duplicates=await Promise.all(Array.from({length:64},()=>walletCall(f.config,'debit',f.payload(chosen.transaction_id))));
 assert.ok(duplicates.every(r=>r.status===200&&JSON.stringify(r.data)===JSON.stringify(chosen)));
 assert.equal(f.observer.prepare("SELECT count(*) n FROM ledger WHERE kind='debit'").get().n,250);
 const health=await (await fetch(f.base+'/health')).json();assert.equal(health.durable_journal.max_batch_limit,64);assert.equal(health.durable_journal.max_pending_limit,1024);assert.equal(health.durable_journal.delay_ms,2);
 assert.ok(health.durable_journal.max_batch>1);assert.ok(health.durable_journal.commits<health.durable_journal.operations/2);assert.equal(f.service.wallet.get('PRAGMA synchronous').synchronous,2);
 t.diagnostic(JSON.stringify({fixture_only:true,http_charges:500,duplicate_retries:64,journal_operations:health.durable_journal.operations,journal_commits:health.durable_journal.commits,max_batch:health.durable_journal.max_batch,max_pending:health.durable_journal.max_pending}));
 await f.restart();assert.deepEqual((await walletCall(f.config,'debit',f.payload(chosen.transaction_id))).data,chosen);
 assert.equal(f.service.wallet.reconcile(f.config.operator.id).status,'matched');
 assert.throws(()=>f.service.wallet.run("UPDATE transactions SET status='rejected'"),/immutable receipt/);
});

test('invalid JSON and failing business operations consume valid nonces durably without affecting other operations',async t=>{
 const f=await fixture(t),requests=[
  f.signed('balance',{}, {raw:'{invalid-json'}),f.signed('status',{}, {raw:'{invalid-json'}),
  f.signed('debit',{...f.payload('invalid-business'),currency:'USD'}),
  f.signed('balance',{player_ref:'alice',currency:'USD'}),f.signed('status',{player_ref:'alice'})
 ];
 const results=await Promise.all([...requests.map(request=>f.send(request)),walletCall(f.config,'debit',f.payload('valid-neighbor'))]);
 assert.deepEqual(results.slice(0,-1).map(result=>result.status),[400,400,422,422,422]);assert.equal(results.at(-1).status,200);assert.equal(results.at(-1).data.status,'applied');
 for(const request of requests)assert.ok(f.observer.prepare('SELECT 1 FROM nonces WHERE operator_id=? AND nonce=?').get(f.config.operator.id,request.headers['x-softtech-nonce']));
 assert.equal(f.observer.prepare('SELECT count(*) n FROM transactions').get().n,1);
 await f.restart();for(const request of requests)assert.equal((await f.send(request)).data.error,'REPLAY_DETECTED');
});

test('failed authentication commit sends no success or fault disconnect, and failed business commit preserves consumed nonce',async t=>{
 const f=await fixture(t),armed=await adminCall(f.config,'/admin/faults',{operator_id:f.config.operator.id,action:'debit',kind:'before_disconnect',count:1}),request=f.signed('debit',f.payload('auth-commit-failure'));
 const original=f.service.wallet.db;let injected=false;
 f.service.wallet.journal.db={exec(sql){if(sql==='COMMIT'&&!injected){injected=true;throw Error('INJECTED_AUTH_COMMIT_FAILURE');}return original.exec(sql);}};
 assert.equal((await f.send(request)).status,500);assert.equal(f.observer.prepare('SELECT remaining FROM faults WHERE id=?').get(armed.data.id).remaining,1);
 assert.equal(f.observer.prepare('SELECT 1 FROM nonces WHERE nonce=?').get(request.headers['x-softtech-nonce']),undefined);assert.equal(f.observer.prepare('SELECT count(*) n FROM transactions').get().n,0);
 f.service.wallet.journal.db=original;
 await assert.rejects(f.send(request));
 assert.equal(f.observer.prepare('SELECT remaining FROM faults WHERE id=?').get(armed.data.id).remaining,0);assert.ok(f.observer.prepare('SELECT 1 FROM nonces WHERE nonce=?').get(request.headers['x-softtech-nonce']));
 const business=f.signed('debit',f.payload('business-commit-failure'));let businessInjected=false;
 f.service.wallet.journal.db={exec(sql){if(sql==='COMMIT'&&!businessInjected&&original.prepare('SELECT 1 FROM transactions WHERE id=?').get('business-commit-failure')){businessInjected=true;throw Error('INJECTED_BUSINESS_COMMIT_FAILURE');}return original.exec(sql);}};
 assert.equal((await f.send(business)).status,500);assert.equal(businessInjected,true);
 assert.ok(f.observer.prepare('SELECT 1 FROM nonces WHERE nonce=?').get(business.headers['x-softtech-nonce']));
 assert.equal(f.observer.prepare('SELECT 1 FROM transactions WHERE id=?').get('business-commit-failure'),undefined);assert.equal(f.observer.prepare("SELECT balance_minor FROM accounts WHERE player_ref='alice'").get().balance_minor,'1000');
 f.service.wallet.journal.db=original;await f.restart();
 assert.equal((await f.send(request)).data.error,'REPLAY_DETECTED');assert.equal((await f.send(business)).data.error,'REPLAY_DETECTED');
 const recovered=await walletCall(f.config,'debit',f.payload('business-commit-failure'));assert.equal(recovered.data.status,'applied');assert.equal(recovered.data.balance_minor,'999');
 assert.deepEqual((await walletCall(f.config,'debit',f.payload('business-commit-failure'))).data,recovered.data);
});

test('before/after disconnect faults are consumed before sockets close and retained receipts recover exactly once after restart',async t=>{
 const f=await fixture(t),records=[];
 for(const kind of ['before_disconnect','after_disconnect']){
  const fault=await adminCall(f.config,'/admin/faults',{operator_id:f.config.operator.id,action:'debit',kind,count:1}),request=f.signed('debit',f.payload(kind));
  await assert.rejects(f.send(request));
  assert.equal(f.observer.prepare('SELECT remaining FROM faults WHERE id=?').get(fault.data.id).remaining,0);
  assert.ok(f.observer.prepare('SELECT 1 FROM nonces WHERE nonce=?').get(request.headers['x-softtech-nonce']));
  const stored=f.observer.prepare('SELECT receipt_json FROM transactions WHERE id=?').get(kind);
  if(kind==='before_disconnect')assert.equal(stored,undefined);else{assert.equal(JSON.parse(stored.receipt_json).status,'applied');assert.equal(f.observer.prepare("SELECT count(*) n FROM ledger WHERE transaction_id=? AND kind='debit'").get(kind).n,1);}
  records.push({kind,request,receipt:stored?JSON.parse(stored.receipt_json):null});
 }
 await f.restart();
 for(const r of records){
  assert.equal((await f.send(r.request)).data.error,'REPLAY_DETECTED');
  const retried=await walletCall(f.config,'debit',f.payload(r.kind));assert.equal(retried.data.status,'applied');
  if(r.receipt)assert.deepEqual(retried.data,r.receipt);
  assert.deepEqual((await walletCall(f.config,'debit',f.payload(r.kind))).data,retried.data);
 }
 assert.equal(f.observer.prepare("SELECT balance_minor FROM accounts WHERE player_ref='alice'").get().balance_minor,'998');assert.equal(f.service.wallet.reconcile(f.config.operator.id).status,'matched');
});

test('concurrent admin seeds are atomic and an after-timeout waits outside the durable queue',async t=>{
 const f=await fixture(t),seed=()=>adminCall(f.config,'/admin/accounts',{operator_id:f.config.operator.id,player_ref:'bob',amount_minor:'100'});
 const seeds=await Promise.all(Array.from({length:64},seed));assert.equal(seeds.filter(r=>r.data.duplicate===false).length,1);assert.ok(seeds.every(r=>r.status===200));
 assert.equal(f.observer.prepare("SELECT count(*) n FROM ledger WHERE player_ref='bob'").get().n,1);
 const page=await adminCall(f.config,'/admin/report',{operator_id:f.config.operator.id,limit:1,offset:0,include_reconciliation:false});assert.equal(page.status,200);assert.equal(page.data.reconciliation,null);assert.equal(page.data.accounts.length,1);
 await adminCall(f.config,'/admin/faults',{operator_id:f.config.operator.id,action:'debit',kind:'after_timeout',count:1,delay_ms:1000});
 let completed=false;const slow=walletCall(f.config,'debit',f.payload('delayed-ack')).then(r=>{completed=true;return r;});
 for(let i=0;i<100&&!f.observer.prepare("SELECT 1 FROM transactions WHERE id='delayed-ack'").get();i++)await new Promise(r=>setTimeout(r,5));
 assert.ok(f.observer.prepare("SELECT 1 FROM transactions WHERE id='delayed-ack'").get());
 assert.equal((await walletCall(f.config,'balance',{player_ref:'alice'})).data.balance_minor,'999');assert.equal(completed,false,'fault delay blocked the durable queue');
 assert.equal((await slow).data.status,'applied');
});

test('queue rejects async/nested callbacks, bounds pending work, isolates falsy failures and never acknowledges a failed group commit',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE proof(id TEXT PRIMARY KEY)');
 const journal=new DurableWrites(db,{maxBatch:2,maxPending:2,delayMs:1000});let invoked=false;
 try{
  await assert.rejects(journal.run(async()=>{invoked=true;}),/Synchronous/);assert.equal(invoked,false);
  const first=journal.run(()=>{db.prepare('INSERT INTO proof VALUES(?)').run('good');return 'good';}),second=journal.run(()=>{db.prepare('INSERT INTO proof VALUES(?)').run('bad');throw null;});
  const settled=Promise.allSettled([first,second]);await assert.rejects(journal.run(()=>{}),e=>e.code==='JOURNAL_BACKPRESSURE');journal.flush();
  const outcomes=await settled;assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].status,'rejected');assert.equal(db.prepare('SELECT count(*) n FROM proof').get().n,1);
  const nested=journal.run(()=>journal.run(()=>db.prepare('INSERT INTO proof VALUES(?)').run('stray')));const denied=assert.rejects(nested,/Nested/);journal.flush();await denied;assert.equal(journal.pending.length,0);
  journal.db={exec(sql){if(sql==='COMMIT')throw Error('INJECTED_GROUP_COMMIT_FAILURE');return db.exec(sql);}};
  const failed=Promise.allSettled(['a','b'].map(id=>journal.run(()=>{db.prepare('INSERT INTO proof VALUES(?)').run(id);return id;})));journal.flush();
  assert.ok((await failed).every(r=>r.status==='rejected'));assert.equal(db.prepare('SELECT count(*) n FROM proof').get().n,1);assert.equal(journal.status().failed_commits,1);
 }finally{journal.close();db.close();}
});
