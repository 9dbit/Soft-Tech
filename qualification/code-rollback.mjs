/* Three-phase Skygate code rollback rehearsal. Platform changes are external.
   Private session material is never embedded in public evidence. */
import {readFileSync,existsSync,lstatSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {args,readConfig,persist,request,operatorCall,must,digest} from './client.mjs';
import {closeNativeSession,Metrics,establishSession,playRound,nativeCall,nativeOutcomeProof,reconcileRun} from './native-load.mjs';
const fullSha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const parse=(bytes,code)=>{try{return JSON.parse(bytes);}catch{throw Error(code);}};
function privatePath(file){
 must(typeof file==='string'&&path.isAbsolute(file),'ABSOLUTE_PRIVATE_STATE_PATH_REQUIRED');
 let dir=path.dirname(file);for(;;){must(!existsSync(path.join(dir,'.git')),'PRIVATE_STATE_MUST_BE_OUTSIDE_GIT');if(existsSync(dir))must(!lstatSync(dir).isSymbolicLink(),'PRIVATE_STATE_SYMLINK_FORBIDDEN');const parent=path.dirname(dir);if(parent===dir)break;dir=parent;}
 if(existsSync(file)){const s=lstatSync(file);must(!s.isSymbolicLink()&&s.isFile()&&(s.mode&0o077)===0,'PRIVATE_STATE_REQUIRES_REGULAR_0600_FILE');}
}
const binding=c=>digest(JSON.stringify({environment:c.environment,core_audience:c.core_audience,operator_id:c.operator?.id,key_id:c.operator?.key_id,core_url:c.core_url,wallet_url:c.wallet_url,origin:c.engine_origins?.['skygate-5000']}));
function readPlatformProof(file,expectedSha,health){
 const bytes=readFileSync(file),p=parse(bytes,'INVALID_PLATFORM_PROOF_JSON'),age=Date.now()-Date.parse(p.observed_at);
 must(p.classification==='railway_authoritative_code_rollback_target'&&p.environment==='preproduction'&&p.status==='SUCCESS','AUTHORITATIVE_SUCCESSFUL_PLATFORM_PROOF_REQUIRED');
 must(Number.isFinite(age)&&age>=-30000&&age<=15*60000,'FRESH_PLATFORM_PROOF_REQUIRED');
 for(const key of ['project_id','environment_id','service_id','volume_id','platform_deployment_id'])must(typeof p[key]==='string'&&p[key].length>=8,'PLATFORM_ID_REQUIRED_'+key);
 must(p.source_commit===expectedSha&&p.service_id===health.identity.deployment_id&&p.mount_path==='/data','PLATFORM_TARGET_SOURCE_OR_VOLUME_BINDING_MISMATCH');
 return {data:Object.fromEntries(['classification','observed_at','environment','status','project_id','environment_id','service_id','volume_id','mount_path','platform_deployment_id','source_commit'].map(k=>[k,p[k]])),sha256:digest(bytes)};
}
async function observe(config,expectedSha,api){
 const r=await api.request(config.engine_origins['skygate-5000']+'/health',{timeout:45000});must(r.ok&&r.data.ok===true,'SKYGATE_HEALTH_REQUIRED');
 const identity=r.data.deployment_identity||r.data.identity;
 must(identity?.identity_bound===true&&identity.environment==='preproduction'&&identity.game_id==='skygate-5000'&&identity.core_deployment_id===config.core_audience,'SKYGATE_IMMUTABLE_IDENTITY_MISMATCH');
 must(r.data.source_commit===expectedSha&&fullSha(expectedSha),'EXPECTED_SKYGATE_SOURCE_MISMATCH');must(typeof r.data.process_boot_id==='string'&&r.data.process_boot_id.length>=8,'ACTUAL_SKYGATE_BOOT_ID_REQUIRED');
 return {source_commit:r.data.source_commit,process_boot_id:r.data.process_boot_id,identity};
}
export async function runCodeRollbackPhase(config,{phase,privateStateFile,platformProofFile,reportFile,currentSource,rollbackSource,runId,adapters={}}={}){
 must(['prepare','after-rollback','after-forward'].includes(phase),'UNKNOWN_ROLLBACK_PHASE');
 must(config.environment==='preproduction'&&config.operator?.protocol_version===2&&config.operator.id.startsWith('op_qualification_'),'ISOLATED_V2_QUALIFICATION_REQUIRED');
 const origin=new URL(config.engine_origins?.['skygate-5000']);must(origin.protocol==='https:'&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash,'EXACT_HTTPS_NATIVE_ORIGIN_REQUIRED');
 privatePath(privateStateFile);must(typeof reportFile==='string'&&!existsSync(reportFile)&&path.resolve(reportFile)!==path.resolve(privateStateFile),'NEW_PUBLIC_REPORT_PATH_REQUIRED');
 const api={request,operatorCall,establishSession,playRound,nativeCall,reconcileRun,...adapters},metrics=new Metrics();let state;
 if(phase==='prepare'){
  must(!existsSync(privateStateFile),'PRIVATE_STATE_ALREADY_EXISTS');must(fullSha(currentSource)&&fullSha(rollbackSource)&&currentSource!==rollbackSource,'TWO_DISTINCT_FULL_SOURCE_SHAS_REQUIRED');must(typeof runId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{3,60}$/.test(runId),'RUN_ID_REQUIRED');
  state={schema_version:1,state_id:randomUUID(),run_id:runId,phase:'preparing',config_binding:binding(config),current_source:currentSource,rollback_source:rollbackSource,completed_requests:[],reports:[]};
 }else{
  must(existsSync(privateStateFile),'PREPARED_PRIVATE_STATE_REQUIRED');state=parse(readFileSync(privateStateFile,'utf8'),'INVALID_PRIVATE_STATE_JSON');
  must(state.schema_version===1&&state.config_binding===binding(config),'ROLLBACK_CONFIGURATION_CHANGED');must(state.phase===(phase==='after-rollback'?'prepared':'rollback_verified'),'ROLLBACK_PHASE_ORDER_OR_PRIOR_FAILURE');
 }
 const report={schema_version:1,classification:'live_native_code_rollback_phase',run_id:state.run_id,phase,started_at:new Date().toISOString(),status:'RUNNING',environment:config.environment,game_id:'skygate-5000',core_audience:config.core_audience,expected_source:phase==='after-rollback'?state.rollback_source:state.current_source,previous_reports:structuredClone(state.reports),full_rollback_completed:false,external_operator_certified:false};
 const savePrivate=()=>{mkdirSync(path.dirname(privateStateFile),{recursive:true,mode:0o700});persist(privateStateFile,state);};
 try{
  const before=await observe(config,report.expected_source,api),platform=readPlatformProof(platformProofFile,report.expected_source,before);report.health_before=before;report.platform_proof={sha256:platform.sha256,...platform.data};
  if(phase!=='prepare'){
   must(JSON.stringify(before.identity)===JSON.stringify(state.identity),'IMMUTABLE_IDENTITY_CHANGED_DURING_CODE_ROLLBACK');
   for(const k of ['project_id','environment_id','service_id','volume_id','mount_path'])must(platform.data[k]===state.initial_platform[k],'PLATFORM_TOPOLOGY_CHANGED_'+k);
   must(before.process_boot_id!==state.last_boot_id&&platform.data.platform_deployment_id!==state.last_platform_deployment_id,'ACTUAL_CODE_DEPLOYMENT_CHANGE_REQUIRED');
  }else{state.identity=before.identity;state.initial_platform=platform.data;savePrivate();}
  if(phase==='prepare'){
   state.context=await api.establishSession(config,0,state.run_id,{metrics,game_id:'skygate-5000'});savePrivate();
   await api.playRound(state.context,{metrics,recoveryRetries:0});must(state.context.last_completed_request,'COMPLETED_NATIVE_REPLAY_REQUEST_REQUIRED');state.completed_requests.push(structuredClone(state.context.last_completed_request));savePrivate();
  }else{
   report.replayed=[];
   for(const saved of state.completed_requests){const result=await api.nativeCall(state.context,saved.pathname,saved.payload,{metrics,recoveryRetries:0,timeout:45000}),proof=nativeOutcomeProof('skygate-5000',result);must(proof.native_round_id===saved.native_round_id&&proof.outcome_sha256===saved.outcome_sha256,'PRE_EXISTING_NATIVE_OUTCOME_CHANGED');report.replayed.push(proof);}
   if(phase==='after-rollback'){await api.playRound(state.context,{metrics,recoveryRetries:0});state.completed_requests.push(structuredClone(state.context.last_completed_request));savePrivate();}
   else{
    must(state.completed_requests.length===2&&state.context.round_count===2,'TWO_ACTUAL_ROLLBACK_ROUNDS_REQUIRED');
    report.reconciliation=await api.reconcileRun(config,[state.context],state.run_id,{metrics});must(report.reconciliation.status==='PASS'&&report.reconciliation.provider_rounds===2&&report.reconciliation.provider_ledger_entries===4&&report.reconciliation.wallet?.run_transactions===4,'ROLLBACK_LEDGER_MISMATCH');
    const revoked=await api.operatorCall(config,'/v1/sessions/'+state.context.session_id+'/revoke',{});must(revoked.ok,'FINAL_SESSION_REVOCATION_FAILED');report.session_revoked=true;
   }
  }
  const after=await observe(config,report.expected_source,api);must(JSON.stringify(before)===JSON.stringify(after),'SOURCE_IDENTITY_OR_PROCESS_CHANGED_WITHIN_PHASE');report.health_after=after;
  report.session_id=state.context.session_id;report.completed_native_rounds=state.context.round_count;report.completed_outcomes=state.completed_requests.map(({native_round_id,outcome_sha256})=>({native_round_id,outcome_sha256}));
  state.phase=phase==='prepare'?'prepared':phase==='after-rollback'?'rollback_verified':'complete';state.last_boot_id=after.process_boot_id;state.last_platform_deployment_id=platform.data.platform_deployment_id;
  report.status='PASS';report.full_rollback_completed=phase==='after-forward';
 }catch(e){report.status='FAIL';report.error=String(e.message).slice(0,180);state.phase='failed';if(state.context){state.failed_context_preserved=true;report.session_id=state.context.session_id;}}
 finally{closeNativeSession(state.context);report.metrics=metrics.summary();report.finished_at=new Date().toISOString();persist(reportFile,report);state.reports.push({phase,file:path.basename(reportFile),sha256:digest(readFileSync(reportFile))});savePrivate();}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const a=args();runCodeRollbackPhase(readConfig(a.config),{phase:a.phase,privateStateFile:a['private-state'],platformProofFile:a['platform-proof'],reportFile:a.report,currentSource:a['current-source'],rollbackSource:a['rollback-source'],runId:a['run-id']}).then(r=>{console.log(JSON.stringify({status:r.status,phase:r.phase,run_id:r.run_id,full_rollback_completed:r.full_rollback_completed,error:r.error||null}));if(r.status!=='PASS')process.exitCode=1;}).catch(e=>{console.error(String(e.message));process.exitCode=1;});}
