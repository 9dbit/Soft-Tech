import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Core} from '../lib/core.mjs';
import {StaffAuth} from '../lib/staff-auth.mjs';
import {requireStaff} from '../lib/staff-policy.mjs';
import {base32,totp,matchTotp,hashPassword,verifyPassword} from '../lib/staff-crypto.mjs';
import {random,sha} from '../lib/security.mjs';

const error=code=>e=>e.code===code;
const password='unit-test-only-'+random(24);
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'st-staff-unit-'));let now=1900000000000;
 const env={NODE_ENV:'test',PANEL_SESSION_SECRET:random(40),PANEL_ADMIN_PASSWORD:'shared-test-'+random(24),CORE_DB_PATH:join(dir,'core.sqlite'),CORE_PUBLIC_ORIGIN:'http://127.0.0.1:18080',UNO_PROVIDER_ORIGIN:'http://127.0.0.1:18081'};
 let core=new Core({env,clock:()=>now}),staff=new StaffAuth(core);
 t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});
 return {env,now:()=>now,tick:ms=>now+=ms,get core(){return core;},get staff(){return staff;},restart(){core.close();core=new Core({env,clock:()=>now});staff=new StaffAuth(core);}};
}
async function owner(f){
 const pending=await f.staff.bootstrap({role:'admin'},{username:'fixture-owner',display_name:'Unit Test Owner',person_ref:'fixture-person-owner',password,admin_password:f.env.PANEL_ADMIN_PASSWORD});
 const signed=f.staff.confirmEnrollment({enrollment_token:pending.enrollment_token,code:totp(pending.secret,{time:f.now()-30000})},'unit');
 return {...signed,secret:pending.secret,get session(){return f.staff.session(signed.token);}};
}
async function member(f,admin,role,name=role){
 const invite=f.staff.invite(admin.session,{username:'fixture-'+name,display_name:'Unit Test '+name,person_ref:'fixture-person-'+name,role});
 const pending=await f.staff.activate({activation_token:invite.activation_token,password},'unit');
 const signed=f.staff.confirmEnrollment({enrollment_token:pending.enrollment_token,code:totp(pending.secret,{time:f.now()-30000})},'unit');
 return {...signed,secret:pending.secret,id:invite.staff.id,get session(){return f.staff.session(signed.token);}};
}

test('TOTP matches RFC 6238 SHA1 vectors and limits skew/replay',()=>{
 const secret=base32(Buffer.from('12345678901234567890'));
 for(const [seconds,expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(totp(secret,{time:seconds*1000,digits:8}),expected);
 const now=1900000000000,step=Math.floor(now/30000),code=totp(secret,{time:now});
 assert.equal(matchTotp(secret,code,now),step);
 assert.equal(matchTotp(secret,code,now,step),null);
 assert.equal(matchTotp(secret,totp(secret,{step:step-2}),now),null);
 assert.equal(matchTotp(secret,'12345',now),null);
});

test('scrypt uses independent 128 MiB salts, bounds concurrent hashing to two and verifies safely',async()=>{
 const results=await Promise.allSettled([hashPassword(password),hashPassword(password),hashPassword(password)]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'fulfilled');assert.equal(results[2].status,'rejected');assert.equal(results[2].reason.code,'AUTH_BUSY');
 const [a,b]=results.slice(0,2).map(r=>r.value);
 assert.match(a,/^scrypt\$131072\$8\$1\$/);assert.notEqual(a,b);assert.ok(!a.includes(password));
 assert.equal(await verifyPassword(password,a),true);assert.equal(await verifyPassword('wrong-'+password,a),false);assert.equal(await verifyPassword(password,null),false);
 await assert.rejects(hashPassword('passwordpassword'),error('WEAK_STAFF_PASSWORD'));
});

test('first owner migration needs existing admin reauth and explicit MFA confirmation',async t=>{
 const f=fixture(t);f.core.run('INSERT INTO panel_sessions VALUES(?,?,?,?,?)',sha('old-shared-session'),'admin','existing-csrf',f.now()+100000,f.now());
 const data={username:'fixture-owner',display_name:'Unit Test Owner',person_ref:'fixture-person-owner',password,admin_password:f.env.PANEL_ADMIN_PASSWORD};
 await assert.rejects(f.staff.bootstrap({role:'auditor'},data),error('BOOTSTRAP_ADMIN_REAUTH_REQUIRED'));
 await assert.rejects(f.staff.bootstrap({role:'admin'},{...data,admin_password:'wrong'}),error('BOOTSTRAP_ADMIN_REAUTH_REQUIRED'));
 const pending=await f.staff.bootstrap({role:'admin'},data);
 assert.equal(f.staff.readiness().active_mfa_staff,0);assert.equal(f.core.get('SELECT status FROM staff_users').status,'pending_mfa');
 assert.equal(f.core.get('SELECT count(*) n FROM staff_sessions').n,0);assert.equal(f.core.get('SELECT count(*) n FROM panel_sessions').n,1);
 await assert.rejects(f.staff.bootstrap({role:'admin'},data),error('STAFF_BOOTSTRAP_CLOSED'));
 assert.throws(()=>f.staff.confirmEnrollment({enrollment_token:pending.enrollment_token,code:'invalid'},'unit'),error('INVALID_MFA_CODE'));
 const signed=f.staff.confirmEnrollment({enrollment_token:pending.enrollment_token,code:totp(pending.secret,{time:f.now()})},'unit');
 assert.equal(signed.identity.mfa_verified,true);assert.equal(signed.recovery_codes.length,8);assert.equal(f.staff.readiness().active_mfa_staff,1);
 assert.throws(()=>f.staff.confirmEnrollment({enrollment_token:pending.enrollment_token,code:totp(pending.secret,{time:f.now()})},'unit'),error('INVALID_AUTH_TOKEN'));
 const durable=JSON.stringify({users:f.core.all('SELECT * FROM staff_users'),codes:f.core.all('SELECT * FROM staff_recovery_codes'),audit:f.core.all('SELECT * FROM audit')});
 for(const secret of [password,pending.secret,pending.enrollment_token,signed.token,...signed.recovery_codes])assert.ok(!durable.includes(secret),'secret persisted in plaintext');
 f.restart();assert.equal(f.staff.session(signed.token).staff_id,signed.identity.staff.id);assert.equal(f.staff.readiness().bootstrap_available,false);
});

test('named staff role checks, distinct people, fresh MFA and immutable release approvals',async t=>{
 const f=fixture(t),a=await owner(f),b=await member(f,a,'approver'),viewer=await member(f,a,'auditor');
 const op=f.core.createOperator({name:'Unit Release Operator',games:['uno-luck']}).operator;
 assert.equal(f.staff.readiness().distinct_approvers_available,true);
 assert.throws(()=>f.staff.invite(a.session,{username:'same-human-alias',display_name:'Duplicate Fixture',person_ref:'fixture-person-owner',role:'approver'}),error('STAFF_PERSON_EXISTS'));
 assert.throws(()=>f.staff.invite(viewer.session,{username:'no-permission',display_name:'No Permission',person_ref:'fixture-no',role:'owner'}),error('STAFF_PERMISSION_DENIED'));
 assert.throws(()=>f.core.requestRelease(op.id,'uno-luck','sandbox'),error('NAMED_STAFF_REQUIRED'));
 assert.throws(()=>f.core.requestRelease(op.id,'uno-luck','production'),error('PRODUCTION_LOCKED'));
 const r=f.core.requestRelease(op.id,'uno-luck','sandbox',a.session);
 assert.equal(r.requested_by,'staff:'+a.identity.staff.id);
 assert.throws(()=>f.core.advanceRelease(r.id,'approve',b.session),error('INVALID_RELEASE_TRANSITION'));
 f.core.advanceRelease(r.id,'validate',a.session);
 assert.throws(()=>f.core.advanceRelease(r.id,'approve',a.session),error('INDEPENDENT_APPROVER_REQUIRED'));
 assert.equal(f.core.get("SELECT count(*) n FROM audit WHERE event='release.approval_denied'").n,1);
 assert.throws(()=>f.core.advanceRelease(r.id,'approve',viewer.session),error('STAFF_PERMISSION_DENIED'));
 assert.throws(()=>f.core.advanceRelease(r.id,'approve',{kind:'staff',id_hash:sha('forged')}),error('NAMED_STAFF_REQUIRED'));
 const approved=f.core.advanceRelease(r.id,'approve',b.session);assert.equal(approved.approved_by,'staff:'+b.id);
 assert.equal(f.core.advanceRelease(r.id,'activate',a.session).status,'activated');
 assert.throws(()=>f.core.run("UPDATE staff_release_signoffs SET staff_id=? WHERE release_id=?",a.identity.staff.id,r.id),/immutable/);
 f.tick(10*60000+1);assert.throws(()=>requireStaff(f.core,b.session,'release:approve'),error('MFA_STEP_UP_REQUIRED'));
 const code=totp(b.secret,{time:f.now()});f.staff.stepUp(b.session,{code});assert.equal(requireStaff(f.core,b.session,'release:approve').staff_id,b.id);
 assert.throws(()=>f.staff.stepUp(b.session,{code}),error('INVALID_MFA_CODE'));
});

test('single-use recovery grants limited access and requires re-enrollment before release',async t=>{
 const f=fixture(t),a=await owner(f),challenge=await f.staff.login({username:'fixture-owner',password},'unit');
 const recovered=f.staff.verifyMfa({challenge:challenge.challenge,recovery_code:a.recovery_codes[0]},'unit'),limited=f.staff.session(recovered.token);
 assert.equal(limited.role,'auditor');assert.equal(recovered.identity.mfa_verified,false);assert.deepEqual(recovered.identity.permissions,[]);
 assert.throws(()=>requireStaff(f.core,limited,'release:approve'),error('TOTP_REQUIRED'));
 const again=await f.staff.login({username:'fixture-owner',password},'unit');
 assert.throws(()=>f.staff.verifyMfa({challenge:again.challenge,recovery_code:a.recovery_codes[0]},'unit'),error('INVALID_MFA_CODE'));
 const pending=await f.staff.resetMfa(limited,{current_password:password});
 assert.equal(f.staff.session(a.token),null);assert.equal(f.staff.session(recovered.token),null);assert.equal(f.core.get('SELECT count(*) n FROM staff_recovery_codes').n,0);
 const signed=f.staff.confirmEnrollment({enrollment_token:pending.enrollment_token,code:totp(pending.secret,{time:f.now()})},'unit');
 assert.equal(signed.identity.mfa_verified,true);assert.notEqual(pending.secret,a.secret);assert.equal(signed.recovery_codes.length,8);
});

test('revocation and role changes survive restart and invalidate approved authority',async t=>{
 const f=fixture(t),a=await owner(f),b=await member(f,a,'approver');
 const op=f.core.createOperator({name:'Unit Revocation Operator',games:['uno-luck']}).operator;
 const r=f.core.requestRelease(op.id,'uno-luck','sandbox',a.session);f.core.advanceRelease(r.id,'validate',a.session);f.core.advanceRelease(r.id,'approve',b.session);
 assert.throws(()=>f.staff.update(a.session,a.identity.staff.id,{status:'disabled'}),error('LAST_OWNER_PROTECTED'));
 f.staff.revoke(a.session,b.id);assert.equal(f.staff.session(b.token),null);
 assert.throws(()=>f.core.advanceRelease(r.id,'activate',a.session),error('INDEPENDENT_APPROVAL_REQUIRED'));
 f.restart();assert.equal(f.staff.session(b.token),null);
 const challenge=await f.staff.login({username:'fixture-approver',password},'unit');
 const signed=f.staff.verifyMfa({challenge:challenge.challenge,code:totp(b.secret,{time:f.now()})},'unit');assert.ok(f.staff.session(signed.token));
 f.staff.update(a.session,b.id,{role:'auditor'});assert.equal(f.staff.session(signed.token),null);
 assert.throws(()=>f.core.advanceRelease(r.id,'activate',a.session),error('INDEPENDENT_APPROVAL_REQUIRED'));
});

test('MFA attempt budgets persist when enrollment challenges are replaced and on restart',async t=>{
 const f=fixture(t),a=await owner(f);
 for(let i=0;i<10;i++)f.staff.consumeLimit('mfa-account',a.identity.staff.id,10);
 f.restart();assert.throws(()=>f.staff.stepUp(a.session,{code:totp(a.secret,{time:f.now()})}),error('AUTH_RATE_LIMITED'));
 f.tick(10*60000+1);f.staff.stepUp(a.session,{code:totp(a.secret,{time:f.now()})});
 assert.equal(f.staff.identity(a.session).mfa_fresh,true);
});
