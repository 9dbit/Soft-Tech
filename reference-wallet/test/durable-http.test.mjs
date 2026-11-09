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
 const f=await fixture(t),malformed=f.signed('balance',{}, {raw:'{invalid-json'}),invalid=f.signed('debit',{...f.payload('invalid-business'),currency:'USD'});
 const results=await Promise.all([f.send(malformed),f.send(invalid),walletCall(f.config,'debit',f.payload('valid-neighbor'))]);
 assert.equal(results[0].status,400);assert.equal(results[1].status,422);assert.equal(results[2].status,200);assert.equal(results[2].data.status,'applied');
 for(const request of [malformed,invalid])assert.ok(f.observer.prepare('SELECT 1 FROM nonces WHERE operator_id=? AND nonce=?').get(f.config.operator.id,request.headers['x-softtech-nonce']));
 assert.equal(f.observer.prepare('SELECT count(*) n FROM transactions').get().n,1);
 await f.restart();assert.equal((await f.send(malformed)).data.error,'REPLAY_DETECTED');assert.equal((await f.send(invalid)).data.error,'REPLAY_DETECTED');
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
