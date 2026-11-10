import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import {CorePhases,CORE_ACTIONS,CORE_PHASES,CORE_CAPTURE_LIMIT,CORE_SPAN_LIMIT,CORE_COUNTER_MAX} from '../lib/core-phases.mjs';
import {DurableWrites} from '../lib/durable-writes.mjs';
import {Core} from '../lib/core.mjs';
import {random,signer} from '../lib/security.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function database(t){const dir=mkdtempSync(join(tmpdir(),'core-phase-')),path=join(dir,'proof.sqlite'),db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE proofs(id TEXT PRIMARY KEY,value TEXT)');t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return {db,path};}
function complete(phases,lease,{error=false,aborted=false}={}){if(error)phases.requestError(lease);phases.handlerDone(lease);phases.responseDone(lease,aborted,error?500:200);}

test('mixed shared batch attributes each synchronous callback to its captured ALS lease, including an untraced item',async t=>{
 let time=0;const phases=new CorePhases({now:()=>time}),f=database(t);
 const journal=new DurableWrites({exec(sql){if(sql==='BEGIN IMMEDIATE')time+=100;if(sql==='COMMIT')time+=1000;return f.db.exec(sql);}},{phases});t.after(()=>journal.close());
 const a=phases.begin('engine_status'),b=phases.begin('engine_reserve');
 const one=phases.run(a,()=>journal.run(()=>{assert.deepEqual(phases.current(),a);phases.increment('body_failures');time+=30;f.db.prepare('INSERT INTO proofs VALUES(?,?)').run('a','one');return 'a';},'auth'));
 const two=phases.run(b,()=>journal.run(()=>{assert.deepEqual(phases.current(),b);phases.increment('transaction_failures');time+=70;f.db.prepare('INSERT INTO proofs VALUES(?,?)').run('b','two');return 'b';}));
 const three=phases.run(null,()=>journal.run(()=>{assert.equal(phases.current(),null);time+=50;return 'untraced';}));
 // Flush under A deliberately: B and untraced must not inherit that timer's context.
 phases.run(a,()=>journal.flush());assert.deepEqual(await Promise.all([one,two,three]),['a','b','untraced']);
 complete(phases,a);complete(phases,b);const result=phases.snapshot();
 assert.equal(result.operations.engine_status.counters.body_failures,1);assert.equal(result.operations.engine_status.counters.transaction_failures,0);
 assert.equal(result.operations.engine_reserve.counters.body_failures,0);assert.equal(result.operations.engine_reserve.counters.transaction_failures,1);
 assert.equal(result.operations.engine_status.phases.auth_batch_begin.total_us,100);assert.equal(result.operations.engine_reserve.phases.journal_batch_begin.total_us,100);
 assert.equal(result.journal_batches.phases.begin.operations,1);assert.equal(result.journal_batches.phases.begin.total_us,100);
 assert.equal(result.journal_batches.phases.commit.total_us,1000);assert.equal(result.journal_batches.unattributed_items,1);
 assert.equal(result.active_captures,0);assert.equal(result.telemetry_error,false);assert.equal(result.late_observations,0);
});

test('concurrent rejected operation keeps the original error, rolls back its savepoint and never contaminates a peer capture',async t=>{
 const phases=new CorePhases(),f=database(t),observer=new DatabaseSync(f.path),journal=new DurableWrites(f.db,{phases});t.after(()=>{journal.close();observer.close();});
 const failure=Error('synthetic operation rejection');
 const work=Array.from({length:96},(_,index)=>{
  const action=index%2?'engine_reserve':'engine_status',lease=phases.begin(action);
  return phases.run(lease,async()=>{
   let error=false;
   try{const value=await journal.run(()=>{assert.deepEqual(phases.current(),lease);f.db.prepare('INSERT INTO proofs VALUES(?,?)').run('p'+index,'value');if(index===17)throw failure;return index;},'auth');assert.equal(observer.prepare('SELECT count(*) n FROM proofs WHERE id=?').get('p'+index).n,1);return value;}
   catch(caught){error=true;assert.equal(caught,failure);throw caught;}
   finally{complete(phases,lease,{error});}
  });
 });
 const result=await Promise.allSettled(work);assert.equal(result.filter(x=>x.status==='fulfilled').length,95);assert.equal(result[17].reason,failure);assert.equal(observer.prepare('SELECT count(*) n FROM proofs').get().n,95);
 const metrics=phases.snapshot();assert.equal(metrics.operations.engine_status.completed,48);assert.equal(metrics.operations.engine_reserve.completed,48);
 assert.equal(metrics.operations.engine_reserve.errors,1);assert.equal(metrics.operations.engine_reserve.counters.journal_operation_failures,1);assert.equal(metrics.operations.engine_status.counters.journal_operation_failures,0);
 assert.equal(metrics.operations.engine_reserve.counters.journal_batch_failures,0);assert.equal(metrics.journal_batches.failed_batches,0);assert.equal(metrics.telemetry_error,false);
});

test('failed batch COMMIT acknowledges no data and all waiting captures retain the same original failure',async t=>{
 const phases=new CorePhases(),f=database(t),failure=Error('synthetic commit rejection');
 const journal=new DurableWrites({exec(sql){if(sql==='COMMIT')throw failure;return f.db.exec(sql);}},{phases});t.after(()=>journal.close());
 let acknowledged=0;
 const pending=Array.from({length:32},(_,i)=>{const lease=phases.begin(i%2?'engine_status':'engine_settle');return phases.run(lease,async()=>{try{await journal.run(()=>f.db.prepare('INSERT INTO proofs VALUES(?,?)').run('p'+i,'v'));acknowledged++;}finally{complete(phases,lease,{error:true});}});});
 const outcomes=await Promise.allSettled(pending);assert(outcomes.every(x=>x.status==='rejected'&&x.reason===failure));assert.equal(acknowledged,0);assert.equal(f.db.prepare('SELECT count(*) n FROM proofs').get().n,0);
 const snapshot=phases.snapshot();assert.equal(snapshot.active_captures,0);assert.equal(snapshot.journal_batches.failed_batches,1);assert.equal(snapshot.journal_batches.phases.commit.operations,1);assert.equal(snapshot.journal_batches.phases.rollback.operations,1);
 for(const action of ['engine_status','engine_settle'])assert.equal(snapshot.operations[action].counters.journal_batch_failures,16);
});

test('auth completion-to-resume is measured at the existing await continuation, not at Promise resolution',async t=>{
 let now=0;const phases=new CorePhases({now:()=>now}),f=database(t),journal=new DurableWrites(f.db,{phases});t.after(()=>journal.close());
 const lease=phases.begin('engine_status');
 await phases.run(lease,async()=>{
  const authentication=phases.authStart();const result=journal.run(()=>{now+=20;return 'accepted';},'auth');
  now+=500;journal.flush();now+=7000;assert.equal(await result,'accepted');phases.authResume(authentication);complete(phases,lease);
 });
 const result=phases.snapshot().operations.engine_status.phases;
 assert.equal(result.auth_queue.total_us,500);assert.equal(result.auth_resolve_to_resume.total_us,7000);assert.equal(result.auth_total.total_us,7520);
});

test('response abort retains a capture while financial work continues; late tokens cannot alter a reused slot',async t=>{
 const phases=new CorePhases({captureLimit:1}),f=database(t),journal=new DurableWrites(f.db,{phases});t.after(()=>journal.close());
 const lease=phases.begin('engine_reserve'),res=new EventEmitter();res.statusCode=200;phases.attachResponse(res,lease);
 const walletGate=deferred(),entered=deferred();let calls=0,stale;
 const original=phases.run(lease,async()=>{
  stale=phases.start('engine_action');
  await journal.run(()=>f.db.prepare('INSERT INTO proofs VALUES(?,?)').run('intent','durable'));
  const promise=walletGate.promise;assert.equal(phases.walletCall('debit',()=>{calls++;entered.resolve();return promise;}),promise);
  await promise;
  await journal.run(()=>f.db.prepare('INSERT INTO proofs VALUES(?,?)').run('receipt','durable'));
  phases.end(stale);phases.handlerDone(lease);
 });
 await entered.promise;res.emit('close');assert.equal(phases.snapshot().active_captures,1);assert.equal(phases.begin('engine_status'),null);
 walletGate.resolve({secret:'not retained'});await original;assert.equal(calls,1);assert.equal(f.db.prepare('SELECT count(*) n FROM proofs').get().n,2);
 const after=phases.snapshot();assert.equal(after.active_captures,0);assert.equal(after.operations.engine_reserve.aborted,1);assert.equal(after.dropped_captures,1);
 const next=phases.begin('engine_settle');const invalidOld={...stale,done:false};phases.end(invalidOld);complete(phases,next);
 const final=phases.snapshot();assert.equal(final.operations.engine_settle.phases.engine_action,undefined);assert.equal(final.late_observations,1);
});

test('closed journal releases queued auth callers without starting a transaction or inventing batch timing',async t=>{
 const phases=new CorePhases(),f=database(t),journal=new DurableWrites(f.db,{phases}),lease=phases.begin('engine_status');
 await phases.run(lease,async()=>{const auth=phases.authStart();const pending=journal.run(()=>assert.fail('closed journal executed a callback'),'auth');journal.close();await assert.rejects(pending,error=>error.code==='JOURNAL_CLOSED');phases.increment('auth_failures');phases.authResume(auth);complete(phases,lease,{error:true});});
 const result=phases.snapshot();assert.equal(result.journal_batches.completed_batches,0);assert.equal(result.operations.engine_status.counters.journal_closed,1);assert.equal(result.operations.engine_status.phases.auth_batch_commit,undefined);
});

test('telemetry faults, invalid clocks and span overflow do not replace returns or invoke business twice',async()=>{
 const phases=new CorePhases({now:()=>{throw Error('synthetic telemetry clock fault');}}),lease=phases.begin('engine_status');let calls=0;
 const value=phases.run(lease,()=>{calls++;const span=phases.start('engine_action');phases.end(span);return 37;});assert.equal(value,37);assert.equal(calls,1);complete(phases,lease);
 let result=phases.snapshot();assert.equal(result.active_captures,0);assert.equal(result.telemetry_error,true);assert(result.invalid_clock>0);assert.equal(result.operations.engine_status.phases.engine_action,undefined);
 const plain=new CorePhases();const oldRun=plain.storage.run;plain.storage.run=()=>{throw Error('synthetic context installation fault');};calls=0;
 assert.equal(plain.run(null,()=>{calls++;return 'same-value';}),'same-value');assert.equal(calls,1);assert.equal(plain.telemetryError,true);plain.storage.run=oldRun;
 const failure=Error('business must propagate');assert.throws(()=>plain.run(null,()=>{throw failure;}),error=>error===failure);
 let clock=100;const bounded=new CorePhases({now:()=>clock}),capture=bounded.begin('engine_reserve');clock=99;bounded.record(capture,'engine_action',100,clock);clock=101;
 for(let i=0;i<CORE_SPAN_LIMIT+5;i++)bounded.record(capture,'body_read',100,101);
 complete(bounded,capture);result=bounded.snapshot();assert(result.invalid_clock>0);assert(result.dropped_spans>=5);assert.equal(result.operations.engine_reserve.phases.body_read.invocations,CORE_SPAN_LIMIT);
});

test('aggregation failure retires the lease and explicitly invalidates telemetry',()=>{
 const phases=new CorePhases({captureLimit:1}),lease=phases.begin('engine_status');phases.record(lease,'body_read',0,1);phases.addCell=()=>{throw Error('synthetic merge fault');};complete(phases,lease);
 assert.equal(phases.snapshot().active_captures,0);assert.equal(phases.telemetryError,true);assert(phases.begin('engine_reserve'));
});

test('saturation, registry identity and fixed labels make loss/reset observable without retaining data',()=>{
 const phases=new CorePhases({captureLimit:1}),other=new CorePhases({captureLimit:1});assert.notEqual(phases.snapshot().registry_id,other.snapshot().registry_id);
 assert.equal(phases.beginHttp('POST','/health?token=not-retained'),null);
 const lease=phases.beginHttp('POST','/api/v4/agency-game/untrusted-user-path?secret=not-retained');phases.completed=CORE_COUNTER_MAX-1;complete(phases,lease);
 const result=phases.snapshot();assert.equal(result.saturated,true);assert.equal(result.reset_count,0);assert.deepEqual(Object.keys(result.operations),['engine_other']);assert(!JSON.stringify(result).includes('not-retained'));
});

test('wallet observation preserves original promise identity, synchronous exceptions and rejected outcomes',async()=>{
 const phases=new CorePhases(),lease=phases.begin('engine_status'),rejected=Error('synthetic wallet failure');
 await phases.run(lease,async()=>{
  const promise=Promise.reject(rejected);assert.equal(phases.walletCall('balance',()=>promise),promise);await assert.rejects(promise,error=>error===rejected);
  assert.throws(()=>phases.walletCall('balance',()=>{throw rejected;}),error=>error===rejected);complete(phases,lease,{error:true});
 });
 assert.equal(phases.snapshot().operations.engine_status.phases.wallet_balance.invocations,2);
});

test('real event-loop blocking appears in bounded process-wide delay histogram without retaining samples',async()=>{
 const phases=new CorePhases();phases.startLoop();
 try{await pause(120);const until=performance.now()+220;while(performance.now()<until){}await pause(120);}finally{phases.stopLoop();}
 const sample=phases.snapshot().event_loop;assert(sample.samples.operations>=2);assert(sample.samples.max_operation_us>=100000);assert.equal(sample.samples.buckets.length,20);assert.equal(sample.running,false);
});

test('fixed registry and repeated capture reuse stay bounded after garbage collection',()=>{
 const moduleURL=new URL('../lib/core-phases.mjs',import.meta.url).href;
 const script=`import {CorePhases,CORE_ACTIONS,CORE_PHASES} from ${JSON.stringify(moduleURL)};global.gc();const before=process.memoryUsage();const p=new CorePhases();for(let i=0;i<20000;i++){const l=p.begin(CORE_ACTIONS[i%CORE_ACTIONS.length]);for(const label of CORE_PHASES)p.record(l,label,0,1234);p.handlerDone(l);p.responseDone(l);}global.gc();const after=process.memoryUsage();const json=JSON.stringify(p.snapshot());console.log(JSON.stringify({heap_delta:after.heapUsed-before.heapUsed,array_delta:after.arrayBuffers-before.arrayBuffers,bytes:Buffer.byteLength(json),active:p.snapshot().active_captures,slots:p.slots.length,free:p.free.length,completed:p.snapshot().completed_operations}));`;
 const result=JSON.parse(execFileSync(process.execPath,['--expose-gc','--input-type=module','-e',script],{encoding:'utf8',timeout:30000}));
 assert.equal(result.slots,CORE_CAPTURE_LIMIT);assert.equal(result.free,CORE_CAPTURE_LIMIT);assert.equal(result.active,0);assert.equal(result.completed,20000);assert(result.heap_delta<16*1024*1024);assert(result.array_delta<8*1024*1024);assert(result.bytes<512*1024);
});

test('observed failed authentication and concurrent same-account charges preserve durable nonce and ledger semantics',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'core-phase-financial-')),phases=new CorePhases(),secret=random(40),engineSecret=random(40);
 const env={NODE_ENV:'test',CORE_DB_PATH:join(dir,'core.sqlite'),PANEL_SESSION_SECRET:secret,CORE_ENGINE_KEYS_JSON:JSON.stringify([{id:'engine-fixture',game:'uno-luck',secret:engineSecret}]),UNO_PROVIDER_ORIGIN:'http://127.0.0.1:19991'};
 let core=new Core({env,phases});t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});
 const created=core.createOperator({name:'Synthetic phase fixture',games:['uno-luck'],initial_minor:'100'}),op=created.operator;
 const launch=core.createLaunch(core.operator(op.id),{game_id:'uno-luck',player_ref:'fixture'},'phase-launch-id');
 const token=new URLSearchParams(new URL(launch.launch_url).hash.slice(1)).get('softtech_launch');
 const session=core.redeem({game:'uno-luck'},{token,request_id:'phase-redeem-id'});
 const path='/api/v4/agency-game/status',body='{}',signature=signer(engineSecret,'agency.v1','POST',path,body);
 const request={method:'POST',path,body,headers:{'x-agency-key':'engine-fixture','x-agency-timestamp':signature.timestamp,'x-agency-nonce':signature.nonce,'x-agency-signature':signature.signature}};
 const authenticate=async request=>{const lease=phases.begin('engine_status');return phases.run(lease,async()=>{const auth=phases.authStart();let error=false;try{return await core.authenticateDurable(request,true);}catch(caught){error=true;phases.increment('auth_failures');throw caught;}finally{phases.authResume(auth);complete(phases,lease,{error});}});};
 await authenticate(request);await assert.rejects(authenticate(request),error=>error.code==='REPLAY_DETECTED');assert.equal(core.get('SELECT count(*) n FROM replay_nonces').n,1);
 const charges=await Promise.allSettled(['one','two'].map(async id=>{const lease=phases.begin('engine_reserve');return phases.run(lease,async()=>{let error=false;try{return await core.engineAction({game:'uno-luck'},'reserve',{tenant_id:op.id,session_id:session.session_id,round_ref:'phase-'+id,stake:'100',max_payout:'1000'});}catch(caught){error=true;throw caught;}finally{complete(phases,lease,{error});}});}));
 assert.equal(charges.filter(x=>x.status==='fulfilled').length,1);assert.equal(core.get("SELECT count(*) n FROM ledger WHERE kind='debit'").n,1);assert.equal(core.get('SELECT balance_minor FROM players').balance_minor,'0');
 core.close();core=new Core({env,phases});await assert.rejects(authenticate(request),error=>error.code==='REPLAY_DETECTED');assert.equal(core.get("SELECT count(*) n FROM ledger WHERE kind='debit'").n,1);
 const metrics=phases.snapshot();assert.equal(metrics.active_captures,0);assert.equal(metrics.operations.engine_status.counters.auth_failures,2);assert.equal(metrics.operations.engine_reserve.completed,2);assert.equal(metrics.telemetry_error,false);assert.equal(metrics.late_observations,0);
});
