import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {totp,matchTotp} from '../lib/staff-crypto.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const random=()=>randomBytes(24).toString('hex');
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
function badCode(secret){for(let i=0;i<100;i++){const code=String(i).padStart(6,'0');if(matchTotp(secret,code,Date.now())===null)return code;}throw Error('Test failed to find invalid TOTP');}

test('real HTTP staff migration, MFA replay, RBAC, independent release approval and recovery', {timeout:90000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'st-staff-http-')),port=await freePort(),base='http://127.0.0.1:'+port;
 const env={...process.env,NODE_ENV:'test',PORT:String(port),CORE_DB_PATH:join(dir,'core.sqlite'),PANEL_ADMIN_PASSWORD:'shared-admin-test-'+random(),PANEL_AUDITOR_PASSWORD:'shared-auditor-test-'+random(),PANEL_SESSION_SECRET:random(),CORE_PUBLIC_ORIGIN:base,UNO_PROVIDER_ORIGIN:base,MAHJONG_PROVIDER_ORIGIN:base,SKYGATE_PROVIDER_ORIGIN:base,CORE_ENGINE_KEYS_JSON:'[]',OFFSITE_BACKUP_ENABLED:'false'};
 let child,logs='';
 async function start(){
  child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
  for(let i=0;i<80;i++){if(child.exitCode!==null)break;try{if((await fetch(base+'/health')).ok)return;}catch{}await pause(50);}
  throw Error('HTTP fixture did not start: '+logs);
 }
 async function stop(){
  if(!child)return;const current=child;child=null;current.kill('SIGTERM');
  await new Promise(resolve=>{if(current.exitCode!==null||current.signalCode!==null)return resolve();current.once('exit',resolve);setTimeout(()=>{current.kill('SIGKILL');resolve();},3000).unref();});
  current.stdout.destroy();current.stderr.destroy();
 }
 async function call(path,{data,session,csrf=true,method=data===undefined?'GET':'POST'}={}){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session.cookie,...(csrf?{'X-CSRF-Token':session.csrf}:{})}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json(),setCookie=response.headers.get('set-cookie');
  return {status:response.status,result,headers:response.headers,cookie:setCookie?.split(';')[0],csrf:result.csrf};
 }
 async function ok(path,options,status=200){const result=await call(path,options);assert.equal(result.status,status,JSON.stringify({path,result:result.result}));return result;}
 async function denied(path,options,status,code){const result=await call(path,options);assert.equal(result.status,status,JSON.stringify({path,result:result.result}));assert.equal(result.result.error,code);return result;}
 async function enroll(pending){
  const step=Math.floor(Date.now()/30000),code=totp(pending.secret,{step}),signed=await ok('/api/staff/enroll/confirm',{data:{enrollment_token:pending.enrollment_token,code}});
  assert.equal(signed.result.identity.mfa_verified,true);assert.equal(signed.result.recovery_codes.length,8);assert.match(signed.headers.get('set-cookie'),/HttpOnly/);assert.match(signed.headers.get('set-cookie'),/SameSite=Strict/);
  return {...signed,secret:pending.secret,step,code};
 }
 async function invite(owner,role){
  const password='http-fixture-'+random(),name='http-fixture-'+role;
  const invited=await ok('/api/staff',{session:owner,data:{username:name,display_name:'HTTP Fixture '+role,person_ref:'http-person-'+role,role}},201);
  const pending=await ok('/api/staff/activate',{data:{activation_token:invited.result.activation_token,password}});
  await denied('/api/staff/activate',{data:{activation_token:invited.result.activation_token,password}},401,'INVALID_AUTH_TOKEN');
  const signed=await enroll(pending.result);
  return {...signed,id:invited.result.staff.id,username:name,password,invitation:invited.result.activation_token};
 }
 try{
  await start();
  await denied('/api/staff',{method:'GET'},401,'UNAUTHENTICATED');
  const shared=await ok('/api/login',{data:{role:'admin',password:env.PANEL_ADMIN_PASSWORD}});
  const ownerPassword='http-owner-'+random(),bootstrap={username:'http-fixture-owner',display_name:'HTTP Fixture Owner',person_ref:'http-person-owner',password:ownerPassword,admin_password:env.PANEL_ADMIN_PASSWORD};
  await denied('/api/staff/bootstrap',{session:shared,csrf:false,data:bootstrap},403,'CSRF_REQUIRED');
  await denied('/api/staff/bootstrap',{session:shared,data:{...bootstrap,admin_password:'wrong-password'}},403,'BOOTSTRAP_ADMIN_REAUTH_REQUIRED');
  const pending=await ok('/api/staff/bootstrap',{session:shared,data:bootstrap},201);
  assert.equal((await ok('/api/staff',{session:shared})).result.readiness.active_mfa_staff,0);
  await denied('/api/staff/bootstrap',{session:shared,data:bootstrap},409,'STAFF_BOOTSTRAP_CLOSED');
  await denied('/api/staff/enroll/confirm',{data:{enrollment_token:pending.result.enrollment_token,code:badCode(pending.result.secret)}},401,'INVALID_MFA_CODE');
  let owner=await enroll(pending.result);
  await denied('/api/staff/enroll/confirm',{data:{enrollment_token:pending.result.enrollment_token,code:owner.code}},401,'INVALID_AUTH_TOKEN');
  const ownerLogin=await ok('/api/staff/login',{data:{username:bootstrap.username,password:ownerPassword}});
  assert.equal(ownerLogin.result.mfa_required,true);assert.equal(ownerLogin.cookie,undefined,'password alone issued a session');
  await denied('/api/staff/mfa',{data:{challenge:ownerLogin.result.challenge,code:badCode(owner.secret)}},401,'INVALID_MFA_CODE');
  await stop();await start();
  await denied('/api/staff/mfa',{data:{challenge:ownerLogin.result.challenge,code:owner.code}},401,'INVALID_MFA_CODE');
  assert.equal((await ok('/api/session',{session:owner})).result.identity.staff.username,bootstrap.username);

  const approver=await invite(owner,'approver'),auditor=await invite(owner,'auditor'),operator=await invite(owner,'operator');
  await denied('/api/staff',{session:auditor,data:{username:'forbidden',display_name:'Forbidden Fixture',person_ref:'forbidden-person',role:'owner'}},403,'STAFF_PERMISSION_DENIED');
  await denied('/api/staff',{session:owner,data:{username:'alias-for-owner',display_name:'Same Person Alias',person_ref:bootstrap.person_ref,role:'approver'}},409,'STAFF_PERSON_EXISTS');
  await denied('/api/operators',{session:approver,data:{name:'Forbidden Approver Operator',games:['uno-luck']}},403,'STAFF_PERMISSION_DENIED');
  const op=(await ok('/api/operators',{session:shared,data:{name:'HTTP Staff Test Operator',games:['uno-luck']}},201)).result.operator;
  await denied('/api/release-requests',{session:shared,data:{operator_id:op.id,game_id:'uno-luck',mode:'preproduction'}},403,'NAMED_STAFF_REQUIRED');
  const requested=(await ok('/api/release-requests',{session:owner,data:{operator_id:op.id,game_id:'uno-luck',mode:'sandbox'}},201)).result;
  assert.equal(requested.requested_by,'staff:'+owner.result.identity.staff.id);
  await denied('/api/release-requests/'+requested.id+'/approve',{session:approver,data:{}},409,'INVALID_RELEASE_TRANSITION');
  await ok('/api/release-requests/'+requested.id+'/validate',{session:owner,data:{}});
  await denied('/api/release-requests/'+requested.id+'/approve',{session:owner,data:{}},403,'INDEPENDENT_APPROVER_REQUIRED');
  await denied('/api/release-requests/'+requested.id+'/approve',{session:operator,data:{}},403,'STAFF_PERMISSION_DENIED');
  await denied('/api/release-requests/'+requested.id+'/approve',{session:shared,data:{}},403,'NAMED_STAFF_REQUIRED');
  const approved=await ok('/api/release-requests/'+requested.id+'/approve',{session:approver,data:{}});
  assert.equal(approved.result.approved_by,'staff:'+approver.id);
  await denied('/api/release-requests',{session:owner,data:{operator_id:op.id,game_id:'uno-luck',mode:'production'}},409,'PRODUCTION_LOCKED');
  await ok('/api/staff/'+approver.id+'/revoke',{session:owner,data:{}});
  await denied('/api/bootstrap',{session:approver},401,'UNAUTHENTICATED');
  await denied('/api/release-requests/'+requested.id+'/activate',{session:owner,data:{}},409,'INDEPENDENT_APPROVAL_REQUIRED');
  const secondLogin=await ok('/api/staff/login',{data:{username:approver.username,password:approver.password}});
  const nextStep=Math.max(Math.floor(Date.now()/30000),approver.step+1);
  const newApprover=await ok('/api/staff/mfa',{data:{challenge:secondLogin.result.challenge,code:totp(approver.secret,{step:nextStep})}});
  await ok('/api/staff/'+approver.id,{session:owner,data:{status:'disabled'}});
  await denied('/api/bootstrap',{session:newApprover},401,'UNAUTHENTICATED');
  await denied('/api/staff/'+owner.result.identity.staff.id,{session:owner,data:{status:'disabled'}},409,'LAST_OWNER_PROTECTED');

  const privateStrings=[ownerPassword,pending.result.secret,pending.result.enrollment_token,approver.password,approver.secret,approver.invitation,...owner.result.recovery_codes];
  for(const path of ['/api/staff','/api/bootstrap','/api/release-control','/api/session']){
   const output=JSON.stringify((await ok(path,{session:owner})).result);
   for(const secret of privateStrings)assert.ok(!output.includes(secret),path+' leaked a credential');
  }
  const recoveryChallenge=await ok('/api/staff/login',{data:{username:bootstrap.username,password:ownerPassword}});
  const recovery=await ok('/api/staff/mfa',{data:{challenge:recoveryChallenge.result.challenge,recovery_code:owner.result.recovery_codes[0]}});
  assert.equal(recovery.result.identity.mfa_verified,false);assert.equal(recovery.result.role,'auditor');
  await denied('/api/operators',{session:recovery,data:{name:'Forbidden Recovery',games:['uno-luck']}},403,'TOTP_REQUIRED');
  const reuse=await ok('/api/staff/login',{data:{username:bootstrap.username,password:ownerPassword}});
  await denied('/api/staff/mfa',{data:{challenge:reuse.result.challenge,recovery_code:owner.result.recovery_codes[0]}},401,'INVALID_MFA_CODE');
  const replacement=await ok('/api/staff/mfa/reset',{session:recovery,data:{current_password:ownerPassword}});
  await denied('/api/bootstrap',{session:owner},401,'UNAUTHENTICATED');
  await denied('/api/bootstrap',{session:recovery},401,'UNAUTHENTICATED');
  owner=await enroll(replacement.result);
  const newPassword='changed-http-owner-'+random();
  const changed=await ok('/api/staff/password',{session:owner,data:{current_password:ownerPassword,new_password:newPassword}});
  await denied('/api/bootstrap',{session:owner},401,'UNAUTHENTICATED');
  owner=changed;
  await denied('/api/staff/login',{data:{username:bootstrap.username,password:ownerPassword}},401,'INVALID_CREDENTIALS');
  await ok('/api/bootstrap',{session:owner});

  for(let i=0;i<10;i++)await denied('/api/staff/login',{data:{username:auditor.username,password:'invalid-password'}},401,'INVALID_CREDENTIALS');
  await stop();await start();
  await denied('/api/staff/login',{data:{username:auditor.username,password:auditor.password}},429,'AUTH_RATE_LIMITED');
  await denied('/api/bootstrap',{session:approver},401,'UNAUTHENTICATED');
  await ok('/api/bootstrap',{session:owner});
  await denied('/api/staff/bootstrap',{session:shared,data:bootstrap},409,'STAFF_BOOTSTRAP_CLOSED');
  const audit=(await ok('/api/bootstrap',{session:owner})).result.audit;
  assert.ok(audit.some(e=>e.event==='staff.sessions_revoked'));
  assert.ok(audit.some(e=>e.event==='release.approve'&&e.actor==='staff:'+approver.id));
  assert.equal(audit.some(e=>e.event==='release.approve'&&e.actor===requested.requested_by),false);
  for(const secret of privateStrings)assert.ok(!logs.includes(secret),'server log leaked credentials');
  await ok('/api/logout',{session:owner,data:{}});await denied('/api/bootstrap',{session:owner},401,'UNAUTHENTICATED');
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
