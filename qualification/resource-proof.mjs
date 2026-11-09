/* Attaches authoritative platform resource summaries without rewriting a run.
   Whole-window maxima bound sampled run maxima; whole-window means are never
   relabelled as means of the smaller qualification interval. */
import {readFileSync,realpathSync,existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {args,digest,persist} from './client.mjs';
const names=['core','wallet','uno','mahjong','skygate','runner'];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
// Summing identical binary floats can put a platform mean a few ULPs outside
// its reported min/max. This tolerance validates summary consistency only;
// the resource budget comparisons below remain strict and unchanged.
const statisticLTE=(a,b)=>a<=b||a-b<=16*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b));
const when=s=>typeof s==='string'?Date.parse(s):NaN;
const validId=s=>typeof s==='string'&&s.length>=8;
export function buildResourceProof(report,metrics,limits,{inputDigests={}}={}){
 const errors=[],out={schema_version:1,classification:'qualification_resource_attachment',run_id:report.run_id,created_at:new Date().toISOString(),original_run_status:report.status,original_report_unchanged:true,inputs:inputDigests,status:'FAIL',combined_status:'FAIL',services:[],errors};
 const require=(ok,code)=>{if(!ok)errors.push(code);return ok;};
 const start=when(report.started_at),end=when(report.finished_at),queryStart=when(metrics.query_started_at),queryEnd=when(metrics.captured_at);
 require(report.classification==='real_native_session_http_load','REAL_NATIVE_LOAD_REPORT_REQUIRED');require(finite(start)&&finite(end)&&end>=start,'RUN_TIMESTAMPS_REQUIRED');
 require(metrics.classification==='railway_authoritative_resource_summary','AUTHORITATIVE_RAILWAY_SUMMARY_REQUIRED');
 require(finite(queryStart)&&finite(queryEnd)&&queryEnd>=queryStart&&finite(metrics.hours_back)&&metrics.hours_back>0&&metrics.hours_back<=168,'METRICS_QUERY_WINDOW_REQUIRED');
 require(Number.isInteger(metrics.sample_rate_seconds)&&metrics.sample_rate_seconds>0,'METRICS_SAMPLE_INTERVAL_REQUIRED');
 // Query execution is somewhere between start and response. The intersection
 // below is guaranteed to be enclosed by every possible hoursBack window.
 const coverageStart=queryEnd-metrics.hours_back*3600000,coverageEnd=queryStart;
 require(coverageStart<=start&&coverageEnd>=end,'SUMMARY_DOES_NOT_COVER_COMPLETE_RUN');
 if(finite(coverageStart)&&finite(coverageEnd))out.coverage={mode:'enclosing_platform_window',guaranteed_start:new Date(coverageStart).toISOString(),guaranteed_end:new Date(coverageEnd).toISOString(),run_started_at:report.started_at,run_finished_at:report.finished_at,sample_rate_seconds:metrics.sample_rate_seconds,run_window_averages_available:false,scope:'Peaks are maxima of platform samples across the enclosing window, possibly including other activity. Means are whole-window means. Unsampled instantaneous spikes are not measured.'};
 require(limits.classification==='railway_authoritative_resource_limits','AUTHORITATIVE_LIMITS_REQUIRED');
 require(when(limits.valid_from)<=start&&when(limits.valid_until)>=end,'LIMITS_DO_NOT_COVER_RUN');
 require(validId(limits.environment_id),'PLATFORM_ENVIRONMENT_ID_REQUIRED');
 require(when(limits.budget_declared_at)<=start,'RESOURCE_BUDGET_MUST_PREDATE_RUN');
 const seen=new Set(),volumes=new Set();
 for(const name of names){
  const expected=name==='runner'?report.runner?.deployment_id:report.runner?.source_snapshot?.[name]?.deployment_id;
  const service=metrics.services?.find(s=>s.kind===name),limit=limits.services?.find(s=>s.kind===name);
  if(!require(validId(expected)&&service?.service?.id===expected&&limit?.service_id===expected,'SERVICE_ID_MISSING_OR_MISMATCH_'+name))continue;
  require(service.environment?.id===limits.environment_id,'ENVIRONMENT_MISMATCH_'+name);
  require(!seen.has(expected),'SHARED_SERVICE_ID_'+name);seen.add(expected);
  require(validId(limit.volume_id)&&!volumes.has(limit.volume_id),'DISTINCT_VOLUME_ID_REQUIRED_'+name);volumes.add(limit.volume_id);
  require(limit.replicas===1,'SINGLE_REPLICA_LIMIT_REQUIRED_'+name);
  require(finite(limit.cpu_limit_vcpu)&&limit.cpu_limit_vcpu>0&&finite(limit.memory_limit_gb)&&limit.memory_limit_gb>0&&finite(limit.disk_capacity_gb)&&limit.disk_capacity_gb>0,'CPU_MEMORY_DISK_LIMITS_REQUIRED_'+name);
  const budget=limit.budget||{};require(['cpu_peak_fraction','memory_peak_fraction','disk_peak_fraction'].every(k=>finite(budget[k])&&budget[k]>0&&budget[k]<=1),'DECLARED_RESOURCE_BUDGET_REQUIRED_'+name);
  const byName=new Map((service.metrics||[]).map(m=>[m.measurement,m])),measurements={};
  for(const mname of ['CPU_USAGE','CPU_LIMIT','MEMORY_USAGE_GB','MEMORY_LIMIT_GB','DISK_USAGE_GB']){
   const m=byName.get(mname);if(!require(m&&Number.isInteger(m.sampleCount)&&m.sampleCount>0&&['current','average','min','max'].every(k=>finite(m[k])&&m[k]>=0)&&statisticLTE(m.min,m.average)&&statisticLTE(m.average,m.max)&&statisticLTE(m.min,m.current)&&statisticLTE(m.current,m.max),'VALID_METRIC_REQUIRED_'+name+'_'+mname))continue;
   measurements[mname]={sample_count:m.sampleCount,enclosing_window_peak:m.max,enclosing_window_average:m.average,latest_sample:m.current,exact_run_window_average:null};
  }
  const cpu=byName.get('CPU_USAGE')?.max,memory=byName.get('MEMORY_USAGE_GB')?.max,disk=byName.get('DISK_USAGE_GB')?.max;
  const checks={cpu:finite(cpu)&&cpu<=limit.cpu_limit_vcpu*budget.cpu_peak_fraction,memory:finite(memory)&&memory<=limit.memory_limit_gb*budget.memory_peak_fraction,disk:finite(disk)&&disk<=limit.disk_capacity_gb*budget.disk_peak_fraction};
  for(const [kind,ok]of Object.entries(checks))require(ok,'SAMPLED_RESOURCE_CEILING_EXCEEDED_OR_UNKNOWN_'+name+'_'+kind);
  out.services.push({kind:name,service_id:expected,source_commit:name==='runner'?report.runner?.source_commit:report.runner?.source_snapshot?.[name]?.source_commit,volume_id:limit.volume_id,limits:{cpu_vcpu:limit.cpu_limit_vcpu,memory_gb:limit.memory_limit_gb,disk_gb:limit.disk_capacity_gb},budget,measurements,checks});
 }
 out.status=errors.length?'FAIL':'PASS';out.server_resource_ceilings=errors.length===0;
 const functional=report.gates&&['concurrent_sessions','all_sessions_played','no_round_failures','exactly_once_reconciliation','duplicate_native_results','request_error_rate','round_latency'].every(k=>report.gates[k]===true)&&Object.entries(report.gates).filter(([name])=>name!=='server_resource_ceilings').every(([,value])=>value!==false)&&(report.duration_target_seconds>0?report.gates.soak_duration===true:true);
 out.combined_status=out.status==='PASS'&&functional&&['PASS','PARTIAL'].includes(report.status)?'PASS':'FAIL';
 out.note='This attachment never changes the original report or converts a failed functional/latency run into a pass. An independent reviewer must validate the provenance of supplied platform summaries, effective limits and prior budget.';
 return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=args();for(const key of ['load','metrics','limits','report'])if(typeof a[key]!=='string')throw Error('Use --load --metrics --limits --report');
 const inputs={};for(const key of ['load','metrics','limits'])inputs[key]=readFileSync(a[key]);
 const target=existsSync(a.report)?realpathSync(a.report):path.resolve(a.report);for(const key of ['load','metrics','limits'])if(realpathSync(a[key])===target)throw Error('Refuse to overwrite input evidence');
 const result=buildResourceProof(...['load','metrics','limits'].map(k=>JSON.parse(inputs[k])),{inputDigests:Object.fromEntries(Object.entries(inputs).map(([k,b])=>[k,{sha256:digest(b),size_bytes:b.length}]))});
 persist(a.report,result);console.log(JSON.stringify({status:result.status,combined_status:result.combined_status,run_id:result.run_id,errors:result.errors}));if(result.status!=='PASS')process.exitCode=1;
 }catch(e){console.error(String(e.message));process.exitCode=1;}}
