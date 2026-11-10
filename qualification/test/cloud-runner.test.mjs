import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCloudRunner,fixedPlan} from '../cloud-runner.mjs';
const config={environment:'preproduction',core_audience:'fixture-core-audience',core_url:'https://core.invalid',wallet_url:'https://wallet.invalid',wallet_admin_token:'wallet-admin-fixture-'.repeat(4),operator:{id:'op_qualification_fixture',protocol_version:2,secret:'operator-fixture-secret-'.repeat(4),wallet_secret:'wallet-fixture-secret-'.repeat(4)},engine_origins:{'uno-luck':'https://uno.invalid','mahjong-wild':'https://mahjong.invalid','skygate-5000':'https://skygate.invalid'}};
const env=dir=>({QUALIFICATION_CONFIG_JSON:JSON.stringify(config),RUNNER_READ_TOKEN:'runner-reader-fixture-'.repeat(4),SOURCE_COMMIT:'a'.repeat(40),QUALIFICATION_RUNNER_ID:'runner-fixture-identity',RUNNER_DATA_DIR:dir});
const snapshot=async()=>Object.fromEntries(['core','wallet','uno','mahjong','skygate'].map(name=>[name,{source_commit:'b'.repeat(40),deployment_id:name+'-fixture',environment:'preproduction'}]));
const report=options=>({schema_version:1,run_id:options.runId,classification:'unit_test_fixture_not_live_evidence',status:'PARTIAL',completed_rounds:options.concurrency,gates:{concurrent_sessions:true,all_sessions_played:true,no_round_failures:true,exactly_once_reconciliation:true,duplicate_native_results:true,request_error_rate:true,round_latency:true,soak_duration:options.durationSeconds?true:null,server_resource_ceilings:null}});
async function startHttp(runner){await new Promise(resolve=>runner.server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+runner.server.address().port;}
async function close(runner){runner.server.closeAllConnections();await new Promise(r=>runner.server.close(r));}
test('nonsecret transport override binds effective configuration, health and immutable plan without rewriting protected JSON',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'runner-transport-override-')),e={...env(dir),QUALIFICATION_RUN_ID:'unit-transport-override',QUALIFICATION_PLAN:'baseline500',QUALIFICATION_NATIVE_TRANSPORT:'per_user_https'},original=e.QUALIFICATION_CONFIG_JSON,calls=[];
 const run=async(c,o)=>{calls.push({transport:c.native_transport,setup:o.setupConcurrency,sessions:o.concurrency,think:o.thinkTimeMs,recovery:o.recoveryRetries});return report(o);};let runner;
 try{runner=createCloudRunner({env:e,run,snapshot});const url=await startHttp(runner),health=await(await fetch(url+'/health')).json();assert.equal(health.native_transport,'per_user_https');assert.equal(health.config_fingerprint,runner.getState().config_fingerprint);assert.equal(JSON.stringify(health).includes(config.operator.secret),false);assert.equal((await runner.start()).status,'PARTIAL');assert.deepEqual(calls,[{transport:'per_user_https',setup:40,sessions:500,think:1000,recovery:0}]);assert.equal(e.QUALIFICATION_CONFIG_JSON,original);
  const saved=JSON.parse(readFileSync(path.join(dir,'reports','unit-transport-override-load500.json'),'utf8'));assert.equal(saved.runner.native_transport,'per_user_https');assert.equal(saved.runner.config_fingerprint,health.config_fingerprint);assert.equal(saved.runner.plan_hash,runner.getState().plan_hash);
  assert.throws(()=>createCloudRunner({env:{...e,QUALIFICATION_NATIVE_TRANSPORT:'shared_fetch'},run,snapshot}),/MISMATCH_USE_NEW_RUN_ID/);
  for(const value of ['', 'unverified', 'https://invalid'])assert.throws(()=>createCloudRunner({env:{...e,QUALIFICATION_NATIVE_TRANSPORT:value}}),/INVALID_NATIVE_TRANSPORT/);
  const idle=createCloudRunner({env:{...env(dir),QUALIFICATION_NATIVE_TRANSPORT:'shared_fetch'}});assert.notEqual(idle.getState().config_fingerprint,runner.getState().config_fingerprint);
 }finally{if(runner)await close(runner);rmSync(dir,{recursive:true,force:true});}
});
test('runner stays idle without run ID, protects reports, and exposes no execution endpoint',async()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'runner-idle-'));let called=0;const e=env(dir),runner=createCloudRunner({env:e,run:async()=>{called++;},snapshot}),url=await startHttp(runner);try{await runner.start();assert.equal(called,0);const health=await(await fetch(url+'/health')).json();assert.equal(health.status,'IDLE');assert.equal(JSON.stringify(health).includes(config.operator.secret),false);assert.equal((await fetch(url+'/reports')).status,401);assert.equal((await fetch(url+'/reports',{headers:{authorization:'Bearer '+e.RUNNER_READ_TOKEN}})).status,200);assert.equal((await fetch(url+'/run',{method:'POST',body:'arbitrary code'})).status,405);}finally{await close(runner);rmSync(dir,{recursive:true,force:true});}});
test('fixed plan executes500 then1000 then one-hour soak and resumes completed reports without replay',async()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'runner-resume-')),e={...env(dir),QUALIFICATION_RUN_ID:'unit-fixture-plan'},calls=[];const run=async(_c,o)=>{calls.push({sessions:o.concurrency,duration:o.durationSeconds});return report(o);};let runner=createCloudRunner({env:e,run,snapshot});try{const result=await runner.start();assert.equal(result.status,'PARTIAL');assert.deepEqual(calls,[{sessions:500,duration:0},{sessions:1000,duration:0},{sessions:500,duration:3600}]);runner=createCloudRunner({env:e,run,snapshot});assert.equal((await runner.start()).status,'PARTIAL');assert.equal(calls.length,3);assert.throws(()=>createCloudRunner({env:{...e,SOURCE_COMMIT:'c'.repeat(40)},run,snapshot}),/MISMATCH_USE_NEW_RUN_ID/);}finally{rmSync(dir,{recursive:true,force:true});}});
test('failed500 stops before1000/soak and is not retried under the same run ID',async()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'runner-fail-')),e={...env(dir),QUALIFICATION_RUN_ID:'unit-fixture-failure'};let calls=0;const run=async(_c,o)=>{calls++;const r=report(o);r.status='FAIL';r.gates.round_latency=false;return r;};try{let runner=createCloudRunner({env:e,run,snapshot});assert.equal((await runner.start()).status,'FAIL');assert.equal(calls,1);runner=createCloudRunner({env:e,run,snapshot});assert.equal((await runner.start()).status,'FAIL');assert.equal(calls,1);}finally{rmSync(dir,{recursive:true,force:true});}});
test('production config, absent Railway volume and changed target source cannot resume',async()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'runner-binding-')),e={...env(dir),QUALIFICATION_RUN_ID:'unit-fixture-binding'};try{assert.throws(()=>createCloudRunner({env:{...e,QUALIFICATION_CONFIG_JSON:JSON.stringify({...config,environment:'production'})}}),/PREPRODUCTION/);assert.throws(()=>createCloudRunner({env:{...e,RAILWAY_SERVICE_ID:'railway-fixture-id'}}),/VOLUME_REQUIRED/);const first=createCloudRunner({env:e,run:async(_c,o)=>report(o),snapshot});await first.start();const changed=createCloudRunner({env:e,run:async()=>{throw Error('Must not run');},snapshot:async()=>({...await snapshot(),uno:{source_commit:'c'.repeat(40),deployment_id:'uno-fixture'}})});assert.equal((await changed.start()).status,'FAIL');assert.match(changed.getState().error,/SOURCE_CHANGED_BEFORE_RESUME_uno/);assert.deepEqual(fixedPlan({...e,QUALIFICATION_PLAN:'baseline500'}).map(s=>s.sessions),[500]);}finally{rmSync(dir,{recursive:true,force:true});}});
test('fixed wallet plan exposes pending restart and verifies actual process change before PASS',async()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'runner-wallet-plan-')),e={...env(dir),QUALIFICATION_RUN_ID:'unit-wallet-plan',QUALIFICATION_PLAN:'wallet_conformance'};let runner,requests=0,observedWaiting=false;const identity={environment:'preproduction',deployment_id:'wallet-fixture',core_audience:config.core_audience};const healthRequest=async()=>{requests++;if(requests>1)observedWaiting=runner.getState().waiting_restart?.target==='wallet';return {ok:true,status:200,data:{ok:true,process_boot_id:requests===1?'old-process':'new-process',source_commit:'b'.repeat(40),identity}};};try{runner=createCloudRunner({env:e,snapshot,healthRequest,run:async()=>{throw Error('Load must not execute');},walletRun:async(_c,o)=>{const proof=await o.restart();assert.equal(proof.process_boot_id_before,'old-process');assert.equal(proof.process_boot_id_after,'new-process');return {schema_version:1,run_id:o.runId,status:'PASS',classification:'unit_test_fixture_not_live_evidence',external_operator_certified:false,cases:Array.from({length:17},(_,i)=>({name:'fixture-'+i,status:'PASS'}))};}});assert.equal((await runner.start()).status,'PASS');assert.equal(observedWaiting,true);assert.equal(runner.getState().waiting_restart,undefined);assert.deepEqual(fixedPlan(e).map(s=>s.kind),['wallet_conformance']);}finally{rmSync(dir,{recursive:true,force:true});}});
test('fixed native chaos plan cannot pass when restart changes deployment identity',async()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'runner-chaos-plan-')),e={...env(dir),QUALIFICATION_RUN_ID:'unit-chaos-plan',QUALIFICATION_PLAN:'network_restart'};let requests=0;const healthRequest=async()=>({ok:true,status:200,data:{ok:true,process_boot_id:++requests===1?'old':'new',source_commit:'b'.repeat(40),identity:{environment:'preproduction',deployment_id:requests===1?'wallet-fixture':'wrong-wallet',core_audience:config.core_audience}}});try{const runner=createCloudRunner({env:e,snapshot,healthRequest,chaosRun:async(c,o)=>{await o.restart(c,'wallet',c.wallet_url);throw Error('Should reject identity change');}});assert.equal((await runner.start()).status,'FAIL');assert.match(runner.getState().error,/IDENTITY_CHANGED_DURING_RESTART/);assert.deepEqual(fixedPlan(e).map(s=>s.kind),['network_restart']);}finally{rmSync(dir,{recursive:true,force:true});}});
test('capacity and soak-only remain separate fixed plans with a hardcoded one-hour duration',()=>{const capacity=fixedPlan({QUALIFICATION_PLAN:'capacity'}),soak=fixedPlan({QUALIFICATION_PLAN:'soak_only',QUALIFICATION_SOAK_SESSIONS:'1000'});assert.deepEqual(capacity.map(s=>[s.sessions,s.duration_seconds]),[[500,0],[1000,0]]);assert.deepEqual(soak.map(s=>[s.sessions,s.duration_seconds,s.min_soak_seconds]),[[1000,3600,3600]]);});
test('load1000-only selects exactly the existing fixed thousand-session step',()=>{
 const expected=[{id:'load1000',sessions:1000,duration_seconds:0,rounds:1}];
 assert.deepEqual(fixedPlan({QUALIFICATION_PLAN:'load1000_only'}),expected);
 assert.deepEqual(fixedPlan({QUALIFICATION_PLAN:'load1000_only',QUALIFICATION_SOAK_SESSIONS:'1000'}),expected);
 assert.deepEqual(fixedPlan({QUALIFICATION_PLAN:'baseline500'}).map(s=>s.id),['load500']);
 assert.deepEqual(fixedPlan({QUALIFICATION_PLAN:'capacity'}).map(s=>s.id),['load500','load1000']);
 assert.deepEqual(fixedPlan({}).map(s=>s.id),['load500','load1000','soak60m']);
 for(const mode of ['load1000','capacity1000_only','load2000_only'])assert.throws(()=>fixedPlan({QUALIFICATION_PLAN:mode}),/UNKNOWN_FIXED_PLAN/);
});
test('declared load1000-only runs once with unchanged transport/options and stops for independent resources',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'runner-1000-only-'));
 const idleEnv={...env(dir),QUALIFICATION_PLAN:'load1000_only',QUALIFICATION_NATIVE_TRANSPORT:'per_user_https'},calls=[];
 const run=async(c,o)=>{calls.push({transport:c.native_transport,sessions:o.concurrency,rounds:o.roundsPerSession,duration:o.durationSeconds,minSoak:o.minSoakSeconds,setup:o.setupConcurrency,think:o.thinkTimeMs,recovery:o.recoveryRetries});return report(o);};
 try{
  const idle=createCloudRunner({env:idleEnv,run,snapshot});await idle.start();assert.equal(idle.getState().status,'IDLE');assert.equal(calls.length,0);
  const e={...idleEnv,QUALIFICATION_RUN_ID:'unit-1000-only'},runner=createCloudRunner({env:e,run,snapshot});
  const result=await runner.start();
  assert.equal(result.status,'PARTIAL');assert.equal(result.active_step,null);
  assert.deepEqual(calls,[{transport:'per_user_https',sessions:1000,rounds:1,duration:0,minSoak:3600,setup:40,think:1000,recovery:0}]);
  assert.deepEqual(result.steps.map(s=>s.id),['load1000']);
  const reportPath=path.join(dir,'reports','unit-1000-only-load1000.json'),original=readFileSync(reportPath,'utf8'),saved=JSON.parse(original);
  assert.equal(saved.status,'PARTIAL');assert.equal(saved.gates.server_resource_ceilings,null);
  assert.equal(saved.runner.step_id,'load1000');assert.equal(saved.runner.plan_hash,result.plan_hash);
  assert.equal(saved.runner.config_fingerprint,result.config_fingerprint);assert.deepEqual(saved.runner.source_snapshot,await snapshot());
  assert.deepEqual(readdirSync(path.join(dir,'reports')).sort(),['unit-1000-only-load1000.json','unit-1000-only-plan.json']);
  const resumed=createCloudRunner({env:e,run,snapshot});assert.equal((await resumed.start()).status,'PARTIAL');
  assert.equal(calls.length,1);assert.equal(resumed.getState().steps[0].resumed_completed_report,true);
  assert.equal(readFileSync(reportPath,'utf8'),original);
  assert.throws(()=>createCloudRunner({env:{...e,QUALIFICATION_PLAN:'capacity'},run,snapshot}),/MISMATCH_USE_NEW_RUN_ID/);
  assert.throws(()=>createCloudRunner({env:{...e,SOURCE_COMMIT:'c'.repeat(40)},run,snapshot}),/MISMATCH_USE_NEW_RUN_ID/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('failed load1000-only remains terminal without retry, a preceding 500, or automatic soak',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'runner-1000-failure-')),e={...env(dir),QUALIFICATION_PLAN:'load1000_only',QUALIFICATION_RUN_ID:'unit-1000-failure'};
 let calls=0;const run=async(_c,o)=>{calls++;assert.equal(o.concurrency,1000);const result=report(o);result.status='FAIL';result.gates.round_latency=false;return result;};
 try{
  const first=createCloudRunner({env:e,run,snapshot});assert.equal((await first.start()).status,'FAIL');assert.equal(calls,1);
  assert.match(first.getState().error,/QUALIFICATION_STEP_FAILED_load1000/);
  const reportPath=path.join(dir,'reports','unit-1000-failure-load1000.json'),original=readFileSync(reportPath,'utf8');
  const resumed=createCloudRunner({env:e,run,snapshot});assert.equal((await resumed.start()).status,'FAIL');assert.equal(calls,1);
  assert.match(resumed.getState().error,/PREVIOUS_STEP_DID_NOT_PASS_USE_NEW_RUN_ID/);
  assert.equal(readFileSync(reportPath,'utf8'),original);
  assert.deepEqual(readdirSync(path.join(dir,'reports')).sort(),['unit-1000-failure-load1000.json','unit-1000-failure-plan.json']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('load1000-only still refuses a changed pinned target before any load execution',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'runner-1000-pins-')),sources=Object.fromEntries(['core','wallet','uno','mahjong','skygate'].map(name=>[name,'b'.repeat(40)]));
 const e={...env(dir),QUALIFICATION_PLAN:'load1000_only',QUALIFICATION_RUN_ID:'unit-1000-pins',QUALIFICATION_EXPECTED_SOURCES_JSON:JSON.stringify(sources)};
 let calls=0;
 try{
  const runner=createCloudRunner({env:e,run:async()=>{calls++;throw Error('Must not execute');},snapshot:async()=>({...await snapshot(),uno:{source_commit:'c'.repeat(40),deployment_id:'uno-fixture',environment:'preproduction'}})});
  assert.equal((await runner.start()).status,'FAIL');assert.equal(calls,0);
  assert.match(runner.getState().error,/EXPECTED_SOURCE_MISMATCH_uno/);
  assert.deepEqual(readdirSync(path.join(dir,'reports')),['unit-1000-pins-plan.json']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('volume plan exposes two distinct stages with ten-minute restore deadline and remains PARTIAL',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'runner-volume-plan-')),e={...env(dir),QUALIFICATION_RUN_ID:'unit-volume-plan',QUALIFICATION_PLAN:'volume_recovery'};let runner,requests=0;const stages=[];
 const healthRequest=async()=>{requests++;const waiting=runner?.getState().waiting_restart;if(waiting){stages.push(waiting.stage);assert.equal(Date.parse(waiting.deadline)-Date.parse(waiting.requested_at),waiting.stage==='volume_restore'?600000:300000);}return {ok:true,data:{ok:true,process_boot_id:'process-'+Math.ceil((requests+1)/2),source_commit:'b'.repeat(40),identity:{environment:'preproduction',deployment_id:'uno-fixture'}}};};
 try{runner=createCloudRunner({env:e,snapshot,healthRequest,volumeRun:async(c,o)=>{for(const stage of ['snapshot_restart','volume_restore'])await o.restart(c,'uno-luck',c.engine_origins['uno-luck'],{stage});return {run_id:o.runId,status:'PARTIAL',application_checks_passed:true,full_volume_recovery_certified:false,cases:Array.from({length:3},()=>({status:'PASS'})),reconciliation:{status:'PASS'}};}});assert.equal((await runner.start()).status,'PARTIAL');assert.deepEqual(stages,['snapshot_restart','volume_restore']);assert.deepEqual(fixedPlan(e).map(s=>s.kind),['volume_recovery']);}finally{rmSync(dir,{recursive:true,force:true});}
});
