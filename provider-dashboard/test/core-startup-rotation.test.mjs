import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,appendFile,stat,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {Core} from '../lib/core.mjs';
import {random,sha} from '../lib/security.mjs';
import {prepareCoreStartup} from '../lib/core-startup-rotation.mjs';
import {verifyCoreVaultFile} from '../lib/core-key-rotation.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'core-startup-rotation-')),source=join(dir,'original.sqlite'),destination=join(dir,'rotated.sqlite'),rollback=join(dir,'rollback.stbk'),oldMaster=random(40),newMaster=random(40);
 const env={NODE_ENV:'test',CORE_ENVIRONMENT:'preproduction',CORE_DEPLOYMENT_ID:'startup-rotation-test-deployment',CORE_DB_PATH:source,PANEL_SESSION_SECRET:oldMaster,PANEL_ADMIN_PASSWORD:random(30),PANEL_AUDITOR_PASSWORD:random(30),CORE_ENGINE_KEYS_JSON:'[]',OFFSITE_BACKUP_ENABLED:'false',CORE_QUALIFICATION_ENABLED:'false'};
 const core=new Core({env});
 const issued=core.createOperator({name:'Startup Rotation Fixture Operator',games:['uno-luck'],return_origins:['https://operator.rotation.example']});
 core.run('INSERT INTO panel_sessions VALUES(?,?,?,?,?)',sha('fixture-old-session'),'admin','fixture-csrf',Date.now()+60000,Date.now());
 core.run("INSERT INTO meta(key,value) VALUES('fixture-preserved','original')");core.close();
 const configured={...env,CORE_DB_PATH:destination,PANEL_SESSION_SECRET:newMaster,CORE_MASTER_ROTATION_ON_START:'true',CORE_MASTER_ROTATION_OFFLINE:'true',CORE_MASTER_ROTATION_SOURCE_PATH:source,CORE_MASTER_ROTATION_ROLLBACK_PATH:rollback,CORE_OLD_MASTER_SECRET:oldMaster,BACKUP_KEYS_JSON:JSON.stringify({first:random(40),current:random(40)}),BACKUP_ACTIVE_KEY_ID:'current'};
 t.after(()=>rm(dir,{recursive:true,force:true}));
 return {dir,source,destination,rollback,receipt:destination+'.rotation.json',preparation:destination+'.rotation.json.preparing',oldMaster,newMaster,env:configured,issued};
}
test('startup rotation is inert unless explicitly enabled',async()=>{
 const env={CORE_DB_PATH:'/not-opened',PANEL_SESSION_SECRET:'not-read'};
 assert.deepEqual(await prepareCoreStartup({env}),{env,report:{enabled:false}});
});
test('startup rotates once, strips obsolete secrets, preserves data and verifies later live changes without old secrets',async t=>{
 const f=await fixture(t),sourceHash=sha(await readFile(f.source));
 const first=await prepareCoreStartup({env:f.env});
 assert.equal(first.report.prepared,true);assert.equal(first.report.verified,true);assert.equal(first.report.old_master_rejected,true);
 assert.equal(first.env.CORE_OLD_MASTER_SECRET,undefined);assert.equal(first.env.PANEL_SESSION_SECRET,f.newMaster);
 assert.equal(sha(await readFile(f.source)),sourceHash);
 const receipt=await readFile(f.receipt),initialHash=sha(await readFile(f.destination));
 assert.equal((await stat(f.receipt)).mode&0o777,0o600);
 assert.throws(()=>verifyCoreVaultFile({source:f.destination,master:f.oldMaster,deploymentId:f.env.CORE_DEPLOYMENT_ID,environment:'preproduction'}));
 const core=new Core({env:first.env});
 try{
  assert.equal(core.get("SELECT value FROM meta WHERE key='fixture-preserved'").value,'original');
  assert.equal(core.vault.open(core.get('SELECT secret_box FROM api_keys WHERE id=?',f.issued.credential.key_id).secret_box),f.issued.credential.secret);
  assert.equal(core.get('SELECT count(*) n FROM panel_sessions').n,0);
  core.run("UPDATE meta SET value='legitimate-post-cutover-write' WHERE key='fixture-preserved'");
 }finally{core.close();}
 assert.notEqual(sha(await readFile(f.destination)),initialHash);
 const later={...first.env};delete later.CORE_MASTER_ROTATION_OFFLINE;delete later.BACKUP_KEYS_JSON;delete later.BACKUP_ACTIVE_KEY_ID;
 const second=await prepareCoreStartup({env:later});
 assert.equal(second.report.prepared,false);assert.equal(second.report.rotation_id,first.report.rotation_id);
 assert.deepEqual(await readFile(f.receipt),receipt);assert.equal(sha(await readFile(f.source)),sourceHash);
});
test('completed guard refuses wrong keys/identity, tampered receipts, missing checkpoint and changed frozen source',async t=>{
 const f=await fixture(t);await prepareCoreStartup({env:f.env});
 await assert.rejects(prepareCoreStartup({env:{...f.env,PANEL_SESSION_SECRET:random(40)}}),/receipt authentication/);
 await assert.rejects(prepareCoreStartup({env:{...f.env,CORE_DEPLOYMENT_ID:'another-test-deployment'}}),/deployment identity mismatch/);
 const receipt=await readFile(f.receipt),tampered=JSON.parse(receipt);tampered.payload.rotation_id='forged';await writeFile(f.receipt,JSON.stringify(tampered));
 await assert.rejects(prepareCoreStartup({env:f.env}),/receipt authentication/);await writeFile(f.receipt,receipt);
 const rollback=await readFile(f.rollback);await appendFile(f.rollback,'tamper');
 await assert.rejects(prepareCoreStartup({env:f.env}),/checkpoint changed/);await writeFile(f.rollback,rollback);
 const source=await readFile(f.source);await appendFile(f.source,'post-cutover-write');
 await assert.rejects(prepareCoreStartup({env:f.env}),/original database changed/);await writeFile(f.source,source);
 await rm(f.rollback);await assert.rejects(prepareCoreStartup({env:f.env}),/ENOENT/);
});
test('startup refuses unmarked outputs, incomplete preparation and symlink aliases without re-rotation',async t=>{
 const f=await fixture(t),original=sha(await readFile(f.source));
 await writeFile(f.destination,'unmarked',{mode:0o600});await assert.rejects(prepareCoreStartup({env:f.env}),/Unmarked/);await rm(f.destination);
 await symlink(f.source,f.destination);await assert.rejects(prepareCoreStartup({env:f.env}));await rm(f.destination);
 await prepareCoreStartup({env:f.env});const receipt=await readFile(f.receipt);await rm(f.receipt);
 await assert.rejects(prepareCoreStartup({env:f.env}),/Incomplete rotation preparation/);
 await writeFile(f.receipt,receipt,{mode:0o600});await rm(f.destination);
 await assert.rejects(prepareCoreStartup({env:f.env}));
 assert.equal(sha(await readFile(f.source)),original);
 await assert.rejects(stat(f.destination),e=>e.code==='ENOENT');
});
test('first startup refuses unsafe configuration before producing any completion receipt',async t=>{
 const f=await fixture(t);
 for(const patch of [{CORE_MASTER_ROTATION_OFFLINE:'false'},{CORE_ENVIRONMENT:'production'},{CORE_OLD_MASTER_SECRET:random(40)},{PANEL_SESSION_SECRET:f.oldMaster},{CORE_NEW_MASTER_SECRET:random(40)},{CORE_MASTER_ROTATION_ROLLBACK_PATH:f.source},{RAILWAY_VOLUME_MOUNT_PATH:'/tmp'}]){
  await assert.rejects(prepareCoreStartup({env:{...f.env,...patch}}));
  await assert.rejects(stat(f.receipt),e=>e.code==='ENOENT');await assert.rejects(stat(f.preparation),e=>e.code==='ENOENT');
 }
});
test('racing first startup has one preparation winner and cannot publish a second rotation',async t=>{
 const f=await fixture(t),results=await Promise.allSettled([prepareCoreStartup({env:f.env}),prepareCoreStartup({env:f.env})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal((await prepareCoreStartup({env:f.env})).report.prepared,false);
});
test('actual startup process serves only after rotation and restarts without old key or rerotation',async t=>{
 const f=await fixture(t),reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 let child,logs='';const stop=async()=>{if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}};t.after(stop);
 const start=async env=>{
  child=spawn(process.execPath,['scripts/start-provider.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,...env,PORT:String(port),CORE_ACCEPTANCE_RUN:''},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
  for(let i=0;i<150;i++){
   if(child.exitCode!==null)throw Error('Startup fixture exited: '+logs);
   try{const r=await fetch('http://127.0.0.1:'+port+'/health');if(r.ok)return await r.json();}catch{}
   await new Promise(r=>setTimeout(r,20));
  }throw Error('Startup fixture timed out');
 };
 const first=await start(f.env);assert.equal(first.deployment_identity.deployment_id,f.env.CORE_DEPLOYMENT_ID);await stop();
 const receipt=await readFile(f.receipt),later={...f.env};delete later.CORE_OLD_MASTER_SECRET;delete later.BACKUP_KEYS_JSON;delete later.BACKUP_ACTIVE_KEY_ID;
 await start(later);await stop();assert.deepEqual(await readFile(f.receipt),receipt);
 assert.ok(logs.includes('provider.master_rotation_startup'));assert.ok(logs.includes('"prepared":true'));assert.ok(logs.includes('"prepared":false'));
 for(const secret of [f.oldMaster,f.newMaster,f.env.BACKUP_KEYS_JSON,f.issued.credential.secret])assert.ok(!logs.includes(secret));
});
