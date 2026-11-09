/* Real HTTP launch -> native redeem -> actual native RNG -> provider wallet callback.
   No synthetic result insertion and no RNG override. Run only against dedicated qualification services. */
import {randomUUID,randomInt} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {RunnerDiagnostics} from './runner-diagnostics.mjs';
import {SessionTransport} from './session-transport.mjs';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readConfig,args,persist,operatorCall,adminCall,request,must,quantiles,digest} from './client.mjs';
const games=['uno-luck','mahjong-wild','skygate-5000'];
export const RECONCILIATION_QUERIES=Object.freeze({
 schema:"PRAGMA journal_mode=OFF; CREATE TABLE provider(id TEXT PRIMARY KEY,round_id TEXT,kind TEXT,amount_minor TEXT,currency TEXT,scale INTEGER,expected_wallet_id TEXT NOT NULL); CREATE INDEX provider_expected_wallet_id ON provider(expected_wallet_id); CREATE TABLE wallet(id TEXT PRIMARY KEY,status TEXT,amount_minor TEXT,currency TEXT,scale INTEGER);",
 cardinality:"SELECT round_id,SUM(kind='debit') debits,SUM(kind='credit') credits,SUM(kind='reversal') reversals FROM provider GROUP BY round_id HAVING debits<>1 OR credits<>1 OR reversals<>0 LIMIT 100",
 mismatches:"SELECT p.round_id,p.kind FROM provider p LEFT JOIN wallet w ON w.id=p.round_id||':'||p.kind WHERE p.kind IN ('debit','credit','reversal') AND (w.id IS NULL OR w.status<>'applied' OR w.amount_minor<>p.amount_minor OR w.currency<>p.currency OR w.scale<>p.scale) LIMIT 100",
 orphans:"SELECT w.id FROM wallet w LEFT JOIN provider p ON p.expected_wallet_id=w.id WHERE w.status='applied' AND p.id IS NULL LIMIT 100"
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function pool(items,concurrency,fn){let index=0;const results=new Array(items.length);await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{for(;;){const i=index++;if(i>=items.length)return;try{results[i]={ok:true,value:await fn(items[i],i)};}catch(e){results[i]={ok:false,error:e};}}}));return results;}
function sample(values,n,value,limit){if(values.length<limit)values.push(value);else {const i=randomInt(n);if(i<limit)values[i]=value;}}
function sampledQuantiles(values,count){return {...quantiles(values),count,sample_count:values.length,estimator:count===values.length?'exact':'uniform_reservoir_sample'};}
export class Metrics {
 constructor(){this.active=0;this.peak=0;this.calls=[];this.total=0;this.failed=0;this.error_counts={};this.operations=new Map();this.roundSamples=[];this.roundCount=0;}
 recordRound(duration){this.roundCount++;sample(this.roundSamples,this.roundCount,duration,100000);}
 roundSummary(){return sampledQuantiles(this.roundSamples,this.roundCount);}
 async measure(label,fn){this.active++;this.peak=Math.max(this.peak,this.active);const started=performance.now();let status=0,ok=false;try{const r=await fn();status=r?.status??200;ok=r?.ok!==false;return r;}catch(e){this.error_counts[e.name==='TimeoutError'?'TIMEOUT':'TRANSPORT']=(this.error_counts[e.name==='TimeoutError'?'TIMEOUT':'TRANSPORT']||0)+1;throw e;}finally{this.active--;const duration=performance.now()-started;this.total++;if(!ok)this.failed++;sample(this.calls,this.total,duration,100000);const operation=this.operations.get(label)||{count:0,samples:[]};operation.count++;sample(operation.samples,operation.count,duration,10000);this.operations.set(label,operation);if(!ok&&status)this.error_counts['HTTP_'+status]=(this.error_counts['HTTP_'+status]||0)+1;}}
 summary(){return {requests:this.total,failed_requests:this.failed,request_error_rate:this.total?this.failed/this.total:0,peak_inflight_requests:this.peak,latency:sampledQuantiles(this.calls,this.total),by_operation:Object.fromEntries([...this.operations].map(([k,v])=>[k,sampledQuantiles(v.samples,v.count)])),error_counts:this.error_counts};}
}
export function closeNativeSession(ctx){ctx?.transport?.close();if(ctx&&Object.getOwnPropertyDescriptor(ctx,'transport')?.configurable)delete ctx.transport;}
function sessionTransport(ctx){if(ctx.native_transport==='per_user_https'&&!ctx.transport)Object.defineProperty(ctx,'transport',{value:new SessionTransport(ctx.origin,{allowLocal:ctx.native_transport_allow_local===true}),configurable:true});return ctx.transport;}
export async function nativeCall(ctx,pathname,payload,{metrics,recoveryRetries=0,timeout=45000,onFailure}={}){
 const method=payload===undefined?'GET':'POST',headers={'content-type':'application/json',...(ctx.game_id==='uno-luck'?{'X-UNO-Client':'spin-ui'}:ctx.game_id==='mahjong-wild'?{'X-ML-Request':'local-demo'}:{'X-Skygate-Client':'agency-ui'}),...(ctx.cookie?{cookie:ctx.cookie}:{})};
 if(payload!==undefined&&['/api/agency/pick','/api/spin','/api/agency/spin'].includes(pathname))ctx.last_round_request={pathname,payload:structuredClone(payload)};
 let last;
 for(let attempt=0;attempt<=recoveryRetries;attempt++){
  try{const operation=()=>request(ctx.origin+pathname,{method,headers,...(payload===undefined?{}:{body:JSON.stringify(payload)}),timeout,transport:sessionTransport(ctx)});const r=metrics?await metrics.measure(ctx.game_id+':'+pathname,operation):await operation();const cookies=r.headers.getSetCookie?.()||[];if(cookies.length)ctx.cookie=cookies.map(c=>c.split(';')[0]).join('; ');if(r.ok)return r.data;last=new Error('NATIVE_HTTP_'+r.status);if(r.status<500&&r.status!==409)throw last;}catch(e){last=e;if(attempt===recoveryRetries)throw e;}
  if(attempt<recoveryRetries){if(onFailure)await onFailure({ctx,pathname,attempt,error:last?.message||'NATIVE_FAILURE'});await sleep(Math.min(2000,200*2**attempt));}
 }
 throw last;
}
// Deliberately excludes current balance, next ticket and replay flags. The saved
// outcome and monetary result must remain byte-equivalent across an old retry.
export function nativeOutcomeProof(gameId,result){
 let outcome,id;
 if(gameId==='uno-luck'){must(result?.round?.complete===true,'UNO_ROUND_INCOMPLETE');outcome=result.round;id=result.round.id;}
 else if(gameId==='mahjong-wild'){outcome={ticket_id:result.ticket_id,round:result.round,stake:result.stake_virtual_credits,win:result.win_virtual_credits,settlement:result.settlement};id=result.ticket_id;}
 else if(gameId==='skygate-5000'){const {state,...saved}=result;outcome=saved;id=result.id;}
 else throw Error('UNKNOWN_GAME');
 must(typeof id==='string'&&id.length>0,'NATIVE_OUTCOME_MISSING');
 return {native_round_id:id,outcome_sha256:digest(JSON.stringify(outcome))};
}
export async function establishSession(config,index,runId,{metrics,game_id=games[index%games.length]}={}){
 const player_ref=runId+'-p'+index;
 if(config.operator.wallet_secret){const seed=await metrics.measure('wallet:seed',()=>adminCall(config,'/admin/accounts',{operator_id:config.operator.id,player_ref,amount_minor:config.test_balance_minor||'100000000000'}));must(seed.ok,'WALLET_SEED_FAILED');}
 const launch=await metrics.measure('core:launch',()=>operatorCall(config,'/v1/game-launches',{game_id,player_ref,currency:config.currency||'VCOIN',return_url:config.return_url||config.core_url}));
 must(launch.ok,'LAUNCH_HTTP_'+launch.status);must(launch.data.environment===config.environment,'LAUNCH_ENVIRONMENT_MISMATCH');
 const url=new URL(launch.data.launch_url),token=new URLSearchParams(url.hash.slice(1)).get('softtech_launch');must(token,'LAUNCH_TOKEN_MISSING');
 const allowed=config.engine_origins?.[game_id];if(allowed)must(url.origin===allowed,'ENGINE_ORIGIN_MISMATCH');
 must(url.protocol==='https:'||config.allow_local===true&&url.protocol==='http:','INSECURE_ENGINE_URL');
 const ctx={game_id,origin:url.origin,session_id:launch.data.session_id,player_ref,cookie:'',rounds:[],native_transport:config.native_transport||'shared_fetch',...(config.allow_local===true?{native_transport_allow_local:true}:{}),established_at:new Date().toISOString()};
 try{await nativeCall(ctx,'/api/agency/launch',{token},{metrics});return ctx;}catch(e){closeNativeSession(ctx);throw e;}
}
export async function playRound(ctx,{metrics,recoveryRetries=0,verifyDuplicate=true,onFailure}={}){
 const options={metrics,recoveryRetries,onFailure},started=performance.now();let final,duplicate,native_round_id;
 if(ctx.game_id==='uno-luck'){
  const state=await nativeCall(ctx,'/api/agency/state',undefined,options),stake=state.rules?.stake_options?.[0];must(stake!==undefined,'UNO_STAKE_OPTIONS_MISSING');let round_id=null;
  for(let phase=1;phase<=3;phase++){const p={request_id:randomUUID(),stake,expected_phase:phase,round_id:phase>1?round_id:null};final=await nativeCall(ctx,'/api/agency/pick',p,options);round_id=final.round?.id;must(round_id,'UNO_ROUND_MISSING');if(phase===3&&verifyDuplicate)duplicate=await nativeCall(ctx,'/api/agency/pick',p,options);}
  must(final.round?.complete,'UNO_ROUND_INCOMPLETE');if(duplicate)must(final.round.id===duplicate.round?.id&&duplicate.round.complete,'UNO_DUPLICATE_CHANGED');native_round_id=final.round.id;
 }else if(ctx.game_id==='mahjong-wild'){
  const state=await nativeCall(ctx,'/api/state',undefined,options),p={ticket_id:state.ticket?.id,idempotency_key:randomUUID(),bet:state.bet_options?.[0]};must(p.ticket_id&&p.bet!==undefined,'MAHJONG_STATE_INVALID');final=await nativeCall(ctx,'/api/spin',p,options);if(verifyDuplicate){duplicate=await nativeCall(ctx,'/api/spin',p,options);must(final.ticket_id===duplicate.ticket_id,'MAHJONG_DUPLICATE_CHANGED');}native_round_id=final.ticket_id;
 }else if(ctx.game_id==='skygate-5000'){
  const state=await nativeCall(ctx,'/api/agency/state',undefined,options),p={request_id:randomUUID(),bet:'2',ante:false,buy_bonus:false,release_id:state.release_id};must(p.release_id,'SKYGATE_RELEASE_MISSING');final=await nativeCall(ctx,'/api/agency/spin',p,options);if(verifyDuplicate){duplicate=await nativeCall(ctx,'/api/agency/spin',p,options);must(final.id===duplicate.id,'SKYGATE_DUPLICATE_CHANGED');}native_round_id=final.id;
 }else throw Error('UNKNOWN_GAME');
 const proof=nativeOutcomeProof(ctx.game_id,final);if(duplicate)must(nativeOutcomeProof(ctx.game_id,duplicate).outcome_sha256===proof.outcome_sha256,'DUPLICATE_OUTCOME_CHANGED');ctx.last_completed_request={...structuredClone(ctx.last_round_request),...proof};
 const summary={native_round_id,duration_ms:performance.now()-started,duplicate_verified:!!duplicate,completed_at:new Date().toISOString()};ctx.round_count=(ctx.round_count||0)+1;ctx.duplicate_verified_count=(ctx.duplicate_verified_count||0)+(summary.duplicate_verified?1:0);sample(ctx.rounds,ctx.round_count,summary,100);metrics?.recordRound(summary.duration_ms);return summary;
}
async function probeHealth(config,origins){const targets={core:config.core_url,wallet:config.wallet_url,...origins},out={};await Promise.all(Object.entries(targets).filter(([,url])=>url).map(async([name,url])=>{try{const r=await request(url+'/health',{timeout:15000});out[name]={http_status:r.status,ok:r.data.ok===true,source_commit:r.data.source_commit??null,identity:r.data.deployment_identity||r.data.identity||null,memory_rss_bytes:r.data.memory_rss_bytes??null,uptime_seconds:r.data.uptime_seconds??null,process_boot_id:r.data.process_boot_id??null};}catch{out[name]={ok:false,error:'UNREACHABLE'};}}));return out;}
export async function reconcileRun(config,contexts,runId,{metrics}={}){
 const ids=new Set(contexts.map(c=>c.session_id)),playerRefs=new Set(contexts.map(c=>c.player_ref)),issues=[],directory=mkdtempSync(path.join(os.tmpdir(),'qualification-reconciliation-')),file=path.join(directory,'proof.sqlite'),db=new DatabaseSync(file);chmodSync(file,0o600);
 db.exec(RECONCILIATION_QUERIES.schema);
 let providerPages=0,walletPages=0,wallet=null,accountCount=0;
 try{
  const insertProvider=db.prepare('INSERT OR IGNORE INTO provider VALUES(?,?,?,?,?,?,?)');
  for(;providerPages<10000;providerPages++){const pathname='/v1/transactions?limit=200&offset='+providerPages*200,r=await metrics.measure('core:transactions',()=>operatorCall(config,pathname));must(r.ok&&Array.isArray(r.data.data),'PROVIDER_TRANSACTIONS_FAILED');db.exec('BEGIN');for(const row of r.data.data){if(!ids.has(row.session_id)||!row.round_id)continue;const n=BigInt(row.amount_minor);if(row.kind==='debit'&&n>=0n||['credit','reversal'].includes(row.kind)&&n<0n)issues.push({code:'LEDGER_AMOUNT_SIGN',round_id:row.round_id,kind:row.kind});const added=insertProvider.run(row.id,row.round_id,row.kind,String(n<0n?-n:n),row.currency,row.scale,row.round_id+':'+row.kind);if(added.changes!==1)issues.push({code:'DUPLICATE_REPORT_RECORD',id:row.id});}db.exec('COMMIT');if(r.data.data.length<200)break;}
  must(providerPages<10000,'REPORT_PAGINATION_LIMIT');
  const invalid=db.prepare(RECONCILIATION_QUERIES.cardinality).all();for(const row of invalid)issues.push({code:'ROUND_LEDGER_CARDINALITY',...row});
  const completed=contexts.reduce((n,c)=>n+(c.round_count||0),0),rounds=db.prepare('SELECT count(DISTINCT round_id) n FROM provider').get().n,entryCount=db.prepare('SELECT count(*) n FROM provider').get().n;if(rounds!==completed)issues.push({code:'ROUND_COUNT_MISMATCH',completed_native_rounds:completed,provider_rounds:rounds});
  const provider=await metrics.measure('core:reconciliation',()=>operatorCall(config,'/v1/reconciliation'));must(provider.ok,'PROVIDER_RECONCILIATION_FAILED');if(provider.data.status!=='matched')issues.push({code:'PROVIDER_RECONCILIATION',status:provider.data.status});
  if(config.wallet_admin_token){const insertWallet=db.prepare('INSERT OR IGNORE INTO wallet VALUES(?,?,?,?,?)');for(;walletPages<10000;walletPages++){const r=await metrics.measure('wallet:report',()=>adminCall(config,'/admin/report',{operator_id:config.operator.id,limit:1000,offset:walletPages*1000,include_reconciliation:walletPages===0}));must(r.ok,'WALLET_REPORT_FAILED');if(r.data.reconciliation)wallet=r.data.reconciliation;accountCount+=r.data.accounts.filter(x=>playerRefs.has(x.player_ref)).length;db.exec('BEGIN');for(const t of r.data.transactions){if(!playerRefs.has(t.player_ref))continue;const added=insertWallet.run(t.id,t.status,t.receipt.amount_minor??null,t.receipt.currency,t.receipt.scale);if(added.changes!==1)issues.push({code:'DUPLICATE_WALLET_REPORT_RECORD',id:t.id});}db.exec('COMMIT');if(r.data.transactions.length<1000&&r.data.accounts.length<1000)break;}
   must(walletPages<10000,'WALLET_REPORT_PAGINATION_LIMIT');if(wallet?.status!=='matched')issues.push({code:'WALLET_RECONCILIATION',status:wallet?.status});
   const mismatches=db.prepare(RECONCILIATION_QUERIES.mismatches).all();for(const row of mismatches)issues.push({code:'CROSS_LEDGER_RECEIPT_MISMATCH',...row});
   const orphans=db.prepare(RECONCILIATION_QUERIES.orphans).all();for(const row of orphans)issues.push({code:'WALLET_APPLIED_WITHOUT_PROVIDER_LEDGER',transaction_id:row.id});
   wallet={...wallet,run_accounts:accountCount,run_transactions:db.prepare('SELECT count(*) n FROM wallet').get().n};
  }
  return {status:issues.length?'FAIL':'PASS',run_id:runId,completed_native_rounds:completed,provider_rounds:rounds,provider_ledger_entries:entryCount,provider_check:provider.data.status,wallet,issues,provider_report_pages:providerPages+1,wallet_report_pages:walletPages+1};
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
}
export async function runNativeLoad(config,{concurrency=500,roundsPerSession=1,setupConcurrency=40,durationSeconds=0,minSoakSeconds=3600,thinkTimeMs=1000,reportFile,runId='load-'+Date.now(),recoveryRetries=0,chaosHook,keepSessions=false,onReady}={}){
 must([500,1000].includes(concurrency)||config.allow_small_test===true&&concurrency>=1,'Load requires 500 or 1000 sessions');
 must(config.environment!=='production','Production qualification forbidden');must(['shared_fetch','per_user_https'].includes(config.native_transport||'shared_fetch'),'Invalid native transport');must(Number.isInteger(roundsPerSession)&&roundsPerSession>=1,'Invalid rounds');
 const report={schema_version:1,run_id:runId,classification:'real_native_session_http_load',environment:config.environment,core_audience:config.core_audience,requested_concurrent_sessions:concurrency,rounds_per_session:roundsPerSession,duration_target_seconds:durationSeconds,minimum_soak_seconds:minSoakSeconds,started_at:new Date().toISOString(),status:'RUNNING',execution_model:'One independently authenticated native session per virtual user; real HTTP engine actions and wallet callbacks; not browser rendering load',thresholds:{request_error_rate:config.thresholds?.request_error_rate??0.01,round_p95_ms:config.thresholds?.round_p95_ms??10000},progress:{phase:'setup',established:0,completed_rounds:0},failures:[],external_operator_certified:false};
 const save=()=>{if(reportFile)persist(reportFile,report);};save();const metrics=new Metrics(),contexts=[],diagnostics=new RunnerDiagnostics();report.native_transport=config.native_transport||'shared_fetch';const origins={};let heartbeat;
 try{
  report.health_before=await probeHealth(config,config.engine_origins||{});must(report.health_before.core?.ok&&report.health_before.wallet?.ok,'QUALIFICATION_SERVICES_UNHEALTHY');
  const setup=await pool(Array.from({length:concurrency},(_,i)=>i),setupConcurrency,async i=>{const ctx=await establishSession(config,i,runId,{metrics});contexts.push(ctx);origins[ctx.game_id]=ctx.origin;report.progress.established=contexts.length;return ctx;});
  report.setup_failures=setup.filter(x=>!x.ok).map((x,i)=>({index:i,error:String(x.error.message).slice(0,100)}));report.established_sessions=contexts.length;report.active_sessions_at_barrier=contexts.length;report.established_by_game=Object.fromEntries(games.map(g=>[g,contexts.filter(c=>c.game_id===g).length]));report.barrier_at=new Date().toISOString();report.progress.phase='running';save();
  must(contexts.length===concurrency,'SESSION_SETUP_INCOMPLETE');
  if(onReady)await onReady({contexts,runId,report});
  diagnostics.setPhase('running');const runStart=performance.now(),deadline=runStart+durationSeconds*1000;let stopped=false;
  heartbeat=setInterval(()=>{report.progress.elapsed_seconds=Math.round((performance.now()-runStart)/1000);report.progress.completed_by_game=Object.fromEntries(games.map(g=>[g,contexts.filter(c=>c.game_id===g).reduce((n,c)=>n+(c.round_count||0),0)]));report.progress.metrics=metrics.summary();report.client_memory_rss_bytes=process.memoryUsage().rss;report.runner_diagnostics=diagnostics.snapshot();save();},10000);heartbeat.unref();
  const chaos=chaosHook?Promise.resolve().then(()=>chaosHook({config,contexts,runId,report,metrics})).then(evidence=>{report.chaos=evidence;}).catch(e=>{report.chaos={status:'FAIL',error:String(e.message).slice(0,100)};}):Promise.resolve();
  await Promise.all(contexts.map(async ctx=>{let iteration=0;do{try{await playRound(ctx,{metrics,recoveryRetries});report.progress.completed_rounds++;}catch(e){report.failures.push({game_id:ctx.game_id,session_id:ctx.session_id,iteration,error:String(e.message).slice(0,100)});break;}iteration++;if(durationSeconds>0&&performance.now()<deadline&&thinkTimeMs)await sleep(thinkTimeMs);}while(durationSeconds>0?performance.now()<deadline:iteration<roundsPerSession);}));
  await chaos;report.actual_execution_seconds=Math.round(performance.now()-runStart)/1000;report.progress.phase='reconciliation';diagnostics.setPhase('reconciliation');report.runner_diagnostics=diagnostics.snapshot();save();
  report.reconciliation=await reconcileRun(config,contexts,runId,{metrics});report.health_after=await probeHealth(config,origins);
  report.source_identity_stable=['core','wallet',...Object.keys(origins)].every(name=>{const before=report.health_before[name],after=report.health_after[name];return before?.ok===true&&after?.ok===true&&before.identity&&JSON.stringify(before.identity)===JSON.stringify(after.identity)&&before.source_commit===after.source_commit&&(config.allow_local===true||/^[a-f0-9]{40}$/.test(before.source_commit||''));});
  report.round_latency=metrics.roundSummary();report.completed_rounds=contexts.reduce((n,c)=>n+(c.round_count||0),0);report.completed_by_game=Object.fromEntries(games.map(g=>[g,contexts.filter(c=>c.game_id===g).reduce((n,c)=>n+(c.round_count||0),0)]));report.progress.completed_by_game=report.completed_by_game;report.sessions_with_completed_rounds=contexts.filter(c=>c.round_count>0).length;report.duplicate_results_verified=contexts.every(c=>c.round_count>0&&c.duplicate_verified_count===c.round_count);report.metrics=metrics.summary();
  report.gates={concurrent_sessions:report.active_sessions_at_barrier===concurrency,all_sessions_played:report.sessions_with_completed_rounds===concurrency,no_round_failures:report.failures.length===0,exactly_once_reconciliation:report.reconciliation.status==='PASS',duplicate_native_results:report.duplicate_results_verified,request_error_rate:report.metrics.request_error_rate<=report.thresholds.request_error_rate,round_latency:report.round_latency.p95_ms<=report.thresholds.round_p95_ms,soak_duration:durationSeconds>0?report.actual_execution_seconds>=minSoakSeconds:null,source_identity_stable:report.source_identity_stable,server_resource_ceilings:null};
  report.status=Object.values(report.gates).some(v=>v===false)?'FAIL':report.gates.server_resource_ceilings===null?'PARTIAL':'PASS';report.resource_note='Server resource ceilings require separately attached Railway metrics for these exact timestamps; client RSS is not server memory evidence.';
 }catch(e){report.status='FAIL';report.error=String(e.message).slice(0,200);report.metrics=metrics.summary();}
 finally{if(heartbeat)clearInterval(heartbeat);diagnostics.setPhase('cleanup');if(!keepSessions){const revoked=await pool(contexts,20,async ctx=>{const r=await operatorCall(config,'/v1/sessions/'+ctx.session_id+'/revoke',{});must(r.ok,'REVOKE_FAILED');});report.cleanup={sessions:contexts.length,revoked:revoked.filter(x=>x.ok).length};}for(const ctx of contexts)closeNativeSession(ctx);report.runner_diagnostics=diagnostics.stop();report.finished_at=new Date().toISOString();report.progress.phase='finished';report.sessions=contexts.map(c=>({session_id:c.session_id,game_id:c.game_id,player_ref:c.player_ref,completed_rounds:c.round_count||0}));save();}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const a=args(),config=readConfig(a.config);runNativeLoad(config,{concurrency:Number(a.sessions||500),roundsPerSession:Number(a.rounds||1),setupConcurrency:Number(a['setup-concurrency']||40),durationSeconds:Number(a['duration-seconds']||0),minSoakSeconds:Number(a['min-soak-seconds']||3600),thinkTimeMs:Number(a['think-time-ms']||1000),reportFile:a.report||'qualification/reports/native-load.json',runId:a['run-id'],recoveryRetries:Number(a['recovery-retries']||0)}).then(r=>{console.log(JSON.stringify({status:r.status,run_id:r.run_id,sessions:r.established_sessions,rounds:r.completed_rounds,error:r.error||null,failures:r.failures.length}));if(r.status==='FAIL')process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});}
