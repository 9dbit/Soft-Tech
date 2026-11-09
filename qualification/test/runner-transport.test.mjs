import test from 'node:test';
import assert from 'node:assert/strict';
import {fork,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {RunnerDiagnostics} from '../runner-diagnostics.mjs';

test('verified local TLS500: unchanged barrier/requests and isolated per-VU persistent sockets',{timeout:90000},async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'runner-transport-')),key=path.join(dir,'fixture.key'),cert=path.join(dir,'fixture.pem');
 const ca=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',key,'-out',cert,'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{encoding:'utf8'});assert.equal(ca.status,0,'Synthetic fixture certificate generation failed');
 const server=fork(new URL('./helpers/runner-tls-server.mjs',import.meta.url),[key,cert],{stdio:['ignore','ignore','pipe','ipc']});let serverError='';server.stderr.on('data',c=>serverError+=c);
 const ask=async message=>{const answer=once(server,'message');server.send(message);return (await answer)[0];};
 try{const {origins}=(await once(server,'message'))[0];
  const run=async(mode,trust=true)=>{const child=fork(new URL('./helpers/runner-tls-client.mjs',import.meta.url),[mode,JSON.stringify(origins)],{env:{...process.env,NODE_EXTRA_CA_CERTS:trust?cert:''},stdio:['ignore','pipe','pipe','ipc']});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('message',async m=>{if(m.ready){await ask('barrier');child.send({go:true});}});const [code]=await once(child,'exit');assert.equal(code,0,stderr);return JSON.parse(stdout.trim());};
  const shared=await run('shared_fetch'),sharedCounts=(await ask('counts')).counts;await ask('reset');const dedicated=await run('per_user_https'),dedicatedCounts=(await ask('counts')).counts;
  for(const [result,counts]of [[shared,sharedCounts],[dedicated,dedicatedCounts]]){assert.equal(result.sessions,500);assert.equal(result.rounds,500);assert.equal(result.actual_native_requests,2334);assert.equal(counts.requests,2334);assert.equal(counts.launches,500);assert.equal(counts.state,500);assert.equal(counts.rounds,500);assert.equal(counts.duplicates,500);assert.equal(counts.roundsBeforeBarrier,0);assert.equal(result.diagnostics.observer_errors,0);assert.equal(result.diagnostics.phases.running.counts.request_sent,1834);assert.equal(result.diagnostics.phases.running.counts.response_headers,1834);assert.ok(result.diagnostics.phases.running.runtime.event_loop_delay.sample_count>0);}
  assert.ok(shared.diagnostics.phases.running.counts.sockets_started>100,'Shared pool must demonstrate the cold connection surge');assert.equal(dedicated.diagnostics.phases.setup.counts.sockets_started,500);assert.equal(dedicated.diagnostics.phases.running.counts.sockets_started,0);assert.equal(dedicated.diagnostics.phases.running.counts.reused_socket_requests,1834);assert.equal(dedicatedCounts.connections,500);
  await run('semantics');const afterSemantics=(await ask('counts')).counts;assert.equal(afterSemantics.requests-dedicatedCounts.requests,14,'Disconnect, redirect, idle expiry and timeout never insert an implicit extra HTTP request');await run('untrusted',false);assert.equal((await ask('counts')).counts.requests,afterSemantics.requests,'Untrusted TLS fails before HTTP');
  const output={classification:'synthetic_local_tls_transport_comparison',shared,per_user:dedicated,shared_server:sharedCounts,per_user_server:dedicatedCounts};if(process.env.RUNNER_FIXTURE_REPORT)writeFileSync(process.env.RUNNER_FIXTURE_REPORT,JSON.stringify(output,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({classification:output.classification,shared_round_p95_ms:shared.round_latency.p95_ms,per_user_round_p95_ms:dedicated.round_latency.p95_ms,shared_running_new_sockets:shared.diagnostics.phases.running.counts.sockets_started,per_user_running_new_sockets:dedicated.diagnostics.phases.running.counts.sockets_started}));
 }finally{server.send('close');await once(server,'exit');rmSync(dir,{recursive:true,force:true});}
 assert.equal(serverError,'');
});

test('the phase boundary retains a live event-loop monitor and cleanup unsubscribes it',async()=>{
 const d=new RunnerDiagnostics();await new Promise(r=>setTimeout(r,25));d.setPhase('running');const until=performance.now()+50;while(performance.now()<until){}await new Promise(r=>setTimeout(r,25));const proof=d.stop();assert.ok(proof.phases.running.runtime.scheduled_timer_lag_ms.max_ms>=40);assert.ok(proof.phases.running.runtime.cpu_user_ms>0);assert.equal(proof.observer_errors,0);const next=new RunnerDiagnostics();next.stop();
});
