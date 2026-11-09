'use strict';
// Enrollment and login secrets live only in this page's memory until the dialog closes.
let staffChallenge=null,staffSnapshot=null;
function clearStaffChallenge(){staffChallenge=null;}
const staffInput=(label,name,type='text',extra='')=>'<div class="control-group"><label>'+esc(label)+'<input name="'+name+'" type="'+type+'" '+extra+' required></label></div>';
const staffForm=(id,body,submit)=>'<form id="'+id+'" autocomplete="off">'+body+'<p class="error-message" data-staff-error role="alert"></p><button class="btn-primary" type="submit">'+submit+'</button></form>';
function staffPage(){return heading('STAFF <em>& MFA.</em>','Individual accounts, authenticator verification, and independent release approval.',btn('REFRESH','data-staff-refresh'))+'<div id="staff-content" class="staff-content">Loading staff access...</div>';}
pages.staff=staffPage;
async function refreshStaff(){
 const data=await request('/api/staff');staffSnapshot=data;
 const target=$('staff-content');if(!target)return;
 const id=data.identity,own=id.staff,ready=data.readiness,manage=id.permissions.includes('staff:manage');
 let access='<h2>'+esc(own?own.display_name:'Shared sandbox access')+'</h2><p>'+(own?esc(own.username)+' / '+esc(own.role):'Create the first owner with their own password and authenticator. Shared access cannot request or approve a release.')+'</p>';
 if(own)access+='<p>'+tag(id.mfa_verified?(id.mfa_fresh?'MFA verified':'MFA renewal due'):'Recovery access only')+'</p><div class="action-stack top-gap">'+(id.mfa_verified?btn('VERIFY NEW MFA CODE','data-staff-step-up')+btn('CHANGE PASSWORD','data-staff-password')+btn('REPLACE RECOVERY CODES','data-staff-recovery'):'')+btn('REPLACE AUTHENTICATOR','data-staff-reset')+'</div>';
 else if(state.role==='admin'&&ready.bootstrap_available)access+=btn('ENROLL FIRST OWNER','data-staff-bootstrap',true);
 else if(!ready.bootstrap_available)access+='<p>Use Individual Staff + MFA on the sign-in page. If the first registration is unfinished, sign in with that person’s chosen username and password to resume enrollment.</p>';
 const status='<section class="panel"><h2>RELEASE IDENTITIES</h2><p>'+n(ready.active_mfa_staff)+' active authenticator accounts. '+n(ready.release_requesters)+' eligible requesters and '+n(ready.release_approvers)+' eligible approvers.</p><p>'+tag(ready.distinct_approvers_available?'Separate approver available':'Separate approver pending')+'</p><p>Each person needs one verified personnel reference. The requester cannot approve their own release. Identity verification and project go-live sign-off remain the responsibility of the designated people.</p></section>';
 target.innerHTML='<div class="grid grid-two"><section class="panel">'+access+'</section>'+status+'</div><section class="panel top-gap"><div class="row-space"><h2>'+(manage?'STAFF DIRECTORY':'YOUR ACCOUNT')+'</h2>'+(manage?btn('INVITE STAFF','data-staff-invite',true):'')+'</div>'+ (data.users.length?table(['Person','Role / Status','MFA','Actions'],data.users.map(u=>'<tr><td><strong>'+esc(u.display_name)+'</strong><br>'+esc(u.username)+'<br><small class="tiny">'+esc(u.person_ref)+'</small></td><td>'+esc(u.role)+'<br>'+tag(u.status)+'</td><td>'+tag(u.mfa_enrolled?'Enrolled':'Pending')+'</td><td>'+(manage?btn('EDIT ACCESS','data-staff-edit="'+esc(u.id)+'"')+(u.status==='invited'?btn('NEW INVITATION','data-staff-reinvite="'+esc(u.id)+'"'):btn('REVOKE SESSIONS','data-staff-revoke="'+esc(u.id)+'"')):'Self-service above')+'</td></tr>')):empty('No individual staff accounts are active yet.'))+'</section>';
}
function showStaffMfa(data){
 staffChallenge={challenge:data.challenge};
 modal('<h2>VERIFY YOUR AUTHENTICATOR</h2><p>Enter one unused code. A recovery code grants limited access to replace a lost authenticator.</p>'+staffForm('staff-login-mfa','<div class="control-group"><label>Verification method<select name="method"><option value="totp">Authenticator code</option><option value="recovery">One-time recovery code</option></select></label></div>'+staffInput('Code','code','text','autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength="64"'),'VERIFY & SIGN IN'));
}
function showStaffEnrollment(data){
 staffChallenge={enrollment_token:data.enrollment_token};
 modal('<h2>SET UP YOUR AUTHENTICATOR</h2><p>Account: <strong>'+esc(data.username)+'</strong>. Add this setup key to your own authenticator app. Use a time-based code, 6 digits, 30 seconds. This setup expires in 10 minutes.</p><div class="staff-secret secret-output" aria-label="Authenticator setup key">'+esc(data.secret)+'</div><p>Your account becomes active only after you enter a valid code below. Closing this dialog leaves enrollment unfinished; sign in again to restart.</p>'+staffForm('staff-enrollment-confirm',staffInput('Authenticator code','code','text','inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"'),'CONFIRM ENROLLMENT'));
}
function showStaffRecovery(codes){
 modal('<h2>SAVE YOUR RECOVERY CODES</h2><p>Each code works once. Keep these in a private password manager or another secure location. They are displayed only now and grant limited recovery access, never release approval.</p><pre class="doc-code secret-output">'+esc(codes.join('\n'))+'</pre>'+btn('SAVED SECURELY / CLOSE','data-close-dialog',true));
}
function showStaffInvitation(data){
 modal('<h2>STAFF INVITATION</h2><p>For <strong>'+esc(data.staff.display_name)+'</strong> ('+esc(data.staff.username)+'). Give this one-time token directly to that person through your approved private channel. The recipient chooses their own password and enrolls their own authenticator.</p><pre class="doc-code secret-output">'+esc(data.activation_token)+'</pre><p>Expires: '+esc(time(data.expires_at))+'. Use ACTIVATE STAFF INVITATION on the sign-in page. Issuing another invitation revokes this one.</p>'+btn('SAVED / CLOSE','data-close-dialog',true));
}
async function finishStaffLogin(result){
 state.csrf=result.csrf;state.identity=result.identity;state.page='staff';
 if($('core-dialog')?.open)$('core-dialog').close();
 await load();if(result.recovery_codes)showStaffRecovery(result.recovery_codes);
}
function staffIdentityFields(){return staffInput('Staff username','username','text','autocomplete="username" minlength="3" maxlength="120"')+staffInput('Full name','display_name','text','minlength="3" maxlength="100"')+staffInput('Unique personnel reference / work email','person_ref','text','minlength="3" maxlength="120"');}
function showStaffBootstrap(){modal('<h2>ENROLL THE FIRST OWNER</h2><p>The actual owner must choose their own password and register their own authenticator. The personnel reference identifies one person across release decisions. This bootstrap closes after the first registration.</p>'+staffForm('staff-bootstrap-form',staffIdentityFields()+staffInput('Your new individual password','password','password','minlength="16" maxlength="128" autocomplete="new-password"')+staffInput('Re-enter the existing sandbox admin password','admin_password','password','autocomplete="current-password"'),'START OWNER ENROLLMENT'));}
function showStaffInvite(){modal('<h2>INVITE AN INDIVIDUAL STAFF MEMBER</h2><p>Use a real person’s name and personnel reference. The recipient creates their own credentials. Owners manage staff; operators request releases; approvers review requests; auditors read reports.</p>'+staffForm('staff-invite-form',staffIdentityFields()+'<div class="control-group"><label>Role<select name="role"><option value="operator">Operator / release requester</option><option value="approver">Independent release approver</option><option value="auditor">Read-only auditor</option><option value="owner">Owner / staff administrator</option></select></label></div>','CREATE INVITATION'));}
function showStaffEdit(id){const u=staffSnapshot?.users.find(x=>x.id===id);if(!u)return;modal('<h2>EDIT STAFF ACCESS</h2><p>'+esc(u.display_name)+' / '+esc(u.person_ref)+'. Saving revokes active sessions and pending release authority. The last active owner is protected.</p>'+staffForm('staff-edit-form','<input name="id" type="hidden" value="'+esc(id)+'"><div class="control-group"><label>Role<select name="role">'+['owner','operator','approver','auditor'].map(r=>'<option value="'+r+'" '+(u.role===r?'selected':'')+'>'+r+'</option>').join('')+'</select></label></div><div class="control-group"><label>Account status<select name="status"><option value="">Keep '+esc(u.status)+'</option><option value="disabled">Disable account</option>'+(u.mfa_enrolled?'<option value="active">Enable account</option>':'')+'</select></label></div>','SAVE & REVOKE SESSIONS'));}

document.addEventListener('DOMContentLoaded',()=>{
 const syncLogin=()=>{const individual=$('role').value==='staff';$('staff-username-field').hidden=!individual;$('staff-username').required=individual;};
 $('role').addEventListener('change',syncLogin);syncLogin();
 document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  try{
   if(b.hasAttribute('data-staff-refresh')){await refreshStaff();return;}
   if(b.hasAttribute('data-staff-bootstrap')){showStaffBootstrap();return;}
   if(b.hasAttribute('data-staff-invite')){showStaffInvite();return;}
   if(b.hasAttribute('data-staff-activation')){modal('<h2>ACTIVATE YOUR STAFF INVITATION</h2><p>Paste the token given to you by your owner and choose your own password. You will then enroll your authenticator.</p>'+staffForm('staff-activation-form',staffInput('One-time invitation token','activation_token','password','autocomplete="off" maxlength="43"')+staffInput('Your individual password','password','password','minlength="16" maxlength="128" autocomplete="new-password"'),'CONTINUE TO MFA'));return;}
   if(b.hasAttribute('data-staff-step-up')){modal('<h2>VERIFY A NEW AUTHENTICATOR CODE</h2><p>Sensitive staff and release actions require a code verified within the last 10 minutes. Wait for a new code if the current one was already used.</p>'+staffForm('staff-step-up-form',staffInput('Authenticator code','code','text','inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"'),'VERIFY CODE'));return;}
   if(b.hasAttribute('data-staff-recovery')){modal('<h2>REPLACE RECOVERY CODES</h2><p>Enter a new authenticator code. Existing recovery codes will stop working.</p>'+staffForm('staff-recovery-form',staffInput('Authenticator code','code','text','inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"'),'REPLACE CODES'));return;}
   if(b.hasAttribute('data-staff-password')){modal('<h2>CHANGE YOUR PASSWORD</h2><p>All existing sessions will be revoked. This browser receives a new authenticated session after the change.</p>'+staffForm('staff-password-form',staffInput('Current password','current_password','password','autocomplete="current-password"')+staffInput('New individual password','new_password','password','minlength="16" maxlength="128" autocomplete="new-password"'),'CHANGE PASSWORD'));return;}
   if(b.hasAttribute('data-staff-reset')){modal('<h2>REPLACE YOUR AUTHENTICATOR</h2><p>This revokes your sessions and old recovery codes. Complete enrollment with your new authenticator to resume access.</p>'+staffForm('staff-reset-form',staffInput('Current password','current_password','password','autocomplete="current-password"')+(state.identity?.mfa_method==='totp'?staffInput('Unused code from current authenticator','code','text','inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"'):''),'START REPLACEMENT'));return;}
   if(b.dataset.staffEdit){showStaffEdit(b.dataset.staffEdit);return;}
   if(b.dataset.staffReinvite){b.disabled=true;const r=await post('/api/staff/'+b.dataset.staffReinvite+'/invite');showStaffInvitation(r);b.disabled=false;return;}
   if(b.dataset.staffRevoke){if(!confirm('Revoke this person’s sessions and pending release authority?'))return;await post('/api/staff/'+b.dataset.staffRevoke+'/revoke');await refreshStaff();notice('Staff sessions revoked');return;}
  }catch(error){notice(error.message);b.disabled=false;}
 });
 document.addEventListener('submit',async e=>{
  const form=e.target;if(!form.id.startsWith('staff-'))return;e.preventDefault();
  const data=Object.fromEntries(new FormData(form)),button=form.querySelector('[type="submit"]'),error=form.querySelector('[data-staff-error]');button.disabled=true;error.textContent='';
  try{
   if(form.id==='staff-bootstrap-form'){showStaffEnrollment(await post('/api/staff/bootstrap',data));return;}
   if(form.id==='staff-activation-form'){showStaffEnrollment(await post('/api/staff/activate',data));return;}
   if(form.id==='staff-enrollment-confirm'){await finishStaffLogin(await post('/api/staff/enroll/confirm',{enrollment_token:staffChallenge?.enrollment_token,code:data.code}));return;}
   if(form.id==='staff-login-mfa'){const payload={challenge:staffChallenge?.challenge,[data.method==='recovery'?'recovery_code':'code']:data.code};await finishStaffLogin(await post('/api/staff/mfa',payload));return;}
   if(form.id==='staff-invite-form'){const result=await post('/api/staff',data);await refreshStaff();showStaffInvitation(result);return;}
   if(form.id==='staff-step-up-form'){const result=await post('/api/staff/step-up',data);state.identity=result.identity;$('core-dialog').close();await refreshStaff();notice('MFA verified for sensitive actions');return;}
   if(form.id==='staff-recovery-form'){showStaffRecovery((await post('/api/staff/recovery-codes',data)).recovery_codes);return;}
   if(form.id==='staff-password-form'){await finishStaffLogin(await post('/api/staff/password',data));notice('Password changed and sessions rotated');return;}
   if(form.id==='staff-reset-form'){const result=await post('/api/staff/mfa/reset',data);showLogin();showStaffEnrollment(result);return;}
   if(form.id==='staff-edit-form'){const {id,status,...change}=data;if(status)change.status=status;await post('/api/staff/'+id,change);$('core-dialog').close();await refreshStaff();return;}
  }catch(err){if(form.isConnected)error.textContent=err.message;else notice(err.message);}finally{if(button.isConnected)button.disabled=false;}
 });
});
