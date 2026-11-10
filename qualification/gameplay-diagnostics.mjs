/* Fixed-schema, content-free boundary observations. Never used by a load gate.
 * Health is fetched only outside gameplay; no polling or financial retry occurs. */
export const DIAGNOSTIC_LIMITS=Object.freeze({response_bytes:262144,request_timeout_ms:5000,services:5});
export const PHASE_BUCKETS=Object.freeze([250,500,1000,2000,4000,8000,16000,32000,64000,128000,256000,512000,1000000,2000000,4000000,8000000,16000000,30000000,60000000,null]);
const games=['uno-luck','mahjong-wild','skygate-5000'];
const services=['core','wallet',...games];
const coreActions=['engine_redeem','engine_status','engine_reserve','engine_settle','engine_void','engine_other','operator'];
const corePhases=['arrival_to_body_complete','body_read','auth_total','auth_queue','auth_batch_begin','auth_entry_to_operation','auth_operation_body','auth_batch_body','auth_batch_commit','auth_commit_to_resolve','auth_resolve_to_resume','journal_queue','journal_batch_begin','journal_entry_to_operation','journal_operation_body','journal_batch_body','journal_batch_commit','journal_commit_to_resolve','engine_action','wallet_balance','wallet_debit','wallet_credit','wallet_reversal','wallet_status','transaction_begin','transaction_body','transaction_commit','transaction_rollback','handler_total','response_write','response_to_finish','request_total'];
const coreCounters=['body_failures','auth_failures','journal_operations','journal_operation_failures','journal_batch_failures','journal_closed','transaction_failures','invalid_clock','dropped_spans'];
const nativeActions=['state','pick1','pick2','pick3','replay_completed','replay_pending','replay_failed','spin_new','spin_resume','request_unclassified','request_rejected','recovery'];
const nativePhases=['arrival_to_dispatch','dispatch_to_worker','worker_total','worker_cpu','worker_to_response_complete','operation_total','db_open_total','open_bound_total','connection_pragmas','session_validation','player_lock_acquire','round_lock_acquire','begin_immediate_wall','explicit_tx_body','explicit_commit_wall','noop_commit_wall','explicit_dml_execute','autocommit_intent_execute','autocommit_result_execute','autocommit_ticket_execute','autocommit_failure_execute','history_read','local_prepare','callback_status','callback_reserve','callback_settle','response_assembly_inclusive','db_close','recovery_scan','explicit_rollback'];
const nativeCounters=['explicit_transactions_started','explicit_transactions_zero_dml','explicit_transactions_with_dml','explicit_commit_active','explicit_commit_noop','explicit_commit_failed','closed_transaction','dml_success','dml_failure','invalid_clock','dropped_spans'];
const batchPhases=['begin','body','commit','rollback','resolution'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0&&v<Number.MAX_SAFE_INTEGER;
const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<Number.MAX_SAFE_INTEGER;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,99}$/.test(v)?v:null;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)?v:null;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)?v:null;
const runId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{2,139}$/.test(v)?v:null;
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))?v:null;
const fixed=(v,values)=>values.includes(v)?v:null;
const numeric=(v,keys,check=integer)=>Object.fromEntries(keys.map(k=>[k,check(v?.[k])?v[k]:null]));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const zeroCell=()=>({operations:0,invocations:0,total_us:0,max_operation_us:0,max_invocation_us:0,buckets:PHASE_BUCKETS.map(()=>0)});

function cell(value,errors){
 const out=numeric(value,['operations','invocations','total_us','max_operation_us','max_invocation_us']);
 out.buckets=Array.isArray(value?.buckets)&&value.buckets.length===PHASE_BUCKETS.length?value.buckets.map(v=>integer(v)?v:null):null;
 if(Object.values(out).some(v=>v===null)||out.buckets?.some(v=>v===null)||out.buckets?.reduce((n,v)=>n+v,0)!==out.operations||out.invocations<out.operations||out.max_invocation_us>out.max_operation_us||out.max_operation_us>out.total_us||out.operations===0&&['invocations','total_us','max_operation_us','max_invocation_us'].some(k=>out[k]!==0))errors.add('INVALID_PHASE_CELL');
 return out;
}
function phaseSnapshot(value,kind){
 if(!object(value))return null;
 const errors=new Set(),isCore=kind==='core',actions=isCore?coreActions:nativeActions,phases=isCore?corePhases:nativePhases,counters=isCore?coreCounters:nativeCounters;
 const out={schema:value.schema===1?1:null,available:value.available===true,registry_id:uuid(value.registry_id),reset_count:integer(value.reset_count)?value.reset_count:null,
  unit:fixed(value.unit,['microseconds']),histogram:fixed(value.histogram,[isCore?'per_request_phase_sum':'per_operation_phase_sum']),
  bucket_upper_us:equal(value.bucket_upper_us,PHASE_BUCKETS)?[...PHASE_BUCKETS]:null,
  ...numeric(value,['capture_limit','active_captures','completed_operations','dropped_captures']),
  telemetry_error:typeof value.telemetry_error==='boolean'?value.telemetry_error:null,saturated:typeof value.saturated==='boolean'?value.saturated:null,operations:{}};
 if(isCore)Object.assign(out,numeric(value,['span_limit_per_capture','dropped_spans','invalid_clock','late_observations']));
 if(out.schema!==1||!out.available||out.unit===null||out.histogram===null||out.bucket_upper_us===null||out.telemetry_error===null||out.saturated===null||['capture_limit','active_captures','completed_operations','dropped_captures',...(isCore?['span_limit_per_capture','dropped_spans','invalid_clock','late_observations']:[])].some(k=>out[k]===null))errors.add('INCOMPLETE_PHASE_SCHEMA');
 if(out.capture_limit<1||out.capture_limit>1024||out.active_captures>out.capture_limit||isCore&&(out.span_limit_per_capture<1||out.span_limit_per_capture>4096))errors.add('INVALID_PHASE_CAPACITY');
 if(!object(value.operations))errors.add('INVALID_OPERATIONS');
 // Iterate only fixed labels; no caller-supplied key is ever retained.
 for(const action of actions){
  if(!Object.hasOwn(value.operations||{},action))continue;
  const v=value.operations[action],operation={...numeric(v,['completed','errors','aborted']),counters:numeric(v?.counters,counters),phases:{}};
  if(!object(v)||!object(v.phases)||Object.values(operation.counters).some(x=>x===null)||['completed','errors','aborted'].some(k=>operation[k]===null)||operation.errors>operation.completed||operation.aborted>operation.completed)errors.add('INVALID_OPERATION');
  for(const phase of phases)if(Object.hasOwn(v?.phases||{},phase))operation.phases[phase]=cell(v.phases[phase],errors);
  if(Object.values(operation.phases).some(p=>p.operations>operation.completed))errors.add('PHASE_OPERATION_COUNT_MISMATCH');
  if(Object.keys(v?.phases||{}).some(k=>!phases.includes(k)))errors.add('UNSUPPORTED_PHASE_LABEL');
  out.operations[action]=operation;
 }
 if(Object.keys(value.operations||{}).some(k=>!actions.includes(k)))errors.add('UNSUPPORTED_OPERATION_LABEL');
 if(Object.values(out.operations).reduce((n,v)=>n+v.completed,0)!==out.completed_operations)errors.add('OPERATION_COUNT_MISMATCH');
 if(isCore){
  const b=value.journal_batches;
  out.journal_batches={...numeric(b,['active_batches','completed_batches','failed_batches','queued_items','settled_items','unattributed_items']),histogram:fixed(b?.histogram,['one_observation_per_batch_phase']),phases:{},queue_per_item:cell(b?.queue_per_item,errors)};
  for(const name of batchPhases)if(Object.hasOwn(b?.phases||{},name))out.journal_batches.phases[name]=cell(b.phases[name],errors);
  if(!object(b?.phases)||Object.keys(b.phases).some(k=>!batchPhases.includes(k)))errors.add('UNSUPPORTED_BATCH_PHASE_SCHEMA');
  if(!object(b)||out.journal_batches.histogram===null||['active_batches','completed_batches','failed_batches','queued_items','settled_items','unattributed_items'].some(k=>out.journal_batches[k]===null))errors.add('INVALID_JOURNAL_SCHEMA');
  const e=value.event_loop;
  out.event_loop={...numeric(e,['interval_ms','invalid_clock']),histogram:fixed(e?.histogram,['timer_callback_delay_after_nominal_interval']),running:typeof e?.running==='boolean'?e.running:null,samples:cell(e?.samples,errors)};
  if(out.event_loop.histogram===null||out.event_loop.interval_ms===null||out.event_loop.invalid_clock===null||out.event_loop.running===null)errors.add('INVALID_EVENT_LOOP_SCHEMA');
 }
 out.validation_errors=[...errors];return out;
}

/** Pure whitelist. Snapshots may be retained even when unavailable for deltas. */
export function sanitizeDiagnosticHealth(value,name){
 if(!services.includes(name)||!object(value))return {ok:false,error:'INVALID_HEALTH_OBJECT'};
 const identity=value.deployment_identity||value.identity;
 const out={ok:value.ok===true,source_commit:sha(value.source_commit),process_boot_id:id(value.process_boot_id),
  deployment_identity:{environment:fixed(identity?.environment,['sandbox','preproduction','production']),deployment_id:id(identity?.deployment_id),core_deployment_id:id(identity?.core_deployment_id||identity?.core_audience),game_id:fixed(identity?.game_id,games)},
  ...numeric(value,['memory_rss_bytes','uptime_seconds']),cpu_usage_microseconds:numeric(value.cpu_usage_microseconds,['user','system'])};
 out.durable_journal=numeric(value.durable_journal,['operations','commits','failed_commits','rejected_operations','max_batch','max_pending','pending','max_batch_limit','max_pending_limit','delay_ms','commit_ms_total','commit_ms_max'],number);
 out.sqlite_writes=numeric(value.sqlite_writes,['statements','total_ms','max_ms'],number);
 if(name==='core'){
  out.core_phases=phaseSnapshot(value.core_phases,'core');
  const t=value.wallet_transport;
  out.wallet_transport={...numeric(t,['requests','completed','failures','timed_out','rejected','connections','reused','max_pending','max_pool_entries','pending','retiring_calls','pool_entries','active_sockets','idle_sockets','queued_requests']),limits:numeric(t?.limits,['maxSockets','maxTotalSockets','maxPending','maxPools','maxCachedSessions','localHttpSockets','idleTimeoutMs','deadlineMs','bodyBytes']),timings_ms:{}};
  for(const phase of ['dns','pool_wait','tcp','tls','request_sent','headers','body','total'])out.wallet_transport.timings_ms[phase]=numeric(t?.timings_ms?.[phase],['count','min_ms','max_ms','mean_ms','p50_ms','p95_ms','p99_ms'],number);
 }else if(games.includes(name)){
  out.native_phases=phaseSnapshot(value.native_phases,'native');
  out.anyio_thread_limiter=numeric(value.anyio_thread_limiter,['total_tokens','borrowed_tokens','tasks_waiting']);
  out.callback_transport=numeric(value.callback_transport,['pool_limit','origin_pool_limit','requests','failures','in_flight','peak_in_flight','pool_wait_seconds_total','http_seconds_total','max_pool_wait_seconds','max_http_seconds'],number);
  if(name==='skygate-5000'){
   const t=value.callback_transport;
   out.callback_transport={...numeric(t,['schema_version','timeout_ms','max_inflight_per_origin','max_pending_per_origin','max_origins','active_origins','shared_tls_contexts','request_bytes_limit','response_bytes_limit','histogram_precision_significant_digits']),
    counts:numeric(t?.counts,['requests','completed','failures','timeouts','backpressure','inflight','pending','retiring','max_inflight','max_pending','max_retiring','dns_inflight','max_dns_inflight','sockets_started','reused_socket_requests','dns_lookups','dns_errors','tcp_connected','tls_connected','request_sent','response_headers']),timings:{}};
   for(const phase of ['pool_wait_ms','dns_lookup_ms','socket_to_tcp_ms','tcp_to_tls_ms','request_to_sent_ms','sent_to_headers_ms','headers_to_body_ms','total_ms'])out.callback_transport.timings[phase]=numeric(t?.timings?.[phase],['count','mean_ms','p50_ms','p95_ms','p99_ms','max_ms'],number);
   out.pending_operation_queues=integer(value.pending_operation_queues)?value.pending_operation_queues:null;
  }
  out.pending_operation_locks=integer(value.pending_operation_locks)?value.pending_operation_locks:null;
 }
 return out;
}

async function boundedJSON(response){
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>DIAGNOSTIC_LIMITS.response_bytes)){await response.body?.cancel();throw Error('RESPONSE_TOO_LARGE');}
 const reader=response.body?.getReader();if(!reader)throw Error('MISSING_RESPONSE_BODY');
 const chunks=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>DIAGNOSTIC_LIMITS.response_bytes)throw Error('RESPONSE_TOO_LARGE');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}catch{throw Error('INVALID_HEALTH_JSON');}
}
export async function captureGameplayBoundary(config,origins={}, {fetchImpl=globalThis.fetch,now=()=>new Date().toISOString()}={}){
 const boundary={started_at:now(),finished_at:null,services:{}};
 const targets={core:config.core_url,wallet:config.wallet_url,...Object.fromEntries(games.map(g=>[g,origins[g]||config.engine_origins?.[g]]))};
 await Promise.all(services.map(async name=>{
  const started_at=now();let result;
  try{
   const u=new URL(targets[name]);
   if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||config.allow_local===true&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('INVALID_DIAGNOSTIC_ORIGIN');
   const response=await fetchImpl(u.origin+'/health',{method:'GET',headers:{accept:'application/json','cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(DIAGNOSTIC_LIMITS.request_timeout_ms)});
   if(!response.ok){await response.body?.cancel();result={ok:false,error:'HEALTH_HTTP_ERROR',http_status:Number.isInteger(response.status)&&response.status>=100&&response.status<=599?response.status:null};}
   else result={...sanitizeDiagnosticHealth(await boundedJSON(response),name),http_status:response.status};
  }catch(error){result={ok:false,error:['INVALID_DIAGNOSTIC_ORIGIN','RESPONSE_TOO_LARGE','MISSING_RESPONSE_BODY','INVALID_HEALTH_JSON'].includes(error?.message)?error.message:'DIAGNOSTIC_UNAVAILABLE'};}
  boundary.services[name]={...result,started_at,finished_at:now()};
 }));boundary.finished_at=now();return boundary;
}

function monotone(before,after,errors){if(!number(before)||!number(after)||after<before){errors.add('COUNTER_DECREASE_OR_INVALID');return null;}return after-before;}
function cellDelta(before=zeroCell(),after=zeroCell(),errors){
 const out={};for(const k of ['operations','invocations','total_us'])out[k]=monotone(before[k],after[k],errors);
 for(const k of ['max_operation_us','max_invocation_us'])if(!integer(before[k])||!integer(after[k])||after[k]<before[k])errors.add('CUMULATIVE_MAXIMUM_DECREASED');
 out.buckets=PHASE_BUCKETS.map((_,i)=>monotone(before.buckets?.[i],after.buckets?.[i],errors));
 // Maxima are intentionally absent: subtracting lifetime maxima is invalid.
 if(out.buckets.reduce((n,v)=>n+v,0)!==out.operations||out.invocations<out.operations)errors.add('INVALID_INTERVAL_HISTOGRAM');
 return out;
}
function comparePhases(before,after,kind){
 const errors=new Set(),isCore=kind==='core';
 if(!before||!after)return {comparable:false,errors:['PHASES_NOT_EXPOSED']};
 if(before.validation_errors.length||after.validation_errors.length)errors.add('INVALID_PHASE_SNAPSHOT');
 if(before.schema!==1||after.schema!==1||before.histogram!==after.histogram||!equal(before.bucket_upper_us,after.bucket_upper_us)||before.capture_limit!==after.capture_limit||isCore&&before.span_limit_per_capture!==after.span_limit_per_capture)errors.add('PHASE_SCHEMA_MISMATCH');
 if(!before.registry_id||!after.registry_id)errors.add('REGISTRY_ID_NOT_EXPOSED');
 else if(before.registry_id!==after.registry_id)errors.add('REGISTRY_ID_CHANGED');
 if(before.reset_count!==0||after.reset_count!==0)errors.add('RESET_IDENTITY_UNVERIFIED');
 if(before.active_captures!==0||after.active_captures!==0)errors.add('ACTIVE_CAPTURES_AT_BOUNDARY');
 if(before.telemetry_error!==false||after.telemetry_error!==false)errors.add('TELEMETRY_ERROR');
 if(before.saturated!==false||after.saturated!==false)errors.add('COUNTER_SATURATED');
 for(const key of ['dropped_captures',...(isCore?['dropped_spans','invalid_clock','late_observations']:[])])if(before[key]!==after[key])errors.add('INTERVAL_TELEMETRY_LOSS');
 if(isCore&&[before,after].some(p=>p.journal_batches.active_batches!==0||p.journal_batches.queued_items!==p.journal_batches.settled_items))errors.add('UNSETTLED_JOURNAL_AT_BOUNDARY');
 const actions=isCore?coreActions:nativeActions,counters=isCore?coreCounters:nativeCounters,phases=isCore?corePhases:nativePhases;
 const delta={completed_operations:monotone(before.completed_operations,after.completed_operations,errors),operations:{}};
 for(const action of actions){
  const b=before.operations[action],a=after.operations[action];if(!b&&!a)continue;
  const d={};for(const k of ['completed','errors','aborted'])d[k]=monotone(b?.[k]??0,a?.[k]??0,errors);
  d.counters={};for(const k of counters)d.counters[k]=monotone(b?.counters[k]??0,a?.counters[k]??0,errors);
  if(d.counters.invalid_clock!==0||d.counters.dropped_spans!==0)errors.add('INTERVAL_TELEMETRY_LOSS');
  d.phases={};for(const phase of phases)if(b?.phases[phase]||a?.phases[phase])d.phases[phase]=cellDelta(b?.phases[phase],a?.phases[phase],errors);
  delta.operations[action]=d;
 }
 if(isCore){
  const b=before.journal_batches,a=after.journal_batches;delta.journal_batches={phases:{}};
  for(const k of ['completed_batches','failed_batches','queued_items','settled_items','unattributed_items'])delta.journal_batches[k]=monotone(b[k],a[k],errors);
  for(const k of batchPhases)if(b.phases[k]||a.phases[k])delta.journal_batches.phases[k]=cellDelta(b.phases[k],a.phases[k],errors);
  delta.journal_batches.queue_per_item=cellDelta(b.queue_per_item,a.queue_per_item,errors);
  if(before.event_loop.invalid_clock!==after.event_loop.invalid_clock||before.event_loop.interval_ms!==after.event_loop.interval_ms||!before.event_loop.running||!after.event_loop.running)errors.add('EVENT_LOOP_INTERVAL_UNVERIFIED');
  delta.event_loop_samples=cellDelta(before.event_loop.samples,after.event_loop.samples,errors);
 }
 return errors.size?{comparable:false,errors:[...errors]}:{comparable:true,errors:[],delta};
}

export function compareGameplayBoundaries(before,after){
 const result={schema_version:1,scope:'process_wide_interval_including_background_work',services:{},
  interpretation:'Deltas use additive counters and fixed histogram buckets only. Phases overlap; do not sum phase percentiles or subtract lifetime maxima. Other traffic and background work may be included. Diagnostic availability never changes qualification gates.'};
 for(const name of services){
  const b=before?.services?.[name],a=after?.services?.[name],errors=[];
  if(!b?.ok||!a?.ok)errors.push('HEALTH_SNAPSHOT_UNAVAILABLE');
  if(!b?.source_commit||b.source_commit!==a?.source_commit)errors.push('SOURCE_CHANGED_OR_MISSING');
  if(!b?.process_boot_id||b.process_boot_id!==a?.process_boot_id)errors.push('PROCESS_CHANGED_OR_MISSING');
  if(!b?.deployment_identity?.environment||!b?.deployment_identity?.deployment_id||!equal(b.deployment_identity,a?.deployment_identity))errors.push('DEPLOYMENT_CHANGED_OR_MISSING');
  if(Date.parse(b?.finished_at)>Date.parse(a?.started_at)||!Number.isFinite(Date.parse(b?.finished_at))||!Number.isFinite(Date.parse(a?.started_at)))errors.push('BOUNDARY_ORDER_UNVERIFIED');
  const kind=name==='core'?'core':'native',key=kind+'_phases';
  result.services[name]={identity_stable:errors.length===0,...(errors.length?{comparable:false,errors}:name==='wallet'?{comparable:false,errors:['PHASES_NOT_EXPOSED']}:{...comparePhases(b[key],a[key],kind)})};
 }
 return result;
}

/** Safe for platform logs: bounded run/source identity, fixed keys and numeric
 * aggregates. No actor, player, round, URL, credential or exception text. */
export function completionAggregate(report,stepId){
 const cleanLatency=value=>numeric(value,['count','p50_ms','p95_ms','p99_ms'],number);
 const out={schema_version:1,step:fixed(stepId,['load500','load1000','soak60m','wallet-conformance','network-restart','volume-recovery']),
  status:fixed(report?.status,['PASS','PARTIAL','FAIL','INTERRUPTED']),
  classification:fixed(report?.classification,['real_native_session_http_load']),run_id:runId(report?.run_id),
  started_at:timestamp(report?.started_at),finished_at:timestamp(report?.finished_at),source_commit:sha(report?.runner?.source_commit),source_commits:{},
  ...numeric(report,['requested_concurrent_sessions','established_sessions','completed_rounds','sessions_with_completed_rounds']),
  actual_execution_seconds:number(report?.actual_execution_seconds)?report.actual_execution_seconds:null,cleanup:numeric(report?.cleanup,['sessions','revoked']),completed_by_game:{},
  round_latency:cleanLatency(report?.round_latency),round_latency_by_game:{},
  request_error_rate:number(report?.metrics?.request_error_rate)&&report.metrics.request_error_rate<=1?report.metrics.request_error_rate:null,
  reconciliation_passed:['PASS','FAIL'].includes(report?.reconciliation?.status)?report.reconciliation.status==='PASS':null,duplicate_results_verified:typeof report?.duplicate_results_verified==='boolean'?report.duplicate_results_verified:null,gates:{},diagnostic_comparability:{}};
 for(const name of ['core','wallet','uno','mahjong','skygate'])out.source_commits[name]=sha(report?.runner?.source_snapshot?.[name]?.source_commit);
 for(const game of games){out.round_latency_by_game[game]=cleanLatency(report?.round_latency_by_game?.[game]);out.completed_by_game[game]=integer(report?.completed_by_game?.[game])?report.completed_by_game[game]:null;}
 for(const gate of ['concurrent_sessions','all_sessions_played','no_round_failures','exactly_once_reconciliation','duplicate_native_results','request_error_rate','round_latency','soak_duration','source_identity_stable','server_resource_ceilings'])out.gates[gate]=typeof report?.gates?.[gate]==='boolean'?report.gates[gate]:null;
 for(const name of services)out.diagnostic_comparability[name]=report?.gameplay_diagnostics?.comparison?.services?.[name]?.comparable===true;
 return out;
}
