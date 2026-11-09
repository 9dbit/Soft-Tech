import {randomBytes} from 'node:crypto';
import {fail,equal,random,sha,text} from './security.mjs';
import {hashPassword,verifyPassword,newTotpSecret,matchTotp} from './staff-crypto.mjs';
import {currentStaffSession,requireStaff,STAFF_ROLES,MFA_FRESH_MS} from './staff-policy.mjs';

const MINUTE=60000,HOUR=60*MINUTE;
const only=(data,keys)=>{if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!keys.includes(k)))fail(422,'UNKNOWN_FIELD');};
const username=value=>text(typeof value==='string'?value.trim().toLowerCase():value,'staff_username',{min:3,max:120,pattern:/^[a-z0-9][a-z0-9@._+-]+$/});
const tokenHash=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)?sha(value):fail(401,'INVALID_AUTH_TOKEN');
const recoveryHash=(id,value)=>sha(id+':'+String(value||'').replaceAll('-','').toLowerCase());
export const staffView=u=>({id:u.id,username:u.username,display_name:u.display_name,person_ref:u.person_ref,role:u.role,status:u.status,mfa_enrolled:!!u.totp_secret_box,created_at:u.created_at,mfa_enrolled_at:u.mfa_enrolled_at});

export class StaffAuth{
 constructor(core){this.core=core;}
 now(){return this.core.clock();}
 audit(actor,event,id,detail={}){this.core.audit(actor,event,id,detail);}
 cleanup(){
  const c=this.core,now=this.now();
  c.run('DELETE FROM staff_auth_limits WHERE window_started_at<?',now-HOUR);
  c.run('DELETE FROM staff_auth_challenges WHERE expires_at<?',now);
  c.run('DELETE FROM staff_enrollments WHERE expires_at<?',now);
  c.run('DELETE FROM staff_sessions WHERE expires_at<?',now-HOUR);
 }
 consumeLimit(kind,identity,max=10){
  const key=sha(kind+':'+identity),now=this.now(),row=this.core.get('SELECT * FROM staff_auth_limits WHERE key_hash=?',key);
  if(row&&row.window_started_at>now-10*MINUTE&&row.attempts>=max)fail(429,'AUTH_RATE_LIMITED','Too many authentication attempts. Retry after 10 minutes.');
  this.core.run(`INSERT INTO staff_auth_limits(key_hash,attempts,window_started_at) VALUES(?,1,?) ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN window_started_at<=? THEN 1 ELSE attempts+1 END,window_started_at=CASE WHEN window_started_at<=? THEN excluded.window_started_at ELSE window_started_at END`,key,now,now-10*MINUTE,now-10*MINUTE);
  return key;
 }
 session(raw){
  if(typeof raw!=='string'||raw.length>100)return null;
  const s=currentStaffSession(this.core,sha(raw));
  if(s&&s.last_seen_at<this.now()-MINUTE)this.core.run('UPDATE staff_sessions SET last_seen_at=? WHERE id_hash=?',this.now(),s.id_hash);
  return s;
 }
 identity(session){
  const s=session?.kind==='staff'?currentStaffSession(this.core,session.id_hash):null;
  if(!s)return {kind:'shared',staff:null,permissions:session?.role==='admin'&&this.core.deploymentIdentity.environment==='sandbox'?['operations:write']:[],mfa_verified:false};
  return {kind:'staff',staff:{id:s.staff_id,username:s.username,display_name:s.display_name,person_ref:s.person_ref,role:s.staff_role},permissions:s.mfa_method==='totp'?STAFF_ROLES[s.staff_role]:[],mfa_verified:s.mfa_method==='totp',mfa_method:s.mfa_method,mfa_fresh:s.mfa_method==='totp'&&s.mfa_at>=this.now()-MFA_FRESH_MS,mfa_at:s.mfa_at};
 }
 readiness(){
  const users=this.core.all("SELECT id,person_ref,role FROM staff_users WHERE status='active' AND totp_secret_box IS NOT NULL");
  const makers=users.filter(u=>STAFF_ROLES[u.role].includes('release:request')),approvers=users.filter(u=>STAFF_ROLES[u.role].includes('release:approve'));
  return {bootstrap_available:this.core.get('SELECT count(*) n FROM staff_users').n===0&&!this.core.get("SELECT value FROM meta WHERE key='staff_bootstrap_completed'"),active_mfa_staff:users.length,release_requesters:makers.length,release_approvers:approvers.length,distinct_approvers_available:makers.some(m=>approvers.some(a=>a.id!==m.id&&a.person_ref!==m.person_ref)),human_identity_review_required:true};
 }
 list(session){
  const identity=this.identity(session),canManage=identity.permissions.includes('staff:manage');
  const users=canManage?this.core.all('SELECT * FROM staff_users ORDER BY created_at'):identity.staff?[this.core.get('SELECT * FROM staff_users WHERE id=?',identity.staff.id)]:[];
  return {identity,readiness:this.readiness(),users:users.map(staffView)};
 }
 metadata(data){
  const name=username(data.username),display=text(typeof data.display_name==='string'?data.display_name.trim():data.display_name,'staff_name',{min:3,max:100}),person=text(typeof data.person_ref==='string'?data.person_ref.trim().toLowerCase():data.person_ref,'person_reference',{min:3,max:120,pattern:/^[a-z0-9][a-z0-9@._:+/-]+$/});
  return {username:name,display_name:display,person_ref:person};
 }
 ensureUnique(person){
  if(this.core.get('SELECT id FROM staff_users WHERE username=?',person.username))fail(409,'STAFF_USERNAME_EXISTS');
  if(this.core.get('SELECT id FROM staff_users WHERE person_ref=?',person.person_ref))fail(409,'STAFF_PERSON_EXISTS','This person already has a staff account.');
 }
 beginEnrollment(user){
  const token=random(32),secret=newTotpSecret(),now=this.now(),expires=now+10*MINUTE;
  this.core.run('DELETE FROM staff_enrollments WHERE staff_id=?',user.id);
  this.core.run('INSERT INTO staff_enrollments(token_hash,staff_id,secret_box,auth_version,expires_at,created_at) VALUES(?,?,?,?,?,?)',sha(token),user.id,this.core.vault.seal(secret),user.auth_version,expires,now);
  this.audit('staff:'+user.id,'staff.mfa_enrollment_started',user.id);
  const issuer='Soft Tech '+this.core.deploymentIdentity.environment;
  return {enrollment_required:true,enrollment_token:token,secret,otpauth_uri:'otpauth://totp/'+encodeURIComponent(issuer+':'+user.username)+'?secret='+secret+'&issuer='+encodeURIComponent(issuer)+'&algorithm=SHA1&digits=6&period=30',expires_at:expires,username:user.username};
 }
 async bootstrap(session,data){
  only(data,['username','display_name','person_ref','password','admin_password']);
  if(session?.kind==='staff'||session?.role!=='admin'||typeof this.core.env.PANEL_ADMIN_PASSWORD!=='string'||this.core.env.PANEL_ADMIN_PASSWORD.length<16)fail(403,'BOOTSTRAP_ADMIN_REAUTH_REQUIRED');
  this.consumeLimit('bootstrap-admin-reauth','first-owner',5);
  if(!equal(data.admin_password,this.core.env.PANEL_ADMIN_PASSWORD))fail(403,'BOOTSTRAP_ADMIN_REAUTH_REQUIRED');
  const person=this.metadata(data);
  return this.core.serial('staff-bootstrap',async()=>{
   if(!this.readiness().bootstrap_available)fail(409,'STAFF_BOOTSTRAP_CLOSED','The first staff identity is already registered. Use individual sign-in or account recovery.');
   const passwordHash=await hashPassword(data.password);
   return this.core.transaction(()=>{
    if(!this.readiness().bootstrap_available)fail(409,'STAFF_BOOTSTRAP_CLOSED');
    const id='staff_'+random(18),now=this.now();
    this.ensureUnique(person);
    this.core.run(`INSERT INTO staff_users(id,username,display_name,person_ref,role,status,password_hash,created_by,created_at,updated_at) VALUES(?,?,?,?,'owner','pending_mfa',?,'shared-admin-bootstrap',?,?)`,id,person.username,person.display_name,person.person_ref,passwordHash,now,now);
    this.audit('panel:admin','staff.owner_bootstrap_pending',id,{username:person.username,person_ref:person.person_ref});
    return this.beginEnrollment(this.core.get('SELECT * FROM staff_users WHERE id=?',id));
   });
  });
 }
 invite(session,data){
  only(data,['username','display_name','person_ref','role']);
  const actor=requireStaff(this.core,session,'staff:manage'),person=this.metadata(data);
  if(!Object.hasOwn(STAFF_ROLES,data.role))fail(422,'INVALID_STAFF_ROLE');
  return this.core.transaction(()=>{
   this.ensureUnique(person);
   const id='staff_'+random(18),now=this.now(),token=random(32),expires=now+24*HOUR;
   this.core.run("INSERT INTO staff_users(id,username,display_name,person_ref,role,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'invited',?,?,?)",id,person.username,person.display_name,person.person_ref,data.role,'staff:'+actor.staff_id,now,now);
   this.core.run('INSERT INTO staff_invitations(token_hash,staff_id,expires_at,created_at) VALUES(?,?,?,?)',sha(token),id,expires,now);
   this.audit('staff:'+actor.staff_id,'staff.invited',id,{username:person.username,person_ref:person.person_ref,role:data.role});
   return {staff:staffView(this.core.get('SELECT * FROM staff_users WHERE id=?',id)),activation_token:token,expires_at:expires};
  });
 }
 reissueInvitation(session,id){
  const actor=requireStaff(this.core,session,'staff:manage'),user=this.core.get('SELECT * FROM staff_users WHERE id=?',id);
  if(!user||user.status!=='invited')fail(409,'STAFF_NOT_INVITED');
  return this.core.transaction(()=>{
   const token=random(32),now=this.now(),expires=now+24*HOUR;
   this.core.run('DELETE FROM staff_invitations WHERE staff_id=?',id);
   this.core.run('INSERT INTO staff_invitations(token_hash,staff_id,expires_at,created_at) VALUES(?,?,?,?)',sha(token),id,expires,now);
   this.audit('staff:'+actor.staff_id,'staff.invitation_rotated',id);
   return {staff:staffView(user),activation_token:token,expires_at:expires};
  });
 }
 async activate(data,ip){
  only(data,['activation_token','password']);this.consumeLimit('activation-ip',ip,20);
  const hash=tokenHash(data.activation_token),before=this.core.get('SELECT * FROM staff_invitations WHERE token_hash=? AND used_at IS NULL AND expires_at>?',hash,this.now());
  if(!before)fail(401,'INVALID_AUTH_TOKEN');
  const passwordHash=await hashPassword(data.password);
  return this.core.transaction(()=>{
   const invite=this.core.get('SELECT * FROM staff_invitations WHERE token_hash=? AND used_at IS NULL AND expires_at>?',hash,this.now()),user=invite?this.core.get('SELECT * FROM staff_users WHERE id=?',invite.staff_id):null;
   if(!user||user.status!=='invited')fail(401,'INVALID_AUTH_TOKEN');
   this.core.run('UPDATE staff_invitations SET used_at=? WHERE token_hash=?',this.now(),hash);
   this.core.run("UPDATE staff_users SET status='pending_mfa',password_hash=?,updated_at=? WHERE id=?",passwordHash,this.now(),user.id);
   this.audit('staff:'+user.id,'staff.invitation_claimed',user.id);
   return this.beginEnrollment(this.core.get('SELECT * FROM staff_users WHERE id=?',user.id));
  });
 }
 async login(data,ip){
  only(data,['username','password']);this.cleanup();this.consumeLimit('login-ip',ip,30);
  const name=username(data.username),accountKey=this.consumeLimit('login-account',name,10),before=this.core.get('SELECT * FROM staff_users WHERE username=?',name);
  const valid=await verifyPassword(data.password,before?.password_hash);
  if(!valid||!before||!['active','pending_mfa'].includes(before.status)){
   this.audit(before?'staff:'+before.id:'staff:unknown','staff.login_failed',before?.id||'staff',{reason:'invalid_credentials'});fail(401,'INVALID_CREDENTIALS');
  }
  return this.core.transaction(()=>{
   const user=this.core.get('SELECT * FROM staff_users WHERE id=?',before.id);
   if(user.password_hash!==before.password_hash||user.auth_version!==before.auth_version||!['active','pending_mfa'].includes(user.status))fail(401,'INVALID_CREDENTIALS');
   if(user.status==='pending_mfa')return this.beginEnrollment(user);
   const challenge=random(32),now=this.now(),expires=now+5*MINUTE;
   this.core.run('DELETE FROM staff_auth_challenges WHERE staff_id=?',user.id);
   this.core.run('INSERT INTO staff_auth_challenges(token_hash,staff_id,auth_version,expires_at,account_rate_key,created_at) VALUES(?,?,?,?,?,?)',sha(challenge),user.id,user.auth_version,expires,accountKey,now);
   return {mfa_required:true,challenge,expires_at:expires};
  });
 }
 issueSession(user,method='totp',mfaAt=this.now()){
  const token=random(36),csrf=random(24),now=this.now(),seconds=method==='totp'?8*3600:15*60;
  this.core.run('INSERT INTO staff_sessions(id_hash,staff_id,csrf,auth_version,mfa_method,mfa_at,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?)',sha(token),user.id,csrf,user.auth_version,method,mfaAt,now+seconds*1000,now,now);
  return {token,max_age:seconds,csrf,role:method==='totp'&&['owner','operator'].includes(user.role)?'admin':'auditor',identity:this.identity(currentStaffSession(this.core,sha(token)))};
 }
 recoveryCodes(id){
  this.core.run('DELETE FROM staff_recovery_codes WHERE staff_id=?',id);
  return Array.from({length:8},()=>{
   const code=randomBytes(16).toString('hex').match(/.{1,8}/g).join('-');
   this.core.run('INSERT INTO staff_recovery_codes(code_hash,staff_id,created_at) VALUES(?,?,?)',recoveryHash(id,code),id,this.now());return code;
  });
 }
 confirmEnrollment(data,ip){
  only(data,['enrollment_token','code']);this.consumeLimit('enrollment-ip',ip,30);
  const hash=tokenHash(data.enrollment_token),enrollment=this.core.get('SELECT * FROM staff_enrollments WHERE token_hash=? AND expires_at>?',hash,this.now());
  if(!enrollment||enrollment.attempts>=5)fail(401,'INVALID_AUTH_TOKEN');
  this.consumeLimit('mfa-account',enrollment.staff_id,10);
  this.core.run('UPDATE staff_enrollments SET attempts=attempts+1 WHERE token_hash=?',hash);
  const user=this.core.get('SELECT * FROM staff_users WHERE id=?',enrollment.staff_id);
  if(!user||user.status!=='pending_mfa'||user.auth_version!==enrollment.auth_version)fail(401,'INVALID_AUTH_TOKEN');
  const step=matchTotp(this.core.vault.open(enrollment.secret_box),data.code,this.now());
  if(step===null){this.audit('staff:'+user.id,'staff.mfa_enrollment_failed',user.id);fail(401,'INVALID_MFA_CODE');}
  return this.core.transaction(()=>{
   this.core.run("UPDATE staff_users SET status='active',totp_secret_box=?,totp_last_step=?,mfa_enrolled_at=?,updated_at=? WHERE id=?",enrollment.secret_box,step,this.now(),this.now(),user.id);
   this.core.run('DELETE FROM staff_enrollments WHERE staff_id=?',user.id);
   this.core.run('DELETE FROM staff_auth_limits WHERE key_hash IN(?,?)',sha('mfa-account:'+user.id),sha('login-account:'+user.username));
   if(user.role==='owner')this.core.run("INSERT OR IGNORE INTO meta(key,value) VALUES('staff_bootstrap_completed',?)",String(this.now()));
   this.audit('staff:'+user.id,'staff.mfa_enrolled',user.id,{role:user.role,method:'totp'});
   const active=this.core.get('SELECT * FROM staff_users WHERE id=?',user.id);
   return {...this.issueSession(active),recovery_codes:this.recoveryCodes(user.id)};
  });
 }
 verifyMfa(data,ip){
  only(data,['challenge','code','recovery_code']);this.consumeLimit('mfa-ip',ip,30);
  if(!!data.code===!!data.recovery_code)fail(422,'ONE_MFA_METHOD_REQUIRED');
  const hash=tokenHash(data.challenge),challenge=this.core.get('SELECT * FROM staff_auth_challenges WHERE token_hash=? AND expires_at>?',hash,this.now());
  if(!challenge||challenge.attempts>=5)fail(401,'INVALID_AUTH_TOKEN');
  this.consumeLimit('mfa-account',challenge.staff_id,10);
  this.core.run('UPDATE staff_auth_challenges SET attempts=attempts+1 WHERE token_hash=?',hash);
  const user=this.core.get('SELECT * FROM staff_users WHERE id=?',challenge.staff_id);
  if(!user||user.status!=='active'||user.auth_version!==challenge.auth_version||!user.totp_secret_box)fail(401,'INVALID_AUTH_TOKEN');
  const recovery=data.recovery_code?this.core.get('SELECT code_hash FROM staff_recovery_codes WHERE staff_id=? AND code_hash=? AND used_at IS NULL',user.id,recoveryHash(user.id,data.recovery_code)):null;
  const step=data.code?matchTotp(this.core.vault.open(user.totp_secret_box),data.code,this.now(),user.totp_last_step):null;
  if(!recovery&&step===null){this.audit('staff:'+user.id,'staff.mfa_failed',user.id,{reason:'invalid_or_replayed'});fail(401,'INVALID_MFA_CODE');}
  return this.core.transaction(()=>{
   const method=recovery?'recovery':'totp';
   if(recovery)this.core.run('UPDATE staff_recovery_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL',this.now(),recovery.code_hash);
   else this.core.run('UPDATE staff_users SET totp_last_step=? WHERE id=?',step,user.id);
   this.core.run('DELETE FROM staff_auth_challenges WHERE staff_id=?',user.id);
   this.core.run('DELETE FROM staff_auth_limits WHERE key_hash IN(?,?)',challenge.account_rate_key,sha('mfa-account:'+user.id));
   this.audit('staff:'+user.id,'staff.login_succeeded',user.id,{method});
   return this.issueSession(user,method);
  });
 }
 logout(session){
  this.core.run('UPDATE staff_sessions SET revoked_at=? WHERE id_hash=?',this.now(),session.id_hash);
  this.audit('staff:'+session.staff_id,'staff.logout',session.staff_id);
 }
 consumeTotp(session,code){
  const s=requireStaff(this.core,session,'self:manage',{fresh:false});
  this.consumeLimit('mfa-account',s.staff_id,10);
  const user=this.core.get('SELECT * FROM staff_users WHERE id=?',s.staff_id),step=matchTotp(this.core.vault.open(user.totp_secret_box),code,this.now(),user.totp_last_step);
  if(step===null){this.audit('staff:'+s.staff_id,'staff.mfa_step_up_failed',s.staff_id);fail(401,'INVALID_MFA_CODE');}
  this.core.run('UPDATE staff_users SET totp_last_step=? WHERE id=?',step,s.staff_id);
  this.core.run('UPDATE staff_sessions SET mfa_at=?,last_seen_at=? WHERE id_hash=?',this.now(),this.now(),s.id_hash);
  this.core.run('DELETE FROM staff_auth_limits WHERE key_hash=?',sha('mfa-account:'+s.staff_id));
  return s;
 }
 stepUp(session,data){
  only(data,['code']);const s=this.consumeTotp(session,data.code);
  this.audit('staff:'+s.staff_id,'staff.mfa_step_up',s.staff_id);
  return {identity:this.identity(session)};
 }
 regenerateRecovery(session,data){
  only(data,['code']);const s=this.consumeTotp(session,data.code);
  return this.core.transaction(()=>{const codes=this.recoveryCodes(s.staff_id);this.audit('staff:'+s.staff_id,'staff.recovery_codes_rotated',s.staff_id);return {recovery_codes:codes};});
 }
 revoke(session,id){
  const actor=requireStaff(this.core,session,'staff:manage'),user=this.core.get('SELECT id FROM staff_users WHERE id=?',id);
  if(!user)fail(404,'STAFF_NOT_FOUND');
  return this.core.transaction(()=>{this.invalidate(id);this.audit('staff:'+actor.staff_id,'staff.sessions_revoked',id);return {success:true};});
 }
 invalidate(id){
  this.core.run('UPDATE staff_users SET auth_version=auth_version+1,updated_at=? WHERE id=?',this.now(),id);
  this.core.run('UPDATE staff_sessions SET revoked_at=? WHERE staff_id=? AND revoked_at IS NULL',this.now(),id);
  this.core.run('DELETE FROM staff_auth_challenges WHERE staff_id=?',id);
  this.core.run('DELETE FROM staff_enrollments WHERE staff_id=?',id);
 }
 update(session,id,data){
  only(data,['role','status']);const actor=requireStaff(this.core,session,'staff:manage'),user=this.core.get('SELECT * FROM staff_users WHERE id=?',id);
  if(!user)fail(404,'STAFF_NOT_FOUND');
  const role=data.role??user.role,status=data.status??user.status;
  if(!Object.hasOwn(STAFF_ROLES,role)||data.status&&!['active','disabled'].includes(data.status))fail(422,'INVALID_STAFF_UPDATE');
  if(status==='active'&&(!user.password_hash||!user.totp_secret_box))fail(409,'STAFF_ENROLLMENT_REQUIRED');
  if(user.role==='owner'&&user.status==='active'&&(role!=='owner'||status!=='active')&&this.core.get("SELECT count(*) n FROM staff_users WHERE role='owner' AND status='active'").n<=1)fail(409,'LAST_OWNER_PROTECTED');
  return this.core.transaction(()=>{
   this.invalidate(id);this.core.run('UPDATE staff_users SET role=?,status=? WHERE id=?',role,status,id);
   this.audit('staff:'+actor.staff_id,'staff.account_updated',id,{from_role:user.role,to_role:role,from_status:user.status,to_status:status});
   return staffView(this.core.get('SELECT * FROM staff_users WHERE id=?',id));
  });
 }
 async changePassword(session,data){
  only(data,['current_password','new_password']);const s=requireStaff(this.core,session,'self:manage'),user=this.core.get('SELECT * FROM staff_users WHERE id=?',s.staff_id);
  this.consumeLimit('password-change',s.staff_id,5);
  if(!await verifyPassword(data.current_password,user.password_hash))fail(401,'INVALID_CREDENTIALS');
  const hash=await hashPassword(data.new_password);
  return this.core.transaction(()=>{
   requireStaff(this.core,session,'self:manage');this.invalidate(user.id);
   this.core.run('UPDATE staff_users SET password_hash=? WHERE id=?',hash,user.id);
   this.audit('staff:'+user.id,'staff.password_changed',user.id);
   return this.issueSession(this.core.get('SELECT * FROM staff_users WHERE id=?',user.id),'totp',s.mfa_at);
  });
 }
 async resetMfa(session,data){
  only(data,['current_password','code']);const s=session?.kind==='staff'?currentStaffSession(this.core,session.id_hash):null;
  if(!s)fail(403,'NAMED_STAFF_REQUIRED');
  this.consumeLimit('mfa-reset',s.staff_id,5);
  const user=this.core.get('SELECT * FROM staff_users WHERE id=?',s.staff_id);
  if(!await verifyPassword(data.current_password,user.password_hash))fail(401,'INVALID_CREDENTIALS');
  return this.core.transaction(()=>{
   if(!currentStaffSession(this.core,session.id_hash))fail(401,'UNAUTHENTICATED');
   if(s.mfa_method==='totp')this.consumeTotp(session,data.code);
   this.invalidate(user.id);
   this.core.run("UPDATE staff_users SET status='pending_mfa',totp_secret_box=NULL,totp_last_step=-1,mfa_enrolled_at=NULL WHERE id=?",user.id);
   this.core.run('DELETE FROM staff_recovery_codes WHERE staff_id=?',user.id);
   this.audit('staff:'+user.id,'staff.mfa_reset_started',user.id,{recovered:s.mfa_method==='recovery'});
   return this.beginEnrollment(this.core.get('SELECT * FROM staff_users WHERE id=?',user.id));
  });
 }
}
