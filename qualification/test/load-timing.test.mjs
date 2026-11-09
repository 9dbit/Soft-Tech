import test from 'node:test';
import assert from 'node:assert/strict';
import {runNativeLoad,Metrics} from '../native-load.mjs';
test('early failed soak reports elapsed seconds and cannot satisfy its minimum duration',async()=>{
 const saved=globalThis.fetch,runId='unit-early-soak-fixture';let nativeHealth=0;
 globalThis.fetch=async(input)=>{const u=new URL(input),ok=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  if(u.pathname==='/health'){if(u.hostname==='native.fixture')nativeHealth++;return ok({ok:true,source_commit:nativeHealth>1&&u.hostname==='native.fixture'?'b'.repeat(40):'a'.repeat(40),identity:{environment:'preproduction',deployment_id:u.hostname}});}
  if(u.pathname==='/admin/accounts')return ok({seeded:true});
  if(u.pathname==='/v1/game-launches')return ok({environment:'preproduction',session_id:'ss_fixture',launch_url:'https://native.fixture/#softtech_launch=private-fixture-token'});
  if(u.pathname==='/api/agency/launch')return ok({launched:true});
  if(u.pathname==='/api/agency/state'){await new Promise(r=>setTimeout(r,200));return new Response('{"error":"unit-fixture-unavailable"}',{status:503});}
  if(u.pathname==='/v1/transactions')return ok({data:[]});
  if(u.pathname==='/v1/reconciliation')return ok({status:'matched'});
  if(u.pathname==='/admin/report')return ok({accounts:[{player_ref:runId+'-p0'}],transactions:[],reconciliation:{status:'matched'}});
  if(u.pathname==='/v1/sessions/ss_fixture/revoke')return ok({revoked:true});
  throw Error('Unexpected fixture URL '+u.pathname);
 };
 try{const began=performance.now(),r=await runNativeLoad({allow_small_test:true,allow_local:true,environment:'preproduction',core_audience:'fixture-core',core_url:'https://core.fixture',wallet_url:'https://wallet.fixture',wallet_admin_token:'fixture-admin',operator:{id:'op_qualification_fixture',key_id:'fixture-key',secret:'fixture-secret',wallet_secret:'fixture-wallet-secret',protocol_version:2},engine_origins:{'uno-luck':'https://native.fixture'}},{concurrency:1,durationSeconds:5,minSoakSeconds:5,runId});
  assert.equal(r.status,'FAIL');assert.equal(r.failures.length,1);assert.equal(r.gates.soak_duration,false);assert.ok(r.actual_execution_seconds>0.15);assert.ok(r.actual_execution_seconds<=(performance.now()-began)/1000+0.05,'Elapsed field must use seconds, not milliseconds');assert.equal(r.gates.source_identity_stable,false,'Source changed between health observations must fail');assert.equal(r.cleanup.revoked,1);
 }finally{globalThis.fetch=saved;}
});

// Three fixed game labels prevent caller-derived histogram cardinality.
test('round timing keeps the global gate sample and bounded independent game samples',()=>{
 const metrics=new Metrics(),games=['uno-luck','mahjong-wild','skygate-5000'];
 for(let i=0;i<100001;i++)for(const game of games)metrics.recordRound(i%1000,game);
 const global=metrics.roundSummary(),byGame=metrics.roundSummaryByGame();
 assert.equal(global.count,300003);assert.equal(global.sample_count,100000);assert.equal(global.estimator,'uniform_reservoir_sample');
 assert.deepEqual(Object.keys(byGame),games);
 for(const stats of Object.values(byGame)){assert.equal(stats.count,100001);assert.equal(stats.sample_count,100000);assert.equal(stats.estimator,'uniform_reservoir_sample');assert.ok(stats.p95_ms>=0&&stats.p95_ms<=999);}
 metrics.recordRound(20000,'untrusted-player-derived-label');assert.deepEqual(Object.keys(metrics.roundSummaryByGame()),games);assert.equal(metrics.roundSummary().count,300004);
});
