import test from 'node:test';
import assert from 'node:assert/strict';
import {buildResourceProof} from '../resource-proof.mjs';
function fixture(){
 const names=['core','wallet','uno','mahjong','skygate','runner'],start='2026-01-01T12:10:00Z',end='2026-01-01T12:11:00Z';
 const report={run_id:'unit-resource-fixture',classification:'real_native_session_http_load',status:'PARTIAL',started_at:start,finished_at:end,gates:{concurrent_sessions:true,all_sessions_played:true,no_round_failures:true,exactly_once_reconciliation:true,duplicate_native_results:true,request_error_rate:true,round_latency:true,server_resource_ceilings:null},runner:{source_commit:'a'.repeat(40),deployment_id:'fixture-runner',source_snapshot:Object.fromEntries(names.slice(0,5).map(n=>[n,{deployment_id:'fixture-'+n,source_commit:'b'.repeat(40)}]))}};
 const metrics={classification:'railway_authoritative_resource_summary',query_started_at:'2026-01-01T12:12:00Z',captured_at:'2026-01-01T12:12:01Z',hours_back:1,sample_rate_seconds:30,services:names.map(n=>({kind:n,service:{id:'fixture-'+n},environment:{id:'fixture-environment'},metrics:['CPU_USAGE','CPU_LIMIT','MEMORY_USAGE_GB','MEMORY_LIMIT_GB','DISK_USAGE_GB'].map(name=>({measurement:name,current:name.includes('LIMIT')?1:.2,min:0,max:name.includes('LIMIT')?1:.3,average:.1,sampleCount:121}))}))};
 const limits={classification:'railway_authoritative_resource_limits',environment_id:'fixture-environment',valid_from:'2026-01-01T12:00:00Z',valid_until:'2026-01-01T12:13:00Z',budget_declared_at:'2026-01-01T11:59:00Z',services:names.map(n=>({kind:n,service_id:'fixture-'+n,volume_id:'fixture-volume-'+n,replicas:1,cpu_limit_vcpu:1,memory_limit_gb:1,disk_capacity_gb:1,budget:{cpu_peak_fraction:.8,memory_peak_fraction:.8,disk_peak_fraction:.8}}))};return {report,metrics,limits};
}
test('enclosing-hour summaries produce sampled peak bounds without inventing exact-run averages',()=>{const {report,metrics,limits}=fixture(),r=buildResourceProof(report,metrics,limits);assert.equal(r.status,'PASS',r.errors.join(','));assert.equal(r.combined_status,'PASS');assert.equal(r.coverage.run_window_averages_available,false);assert.equal(r.services[0].measurements.CPU_USAGE.enclosing_window_average,.1);assert.equal(r.services[0].measurements.CPU_USAGE.exact_run_window_average,null);assert.equal(report.status,'PARTIAL');});
test('incomplete time coverage and absent disk/limit measurements cannot satisfy the resource gate',()=>{const {report,metrics,limits}=fixture();metrics.query_started_at='2026-01-01T12:10:30Z';metrics.captured_at='2026-01-01T12:10:31Z';metrics.services[0].metrics=metrics.services[0].metrics.filter(m=>m.measurement!=='DISK_USAGE_GB');delete limits.services[1].disk_capacity_gb;const r=buildResourceProof(report,metrics,limits);assert.equal(r.status,'FAIL');assert.ok(r.errors.includes('SUMMARY_DOES_NOT_COVER_COMPLETE_RUN'));assert.ok(r.errors.includes('VALID_METRIC_REQUIRED_core_DISK_USAGE_GB'));assert.ok(r.errors.includes('CPU_MEMORY_DISK_LIMITS_REQUIRED_wallet'));});
test('passing resource measurements cannot erase a failed native round or a later changed budget',()=>{const {report,metrics,limits}=fixture();report.status='FAIL';report.gates.round_latency=false;assert.equal(buildResourceProof(report,metrics,limits).combined_status,'FAIL');limits.budget_declared_at='2026-01-01T12:11:00Z';assert.ok(buildResourceProof(report,metrics,limits).errors.includes('RESOURCE_BUDGET_MUST_PREDATE_RUN'));});
test('wrong service identity, duplicated volume and missing runner proof are rejected',()=>{const {report,metrics,limits}=fixture();limits.services[1].volume_id=limits.services[0].volume_id;metrics.services[2].service.id='another-native-service';metrics.services.pop();const r=buildResourceProof(report,metrics,limits);assert.equal(r.status,'FAIL');assert.ok(r.errors.includes('DISTINCT_VOLUME_ID_REQUIRED_wallet'));assert.ok(r.errors.includes('SERVICE_ID_MISSING_OR_MISMATCH_uno'));assert.ok(r.errors.includes('SERVICE_ID_MISSING_OR_MISMATCH_runner'));});
test('actual platform float-mean roundoff is accepted without relaxing a resource budget ceiling',()=>{
 const {report,metrics,limits}=fixture(),m=metrics.services.find(s=>s.kind==='mahjong').metrics.find(m=>m.measurement==='MEMORY_LIMIT_GB');
 Object.assign(m,{min:.99999744,max:.99999744,current:.99999744,average:.9999974400000011});
 assert.equal(buildResourceProof(report,metrics,limits).status,'PASS');
 m.average=.99999745;assert.ok(buildResourceProof(report,metrics,limits).errors.includes('VALID_METRIC_REQUIRED_mahjong_MEMORY_LIMIT_GB'));
 m.average=.9999974400000011;const cpu=metrics.services[0].metrics.find(m=>m.measurement==='CPU_USAGE');cpu.max=.8000000000000002;
 const exceeded=buildResourceProof(report,metrics,limits);assert.equal(exceeded.status,'FAIL');assert.ok(exceeded.errors.includes('SAMPLED_RESOURCE_CEILING_EXCEEDED_OR_UNKNOWN_core_cpu'));
});
test('all-zero Core metric series cannot certify resources or mutate the original report',()=>{
 const {report,metrics,limits}=fixture(),original=structuredClone(report);
 for(const m of metrics.services[0].metrics)Object.assign(m,{current:0,average:0,min:0,max:0});
 const r=buildResourceProof(report,metrics,limits);
 assert.equal(r.status,'FAIL');assert.equal(r.combined_status,'FAIL');assert.equal(r.server_resource_ceilings,false);
 assert.ok(r.errors.includes('OBSERVED_CPU_LIMIT_MISSING_OR_MISMATCH_core'));
 assert.ok(r.errors.includes('OBSERVED_MEMORY_LIMIT_MISSING_OR_MISMATCH_core'));
 assert.deepEqual(r.services[0].observed_limit_checks,{cpu:false,memory:false});
 assert.deepEqual(report,original);
});
test('positive current limits allow genuine zero usage and historical zero limit minima',()=>{
 const {report,metrics,limits}=fixture();
 for(const s of metrics.services)for(const m of s.metrics)Object.assign(m,m.measurement.includes('LIMIT')?{current:1,min:0,max:1,average:.9}:{current:0,min:0,max:0,average:0});
 const r=buildResourceProof(report,metrics,limits);
 assert.equal(r.status,'PASS',r.errors.join(','));assert.equal(r.combined_status,'PASS');
 assert.deepEqual(r.services[0].observed_limit_checks,{cpu:true,memory:true});
 assert.equal(r.services[0].measurements.CPU_USAGE.enclosing_window_peak,0);
});
test('missing or unusable latest observed limits fail despite positive historical samples',()=>{
 for(const measurement of ['CPU_LIMIT','MEMORY_LIMIT_GB'])for(const missing of [true,false]){
  const {report,metrics,limits}=fixture(),service=metrics.services[0];
  if(missing)service.metrics=service.metrics.filter(m=>m.measurement!==measurement);
  else service.metrics.find(m=>m.measurement===measurement).current=0;
  const r=buildResourceProof(report,metrics,limits),kind=measurement==='CPU_LIMIT'?'CPU':'MEMORY';
  assert.equal(r.status,'FAIL');assert.ok(r.errors.includes('OBSERVED_'+kind+'_LIMIT_MISSING_OR_MISMATCH_core'));
 }
});
test('mismatched current CPU or memory limits cannot match a declared effective limit',()=>{
 for(const [measurement,value] of [['CPU_LIMIT',2],['CPU_LIMIT',.9999999999999999],['MEMORY_LIMIT_GB',2],['MEMORY_LIMIT_GB',.99999]]){
  const {report,metrics,limits}=fixture(),m=metrics.services[0].metrics.find(m=>m.measurement===measurement);
  Object.assign(m,{current:value,max:Math.max(value,m.max)});
  const r=buildResourceProof(report,metrics,limits),kind=measurement==='CPU_LIMIT'?'CPU':'MEMORY';
  assert.equal(r.status,'FAIL');assert.ok(r.errors.includes('OBSERVED_'+kind+'_LIMIT_MISSING_OR_MISMATCH_core'));
 }
});
test('one-page RAM rounding allowance never relaxes a usage budget ceiling',()=>{
 const {report,metrics,limits}=fixture(),m=metrics.services[0].metrics.find(m=>m.measurement==='MEMORY_LIMIT_GB');
 Object.assign(m,{current:.99999744,min:0,max:1,average:.9});
 assert.equal(buildResourceProof(report,metrics,limits).status,'PASS');
 m.current=(1e9-4096)/1e9;assert.equal(buildResourceProof(report,metrics,limits).status,'PASS');
 m.current=(1e9-8192)/1e9;
 assert.ok(buildResourceProof(report,metrics,limits).errors.includes('OBSERVED_MEMORY_LIMIT_MISSING_OR_MISMATCH_core'));
 m.current=.99999744;metrics.services[0].metrics.find(m=>m.measurement==='MEMORY_USAGE_GB').max=.8000000000000002;
 const r=buildResourceProof(report,metrics,limits);assert.equal(r.status,'FAIL');
 assert.ok(r.errors.includes('SAMPLED_RESOURCE_CEILING_EXCEEDED_OR_UNKNOWN_core_memory'));
});
test('enclosing-window limit maxima may describe another arm when current limits agree',()=>{
 const {report,metrics,limits}=fixture(),service=metrics.services[0];
 Object.assign(service.metrics.find(m=>m.measurement==='CPU_LIMIT'),{current:1,min:0,max:2,average:1.2});
 Object.assign(service.metrics.find(m=>m.measurement==='MEMORY_LIMIT_GB'),{current:.99999744,min:0,max:8,average:1.3});
 const r=buildResourceProof(report,metrics,limits);assert.equal(r.status,'PASS',r.errors.join(','));
 assert.deepEqual(r.services[0].observed_limit_checks,{cpu:true,memory:true});
});
