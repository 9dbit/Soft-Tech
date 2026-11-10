import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {CorePhases} from '../../provider-dashboard/lib/core-phases.mjs';
import {DurableWrites} from '../../provider-dashboard/lib/durable-writes.mjs';
import {runNativeLoad} from '../native-load.mjs';
import {DIAGNOSTIC_LIMITS,PHASE_BUCKETS,sanitizeDiagnosticHealth,captureGameplayBoundary,compareGameplayBoundaries,completionAggregate} from '../gameplay-diagnostics.mjs';

const time='2026-11-10T10:00:00.000Z',later='2026-11-10T10:01:00.000Z';
const base={ok:true,source_commit:'a'.repeat(40),process_boot_id:'fixture-process-identity',identity:{environment:'preproduction',deployment_id:'fixture-core-identity'}};
const wrap=(health,name='core',stamp=time)=>({services:{[name]:{...sanitizeDiagnosticHealth(health,name),started_at:stamp,finished_at:stamp}}});
const complete=(p,lease)=>{p.handlerDone(lease);p.responseDone(lease);};
const nativeCounters=['explicit_transactions_started','explicit_transactions_zero_dml','explicit_transactions_with_dml','explicit_commit_active','explicit_commit_noop','explicit_commit_failed','closed_transaction','dml_success','dml_failure','invalid_clock','dropped_spans'];
function nativeHealth(count=0){return {...base,native_phases:{schema:1,available:true,registry_id:'4d6af31d-2ca4-43e2-8e90-9785da971b1b',reset_count:0,capture_limit:1024,telemetry_error:false,unit:'microseconds',histogram:'per_operation_phase_sum',bucket_upper_us:[...PHASE_BUCKETS],active_captures:0,completed_operations:count,dropped_captures:0,saturated:false,operations:count?{state:{completed:count,errors:0,aborted:0,counters:Object.fromEntries(nativeCounters.map(k=>[k,0])),phases:{callback_status:{operations:count,invocations:count,total_us:count*100,max_operation_us:100,max_invocation_us:100,buckets:PHASE_BUCKETS.map((_,i)=>i===0?count:0)}}}}:{}}};}

test('actual Core and SQLite grouped writes produce comparable additive interval evidence excluding setup',async t=>{
 const phases=new CorePhases(),db=new DatabaseSync(':memory:');db.exec('CREATE TABLE observations(id INTEGER PRIMARY KEY)');
 const journal=new DurableWrites(db,{phases});phases.startLoop();t.after(()=>{phases.stopLoop();journal.close();db.close();});
 const setup=phases.begin('operator');await phases.run(setup,()=>journal.run(()=>db.prepare('INSERT INTO observations VALUES(?)').run(0)));complete(phases,setup);
 const before=wrap({...base,core_phases:phases.snapshot()});
 await Promise.all([1,2,3].map(async i=>{const lease=phases.begin('engine_status');await phases.run(lease,()=>journal.run(()=>db.prepare('INSERT INTO observations VALUES(?)').run(i)));complete(phases,lease);}));
 const after=wrap({...base,core_phases:phases.snapshot()},'core',later);
 const compared=compareGameplayBoundaries(before,after).services.core;
 assert.equal(compared.comparable,true,JSON.stringify(compared));assert.equal(compared.delta.completed_operations,3);
 assert.equal(compared.delta.operations.operator.completed,0);assert.equal(compared.delta.operations.engine_status.completed,3);
 assert.equal(compared.delta.journal_batches.queued_items,3);assert.equal(compared.delta.journal_batches.settled_items,3);
 assert.equal(compared.delta.journal_batches.completed_batches,1);assert.equal(db.prepare('SELECT count(*) n FROM observations').get().n,4);
 assert.equal(compared.delta.operations.engine_status.phases.journal_queue.operations,3);
 assert.equal(compared.delta.operations.engine_status.phases.journal_queue.buckets.reduce((a,b)=>a+b),3);
 assert.equal(JSON.stringify(compared.delta).includes('max_operation_us'),false);assert.equal(JSON.stringify(compared.delta).includes('p95'),false);
});

test('authenticated game partitions retain early phases across interleaved durable batches and exclude setup',async t=>{
 let clock=0;const phases=new CorePhases({now:()=>++clock}),db=new DatabaseSync(':memory:');db.exec('CREATE TABLE observations(id INTEGER PRIMARY KEY)');
 const journal=new DurableWrites(db,{phases});phases.startLoop();t.after(()=>{phases.stopLoop();journal.close();db.close();});
 const setup=phases.begin('operator');await phases.run(setup,()=>journal.run(()=>db.prepare('INSERT INTO observations VALUES(0)').run()));complete(phases,setup);
 const before=wrap({...base,core_phases:phases.snapshot()});
 const labels=['uno-luck','mahjong-wild','skygate-5000'];
 await Promise.all(labels.map(async(game,index)=>{
  const lease=phases.begin('engine_status');
  await phases.run(lease,async()=>{
   const body=phases.start('body_read');await Promise.resolve();phases.end(body);
   const auth=phases.authStart();await journal.run(()=>db.prepare('INSERT INTO observations VALUES(?)').run(index+1),'auth');phases.authResume(auth);
   assert.equal(phases.attributeAuthenticatedGame(game),true);
   const balance=phases.start('wallet_balance');await Promise.resolve();phases.end(balance);
   await journal.run(()=>db.prepare('INSERT INTO observations VALUES(?)').run(index+11));
  });complete(phases,lease);
 }));
 const failed=phases.begin('engine_status');phases.increment('auth_failures',failed);phases.requestError(failed);complete(phases,failed);
 const operator=phases.begin('operator');complete(phases,operator);
 const after=wrap({...base,core_phases:phases.snapshot()},'core',later),result=compareGameplayBoundaries(before,after).services.core;
 assert.equal(result.comparable,true,JSON.stringify(result));const attributed=result.game_attribution;
 assert.equal(attributed.comparable,true,JSON.stringify(attributed));assert.deepEqual(attributed.labels,['unattributed',...labels]);
 assert.equal(attributed.delta.completed_operations,5);assert.equal(result.delta.journal_batches.completed_batches,2);
 assert.equal(result.delta.journal_batches.queued_items,6);assert.equal(db.prepare('SELECT count(*) n FROM observations').get().n,7);
 for(const game of labels){
  const group=attributed.delta.groups[game];assert.equal(group.completed_operations,1);assert.equal(group.operations.engine_status.completed,1);
  for(const phase of ['body_read','auth_total','auth_queue','journal_queue','wallet_balance'])assert.equal(group.operations.engine_status.phases[phase].operations,1,game+':'+phase);
  assert.equal(group.operations.engine_status.counters.journal_operations,2);assert.equal(group.operations.operator,undefined);
  assert.equal(group.journal_batches,undefined);assert.equal(group.event_loop,undefined);
 }
 assert.equal(attributed.delta.groups.unattributed.completed_operations,2);
 assert.equal(attributed.delta.groups.unattributed.operations.operator.completed,1);
 assert.equal(attributed.delta.groups.unattributed.operations.engine_status.counters.auth_failures,1);
 assert.equal(JSON.stringify(attributed.delta).includes('max_operation_us'),false);
 assert.equal(JSON.stringify(attributed.delta).includes('p95'),false);
});

test('legacy and malformed game partitions cannot produce attributed deltas or invalidate valid global totals',t=>{
 let clock=0;const phases=new CorePhases({now:()=>++clock});phases.startLoop();t.after(()=>phases.stopLoop());
 const beforeHealth={...base,core_phases:phases.snapshot()};
 let lease=phases.begin('operator');complete(phases,lease);
 lease=phases.begin('engine_status');phases.attributeAuthenticatedGame('uno-luck',lease);phases.record(lease,'wallet_balance',0,100);complete(phases,lease);
 const health={...base,core_phases:phases.snapshot()},before=wrap(beforeHealth);
 const legacyBefore=structuredClone(beforeHealth),legacyAfter=structuredClone(health);delete legacyBefore.core_phases.game_attribution;delete legacyAfter.core_phases.game_attribution;
 const legacy=compareGameplayBoundaries(wrap(legacyBefore),wrap(legacyAfter,'core',later)).services.core;
 assert.equal(legacy.comparable,true);assert.equal(legacy.game_attribution.comparable,false);assert.deepEqual(legacy.game_attribution.errors,['GAME_ATTRIBUTION_NOT_EXPOSED']);assert.equal(legacy.game_attribution.delta,undefined);
 const cases=[
  ['unsupported schema',v=>v.schema=2],['wrong provenance',v=>v.provenance='request_body'],['wrong labels',v=>v.labels.push('private-game')],
  ['unknown group',v=>v.groups['private-game']={secret:'private-value'}],['missing group',v=>delete v.groups['skygate-5000']],
  ['nonobject group',v=>v.groups['mahjong-wild']='private-value'],['count mismatch',v=>v.groups['uno-luck'].completed_operations++],
  ['operation mismatch',v=>v.groups['uno-luck'].operations.engine_status.errors++],
  ['counter mismatch',v=>v.groups['uno-luck'].operations.engine_status.counters.journal_operations++],
  ['phase sum mismatch',v=>v.groups['uno-luck'].operations.engine_status.phases.wallet_balance.total_us++],
  ['bucket mismatch',v=>{const c=v.groups['uno-luck'].operations.engine_status.phases.wallet_balance;c.buckets[0]--;c.buckets[1]++;}],
  ['invalid cell',v=>v.groups['uno-luck'].operations.engine_status.phases.wallet_balance.total_us=Infinity],
  ['operator misclassification',v=>{const u=v.groups.unattributed,g=v.groups['uno-luck'];g.operations.operator=u.operations.operator;delete u.operations.operator;u.completed_operations--;g.completed_operations++;}]
 ];
 for(const [name,change]of cases){
  const corrupted=structuredClone(health);change(corrupted.core_phases.game_attribution);
  const after=wrap(corrupted,'core',later),result=compareGameplayBoundaries(before,after).services.core;
  assert.equal(result.comparable,true,name);assert.equal(result.game_attribution.comparable,false,name);assert.equal(result.game_attribution.delta,undefined,name);
  assert(after.services.core.core_phases.game_attribution.validation_errors.length>0,name);
 }
 for(const counter of ['auth_failures','body_failures']){
  const failedAuth=structuredClone(health);
  failedAuth.core_phases.operations.engine_status.counters[counter]=1;
  failedAuth.core_phases.game_attribution.groups['uno-luck'].operations.engine_status.counters[counter]=1;
  const auth=wrap(failedAuth,'core',later);assert(auth.services.core.core_phases.game_attribution.validation_errors.includes('UNVERIFIED_GAME_ATTRIBUTION'));
  assert.equal(compareGameplayBoundaries(before,auth).services.core.game_attribution.comparable,false);
 }
});

test('conserved game snapshots still reject interval reassignment and histogram decreases',t=>{
 let clock=0;const phases=new CorePhases({now:()=>++clock});phases.startLoop();t.after(()=>phases.stopLoop());
 for(const [game,elapsed]of [['uno-luck',2000],['skygate-5000',100]]){const lease=phases.begin('engine_status');phases.attributeAuthenticatedGame(game,lease);phases.record(lease,'wallet_balance',0,elapsed);complete(phases,lease);}
 const health={...base,core_phases:phases.snapshot()},before=wrap(health),swapped=structuredClone(health),groups=swapped.core_phases.game_attribution.groups;
 [groups['uno-luck'],groups['skygate-5000']]=[groups['skygate-5000'],groups['uno-luck']];
 const after=wrap(swapped,'core',later);assert.deepEqual(after.services.core.core_phases.game_attribution.validation_errors,[]);
 const result=compareGameplayBoundaries(before,after).services.core;assert.equal(result.comparable,true);assert.equal(result.game_attribution.comparable,false);
 assert(result.game_attribution.errors.includes('COUNTER_DECREASE_OR_INVALID'));assert.equal(result.game_attribution.delta,undefined);
});

test('game attribution whitelists fixed labels and fields without retaining identifiers or unbounded arrays',t=>{
 assert.equal(DIAGNOSTIC_LIMITS.response_bytes,262144);
 const phases=new CorePhases();phases.startLoop();t.after(()=>phases.stopLoop());
 const lease=phases.begin('engine_status');phases.attributeAuthenticatedGame('uno-luck',lease);phases.record(lease,'wallet_balance',0,10);complete(phases,lease);
 const health={...base,core_phases:phases.snapshot()},secret='PRIVATE_PLAYER_OR_TOKEN',game=health.core_phases.game_attribution;
 game.secret=secret;game.players=Array(10000).fill(secret);game.groups[secret]={completed_operations:1,token:secret};
 const operation=game.groups['uno-luck'].operations.engine_status;operation.session=secret;operation.counters[secret]=7;operation.phases.wallet_balance.token=secret;operation.phases[secret]={secret};
 const safe=sanitizeDiagnosticHealth(health,'core'),encoded=JSON.stringify(safe);
 assert(!encoded.includes(secret));assert(encoded.length<30000);assert.equal(safe.core_phases.game_attribution.groups['uno-luck'].operations.engine_status.session,undefined);
 assert(safe.core_phases.game_attribution.validation_errors.includes('UNSUPPORTED_GAME_LABEL'));assert(safe.core_phases.game_attribution.validation_errors.includes('UNSUPPORTED_PHASE_LABEL'));
 game.labels=Array(100000).fill(secret);operation.phases.wallet_balance.buckets=Array(100000).fill(1);
 const huge=sanitizeDiagnosticHealth(health,'core');assert.equal(huge.core_phases.game_attribution.labels,null);assert.equal(huge.core_phases.game_attribution.groups['uno-luck'].operations.engine_status.phases.wallet_balance.buckets,null);
 assert(JSON.stringify(huge).length<30000);assert(!JSON.stringify(huge).includes(secret));
});

test('a shorter interval observation does not subtract or relabel the previous lifetime maximum',t=>{
 let now=0;const phases=new CorePhases({now:()=>now});phases.startLoop();t.after(()=>phases.stopLoop());
 let lease=phases.begin('engine_status');phases.record(lease,'wallet_balance',0,8000);now=8000;complete(phases,lease);
 const before=wrap({...base,core_phases:phases.snapshot()});
 lease=phases.begin('engine_status');phases.record(lease,'wallet_balance',now,now+100);now+=100;complete(phases,lease);
 const after=wrap({...base,core_phases:phases.snapshot()},'core',later),result=compareGameplayBoundaries(before,after).services.core;
 assert.equal(result.comparable,true);assert.equal(result.delta.operations.engine_status.phases.wallet_balance.total_us,100);
 assert.equal(result.delta.operations.engine_status.phases.wallet_balance.buckets[0],1);
 assert.equal(after.services.core.core_phases.operations.engine_status.phases.wallet_balance.max_operation_us,8000);
 assert.equal('max_operation_us' in result.delta.operations.engine_status.phases.wallet_balance,false);
});

test('changed process, source, deployment, registry, reset, active capture, loss and inconsistent counters block deltas',t=>{
 const phases=new CorePhases();phases.startLoop();t.after(()=>phases.stopLoop());
 const health={...base,core_phases:phases.snapshot()},before=wrap(health),validAfter=wrap(health,'core',later);
 const changes=[
  ['PROCESS_CHANGED_OR_MISSING',v=>v.process_boot_id='different-process'],
  ['SOURCE_CHANGED_OR_MISSING',v=>v.source_commit='b'.repeat(40)],
  ['DEPLOYMENT_CHANGED_OR_MISSING',v=>v.deployment_identity.deployment_id='different-deployment'],
  ['REGISTRY_ID_CHANGED',v=>v.core_phases.registry_id='ffffffff-ffff-ffff-ffff-ffffffffffff'],
  ['RESET_IDENTITY_UNVERIFIED',v=>v.core_phases.reset_count=1],
  ['ACTIVE_CAPTURES_AT_BOUNDARY',v=>v.core_phases.active_captures=1],
  ['INTERVAL_TELEMETRY_LOSS',v=>v.core_phases.dropped_captures=1],
  ['TELEMETRY_ERROR',v=>v.core_phases.telemetry_error=true],
  ['COUNTER_SATURATED',v=>v.core_phases.saturated=true],
  ['UNSETTLED_JOURNAL_AT_BOUNDARY',v=>v.core_phases.journal_batches.queued_items=1],
  ['EVENT_LOOP_INTERVAL_UNVERIFIED',v=>v.core_phases.event_loop.running=false],
  ['COUNTER_DECREASE_OR_INVALID',v=>v.core_phases.completed_operations=-1]
 ];
 for(const [code,change]of changes){const after=structuredClone(validAfter);change(after.services.core);const result=compareGameplayBoundaries(before,after).services.core;assert.equal(result.comparable,false,code);assert(result.errors.includes(code),JSON.stringify(result));assert.equal(result.delta,undefined);assert.equal(result.game_attribution.comparable,false,code);assert.equal(result.game_attribution.delta,undefined);}
 const activeBefore=structuredClone(before);activeBefore.services.core.core_phases.active_captures=1;assert.equal(compareGameplayBoundaries(activeBefore,validAfter).services.core.comparable,false);
 const lateBefore=structuredClone(before);lateBefore.services.core.finished_at='2026-11-10T11:00:00.000Z';assert(compareGameplayBoundaries(lateBefore,validAfter).services.core.errors.includes('BOUNDARY_ORDER_UNVERIFIED'));
});

test('native registry-less versions remain explicit unavailable; a known registry permits fixed native phase deltas',()=>{
 const before=wrap(nativeHealth(1),'uno-luck'),after=wrap(nativeHealth(3),'uno-luck',later);
 const valid=compareGameplayBoundaries(before,after).services['uno-luck'];assert.equal(valid.comparable,true);assert.equal(valid.delta.operations.state.phases.callback_status.total_us,200);
 for(const boundary of [before,after]){boundary.services['uno-luck'].native_phases.registry_id=null;boundary.services['uno-luck'].native_phases.reset_count=null;}
 const missing=compareGameplayBoundaries(before,after).services['uno-luck'];assert.equal(missing.comparable,false);assert(missing.errors.includes('REGISTRY_ID_NOT_EXPOSED'));assert(missing.errors.includes('RESET_IDENTITY_UNVERIFIED'));assert.equal(missing.delta,undefined);
 const bad=nativeHealth(3);bad.native_phases.operations.state.phases.callback_status.buckets[0]=2;
 assert(sanitizeDiagnosticHealth(bad,'uno-luck').native_phases.validation_errors.includes('INVALID_PHASE_CELL'));
 const lost=wrap(nativeHealth(3),'uno-luck',later);lost.services['uno-luck'].native_phases.operations.state.counters.invalid_clock=1;
 assert(compareGameplayBoundaries(wrap(nativeHealth(1),'uno-luck'),lost).services['uno-luck'].errors.includes('INTERVAL_TELEMETRY_LOSS'));
});

test('UNO admission split retains bounded additive phases without fabricating legacy measurements',()=>{
 const measured=count=>{
  const health=nativeHealth(count),phases=health.native_phases.operations.state.phases;
  for(const [name,us]of Object.entries({dispatch_to_worker:61,dispatch_to_admission:11,admission_wait:20,admission_to_worker:30})){
   phases[name]={operations:count,invocations:count,total_us:count*us,max_operation_us:us,max_invocation_us:us,buckets:PHASE_BUCKETS.map((_,i)=>i===0?count:0)};
  }
  return health;
 };
 const result=compareGameplayBoundaries(wrap(measured(1),'uno-luck'),wrap(measured(3),'uno-luck',later)).services['uno-luck'];
 assert.equal(result.comparable,true,JSON.stringify(result));
 const phases=result.delta.operations.state.phases;
 for(const [name,us]of Object.entries({dispatch_to_worker:122,dispatch_to_admission:22,admission_wait:40,admission_to_worker:60})){
  assert.equal(phases[name].operations,2);assert.equal(phases[name].invocations,2);assert.equal(phases[name].total_us,us);
  assert.equal(phases[name].max_operation_us,undefined);assert.equal(phases[name].max_invocation_us,undefined);
 }
 const legacy=compareGameplayBoundaries(wrap(nativeHealth(1),'uno-luck'),wrap(nativeHealth(3),'uno-luck',later)).services['uno-luck'];
 assert.equal(legacy.comparable,true);assert.equal(legacy.delta.operations.state.phases.admission_wait,undefined);
 // Cancellation before token acquisition can complete an operation without a
 // successful admission or worker entry. Partial phase populations are valid.
 const cancelled=measured(3);for(const phase of ['admission_wait','admission_to_worker'])delete cancelled.native_phases.operations.state.phases[phase];
 assert.deepEqual(sanitizeDiagnosticHealth(cancelled,'uno-luck').native_phases.validation_errors,[]);
 const malformed=measured(3);malformed.native_phases.operations.state.phases.admission_wait.total_us=-1;
 const bad=compareGameplayBoundaries(wrap(measured(1),'uno-luck'),wrap(malformed,'uno-luck',later)).services['uno-luck'];
 assert.equal(bad.comparable,false);assert(bad.errors.includes('INVALID_PHASE_SNAPSHOT'));assert.equal(bad.delta,undefined);
 const secret='DO_NOT_RETAIN_ADMISSION_DETAIL',untrusted=measured(1);
 untrusted.native_phases.operations.state.phases.admission_wait.borrower=secret;
 untrusted.native_phases.operations.state.phases[secret]={token:secret};
 const safe=sanitizeDiagnosticHealth(untrusted,'uno-luck');assert(!JSON.stringify(safe).includes(secret));
 assert(safe.native_phases.validation_errors.includes('UNSUPPORTED_PHASE_LABEL'));
});

test('Mahjong admission and worker spans retain bounded per-operation totals and distinct invocation counts',()=>{
 const name='mahjong-wild';
 const measured=count=>{
  const health=nativeHealth(count),operation=health.native_phases.operations.state;
  health.native_phases.operations={spin_new:operation};
  for(const [phase,us,invocations,maxInvocation]of [
   ['dispatch_to_worker',61,1,61],['dispatch_to_admission',11,1,11],
   ['admission_wait',20,1,20],['admission_to_worker',30,1,30],
   ['ticket_read',35,2,20],['manifest_prepare',60,3,25],
  ])operation.phases[phase]={operations:count,invocations:count*invocations,total_us:count*us,max_operation_us:us,max_invocation_us:maxInvocation,buckets:PHASE_BUCKETS.map((_,i)=>i===0?count:0)};
  return health;
 };
 const result=compareGameplayBoundaries(wrap(measured(1),name),wrap(measured(4),name,later)).services[name];
 assert.equal(result.comparable,true,JSON.stringify(result));
 const phases=result.delta.operations.spin_new.phases;
 assert.equal(phases.dispatch_to_worker.total_us,183);
 assert.equal(phases.dispatch_to_admission.total_us,33);
 assert.equal(phases.admission_wait.total_us,60);
 assert.equal(phases.admission_to_worker.total_us,90);
 assert.equal(phases.ticket_read.operations,3);assert.equal(phases.ticket_read.invocations,6);assert.equal(phases.ticket_read.total_us,105);
 assert.equal(phases.manifest_prepare.operations,3);assert.equal(phases.manifest_prepare.invocations,9);assert.equal(phases.manifest_prepare.total_us,180);
 for(const phase of Object.values(phases)){assert.equal(phase.max_operation_us,undefined);assert.equal(phase.max_invocation_us,undefined);}
 const legacy=compareGameplayBoundaries(wrap(nativeHealth(1),name),wrap(nativeHealth(4),name,later)).services[name];
 assert.equal(legacy.comparable,true);assert.equal(legacy.delta.operations.state.phases.ticket_read,undefined);assert.equal(legacy.delta.operations.state.phases.manifest_prepare,undefined);assert.equal(legacy.delta.operations.state.phases.admission_wait,undefined);
 const invalid=measured(4);invalid.native_phases.operations.spin_new.phases.manifest_prepare.invocations=3;
 const bad=compareGameplayBoundaries(wrap(measured(1),name),wrap(invalid,name,later)).services[name];
 assert.equal(bad.comparable,false);assert(bad.errors.includes('INVALID_PHASE_SNAPSHOT'));assert.equal(bad.delta,undefined);
 const secret='PRIVATE_TICKET_OR_ASSET',untrusted=measured(1);
 untrusted.native_phases.operations.spin_new.phases.ticket_read.ticket_id=secret;
 untrusted.native_phases.operations.spin_new.phases.manifest_prepare.assets=Array(10000).fill(secret);
 untrusted.native_phases.operations.spin_new.phases[secret]={path:secret};
 const safe=sanitizeDiagnosticHealth(untrusted,name);assert(!JSON.stringify(safe).includes(secret));
 assert(safe.native_phases.validation_errors.includes('UNSUPPORTED_PHASE_LABEL'));
 assert.equal(DIAGNOSTIC_LIMITS.response_bytes,262144);
});

test('Mahjong registry continuity enables deltas while replacement, reset and unavailable telemetry remain blocked',()=>{
 const name='mahjong-wild',before=wrap(nativeHealth(1),name),after=wrap(nativeHealth(3),name,later);
 const valid=compareGameplayBoundaries(before,after).services[name];
 assert.equal(valid.comparable,true);assert.equal(valid.delta.completed_operations,2);
 for(const [error,change]of [
  ['REGISTRY_ID_NOT_EXPOSED',v=>v.native_phases.registry_id=null],
  ['REGISTRY_ID_CHANGED',v=>v.native_phases.registry_id='ffffffff-ffff-ffff-ffff-ffffffffffff'],
  ['RESET_IDENTITY_UNVERIFIED',v=>v.native_phases.reset_count=1],
  ['PROCESS_CHANGED_OR_MISSING',v=>v.process_boot_id='replacement-process'],
  ['SOURCE_CHANGED_OR_MISSING',v=>v.source_commit='b'.repeat(40)],
  ['TELEMETRY_ERROR',v=>v.native_phases.telemetry_error=true],
  ['ACTIVE_CAPTURES_AT_BOUNDARY',v=>v.native_phases.active_captures=1],
  ['INTERVAL_TELEMETRY_LOSS',v=>v.native_phases.dropped_captures=1],
 ]){
  const changed=structuredClone(after);change(changed.services[name]);
  const result=compareGameplayBoundaries(before,changed).services[name];
  assert.equal(result.comparable,false,error);assert(result.errors.includes(error),JSON.stringify(result));assert.equal(result.delta,undefined);
 }
 const unavailable=nativeHealth(3);unavailable.native_phases.available=false;
 const result=compareGameplayBoundaries(before,wrap(unavailable,name,later)).services[name];
 assert.equal(result.comparable,false);assert(result.errors.includes('INVALID_PHASE_SNAPSHOT'));assert.equal(result.delta,undefined);
});

test('whitelist discards secret values, dynamic labels, huge fields and invalid numbers with fixed output size',()=>{
 const health=nativeHealth(1),secret='DO_NOT_RETAIN_SECRET';
 health.password=secret;health.sessions=Array(10000).fill(secret);health.identity.cookie=secret;
 health.native_phases.operations.state.phases.callback_status.token=secret;
 health.native_phases.operations.state.counters.player=secret;
 health.callback_transport={requests:7,failures:Infinity,pool_limit:40,secret,origins:{[secret]:{token:secret}}};
 health.anyio_thread_limiter={total_tokens:40,borrowed_tokens:0,tasks_waiting:0,borrowers:[secret]};
 health.native_phases.operations[secret]={body:secret};
 const safe=sanitizeDiagnosticHealth(health,'uno-luck'),encoded=JSON.stringify(safe);
 assert(!encoded.includes(secret));assert(encoded.length<10000);assert.equal(safe.callback_transport.requests,7);assert.equal(safe.callback_transport.failures,null);assert.equal(safe.anyio_thread_limiter.borrowers,undefined);
 assert(safe.native_phases.validation_errors.includes('UNSUPPORTED_OPERATION_LABEL'));
 health.native_phases.operations.state.phases.callback_status.buckets=Array(100000).fill(1);
 const oversized=sanitizeDiagnosticHealth(health,'uno-luck');assert.equal(oversized.native_phases.operations.state.phases.callback_status.buckets,null);assert(JSON.stringify(oversized).length<10000);
});

test('bounded public health fetch uses five fixed targets, no credentials or redirects, and cancels oversized streams',async()=>{
 const config={core_url:'https://core.fixture',wallet_url:'https://wallet.fixture',engine_origins:{'uno-luck':'https://uno.fixture','mahjong-wild':'https://mahjong.fixture','skygate-5000':'https://skygate.fixture','untrusted-dynamic-target':'https://forbidden.fixture'}},seen=[];let cancelled=false;
 const result=await captureGameplayBoundary(config,{}, {fetchImpl:async(url,options)=>{
  seen.push(url);assert.deepEqual(options.headers,{accept:'application/json','cache-control':'no-cache'});assert.equal(options.redirect,'error');assert(options.signal);assert.equal(options.method,'GET');
  if(url.includes('core.fixture'))return new Response(JSON.stringify({...base,secret:'DO_NOT_RETAIN'}));
  if(url.includes('wallet.fixture'))return new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(DIAGNOSTIC_LIMITS.response_bytes+1));},cancel(){cancelled=true;}}));
  if(url.includes('uno.fixture'))return new Response('not JSON');
  if(url.includes('mahjong.fixture'))throw Error('https://private.invalid?token=DO_NOT_RETAIN');
  return new Response('DO_NOT_RETAIN',{status:503});
 }});
 assert.equal(seen.length,5);assert(seen.every(url=>!url.includes('forbidden')));assert.equal(cancelled,true);
 assert.equal(result.services.wallet.error,'RESPONSE_TOO_LARGE');assert.equal(result.services['uno-luck'].error,'INVALID_HEALTH_JSON');assert.equal(result.services['mahjong-wild'].error,'DIAGNOSTIC_UNAVAILABLE');assert.equal(result.services['skygate-5000'].http_status,503);
 assert(!JSON.stringify(result).includes('DO_NOT_RETAIN'));assert(!JSON.stringify(result).includes('private.invalid'));
});

async function listen(handler,t){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));return 'http://127.0.0.1:'+server.address().port;}
const send=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};

test('real HTTP load fixture captures after setup and before reconciliation without changing workload or qualification gates',async t=>{
 const events=[],healthCounts={core:0,native:0,wallet:0};let nativeOrigin;
 const health=(kind,res)=>{events.push(kind+':health'+(++healthCounts[kind]));send(res,{...base,identity:{...base.identity,deployment_id:kind+'-fixture-identity'}});};
 const wallet=await listen((req,res)=>{assert.equal(req.url,'/health');health('wallet',res);},t);
 const core=await listen((req,res)=>{
  const u=new URL(req.url,'http://fixture');if(u.pathname==='/health')return health('core',res);
  events.push(u.pathname);
  if(u.pathname==='/v1/game-launches')return send(res,{environment:'preproduction',session_id:'ss_fixture',launch_url:nativeOrigin+'/#softtech_launch=private-fixture-token'});
  if(u.pathname==='/v1/transactions')return send(res,{data:[['debit','-100'],['credit','0']].map(([kind,amount_minor])=>({id:'receipt-'+kind,round_id:'rd_fixture',session_id:'ss_fixture',kind,amount_minor,currency:'VCOIN',scale:2}))});
  if(u.pathname==='/v1/reconciliation')return send(res,{status:'matched'});
  if(u.pathname==='/v1/sessions/ss_fixture/revoke')return send(res,{revoked:true});
  res.statusCode=404;send(res,{});
 },t);
 nativeOrigin=await listen((req,res)=>{
  if(req.url==='/health')return health('native',res);events.push(req.url);
  if(req.url==='/api/agency/launch'){res.setHeader('set-cookie','fixture_session=private-fixture-cookie; Path=/');return send(res,{ok:true});}
  assert.equal(req.headers.cookie,'fixture_session=private-fixture-cookie');
  if(req.url==='/api/agency/state')return send(res,{rules:{stake_options:[25]}});
  if(req.url==='/api/agency/pick'){let text='';req.on('data',b=>text+=b);req.on('end',()=>{const p=JSON.parse(text);send(res,{round:{id:'native-round-fixture',complete:p.expected_phase===3,phase:p.expected_phase}});});return;}
  res.statusCode=404;send(res,{});
 },t);
 const report=await runNativeLoad({allow_small_test:true,allow_local:true,environment:'preproduction',core_audience:'fixture-core-identity',core_url:core,wallet_url:wallet,engine_origins:{'uno-luck':nativeOrigin},operator:{id:'op_qualification_fixture',key_id:'fixture-key',secret:'fixture-secret',protocol_version:2}},{concurrency:1,runId:'diagnostic-http-fixture'});
 assert.equal(report.status,'PARTIAL');assert.deepEqual(report.thresholds,{request_error_rate:0.01,round_p95_ms:10000});
 assert.deepEqual(report.gates,{concurrent_sessions:true,all_sessions_played:true,no_round_failures:true,exactly_once_reconciliation:true,duplicate_native_results:true,request_error_rate:true,round_latency:true,soak_duration:null,source_identity_stable:true,server_resource_ceilings:null});
 assert.equal(report.metrics.requests,9);assert.equal(report.completed_rounds,1);assert.deepEqual(report.cleanup,{sessions:1,revoked:1});
 assert.equal(events.filter(x=>x==='/api/agency/pick').length,4);assert.equal(events.filter(x=>x==='/api/agency/state').length,1);
 assert(events.indexOf('core:health2')>events.indexOf('/api/agency/launch'));assert(events.indexOf('core:health2')<events.indexOf('/api/agency/state'));
 assert(events.indexOf('core:health3')>events.lastIndexOf('/api/agency/pick'));assert(events.indexOf('core:health3')<events.indexOf('/v1/transactions'));assert(events.indexOf('core:health3')<events.indexOf('/v1/sessions/ss_fixture/revoke'));
 assert.equal(report.gameplay_diagnostics.comparison.services.core.comparable,false,'missing optional diagnostics cannot promote or fail a qualification gate');
 assert(!JSON.stringify(report.gameplay_diagnostics).includes('private-fixture'));
});

test('completion log is bounded aggregate-only evidence with exact failure gates and source/run binding',()=>{
 const secret='DO_NOT_LOG_SECRET',report={run_id:'preprod-diagnostic-run-load500',status:'FAIL',classification:'real_native_session_http_load',started_at:time,finished_at:later,requested_concurrent_sessions:500,established_sessions:500,completed_rounds:500,sessions_with_completed_rounds:500,actual_execution_seconds:11.2,
  runner:{source_commit:'a'.repeat(40),source_snapshot:{core:{source_commit:'b'.repeat(40),token:secret}}},
  round_latency:{count:500,p50_ms:7000,p95_ms:11136,p99_ms:12000,session:secret},round_latency_by_game:{'uno-luck':{count:167,p95_ms:11500},[secret]:{secret}},completed_by_game:{'uno-luck':167,[secret]:5},
  metrics:{request_error_rate:0},reconciliation:{status:'PASS',operator_id:secret},duplicate_results_verified:true,cleanup:{sessions:500,revoked:500,token:secret},gates:{round_latency:false,exactly_once_reconciliation:true,[secret]:true},sessions:Array(10000).fill(secret),failures:[{error:secret}]};
 const aggregate=completionAggregate(report,'load500'),encoded=JSON.stringify(aggregate);
 assert(encoded.length<4096);assert(!encoded.includes(secret));assert.equal(aggregate.round_latency.p95_ms,11136);assert.equal(aggregate.gates.round_latency,false);assert.equal(aggregate.status,'FAIL');assert.equal(aggregate.source_commit,'a'.repeat(40));assert.equal(aggregate.source_commits.core,'b'.repeat(40));assert.deepEqual(aggregate.cleanup,{sessions:500,revoked:500});assert.equal(aggregate.run_id,report.run_id);assert.equal(aggregate.finished_at,later);assert.equal(aggregate.reconciliation_passed,true);
 assert.equal(completionAggregate({...report,run_id:secret.repeat(100),status:secret,started_at:secret,round_latency:{p95_ms:Infinity}},secret).run_id,null);
 assert.equal(aggregate.core_game_attribution_comparable,false);
 const diagnostics={comparison:{services:{core:{comparable:true,game_attribution:{comparable:true,secret}}}}};
 const attributed=completionAggregate({...report,gameplay_diagnostics:diagnostics},'load500');
 assert.equal(attributed.core_game_attribution_comparable,true);assert.deepEqual(attributed.gates,aggregate.gates);assert(!JSON.stringify(attributed).includes(secret));
 diagnostics.comparison.services.core.comparable=false;
 assert.equal(completionAggregate({...report,gameplay_diagnostics:diagnostics},'load500').core_game_attribution_comparable,false);
});
