/* Native full-volume exercise. A platform operator performs the actual storage
   replacement. Process changes alone never certify loss/restoration of a volume. */
import {pathToFileURL} from 'node:url';
import {args,readConfig,persist,adminCall,operatorCall,must,digest} from './client.mjs';
import {closeNativeSession,Metrics,establishSession,playRound,nativeCall,nativeOutcomeProof,reconcileRun} from './native-load.mjs';
import {requestPlatformRestart} from './native-chaos.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const gameNames=['uno-luck','mahjong-wild','skygate-5000'];
export async function runVolumeRecovery(config,{reportFile,controlFile,runId='volume-recovery-'+Date.now(),restart=requestPlatformRestart,adapters={}}={}){
 must(config.environment==='preproduction'||config.allow_local===true,'ISOLATED_PREPRODUCTION_REQUIRED');
 const api={establishSession,playRound,nativeCall,adminCall,operatorCall,reconcileRun,sleep,...adapters};
 const report={schema_version:1,run_id:runId,classification:'native_volume_restore_application_checks',environment:config.environment,core_audience:config.core_audience,started_at:new Date().toISOString(),status:'RUNNING',cases:[],platform_volume_evidence:null,full_volume_recovery_certified:false,external_operator_certified:false},metrics=new Metrics(),contexts=[];
 const save=()=>{if(reportFile)persist(reportFile,report);};save();
 try{
  for(let i=0;i<gameNames.length;i++){
   const ctx=await api.establishSession(config,i,runId,{metrics,game_id:gameNames[i]});contexts.push(ctx);
   const baseline=await api.playRound(ctx,{metrics});const completed=structuredClone(ctx.last_completed_request);must(completed?.outcome_sha256&&completed?.payload,'COMPLETED_REPLAY_REQUEST_MISSING');
   const arm=await api.adminCall(config,'/admin/faults',{operator_id:config.operator.id,action:'credit',kind:'network_partition',count:10000});must(arm.ok,'PENDING_CREDIT_BARRIER_NOT_ARMED');
   let pendingError=null;try{await api.playRound(ctx,{metrics,recoveryRetries:0});}catch(e){pendingError=String(e.message).slice(0,120);}
   must(pendingError,'PENDING_ROUND_NOT_OBSERVED');const pending=structuredClone(ctx.last_round_request);must(pending?.payload&&JSON.stringify(pending)!==JSON.stringify({pathname:completed.pathname,payload:completed.payload}),'PENDING_REQUEST_NOT_CAPTURED');
   if(ctx.game_id==='uno-luck')must(pending.pathname==='/api/agency/pick'&&pending.payload.expected_phase===3,'UNO_PENDING_SETTLEMENT_REQUIRED');
   const inspectBarrier=async()=>{const r=await api.adminCall(config,'/admin/report',{operator_id:config.operator.id,limit:1,include_reconciliation:false});const f=r.data?.faults?.find(f=>f.id===arm.data.id);must(r.ok&&f?.remaining>0&&f.remaining<10000,'CREDIT_BARRIER_NOT_ACTIVE_OR_CONSUMED');return f.remaining;};
   await inspectBarrier();
   const snapshot=await restart(config,ctx.game_id,ctx.origin,{runId,controlFile,stage:'snapshot_restart',timeoutMs:300000});
   // Startup recovery and snapshot run concurrently. Keep the credit unavailable
   // until both restarts are observed, so the new snapshot retains pending work.
   await api.sleep(30000);const remainingBeforeRestore=await inspectBarrier();
   const restore=await restart(config,ctx.game_id,ctx.origin,{runId,controlFile,stage:'volume_restore',timeoutMs:600000});
   must(snapshot.status==='PASS'&&restore.status==='PASS'&&/^[a-f0-9]{40}$/.test(snapshot.source_commit||'')&&snapshot.source_commit===restore.source_commit,'SAME_SOURCE_RESTORE_REQUIRED');
   must(snapshot.process_boot_id_after===restore.process_boot_id_before&&restore.process_boot_id_before!==restore.process_boot_id_after,'RESTORE_PROCESS_CHAIN_MISMATCH');
   const remainingAfterRestore=await inspectBarrier();must((await api.adminCall(config,'/admin/faults/clear',{operator_id:config.operator.id})).ok,'CREDIT_BARRIER_CLEAR_FAILED');
   const recovered=await api.nativeCall(ctx,pending.pathname,pending.payload,{metrics,recoveryRetries:16}),recoveredProof=nativeOutcomeProof(ctx.game_id,recovered);
   const recoveredDuplicate=await api.nativeCall(ctx,pending.pathname,pending.payload,{metrics,recoveryRetries:4});must(nativeOutcomeProof(ctx.game_id,recoveredDuplicate).outcome_sha256===recoveredProof.outcome_sha256,'PENDING_OUTCOME_CHANGED_AFTER_RETRY');
   ctx.round_count=(ctx.round_count||0)+1;ctx.duplicate_verified_count=(ctx.duplicate_verified_count||0)+1;
   const replay=await api.nativeCall(ctx,completed.pathname,completed.payload,{metrics,recoveryRetries:4}),proof=nativeOutcomeProof(ctx.game_id,replay);
   must(proof.native_round_id===completed.native_round_id&&proof.outcome_sha256===completed.outcome_sha256,'PRE_EXISTING_OUTCOME_CHANGED_AFTER_RESTORE');
   report.cases.push({name:ctx.game_id+':same_session_pending_and_completed_round_restore',status:'PASS',session_id:ctx.session_id,baseline_native_round_id:baseline.native_round_id,completed_outcome_sha256:proof.outcome_sha256,pending_request_sha256:digest(JSON.stringify(pending)),recovered_native_round_id:recoveredProof.native_round_id,recovered_outcome_sha256:recoveredProof.outcome_sha256,initial_pending_error:pendingError,pending_request_replayed:true,pre_existing_completed_round_replayed:true,credit_barrier_remaining_before_restore:remainingBeforeRestore,credit_barrier_remaining_after_restore:remainingAfterRestore,snapshot_restart:snapshot,volume_restore_process:restore});save();
  }
  report.reconciliation=await api.reconcileRun(config,contexts,runId,{metrics});must(report.reconciliation.status==='PASS','VOLUME_RECOVERY_LEDGER_MISMATCH');
  report.application_checks_passed=true;report.status='PARTIAL';report.note='Application checks passed. Full-volume evidence still requires authoritative platform old/new volume IDs, snapshot object/hash, verified backup and restore logs, backup key IDs before/after, and measured recovery timing. A changed boot ID alone is insufficient.';
 }catch(e){report.status='FAIL';report.application_checks_passed=false;report.error=String(e.message).slice(0,200);}
 finally{
  try{await api.adminCall(config,'/admin/faults/clear',{operator_id:config.operator.id});}catch{}
  const cleanup=[];for(const ctx of contexts)try{const r=await api.operatorCall(config,'/v1/sessions/'+ctx.session_id+'/revoke',{});cleanup.push({session_id:ctx.session_id,revoked:r.ok});}catch{cleanup.push({session_id:ctx.session_id,revoked:false});}
  for(const ctx of contexts)closeNativeSession(ctx);report.cleanup=cleanup;report.metrics=metrics.summary();report.completed_native_rounds=contexts.reduce((n,c)=>n+(c.round_count||0),0);report.finished_at=new Date().toISOString();save();
 }
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const a=args();runVolumeRecovery(readConfig(a.config),{reportFile:a.report||'qualification/reports/volume-recovery.json',controlFile:a['control-file'],runId:a['run-id']}).then(r=>{console.log(JSON.stringify({status:r.status,application_checks_passed:r.application_checks_passed,full_volume_recovery_certified:false,cases:r.cases.length}));if(r.status==='FAIL')process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});}
