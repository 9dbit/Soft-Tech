import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Core} from '../lib/core.mjs';
import {StaffAuth} from '../lib/staff-auth.mjs';
import {totp} from '../lib/staff-crypto.mjs';
import {random,sha} from '../lib/security.mjs';
import {rotateCoreMasterKey,prepareCoreRollback} from '../lib/core-key-rotation.mjs';

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'core-master-rotation-')),source=join(dir,'original.sqlite'),now=Date.now();
 const env={NODE_ENV:'test',CORE_ENVIRONMENT:'sandbox',CORE_DEPLOYMENT_ID:'rotation-test-deployment',CORE_DB_PATH:source,PANEL_SESSION_SECRET:random(40),PANEL_ADMIN_PASSWORD:random(30),CORE_PUBLIC_ORIGIN:'https://provider.rotation.example',UNO_PROVIDER_ORIGIN:'https://uno.rotation.example'};
 const core=new Core({env,clock:()=>now}),staff=new StaffAuth(core),password=random(30);
 const pending=await staff.bootstrap({role:'admin'},{username:'rotation-fixture-owner',display_name:'Rotation Fixture Owner',person_ref:'rotation-fixture-person',password,admin_password:env.PANEL_ADMIN_PASSWORD});
 const owner=staff.confirmEnrollment({enrollment_token:pending.enrollment_token,code:totp(pending.secret,{time:now-30000})},'rotation-test'),session=staff.session(owner.token);
 const invite=staff.invite(session,{username:'rotation-fixture-pending',display_name:'Rotation Fixture Pending',person_ref:'rotation-fixture-pending-person',role:'auditor'}),enrollment=await staff.activate({activation_token:invite.activation_token,password},'rotation-test');
 const challenge=await staff.login({username:'rotation-fixture-owner',password},'rotation-test');
 core.run('INSERT INTO panel_sessions VALUES(?,?,?,?,?)',sha('old-shared-session'),'admin','old-csrf',now+3600000,now);
 core.run('INSERT INTO replay_nonces VALUES(?,?,?)','rotation-nonce-key','rotation-consumed-nonce',now);
 const issued=core.createOperator({name:'Rotation Virtual Operator',games:['uno-luck'],initial_minor:'10000',max_stake_minor:'1000',max_payout_minor:'10000',return_origins:['https://operator.rotation.example']}),op=core.operator(issued.operator.id);
 const external=core.createOperator({name:'Rotation External Credential Fixture',games:['uno-luck'],wallet_mode:'seamless',wallet_url:'https://wallet.rotation.example/callback'});
 const input={game_id:'uno-luck',player_ref:'rotation-player',return_url:'https://operator.rotation.example'},launch=core.createLaunch(op,input,'rotation-launch-id');
 const launchToken=new URLSearchParams(new URL(launch.launch_url).hash.slice(1)).get('softtech_launch'),gameSession=core.redeem({game:'uno-luck'},{token:launchToken,request_id:'rotation-redeem-id'});
 const reserved=await core.reserve({game:'uno-luck'},{tenant_id:op.id,session_id:gameSession.session_id,round_ref:'rotation-pending-round',stake:'100',max_payout:'1000'});
 const destination=join(dir,'rotated.sqlite'),rollbackDestination=join(dir,'rollback.stbk'),newMaster=random(40),keys={legacy:random(40),current:random(40)};
 const options={source,destination,rollbackDestination,oldMaster:env.PANEL_SESSION_SECRET,newMaster,keys,activeKeyId:'current',deploymentId:env.CORE_DEPLOYMENT_ID,environment:'sandbox',offline:true,now};
 return {dir,source,now,env,core,staff,password,pending,owner,enrollment,challenge,issued,op,external,input,launch,gameSession,reserved,options};
}
test('offline master rotation rewraps every vault field, preserves pending accounting/MFA and prepares safe rollback',async()=>{
 const f=await fixture();let rotated,rollback;
 try{
  const beforeDb=sha(await readFile(f.source)),beforeWal=sha(await readFile(f.source+'-wal'));
  const original={ledger:f.core.all('SELECT * FROM ledger'),rounds:f.core.all('SELECT * FROM rounds'),nonces:f.core.all('SELECT * FROM replay_nonces'),sessions:f.core.all('SELECT id,status,launch_hash FROM sessions'),mfa:f.core.get('SELECT totp_last_step,password_hash FROM staff_users WHERE id=?',f.owner.identity.staff.id),wallet:f.core.vault.open(f.core.operator(f.external.operator.id).wallet_secret)};
  const report=await rotateCoreMasterKey(f.options);assert.equal(report.old_master_rejected,true);assert.equal(report.source_written,false);assert.equal(report.rewrapped['staff_enrollments.secret_box'],1);assert.equal(report.rewrapped['staff_users.totp_secret_box'],1);assert.equal(report.revoked.staff_challenges,1);
  assert.equal(sha(await readFile(f.source)),beforeDb);assert.equal(sha(await readFile(f.source+'-wal')),beforeWal);
  const newEnv={...f.env,CORE_DB_PATH:f.options.destination,PANEL_SESSION_SECRET:f.options.newMaster};
  assert.throws(()=>new Core({env:{...newEnv,PANEL_SESSION_SECRET:f.env.PANEL_SESSION_SECRET},clock:()=>f.now}));
  rotated=new Core({env:newEnv,clock:()=>f.now});const staff=new StaffAuth(rotated);
  assert.deepEqual(rotated.all('SELECT * FROM ledger'),original.ledger);assert.deepEqual(rotated.all('SELECT * FROM rounds'),original.rounds);assert.deepEqual(rotated.all('SELECT * FROM replay_nonces'),original.nonces);assert.deepEqual(rotated.all('SELECT id,status,launch_hash FROM sessions'),original.sessions);
  assert.equal(rotated.vault.open(rotated.get('SELECT secret_box FROM api_keys WHERE id=?',f.issued.credential.key_id).secret_box),f.issued.credential.secret);
  assert.equal(rotated.vault.open(rotated.operator(f.external.operator.id).wallet_secret),original.wallet);
  assert.equal(rotated.vault.open(rotated.get('SELECT totp_secret_box FROM staff_users WHERE id=?',f.owner.identity.staff.id).totp_secret_box),f.pending.secret);
  assert.equal(rotated.vault.open(rotated.get('SELECT secret_box FROM staff_enrollments').secret_box),f.enrollment.secret);
  assert.deepEqual(rotated.get('SELECT totp_last_step,password_hash FROM staff_users WHERE id=?',f.owner.identity.staff.id),original.mfa);
  assert.equal(staff.session(f.owner.token),null);assert.equal(rotated.get('SELECT count(*) n FROM panel_sessions').n,0);assert.equal(rotated.get('SELECT count(*) n FROM staff_auth_challenges').n,0);
  assert.throws(()=>staff.confirmEnrollment({enrollment_token:f.enrollment.enrollment_token,code:totp(f.enrollment.secret,{time:f.now})},'rotation'),e=>e.code==='INVALID_AUTH_TOKEN');
  assert.deepEqual(rotated.createLaunch(rotated.operator(f.op.id),f.input,'rotation-launch-id'),f.launch);
  const login=await staff.login({username:'rotation-fixture-owner',password:f.password},'rotation');
  assert.throws(()=>staff.verifyMfa({challenge:login.challenge,code:totp(f.pending.secret,{time:f.now-30000})},'rotation'),e=>e.code==='INVALID_MFA_CODE');
  assert.equal(staff.verifyMfa({challenge:login.challenge,code:totp(f.pending.secret,{time:f.now})},'rotation').identity.mfa_verified,true);
  const settlement={tenant_id:f.op.id,round_id:f.reserved.id,payout:'175',evidence:'isolated-rotation-fixture'};
  await Promise.all([rotated.settle({game:'uno-luck'},settlement),rotated.settle({game:'uno-luck'},settlement)]);
  assert.deepEqual(rotated.all('SELECT kind,amount_minor FROM ledger WHERE round_id=?',f.reserved.id).map(r=>({...r})),[{kind:'debit',amount_minor:'-100'},{kind:'credit',amount_minor:'175'}]);
  const rollbackPath=join(f.dir,'rollback-ready.sqlite');const restored=await prepareCoreRollback({source:f.options.rollbackDestination,destination:rollbackPath,master:f.env.PANEL_SESSION_SECRET,keys:f.options.keys,activeKeyId:'current',deploymentId:f.env.CORE_DEPLOYMENT_ID,environment:'sandbox',offline:true,now:f.now});assert.equal(restored.integrity_verified,true);
  rollback=new Core({env:{...f.env,CORE_DB_PATH:rollbackPath},clock:()=>f.now});assert.equal(rollback.round(f.reserved.id).status,'reserved');assert.equal(new StaffAuth(rollback).session(f.owner.token),null);
  assert.equal(rollback.get('SELECT count(*) n FROM staff_recovery_codes WHERE used_at IS NULL').n,0);
  const rollbackStaff=new StaffAuth(rollback),rollbackLogin=await rollbackStaff.login({username:'rotation-fixture-owner',password:f.password},'rollback');
  assert.throws(()=>rollbackStaff.verifyMfa({challenge:rollbackLogin.challenge,code:totp(f.pending.secret,{time:f.now})},'rollback'),e=>e.code==='INVALID_MFA_CODE');
  await rollback.settle({game:'uno-luck'},settlement);await rollback.settle({game:'uno-luck'},settlement);
  assert.equal(rollback.get("SELECT count(*) n FROM ledger WHERE round_id=? AND kind='credit'",f.reserved.id).n,1);
  assert.equal(f.core.round(f.reserved.id).status,'reserved');assert.equal(sha(await readFile(f.source)),beforeDb);assert.equal(sha(await readFile(f.source+'-wal')),beforeWal);
  await assert.rejects(rotateCoreMasterKey(f.options),/already exists/);
 }finally{rotated?.close();rollback?.close();f.core.close();await rm(f.dir,{recursive:true,force:true});}
});
test('a concurrent source writer prevents offline rotation from publishing a stale copy',async()=>{
 const f=await fixture();let timer;
 try{
  let writes=0;timer=setInterval(()=>f.core.run("INSERT INTO meta(key,value) VALUES('concurrent-writer',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(++writes)),1);
  await assert.rejects(rotateCoreMasterKey(f.options),/Source changed during offline preparation/);
  assert.ok(writes>0);await assert.rejects(stat(f.options.destination),e=>e.code==='ENOENT');
 }finally{clearInterval(timer);f.core.close();await rm(f.dir,{recursive:true,force:true});}
});
test('offline rotation fails closed for wrong keys, identity, reused output and unknown vault fields',async()=>{
 const f=await fixture();
 try{
  await assert.rejects(rotateCoreMasterKey({...f.options,offline:false}),/offline acknowledgement/);
  await assert.rejects(rotateCoreMasterKey({...f.options,newMaster:f.options.oldMaster}),/differ/);
  await assert.rejects(rotateCoreMasterKey({...f.options,deploymentId:'wrong-deployment'}),/identity mismatch/);
  await assert.rejects(rotateCoreMasterKey({...f.options,oldMaster:random(40)}));
  await assert.rejects(stat(f.options.destination),e=>e.code==='ENOENT');await assert.rejects(stat(f.options.rollbackDestination),e=>e.code==='ENOENT');
  await assert.rejects(rotateCoreMasterKey({...f.options,destination:f.source}),/already exists/);
  f.core.db.exec('CREATE TABLE future_feature(id TEXT,unexpected_box TEXT)');
  await assert.rejects(rotateCoreMasterKey(f.options),/Unrecognized encrypted field/);
 }finally{f.core.close();await rm(f.dir,{recursive:true,force:true});}
});
