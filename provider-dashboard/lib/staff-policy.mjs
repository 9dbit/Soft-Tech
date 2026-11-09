import {fail} from './security.mjs';

export const STAFF_ROLES=Object.freeze({
 owner:['self:manage','staff:manage','operations:write','release:request','release:validate','release:approve','release:activate','release:reject','release:cancel'],
 operator:['self:manage','operations:write','release:request','release:validate','release:activate','release:cancel'],
 approver:['self:manage','release:approve','release:reject'],
 auditor:['self:manage']
});
export const MFA_FRESH_MS=10*60*1000;
export const STAFF_IDLE_MS=30*60*1000;
export function currentStaffSession(core,idHash){
 if(typeof idHash!=='string'||!core.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='staff_sessions'"))return null;
 const s=core.get(`SELECT s.*,u.username,u.display_name,u.person_ref,u.role AS staff_role,u.status,u.auth_version AS current_auth_version
  FROM staff_sessions s JOIN staff_users u ON u.id=s.staff_id
  WHERE s.id_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND u.status='active' AND u.totp_secret_box IS NOT NULL AND s.auth_version=u.auth_version`,idHash,core.clock(),core.clock()-STAFF_IDLE_MS);
 return s?{...s,kind:'staff',role:s.mfa_method==='totp'&&['owner','operator'].includes(s.staff_role)?'admin':'auditor'}:null;
}
export function requireStaff(core,session,permission,{fresh=true}={}){
 const s=session?.kind==='staff'?currentStaffSession(core,session.id_hash):null;
 const deny=(code,message)=>{core.audit(s?'staff:'+s.staff_id:'panel:shared','staff.authorization_denied','provider',{permission,reason:code});fail(403,code,message);};
 if(!s)deny('NAMED_STAFF_REQUIRED','Sign in with an individual staff account and MFA. Shared sandbox access cannot authorize this action.');
 if(!STAFF_ROLES[s.staff_role]?.includes(permission))deny('STAFF_PERMISSION_DENIED');
 if(s.mfa_method!=='totp')deny('TOTP_REQUIRED','Complete authenticator recovery before this action.');
 if(fresh&&(!s.mfa_at||s.mfa_at>core.clock()+30000||s.mfa_at<core.clock()-MFA_FRESH_MS))deny('MFA_STEP_UP_REQUIRED','Verify a new authenticator code in Staff & MFA, then retry.');
 return s;
}
export function releaseStaff(core,session,action,request=null){
 const s=requireStaff(core,session,'release:'+action);
 if(request&&['approve','activate'].includes(action)){
  const maker=core.get('SELECT * FROM staff_users WHERE id=?',String(request.requested_by).replace(/^staff:/,''));
  if(!String(request.requested_by).startsWith('staff:')||!maker||maker.status!=='active')fail(409,'NAMED_REQUESTER_REQUIRED','Recreate this request with an active individual staff account.');
  const made=core.get("SELECT * FROM staff_release_signoffs WHERE release_id=? AND action='request'",request.id);
  if(!made||made.staff_id!==maker.id||made.auth_version!==maker.auth_version||!STAFF_ROLES[maker.role]?.includes('release:request'))fail(409,'STALE_REQUESTER_AUTHORIZATION','The requester credentials or role changed. Recreate this release request.');
  if(action==='approve'&&(maker.id===s.staff_id||maker.person_ref===s.person_ref)){
   core.audit('staff:'+s.staff_id,'release.approval_denied',request.id,{reason:'INDEPENDENT_APPROVER_REQUIRED'});
   fail(403,'INDEPENDENT_APPROVER_REQUIRED','The requester cannot approve their own release.');
  }
  if(action==='activate'){
   const proof=core.get(`SELECT a.*,u.status,u.role,u.auth_version AS current_auth_version FROM staff_release_signoffs a JOIN staff_users u ON u.id=a.staff_id WHERE a.release_id=? AND a.action='approve'`,request.id);
   if(!proof||proof.status!=='active'||proof.auth_version!==proof.current_auth_version||!STAFF_ROLES[proof.role]?.includes('release:approve')||proof.person_ref===maker.person_ref||proof.staff_id===maker.id||request.approved_by!=='staff:'+proof.staff_id)fail(409,'INDEPENDENT_APPROVAL_REQUIRED');
  }
 }
 return s;
}
export function recordReleaseSignoff(core,requestId,action,s){
 core.run('INSERT INTO staff_release_signoffs(release_id,action,staff_id,person_ref,auth_version,mfa_at,created_at) VALUES(?,?,?,?,?,?,?)',requestId,action,s.staff_id,s.person_ref,s.auth_version,s.mfa_at,core.clock());
}
