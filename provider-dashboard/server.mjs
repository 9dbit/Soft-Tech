import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {Core} from './lib/core.mjs';
import {walletTransportStatus} from './lib/wallet.mjs';
import {startOffsiteBackup} from './lib/offsite-backup.mjs';
import {backupReadiness} from './lib/backup-readiness.mjs';
import {Fault,fail,random,sha,equal,json} from './lib/security.mjs';
import {spec,developerHTML,signingExample} from './lib/docs.mjs';
import {StaffAuth} from './lib/staff-auth.mjs';
import {requireStaff} from './lib/staff-policy.mjs';
import {bootstrapQualification} from './lib/qualification-bootstrap.mjs';
const env=process.env,port=Number(env.PORT||8080),root=resolve(import.meta.dirname,'public');
if((env.PANEL_ADMIN_PASSWORD||'').length<16||(env.PANEL_AUDITOR_PASSWORD||'').length<16)throw Error('Admin and auditor passwords must be configured');
export const core=new Core({env});
const staff=new StaffAuth(core);
const processBootId=random(16);
let qualificationState={enabled:env.CORE_QUALIFICATION_ENABLED==='true',ready:false},qualificationTimer;
async function prepareQualification(){
 if(env.CORE_QUALIFICATION_ENABLED!=='true')return;
 try{const report=await bootstrapQualification(core);qualificationState={...report,ready:true};console.log('provider.qualification_ready',JSON.stringify(qualificationState));}
 catch(e){qualificationState={enabled:true,ready:false,error:'QUALIFICATION_BOOTSTRAP_PENDING'};console.error('provider.qualification_pending',e.message);qualificationTimer=setTimeout(prepareQualification,15000);qualificationTimer.unref();}
}
const rate=new Map();
let backupState={enabled:env.OFFSITE_BACKUP_ENABLED==='true',last:null};
const backupEnv={...env,CORE_DB_PATH:core.databasePath};
const backupRunner=startOffsiteBackup({env:backupEnv,onStatus:status=>{const proof={...status,source_commit:env.RAILWAY_GIT_COMMIT_SHA||'local'};backupState={enabled:true,last:proof};console.log('provider.offsite_backup',JSON.stringify(proof));}});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
function send(res,status,data,type='application/json; charset=utf-8',extra={}){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',...extra});res.end(type.startsWith('application/json')?JSON.stringify(data):data);}
async function readBody(req){if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'JSON_REQUIRED');let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>65536)fail(413,'BODY_TOO_LARGE');chunks.push(c);}return Buffer.concat(chunks).toString('utf8');}
function panelSession(req){const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('stp_session='))?.slice(12);if(!raw||raw.length>100)return null;const named=staff.session(raw);if(named)return named;if(core.deploymentIdentity.environment!=='sandbox'&&!staff.readiness().bootstrap_available)return null;return core.get('SELECT * FROM panel_sessions WHERE id_hash=? AND expires_at>?',sha(raw),Date.now());}
function cookie(value,maxAge){const secure=env.NODE_ENV==='production';return `stp_session=${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;}
function originGuard(req){if(req.headers['sec-fetch-site']==='cross-site')fail(403,'INVALID_ORIGIN');if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{fail(403,'INVALID_ORIGIN');}if(origin.host!==req.headers.host)fail(403,'INVALID_ORIGIN');}}
const admin=session=>{if(session?.kind==='staff'){requireStaff(core,session,'operations:write',{fresh:false});return;}if(!session||session.role!=='admin')fail(403,'READ_ONLY_ROLE');if(core.deploymentIdentity.environment!=='sandbox')fail(403,'NAMED_STAFF_REQUIRED');};
const actor=session=>session.kind==='staff'?'staff:'+session.staff_id:'panel:'+session.role;
// Account limits are durable; the peer limit cannot be bypassed with a forged forwarding header.
const authIp=req=>String(req.socket.remoteAddress||'unknown').slice(0,100);
function sendStaffSession(res,result){const {token,max_age,...body}=result;send(res,200,body,undefined,{'Set-Cookie':cookie(token,max_age)});}
const server=createServer({maxHeaderSize:16384},async(req,res)=>{
 try{
  const u=new URL(req.url||'/','http://localhost'),path=u.pathname,method=req.method||'GET';
  if(path==='/health/backup'&&method==='GET'){const report=backupReadiness(backupState,{env});send(res,report.ok?200:503,report);return;}
  if(path==='/health'&&method==='GET'){core.get('SELECT 1');const last=core.get('SELECT id,status,updated_at FROM selftests ORDER BY created_at DESC LIMIT 1');send(res,200,{ok:true,status:'ok',app:'soft-tech-provider-core',version:'1.1.0',environment:core.deploymentIdentity.environment,deployment_identity:core.deploymentIdentity,isolation_readiness:core.isolation,production_enabled:false,qualification:qualificationState,process_boot_id:processBootId,uptime_seconds:Math.floor(process.uptime()),memory_rss_bytes:process.memoryUsage().rss,cpu_usage_microseconds:process.cpuUsage(),durable_journal:core.journal.status(),sqlite_writes:core.writeMetrics,wallet_transport:walletTransportStatus(),persistent:true,replicas_supported:1,acceptance:last||null,source_commit:env.RAILWAY_GIT_COMMIT_SHA||'local'});return;}
  if(path.startsWith('/api/v4/agency-game/')){
   if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED');const raw=await readBody(req);const key=await core.authenticateDurable({method,path:u.pathname+u.search,body:raw,headers:req.headers},true);
   const result=await core.engineAction(key,path.slice('/api/v4/agency-game/'.length),json(raw));send(res,200,result);return;
  }
  if(path.startsWith('/v1/')){
   const raw=method==='POST'?await readBody(req):'';const p=await core.authenticateDurable({method,path:u.pathname+u.search,body:raw,headers:req.headers});const op=p.operator;
   const data=raw?json(raw):{};
   if(path==='/v1/games'&&method==='GET'){core.requireScope(p,'games:read');core.ensureOperatorEnabled(op);send(res,200,{games:core.games(op)});return;}
   if(path==='/v1/game-launches'&&method==='POST'){core.requireScope(p,'sessions:write');if(Object.keys(data).some(k=>!['game_id','player_ref','currency','return_url'].includes(k)))fail(422,'UNKNOWN_FIELD');send(res,200,core.createLaunch(op,data,req.headers['idempotency-key'],'operator:'+op.id));return;}
   let m=path.match(/^\/v1\/sessions\/(ss_[\w-]+)(\/revoke)?$/);
   if(m){core.requireScope(p,m[2]?'sessions:write':'reports:read');if(m[2]&&method==='POST'){send(res,200,core.revoke(op.id,m[1],'operator:'+op.id));return;}if(!m[2]&&method==='GET'){send(res,200,core.sessionView(core.session(m[1],op.id)));return;}}
   m=path.match(/^\/v1\/rounds\/(rd_[\w-]+)$/);if(m&&method==='GET'){core.requireScope(p,'reports:read');send(res,200,core.round(m[1],op.id));return;}
   if(method==='GET'&&['/v1/sessions','/v1/transactions'].includes(path)){core.requireScope(p,'reports:read');const result=core.reports(op.id,{limit:u.searchParams.get('limit'),offset:u.searchParams.get('offset')});send(res,200,{data:path.endsWith('sessions')?result.sessions:result.transactions,pagination:result.pagination});return;}
   if(path==='/v1/reconciliation'&&method==='GET'){core.requireScope(p,'reports:read');send(res,200,core.reconciliation(op.id,'operator:'+op.id,false));return;}
   if(path==='/v1/openapi.json'&&method==='GET'){core.requireScope(p,'reports:read');send(res,200,spec());return;}
   fail(404,'NOT_FOUND');
  }
  if(path.startsWith('/api/')){
   if(method==='POST')originGuard(req);
   const session=panelSession(req);
   if(path==='/api/session'&&method==='GET'){send(res,200,{authenticated:!!session,role:session?.role||null,csrf:session?.csrf||null,identity:session?staff.identity(session):null,staff_bootstrap_available:staff.readiness().bootstrap_available,version:'1.0.0',environment:core.deploymentIdentity.environment,deployment_identity:core.deploymentIdentity});return;}
   if(path==='/api/staff/login'&&method==='POST'){send(res,200,await staff.login(json(await readBody(req)),authIp(req)));return;}
   if(path==='/api/staff/mfa'&&method==='POST'){sendStaffSession(res,staff.verifyMfa(json(await readBody(req)),authIp(req)));return;}
   if(path==='/api/staff/activate'&&method==='POST'){send(res,200,await staff.activate(json(await readBody(req)),authIp(req)));return;}
   if(path==='/api/staff/enroll/confirm'&&method==='POST'){sendStaffSession(res,staff.confirmEnrollment(json(await readBody(req)),authIp(req)));return;}
   if(path==='/api/login'&&method==='POST'){
    if(core.deploymentIdentity.environment!=='sandbox'&&!staff.readiness().bootstrap_available)fail(403,'NAMED_STAFF_REQUIRED');
    const ip=authIp(req),now=Date.now();
    staff.consumeLimit('shared-login',ip,30);
    const attempts=(rate.get(ip)||[]).filter(t=>t>now-600000);if(attempts.length>=10)fail(429,'RATE_LIMITED');
    const p=json(await readBody(req));const valid=p.role==='admin'&&equal(p.password,env.PANEL_ADMIN_PASSWORD)||p.role==='auditor'&&equal(p.password,env.PANEL_AUDITOR_PASSWORD);
    if(!valid){attempts.push(now);if(rate.size>10000)rate.clear();rate.set(ip,attempts);fail(401,'INVALID_CREDENTIALS');}
    const token=random(36),csrf=random(24);core.run('INSERT INTO panel_sessions VALUES(?,?,?,?,?)',sha(token),p.role,csrf,now+8*3600000,now);rate.delete(ip);send(res,200,{role:p.role,csrf},undefined,{'Set-Cookie':cookie(token,8*3600)});return;
   }
   if(!session)fail(401,'UNAUTHENTICATED');
   if(method==='POST'&&!equal(req.headers['x-csrf-token']||'',session.csrf))fail(403,'CSRF_REQUIRED');
   if(path==='/api/logout'&&method==='POST'){if(session.kind==='staff')staff.logout(session);else core.run('DELETE FROM panel_sessions WHERE id_hash=?',session.id_hash);send(res,200,{success:true},undefined,{'Set-Cookie':cookie('',0)});return;}
   if(path==='/api/staff'&&method==='GET'){send(res,200,staff.list(session));return;}
   if(path==='/api/staff/bootstrap'&&method==='POST'){send(res,201,await staff.bootstrap(session,json(await readBody(req))));return;}
   if(path==='/api/staff'&&method==='POST'){send(res,201,staff.invite(session,json(await readBody(req))));return;}
   if(path==='/api/staff/step-up'&&method==='POST'){send(res,200,staff.stepUp(session,json(await readBody(req))));return;}
   if(path==='/api/staff/recovery-codes'&&method==='POST'){send(res,200,staff.regenerateRecovery(session,json(await readBody(req))));return;}
   if(path==='/api/staff/password'&&method==='POST'){sendStaffSession(res,await staff.changePassword(session,json(await readBody(req))));return;}
   if(path==='/api/staff/mfa/reset'&&method==='POST'){send(res,200,await staff.resetMfa(session,json(await readBody(req))),undefined,{'Set-Cookie':cookie('',0)});return;}
   const staffMatch=path.match(/^\/api\/staff\/(staff_[\w-]+)(?:\/(revoke|invite))?$/);
   if(staffMatch&&method==='POST'){send(res,200,staffMatch[2]==='revoke'?staff.revoke(session,staffMatch[1]):staffMatch[2]==='invite'?staff.reissueInvitation(session,staffMatch[1]):staff.update(session,staffMatch[1],json(await readBody(req))));return;}
   if(path==='/api/backup-status'&&method==='GET'){admin(session);send(res,200,backupState);return;}
   if(path==='/api/release-control'&&method==='GET'){
    const mode=core.releaseMode();
    send(res,200,{mode,production_enabled:false,deployment_identity:core.deploymentIdentity,isolation_readiness:core.isolation,qualification:qualificationState,credits:'virtual_nonredeemable',backup:backupState,backup_readiness:backupReadiness(backupState,{env}),staff_readiness:staff.readiness(),checks:{backup_verified:backupReadiness(backupState,{env}).ok,environment_isolation:core.isolation.ok,external_wallet_certified:false,engine_volume_recovery:false,mfa_enabled:staff.readiness().distinct_approvers_available,legal_approval:false},message:'Production activation is locked until all independent release gates pass.'});return;
   }
   if(path==='/api/release-control'&&method==='POST'){
    admin(session);const data=json(await readBody(req));
    if(!['sandbox','preproduction'].includes(data.mode))fail(409,'PRODUCTION_LOCKED');
    if(data.confirmation!=='CONFIRM '+data.mode.toUpperCase())fail(422,'CONFIRMATION_REQUIRED');
    const old=core.get('SELECT value FROM meta WHERE key=?','release_mode')?.value||'sandbox';
    if(data.mode==='preproduction'&&!backupReadiness(backupState,{env}).ok)fail(409,'BACKUP_NOT_VERIFIED');
    if(data.mode==='preproduction')requireStaff(core,session,'release:activate');
    core.transaction(()=>{core.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','release_mode',data.mode);core.audit(actor(session),'release.mode_changed','provider',{from:old,to:data.mode,credits:'virtual_nonredeemable'});});
    send(res,200,{mode:data.mode,production_enabled:false});return;
   }
   if(path==='/api/release-requests'&&method==='GET'){send(res,200,{requests:core.releaseRequests()});return;}
   if(path==='/api/release-requests'&&method==='POST'){const p=json(await readBody(req));send(res,201,core.requestRelease(p.operator_id,p.game_id,p.mode,session));return;}
   let releaseMatch=path.match(/^\/api\/release-requests\/(rel_[\w-]+)\/(validate|approve|activate|reject|cancel)$/);
   if(releaseMatch&&method==='POST'){send(res,200,core.advanceRelease(releaseMatch[1],releaseMatch[2],session));return;}
   if(path==='/api/bootstrap'&&method==='GET'){send(res,200,{...core.bootstrap(session.role),identity:staff.identity(session)});return;}
   if(path==='/api/download/openapi.json'&&method==='GET'){send(res,200,spec(),undefined,{'Content-Disposition':'attachment; filename="soft-tech-provider-openapi-v1.json"'});return;}
   if(path==='/api/download/developer.html'&&method==='GET'){send(res,200,developerHTML(),'text/html; charset=utf-8',{'Content-Disposition':'attachment; filename="soft-tech-provider-api-v1.html"'});return;}
   if(path==='/api/download/client.mjs'&&method==='GET'){send(res,200,signingExample,'text/javascript; charset=utf-8',{'Content-Disposition':'attachment; filename="soft-tech-client-example.mjs"'});return;}
   if(path==='/api/operators'&&method==='POST'){admin(session);send(res,201,core.createOperator(json(await readBody(req)),actor(session)));return;}
   let policyMatch=path.match(/^\/api\/operators\/([\w-]+)\/games\/([\w-]+)\/mode$/);
   if(policyMatch&&method==='POST'){admin(session);const p=json(await readBody(req));if(Object.keys(p).some(k=>k!=='mode'))fail(422,'UNKNOWN_FIELD');send(res,200,core.setOperatorGameMode(policyMatch[1],policyMatch[2],p.mode,actor(session)));return;}
   let m=path.match(/^\/api\/operators\/([\w-]+)(\/keys)?$/);
   if(m&&method==='POST'){admin(session);send(res,200,m[2]?core.rotateKey(m[1],actor(session)):core.updateOperator(m[1],json(await readBody(req)),actor(session)));return;}
   if(path==='/api/game-launches'&&method==='POST'){admin(session);const p=json(await readBody(req));send(res,200,core.createLaunch(core.internalOperator(),{game_id:p.game_id,player_ref:p.player_ref||'owner-qa',return_url:env.CORE_PUBLIC_ORIGIN||'https://soft-tech-provider-panel.up.railway.app'},p.idempotency_key||random(24),actor(session)));return;}
   m=path.match(/^\/api\/games\/([\w-]+)$/);if(m&&method==='POST'){admin(session);send(res,200,core.setGame(m[1],json(await readBody(req)),actor(session)));return;}
   if(path==='/api/healthcheck'&&method==='POST'){admin(session);send(res,200,{games:await core.refreshHealth()});return;}
   if(path==='/api/reconcile'&&method==='POST'){admin(session);const p=json(await readBody(req));send(res,200,core.reconciliation(p.operator_id||null,actor(session)));return;}
   if(path==='/api/reports'&&method==='GET'){send(res,200,core.reports(u.searchParams.get('operator_id'),{game:u.searchParams.get('game_id'),limit:u.searchParams.get('limit'),offset:u.searchParams.get('offset')}));return;}
   if(path==='/api/acceptance'&&method==='GET'){send(res,200,core.all('SELECT * FROM selftests ORDER BY created_at DESC LIMIT 10').map(x=>({...x,result:JSON.parse(x.result_json),result_json:undefined})));return;}
   fail(404,'NOT_FOUND');
  }
  if(method!=='GET'&&method!=='HEAD')fail(405,'METHOD_NOT_ALLOWED');
  const file=path==='/'?'/index.html':path;
  if(!['/index.html','/app.js','/staff.js','/style.css','/core.css','/Minecraft.woff2','/logo.png'].includes(file))fail(404,'NOT_FOUND');
  const bytes=await readFile(resolve(root,'.'+file)),type=types[extname(file)]||'application/octet-stream';
  send(res,200,method==='HEAD'?'':bytes,type,{'Cache-Control':file.endsWith('.html')?'no-store':'public, max-age=60','Content-Security-Policy':"default-src 'self'; img-src 'self' data: https://soft-tech-web-production.up.railway.app; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"});
 }catch(e){if(!res.headersSent)send(res,e.status||500,{error:e.code||'INTERNAL_ERROR',message:e instanceof Fault?e.message:'Request failed safely; use original request ID to retry'});else res.destroy();if(!(e instanceof Fault))console.error('provider.error',e?.message);}
});
server.requestTimeout=20000;server.headersTimeout=10000;
server.listen(port,'0.0.0.0',()=>{
 console.log('Soft Tech Provider Core v1 listening on '+port);
 void core.refreshHealth().catch(()=>{});
 void prepareQualification();
 if(env.CORE_ACCEPTANCE_RUN){import('./test/acceptance.mjs').then(m=>m.runAcceptance(core,env.CORE_ACCEPTANCE_RUN)).catch(e=>console.error('acceptance.failed',e.message));}
});
const healthTimer=setInterval(()=>void core.refreshHealth().catch(()=>{}),60000);healthTimer.unref();
const recoveryTimer=setInterval(()=>void core.recover().catch(()=>{}),30000);recoveryTimer.unref();
function shutdown(){backupRunner.stop();clearTimeout(qualificationTimer);clearInterval(healthTimer);clearInterval(recoveryTimer);server.close(()=>{core.close();process.exit(0);});setTimeout(()=>process.exit(1),15000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
