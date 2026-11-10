import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Core} from '../lib/core.mjs';
import {nativeHealthSummary} from '../lib/native-health-summary.mjs';

const games=['uno-luck','mahjong-wild','skygate-5000'];
const identity=game=>({environment:'preproduction',deployment_id:'engine-test-'+game,core_deployment_id:'core-health-fixture',game_id:game,identity_version:1,identity_bound:true,physical_isolation_verified:false,play_enabled:true});
const health=game=>({native_phases:{large_diagnostics:'x'.repeat(50000)},ok:true,provider:'soft-tech',source_commit:'a'.repeat(40),version:'test',deployment_identity:identity(game),native_volume:{required:true,verified:true,verification:'linux_mountinfo',filesystem_type:'ext4'}});

test('large diagnostics preceding identity remain valid bounded JSON without retaining arbitrary fields',()=>{
 const data={...health(games[0]),unexpected_secret:'never-persist',deep:{arbitrary:'never-persist'}};
 assert.throws(()=>JSON.parse(JSON.stringify(data).slice(0,16000)));
 const raw=nativeHealthSummary(data),stored=JSON.parse(raw);
 assert.ok(Buffer.byteLength(raw)<4096);
 assert.deepEqual(stored.deployment_identity,identity(games[0]));
 assert.deepEqual(stored.native_volume,data.native_volume);
 assert.equal(stored.source_commit,'a'.repeat(40));
 assert.equal(raw.includes('never-persist'),false);
 assert.equal('native_phases' in stored,false);
 assert.equal(data.native_phases.large_diagnostics.length,50000);
});

test('malformed and oversized identity fields are omitted rather than truncated into valid identity',()=>{
 for(const value of [null,undefined,[],false,'x'])assert.deepEqual(JSON.parse(nativeHealthSummary(value)),{});
 const data=health(games[0]);
 data.deployment_identity.deployment_id='engine-test-'+games[0]+'x'.repeat(1000);
 data.deployment_identity.identity_bound='true';
 data.deployment_identity.environment={value:'preproduction'};
 data.source_commit='a'.repeat(41);
 const stored=JSON.parse(nativeHealthSummary(data));
 assert.equal('deployment_id' in stored.deployment_identity,false);
 assert.equal('identity_bound' in stored.deployment_identity,false);
 assert.equal('environment' in stored.deployment_identity,false);
 assert.equal('source_commit' in stored,false);
 assert.ok(Buffer.byteLength(nativeHealthSummary({version:'x'.repeat(1000000)}))<4096);
});

test('fixed field projection stays within16KB even for maximum JSON escape expansion',()=>{
 const data=health(games[0]);
 for(const key of ['provider','game','environment','version','engine_version','platform_deployment_id'])data[key]='\u0000'.repeat(100);
 for(const key of ['environment','deployment_id','core_deployment_id','game_id'])data.deployment_identity[key]='\u0000'.repeat(100);
 data.deployment_identity.identity_version=Number.MAX_SAFE_INTEGER;
 data.native_volume.verification=data.native_volume.filesystem_type='\u0000'.repeat(64);
 const raw=nativeHealthSummary(data);
 assert.ok(Buffer.byteLength(raw)<16000);
 assert.deepEqual(JSON.parse(raw).deployment_identity,data.deployment_identity);
});

test('Core refresh persists large native health and preserves identity gating after reopen',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'softtech-health-summary-'));
 const origins=games.map((_,i)=>'http://127.0.0.1:'+(19011+i));
 const payloads=games.map(health);
 t.mock.method(globalThis,'fetch',async url=>{
  const index=origins.indexOf(new URL(url).origin);
  assert.notEqual(index,-1);
  return new Response(JSON.stringify(payloads[index]),{status:200,headers:{'content-type':'application/json'}});
 });
 const env={NODE_ENV:'test',CORE_ENVIRONMENT:'preproduction',CORE_DEPLOYMENT_ID:'core-health-fixture',CORE_DB_PATH:join(dir,'core.sqlite'),PANEL_SESSION_SECRET:'health-fixture-master-'.repeat(3),CORE_QUALIFICATION_ENABLED:'true',CORE_ENGINE_KEYS_JSON:JSON.stringify(games.map((game,i)=>({id:'engine-key-'+i,game,secret:'test-engine-secret-'.repeat(3),deployment_id:identity(game).deployment_id,protocol_version:2}))),UNO_PROVIDER_ORIGIN:origins[0],MAHJONG_PROVIDER_ORIGIN:origins[1],SKYGATE_PROVIDER_ORIGIN:origins[2]};
 let core=new Core({env});
 t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});
 const op={id:'op_qualification_health_fixture',internal:1,currency:'VCOIN',wallet_mode:'seamless',wallet_protocol_version:2};
 await core.refreshHealth();
 for(const game of games){
  const row=core.get('SELECT health,health_json FROM games WHERE id=?',game);
  assert.equal(row.health,'ok');
  assert.deepEqual(JSON.parse(row.health_json).deployment_identity,identity(game));
  assert.doesNotThrow(()=>core.ensurePlayEnvironment(op,game));
 }
 core.close();core=new Core({env});
 for(const game of games)assert.doesNotThrow(()=>core.ensurePlayEnvironment(op,game));
 payloads[0].deployment_identity.core_deployment_id='another-core-fixture';
 await core.refreshHealth();
 assert.equal(core.get('SELECT health FROM games WHERE id=?',games[0]).health,'degraded');
 assert.throws(()=>core.ensurePlayEnvironment(op,games[0]),e=>e.code==='ENGINE_ENVIRONMENT_NOT_VERIFIED');
});
