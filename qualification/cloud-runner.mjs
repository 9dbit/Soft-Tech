/* Dedicated, fixed-plan preproduction load generator. No job execution API.
   A run starts only from protected deployment configuration; reports are read-only. */
import http from 'node:http';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {persist,request} from './client.mjs';
import {runNativeLoad} from './native-load.mjs';
import {completionAggregate} from './gameplay-diagnostics.mjs';
import {runWalletConformance} from './wallet-conformance.mjs';
import {runNativeChaos} from './native-chaos.mjs';
import {runVolumeRecovery} from './volume-recovery.mjs';
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const equal=(a,b)=>timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
const need=(ok,code)=>{if(!ok)throw Error(code);};
const parse=(s,code)=>{try{return JSON.parse(s);}catch{throw Error(code);}};
const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{3,80}$/.test(id);
function configFromEnvironment(env){
 const c=parse(env.QUALIFICATION_CONFIG_JSON||'','INVALID_QUALIFICATION_CONFIG');
 need(c.environment==='preproduction'&&c.operator?.protocol_version===2&&c.operator?.id?.startsWith('op_qualification_'),'PREPRODUCTION_V2_QUALIFICATION_ONLY');
 need(typeof c.core_audience==='string'&&c.core_audience.length>=8,'CORE_AUDIENCE_REQUIRED');
 for(const secret of [c.operator.secret,c.operator.wallet_secret,c.wallet_admin_token])need(typeof secret==='string'&&secret.length>=40,'PROTECTED_CREDENTIALS_REQUIRED');
 for(const key of ['uno-luck','mahjong-wild','skygate-5000'])need(typeof c.engine_origins?.[key]==='string','ALL_THREE_ENGINE_ORIGINS_REQUIRED');
 for(const origin of [c.core_url,c.wallet_url,...Object.values(c.engine_origins)]){let u;try{u=new URL(origin);}catch{throw Error('INVALID_QUALIFICATION_ORIGIN');}need(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/','HTTPS_ORIGIN_REQUIRED');}
 const nativeTransport=env.QUALIFICATION_NATIVE_TRANSPORT??c.native_transport??'shared_fetch';
 need(['shared_fetch','per_user_https'].includes(nativeTransport),'INVALID_NATIVE_TRANSPORT');
 if(c.native_transport!==undefined)need(['shared_fetch','per_user_https'].includes(c.native_transport),'INVALID_CONFIG_NATIVE_TRANSPORT');
 return {...c,native_transport:nativeTransport,allow_local:false,allow_small_test:false};
}
export function fixedPlan(env){
 const mode=env.QUALIFICATION_PLAN||'standard';need(['standard','capacity','soak_only','baseline500','wallet_conformance','network_restart','volume_recovery'].includes(mode),'UNKNOWN_FIXED_PLAN');
 if(mode==='wallet_conformance')return [{id:'wallet-conformance',kind:'wallet_conformance'}];
 if(mode==='network_restart')return [{id:'network-restart',kind:'network_restart'}];
 if(mode==='volume_recovery')return [{id:'volume-recovery',kind:'volume_recovery'}];
 const soakSessions=Number(env.QUALIFICATION_SOAK_SESSIONS||500);need([500,1000].includes(soakSessions),'INVALID_SOAK_CONCURRENCY');
 const first={id:'load500',sessions:500,duration_seconds:0,rounds:1};
 const capacity=[first,{id:'load1000',sessions:1000,duration_seconds:0,rounds:1}],soak={id:'soak60m',sessions:soakSessions,duration_seconds:3600,min_soak_seconds:3600,rounds:1};return mode==='baseline500'?[first]:mode==='capacity'?capacity:mode==='soak_only'?[soak]:[...capacity,soak];
}
export function functionalPass(report){return ['PASS','PARTIAL'].includes(report?.status)&&report?.gates&&Object.values(report.gates).every(x=>x!==false)&&report.gates.concurrent_sessions===true&&report.gates.all_sessions_played===true&&report.gates.no_round_failures===true&&report.gates.exactly_once_reconciliation===true&&report.gates.duplicate_native_results===true&&report.gates.request_error_rate===true&&report.gates.round_latency===true;}
async function sourceSnapshot(config){
 const targets={core:config.core_url,wallet:config.wallet_url,uno:config.engine_origins['uno-luck'],mahjong:config.engine_origins['mahjong-wild'],skygate:config.engine_origins['skygate-5000']},out={};
 await Promise.all(Object.entries(targets).map(async([name,origin])=>{const r=await request(origin+'/health',{timeout:15000});need(r.ok&&r.data.ok===true&&/^[a-f0-9]{40}$/.test(r.data.source_commit||''),'SERVICE_NOT_READY_'+name);const identity=r.data.deployment_identity||r.data.identity;need(identity?.environment==='preproduction','WRONG_SERVICE_ENVIRONMENT_'+name);if(name==='core')need(identity.deployment_id===config.core_audience&&identity.identity_bound===true&&r.data.qualification?.ready===true,'CORE_NOT_BOUND_OR_QUALIFIED');else if(name==='wallet')need(identity.core_audience===config.core_audience&&r.data.service==='softtech-reference-wallet'&&r.data.production_enabled===false,'WALLET_AUDIENCE_MISMATCH');else need(identity.core_deployment_id===config.core_audience&&identity.identity_bound===true,'ENGINE_AUDIENCE_MISMATCH_'+name);out[name]={source_commit:r.data.source_commit,deployment_id:identity.deployment_id,environment:identity.environment,process_boot_id:r.data.process_boot_id||null};}));return out;
}
export function createCloudRunner({env=process.env,run=runNativeLoad,snapshot=sourceSnapshot,walletRun=runWalletConformance,chaosRun=runNativeChaos,volumeRun=runVolumeRecovery,healthRequest=request}={}){
 need(typeof env.RUNNER_READ_TOKEN==='string'&&env.RUNNER_READ_TOKEN.length>=40,'RUNNER_READ_TOKEN_REQUIRED');
 const config=configFromEnvironment(env),source=env.RAILWAY_GIT_COMMIT_SHA||env.SOURCE_COMMIT;need(/^[a-f0-9]{40}$/.test(source||''),'FULL_RUNNER_SOURCE_SHA_REQUIRED');
 const deployment=env.QUALIFICATION_RUNNER_ID||env.RAILWAY_SERVICE_ID;need(typeof deployment==='string'&&/^[-\w]{8,100}$/.test(deployment),'RUNNER_DEPLOYMENT_ID_REQUIRED');
 const dataDirectory=path.resolve(env.RUNNER_DATA_DIR||'/data');if(env.RAILWAY_SERVICE_ID)need(env.RAILWAY_VOLUME_MOUNT_PATH,'DEDICATED_RUNNER_VOLUME_REQUIRED');
 if(env.RAILWAY_VOLUME_MOUNT_PATH){const mount=realpathSync(env.RAILWAY_VOLUME_MOUNT_PATH),parent=existsSync(dataDirectory)?realpathSync(dataDirectory):dataDirectory;need(parent===mount||parent.startsWith(mount+path.sep),'RUNNER_DATA_OUTSIDE_VOLUME');}
 mkdirSync(dataDirectory,{recursive:true,mode:0o700});const reportsDirectory=path.join(dataDirectory,'reports');mkdirSync(reportsDirectory,{recursive:true,mode:0o700});
 const identity={environment:'preproduction',deployment_id:deployment,core_audience:config.core_audience},identityFile=path.join(dataDirectory,'runner-identity.json');if(existsSync(identityFile))need(JSON.stringify(parse(readFileSync(identityFile,'utf8'),'INVALID_RUNNER_IDENTITY'))===JSON.stringify(identity),'RUNNER_VOLUME_IDENTITY_MISMATCH');else persist(identityFile,identity);
 const runId=env.QUALIFICATION_RUN_ID||null;need(runId===null||safeId(runId),'INVALID_RUN_ID');const expectedSources=env.QUALIFICATION_EXPECTED_SOURCES_JSON?parse(env.QUALIFICATION_EXPECTED_SOURCES_JSON,'INVALID_EXPECTED_SOURCES'):null;if(expectedSources)for(const name of ['core','wallet','uno','mahjong','skygate'])need(/^[a-f0-9]{40}$/.test(expectedSources[name]||''),'FULL_EXPECTED_SOURCE_SHA_REQUIRED');const configFingerprint=hash(JSON.stringify({protected_config_sha256:hash(env.QUALIFICATION_CONFIG_JSON),native_transport:config.native_transport})),steps=fixedPlan(env),planHash=hash(JSON.stringify({source,config_fingerprint:configFingerprint,run_id:runId,expected_sources:expectedSources,steps})),bootId=randomUUID();
 const stateFile=runId?path.join(reportsDirectory,runId+'-plan.json'):null;
 let state={schema_version:1,classification:'colocated_preproduction_native_load_plan',run_id:runId,status:runId?'READY':'IDLE',environment:'preproduction',core_audience:config.core_audience,runner_source_commit:source,runner_deployment_id:deployment,runner_process_boot_id:bootId,plan_hash:planHash,config_fingerprint:configFingerprint,native_transport:config.native_transport,steps:steps.map(s=>({...s,status:'NOT_STARTED',report_file:runId?runId+'-'+s.id+'.json':null})),production_enabled:false};
 if(stateFile&&existsSync(stateFile)){const old=parse(readFileSync(stateFile,'utf8'),'INVALID_SAVED_RUN_STATE');need(old.plan_hash===planHash&&old.runner_source_commit===source&&old.run_id===runId,'RUN_SOURCE_OR_CONFIGURATION_MISMATCH_USE_NEW_RUN_ID');state={...old,runner_process_boot_id:bootId};}
 const save=()=>{if(stateFile)persist(stateFile,state);};let running=null,currentReport=null;
 const progress=()=>{if(currentReport&&existsSync(currentReport)){try{const r=JSON.parse(readFileSync(currentReport,'utf8'));return {phase:r.progress?.phase||r.status,established_sessions:r.progress?.established??r.established_sessions??0,completed_rounds:r.progress?.completed_rounds??r.completed_rounds??0,completed_by_game:r.progress?.completed_by_game??r.completed_by_game??{},round_latency_by_game:r.progress?.round_latency_by_game??r.round_latency_by_game??{},elapsed_seconds:r.progress?.elapsed_seconds??r.actual_execution_seconds??0,completed_cases:r.cases?.length||0};}catch{}}return null;};
 const server=http.createServer((req,res)=>{
  const send=(code,value,extra={})=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra});res.end(JSON.stringify(value));};
  try{const u=new URL(req.url,'http://runner');if(req.method!=='GET'){send(405,{error:'READ_ONLY_RUNNER'});return;}
   if(u.pathname==='/health'){send(200,{ok:true,service:'softtech-qualification-runner',identity,source_commit:source,native_transport:config.native_transport,config_fingerprint:configFingerprint,process_boot_id:bootId,uptime_seconds:Math.floor(process.uptime()),memory_rss_bytes:process.memoryUsage().rss,production_enabled:false,run_id:state.run_id,status:state.status,active_step:state.active_step||null,waiting_restart:state.waiting_restart||null,progress:progress(),completed_steps:state.steps.filter(s=>['PASS','PARTIAL'].includes(s.status)).length});return;}
   if(!equal(String(req.headers.authorization||''),'Bearer '+env.RUNNER_READ_TOKEN)){send(401,{error:'REPORT_AUTH_REQUIRED'});return;}
   if(u.search){send(400,{error:'QUERY_NOT_ALLOWED'});return;}
   if(u.pathname==='/reports'){send(200,{state,files:readdirSync(reportsDirectory).filter(f=>/^[A-Za-z0-9][A-Za-z0-9_.-]+\.json$/.test(f))});return;}
   const match=u.pathname.match(/^\/reports\/([A-Za-z0-9][A-Za-z0-9_.-]{2,140}\.json)$/);if(match){const file=path.join(reportsDirectory,match[1]);if(!existsSync(file)){send(404,{error:'REPORT_NOT_FOUND'});return;}send(200,parse(readFileSync(file,'utf8'),'INVALID_REPORT'),{'content-disposition':'attachment; filename="'+match[1]+'"'});return;}
   send(404,{error:'NOT_FOUND'});
  }catch{send(500,{error:'RUNNER_REPORT_ERROR'});}
 });server.headersTimeout=10000;server.requestTimeout=15000;
 async function waitForActualRestart(target,origin,{stage='restart'}={}){
  need(['restart','snapshot_restart','volume_restore'].includes(stage),'INVALID_RESTART_STAGE');
  const allowed={core:config.core_url,wallet:config.wallet_url,...config.engine_origins};need(allowed[target]===origin,'INVALID_RESTART_TARGET');
  const before=await healthRequest(origin+'/health',{timeout:15000});need(before.ok&&before.data.ok===true&&before.data.process_boot_id,'PRE_RESTART_PROCESS_ID_REQUIRED');
  const identityBefore=before.data.deployment_identity||before.data.identity;need(identityBefore?.environment==='preproduction','RESTART_ENVIRONMENT_MISMATCH');
  const sourceName=({'uno-luck':'uno','mahjong-wild':'mahjong','skygate-5000':'skygate'})[target]||target,expected=state.pinned_sources?.[sourceName];need(expected&&identityBefore.deployment_id===expected.deployment_id,'RESTART_TARGET_IDENTITY_MISMATCH');need(before.data.source_commit===expected.source_commit,'SOURCE_CHANGED_BEFORE_RESTART');
  const requestedAt=Date.now(),deadline=requestedAt+(stage==='volume_restore'?600000:300000);let firstUnavailable=null,lastHealthy=requestedAt;
  state.waiting_restart={target,stage,deployment_id:identityBefore.deployment_id,environment:'preproduction',process_boot_id_before:before.data.process_boot_id,source_commit:before.data.source_commit,requested_at:new Date(requestedAt).toISOString(),deadline:new Date(deadline).toISOString(),action:stage==='volume_restore'?'After verifying the fresh encrypted snapshot, preserve the old volume disconnected; attach a distinct empty volume, restore that exact snapshot, rotate the active backup key, and restart this same-source service. Retain platform volume IDs and backup hash as separate evidence.':stage==='snapshot_restart'?'Restart this same-source isolated native service to create a fresh startup snapshot. Verify encrypted backup upload/readback logs before the next volume_restore stage. The wallet credit barrier stays active.':'Restart this exact isolated service through the platform; no acknowledgement API exists.'};save();
  try{while(Date.now()<deadline){const began=Date.now();try{const r=await healthRequest(origin+'/health',{timeout:10000}),ready=r.ok&&r.data.ok===true&&(target!=='core'||r.data.qualification?.ready===true);if(ready&&r.data.process_boot_id&&r.data.process_boot_id!==before.data.process_boot_id){const identityAfter=r.data.deployment_identity||r.data.identity;need(JSON.stringify(identityBefore)===JSON.stringify(identityAfter),'IDENTITY_CHANGED_DURING_RESTART');need(r.data.source_commit===before.data.source_commit,'SOURCE_CHANGED_DURING_RESTART');const observed=Date.now();return {status:'PASS',target,stage,deployment_id:identityAfter.deployment_id,requested_at:new Date(requestedAt).toISOString(),observed_at:new Date(observed).toISOString(),elapsed_seconds:(observed-requestedAt)/1000,observed_recovery_seconds:firstUnavailable===null?null:(observed-firstUnavailable)/1000,maximum_observed_gap_seconds:(observed-lastHealthy)/1000,probe_interval_ms:1000,process_boot_id_before:before.data.process_boot_id,process_boot_id_after:r.data.process_boot_id,source_commit:r.data.source_commit,identity:identityAfter,verification:'Observed a new process with the same identity and source; the surrounding conformance scenario verifies durable receipt/session replay.'};}if(ready)lastHealthy=Date.now();else firstUnavailable??=began;}catch(e){if(/IDENTITY_CHANGED|SOURCE_CHANGED/.test(e.message))throw e;firstUnavailable??=began;}await new Promise(resolve=>setTimeout(resolve,1000));}throw Error('ACTUAL_PLATFORM_RESTART_NOT_OBSERVED');}finally{delete state.waiting_restart;save();}
 }
 const stepPass=(step,report)=>step.kind==='volume_recovery'?report?.status==='PARTIAL'&&report.application_checks_passed===true&&report.full_volume_recovery_certified===false&&report.cases?.length===3&&report.cases.every(c=>c.status==='PASS')&&report.reconciliation?.status==='PASS':step.kind==='wallet_conformance'?report?.status==='PASS'&&report.cases?.length===17&&report.cases.every(c=>c.status==='PASS'):step.kind==='network_restart'?report?.status==='PASS'&&report.cases?.length===12&&report.cases.every(c=>c.status==='PASS'):functionalPass(report);
 async function start(){
  if(!runId||running)return running;running=(async()=>{
   try{state.status='RUNNING';state.started_at??=new Date().toISOString();save();const initialSources=await snapshot(config);if(state.pinned_sources)for(const [name,v]of Object.entries(initialSources))need(state.pinned_sources[name]?.source_commit===v.source_commit&&state.pinned_sources[name]?.deployment_id===v.deployment_id,'SOURCE_CHANGED_BEFORE_RESUME_'+name);else state.pinned_sources=initialSources;if(expectedSources)for(const name of ['core','wallet','uno','mahjong','skygate'])need(expectedSources[name]===initialSources[name]?.source_commit,'EXPECTED_SOURCE_MISMATCH_'+name);save();
    for(const step of state.steps){const reportFile=path.join(reportsDirectory,step.report_file);currentReport=reportFile;
     if(existsSync(reportFile)){const prior=parse(readFileSync(reportFile,'utf8'),'INVALID_COMPLETED_REPORT');need(prior.runner?.source_commit===source&&prior.runner?.plan_hash===planHash&&prior.runner?.step_id===step.id&&prior.run_id===runId+'-'+step.id,'INCOMPLETE_OR_DIFFERENT_SOURCE_REPORT_USE_NEW_RUN_ID');need(stepPass(step,prior),'PREVIOUS_STEP_DID_NOT_PASS_USE_NEW_RUN_ID');step.status=prior.status;step.resumed_completed_report=true;save();continue;}
     const sources=await snapshot(config);if(state.pinned_sources){for(const [name,s]of Object.entries(sources))need(state.pinned_sources[name]?.source_commit===s.source_commit&&state.pinned_sources[name]?.deployment_id===s.deployment_id,'SOURCE_CHANGED_WITHIN_PLAN_'+name);}else state.pinned_sources=sources;
     if(expectedSources)for(const name of ['core','wallet','uno','mahjong','skygate'])need(expectedSources[name]===sources[name]?.source_commit,'EXPECTED_SOURCE_MISMATCH_'+name);
     state.active_step=step.id;step.status='RUNNING';step.started_at=new Date().toISOString();save();
     const options={runId:runId+'-'+step.id,reportFile};const report=step.kind==='volume_recovery'?await volumeRun(config,{...options,restart:(_config,target,origin,restartOptions)=>waitForActualRestart(target,origin,restartOptions)}):step.kind==='wallet_conformance'?await walletRun(config,{...options,restart:()=>waitForActualRestart('wallet',config.wallet_url)}):step.kind==='network_restart'?await chaosRun(config,{...options,restart:(_config,target,origin)=>waitForActualRestart(target,origin)}):await run(config,{...options,concurrency:step.sessions,roundsPerSession:step.rounds,setupConcurrency:40,durationSeconds:step.duration_seconds,minSoakSeconds:step.min_soak_seconds||3600,thinkTimeMs:1000,recoveryRetries:0});
     report.runner={source_commit:source,plan_hash:planHash,config_fingerprint:configFingerprint,native_transport:config.native_transport,step_id:step.id,deployment_id:deployment,process_boot_id:bootId,location:'dedicated_preproduction_service',source_snapshot:sources};persist(reportFile,report);step.status=report.status;step.finished_at=new Date().toISOString();step.completed_rounds=report.completed_rounds??0;save();if(!step.kind)console.log('qualification.step_summary',JSON.stringify(completionAggregate(report,step.id)));need(stepPass(step,report),'QUALIFICATION_STEP_FAILED_'+step.id);
    }
    state.active_step=null;state.status=state.steps.every(s=>s.status==='PASS')?'PASS':'PARTIAL';state.note=state.steps.some(s=>!s.kind)?'Completed native-session and latency checks; resource gates remain separate until authoritative platform metrics are attached.':'Completed the fixed conformance/restart plan; this remains internal engineering evidence and does not certify an independent external operator.';
   }catch(e){state.status='FAIL';state.error=String(e.message).slice(0,180);}
   finally{state.finished_at=new Date().toISOString();currentReport=null;save();console.log('qualification.plan_finished',JSON.stringify({run_id:state.run_id,status:state.status,error:state.error||null,completed_steps:state.steps.filter(s=>['PASS','PARTIAL'].includes(s.status)).length}));}
   return state;
  })();return running;
 }
 function interrupted(){if(state.status==='RUNNING'){state.status='INTERRUPTED';state.error='RUNNER_STOPPED_DURING_ACTIVE_PLAN';state.interrupted_at=new Date().toISOString();save();}}
 return {server,start,interrupted,getState:()=>state};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const runner=createCloudRunner();runner.server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>{console.log('qualification.runner_ready',JSON.stringify({environment:'preproduction',run_configured:!!process.env.QUALIFICATION_RUN_ID}));void runner.start();});for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{runner.interrupted();runner.server.close(()=>process.exit(0));});}
