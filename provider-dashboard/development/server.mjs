import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {DevelopmentSessionStore} from './session-store.mjs';
import {ensureFinance,validateProfile,previewInvoice,financeSummary} from './finance.mjs';

// This entry point deliberately has no imports from the provider Core, staff
// authentication, wallets, game adapters, databases or release-control modules.
// Every record below belongs to one short-lived, server-side demonstration.
const SESSION_MS = 2 * 60 * 60 * 1000;
const LOGIN_MS = 5 * 60 * 1000;
const MAX_SESSIONS = 128;
const root = fileURLToPath(new URL('./public/', import.meta.url));
const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => {
  if(typeof a!=='string'||typeof b!=='string'||!a.length||a.length>256||b.length>256)return false;
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length&&timingSafeEqual(left,right);
};
const id = prefix => prefix + randomBytes(8).toString('hex');
const roles = Object.freeze([
  {id:'owner',label:'Owner',description:'Explore every view and manage this development workspace.',permissions:['operators:write','games:write','release:request','release:validate','release:approve','release:reject','release:cancel','workspace:reset','finance:manage','finance:record']},
  {id:'operator',label:'Operator',description:'Practice operator setup and prepare sample release requests.',permissions:['operators:write','games:write','release:request','release:validate','release:cancel']},
  {id:'approver',label:'Approver',description:'Review and approve or reject simulated release requests.',permissions:['release:approve','release:reject','finance:issue']},
  {id:'auditor',label:'Auditor',description:'Inspect sample activity, transactions and audit records.',permissions:[]}
].map(role => Object.freeze({...role,permissions:Object.freeze(role.permissions)})));

export function validateDevelopmentEnvironment(env) {
  if (env.XDPLAY_DEVELOPMENT_ONLY !== 'true' || env.CORE_ENVIRONMENT !== 'development') {
    throw Error('Development server requires XDPLAY_DEVELOPMENT_ONLY=true and CORE_ENVIRONMENT=development.');
  }
  const platformKeys = ['RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID','RAILWAY_ENVIRONMENT_NAME'];
  if (platformKeys.some(key => env[key])) {
    if (env.RAILWAY_ENVIRONMENT_NAME !== 'development') throw Error('Railway environment must be development.');
    for (const part of ['PROJECT','ENVIRONMENT','SERVICE']) {
      if (!env['RAILWAY_'+part+'_ID'] || env['RAILWAY_'+part+'_ID'] !== env['XDPLAY_DEVELOPMENT_'+part+'_ID']) {
        throw Error('Development deployment identity mismatch: '+part.toLowerCase());
      }
    }
  } else if (!['development','test'].includes(env.NODE_ENV)) {
    throw Error('Local development requires NODE_ENV=development or test.');
  }
  if (env.XDPLAY_DEVELOPMENT_DB_PATH && !/^\/data\/xdplay-development\/[^/]+\.sqlite$/.test(env.XDPLAY_DEVELOPMENT_DB_PATH) && env.NODE_ENV === 'production') throw Error('Development DB path must be on its isolated volume.');
  const prohibited = /^(?:PANEL_|BACKUP_|OFFSITE_|WALLET_|DATABASE_URL$|CORE_DB_PATH$|CORE_ENGINE_|CORE_ALLOWED_WALLET_|CORE_PUBLIC_ORIGIN$|CORE_QUALIFICATION_|CORE_ACCEPTANCE_|CORE_ISOLATION_)|_PROVIDER_ORIGIN$/;
  for (const [key,value] of Object.entries(env)) {
    if (value && prohibited.test(key)) throw Error('Live provider configuration is forbidden in development: '+key);
  }
  if (env.XDPLAY_DEVELOPMENT_ORIGIN) {
    const origin = new URL(env.XDPLAY_DEVELOPMENT_ORIGIN);
    if (origin.origin !== env.XDPLAY_DEVELOPMENT_ORIGIN || origin.username || origin.password ||
        (env.NODE_ENV === 'production' && origin.protocol !== 'https:')) throw Error('Invalid development origin.');
  }
  return Object.freeze({environment:'development',secureCookies:env.NODE_ENV === 'production'});
}

function fixture(now) {
  const games = [
    {id:'uno-luck',name:'UNO LUCK',status:'sample',maintenance:false,version:'Development preview'},
    {id:'mahjong-wild',name:'Mahjong Wild',status:'sample',maintenance:false,version:'Development preview'},
    {id:'skygate',name:'Skygate',status:'sample',maintenance:false,version:'Development preview'}
  ];
  return {
    games,
    operators:[
      {id:'op_dev_alpha',name:'Demo Operator Alpha',status:'enabled',environment:'development',currency:'VCOIN',games:games.map(game=>game.id)},
      {id:'op_dev_beta',name:'Demo Operator Beta',status:'enabled',environment:'development',currency:'VCOIN',games:['uno-luck','skygate']}
    ],
    sessions:[
      {id:'ss_dev_1001',operator_id:'op_dev_alpha',game_id:'uno-luck',status:'completed',created_at:now-25*60000},
      {id:'ss_dev_1002',operator_id:'op_dev_beta',game_id:'skygate',status:'completed',created_at:now-12*60000}
    ],
    transactions:[
      {id:'tx_dev_1001',operator_id:'op_dev_alpha',game_id:'uno-luck',kind:'sample debit',amount_minor:'400',currency:'VCOIN',reference:'sample_round_1001',created_at:now-24*60000},
      {id:'tx_dev_1002',operator_id:'op_dev_alpha',game_id:'uno-luck',kind:'sample credit',amount_minor:'800',currency:'VCOIN',reference:'sample_round_1001',created_at:now-24*60000},
      {id:'tx_dev_1003',operator_id:'op_dev_beta',game_id:'skygate',kind:'sample debit',amount_minor:'500',currency:'VCOIN',reference:'sample_round_1002',created_at:now-11*60000},
      {id:'tx_dev_1004',operator_id:'op_dev_beta',game_id:'skygate',kind:'sample credit',amount_minor:'0',currency:'VCOIN',reference:'sample_round_1002',created_at:now-11*60000}
    ],
    releases:[{id:'rel_dev_example',operator_id:'op_dev_alpha',game_id:'uno-luck',status:'validated',requested_by:'operator',validated_by:'operator',approved_by:null,created_at:now-8*60000,updated_at:now-6*60000,simulation:true}],
    game_settings: [
      {operator_id:'op_dev_alpha',game_id:'uno-luck',enabled:true,maintenance:false,min_bet:400,max_bet:10000,currency:'VCOIN',revision:1,updated_at:now,updated_by:'system'},
      {operator_id:'op_dev_alpha',game_id:'mahjong-wild',enabled:true,maintenance:false,min_bet:400,max_bet:10000,currency:'VCOIN',revision:1,updated_at:now,updated_by:'system'},
      {operator_id:'op_dev_alpha',game_id:'skygate',enabled:true,maintenance:false,min_bet:400,max_bet:10000,currency:'VCOIN',revision:1,updated_at:now,updated_by:'system'},
      {operator_id:'op_dev_beta',game_id:'uno-luck',enabled:true,maintenance:false,min_bet:400,max_bet:10000,currency:'VCOIN',revision:1,updated_at:now,updated_by:'system'},
      {operator_id:'op_dev_beta',game_id:'skygate',enabled:true,maintenance:false,min_bet:400,max_bet:10000,currency:'VCOIN',revision:1,updated_at:now,updated_by:'system'}
    ],
    staff:roles.map(role=>({role:role.id,display_name:'Development '+role.label,description:role.description})),
    audit:[{id:'audit_dev_initial',event:'development.workspace_created',actor:'system',created_at:now}],
    created_at:now
  };
}

function ensureGameSettings(workspace,now) {
  if(!Array.isArray(workspace.game_settings)) workspace.game_settings=[];
  for(const operator of workspace.operators) for(const gameId of operator.games){
    if(!workspace.games.some(game=>game.id===gameId))continue;
    if(!workspace.game_settings.some(item=>item.operator_id===operator.id&&item.game_id===gameId)){
      workspace.game_settings.push({operator_id:operator.id,game_id:gameId,enabled:true,maintenance:false,min_bet:400,max_bet:10000,currency:'VCOIN',revision:1,updated_at:now,updated_by:'system'});
    }
  }
  return workspace.game_settings;
}
function assignedGameSetting(workspace,operatorId,gameId,now){
  return ensureGameSettings(workspace,now).find(item=>item.operator_id===operatorId&&item.game_id===gameId);
}
class DevelopmentError extends Error {
  constructor(status,code,message=code) { super(message);this.status=status;this.code=code; }
}
const fail = (status,code,message) => { throw new DevelopmentError(status,code,message); };
function roleById(role) { return typeof role === 'string' ? roles.find(item=>item.id === role) : null; }
function permission(session, name) {
  if (!roleById(session.role)?.permissions.includes(name)) fail(403,'DEVELOPMENT_PERMISSION_DENIED','This development role cannot perform that action.');
}
function identity(session) {
  const role=roleById(session.role);
  return {kind:'development',role:role.id,display_name:'Development '+role.label,permissions:role.permissions,mfa_verified:false,mfa_fresh:false};
}
function audit(workspace,event,actor,now) {
  workspace.audit.unshift({id:id('audit_dev_'),event,actor,created_at:now});
  workspace.audit.length=Math.min(workspace.audit.length,200);
}
function payloadFields(data,allowed) {
  if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).some(key=>!allowed.includes(key))) fail(422,'INVALID_INPUT','Check the submitted fields.');
}
function parseCookies(header) {
  const cookies=new Map();
  for (const item of String(header||'').split(';')) {
    const at=item.indexOf('=');if(at>0) cookies.set(item.slice(0,at).trim(),item.slice(at+1).trim());
  }
  return cookies;
}
async function body(req) {
  if (!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')) fail(415,'JSON_REQUIRED');
  const chunks=[];let bytes=0;
  for await (const chunk of req) {
    bytes+=chunk.length;if(bytes>16384) fail(413,'BODY_TOO_LARGE');chunks.push(chunk);
  }
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON');}
  if (!data || Array.isArray(data) || typeof data!=='object') fail(422,'INVALID_INPUT');
  return data;
}

export function createDevelopmentServer({env=process.env,clock=Date.now}={}) {
  const config=validateDevelopmentEnvironment(env);
  const store=env.XDPLAY_DEVELOPMENT_DB_PATH?new DevelopmentSessionStore(env.XDPLAY_DEVELOPMENT_DB_PATH):null;
  const sessions=new Map(store?store.load(clock()):[]),logins=new Map(),limits=new Map();
  const saveSession=key=>{if(store&&sessions.has(key))store.save(key,sessions.get(key));};
  const removeSession=key=>{sessions.delete(key);store?.remove(key);};
  const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.secureCookies?'; Secure':''}`;
  function cleanup() {
    const now=clock();
    for(const map of [sessions,logins]) for(const [key,item] of map) if(item.expires_at<=now)(map===sessions?removeSession(key):map.delete(key));
    store?.prune(now);
    for(const [key,item] of limits)if(item.until<=now)limits.delete(key);
  }
  function throttle(req,bucket,max) {
    const key=bucket+':'+String(req.socket.remoteAddress||'unknown');
    let item=limits.get(key);
    if(!item||item.until<=clock()) {if(limits.size>=2048)fail(503,'DEVELOPMENT_BUSY');item={count:0,until:clock()+60000};limits.set(key,item);}
    if(++item.count>max)fail(429,'RATE_LIMITED','Please wait a minute before trying again.');
  }
  function originGuard(req) {
    if(req.headers['sec-fetch-site']==='cross-site'||!req.headers.origin)fail(403,'INVALID_ORIGIN');
    const expected=env.XDPLAY_DEVELOPMENT_ORIGIN||`${config.secureCookies?'https':'http'}://${req.headers.host}`;
    if(req.headers.origin!==expected)fail(403,'INVALID_ORIGIN');
  }
  function reply(res,status,data,headers={}) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','X-Robots-Tag':'noindex, nofollow',...headers});
    res.end(typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data));
  }
  function view(session) {
    return {authenticated:true,development:true,production_enabled:false,csrf:session.csrf,identity:identity(session),roles,expires_at:session.expires_at};
  }
  function newSession(role,workspace,expires_at=clock()+SESSION_MS) {
    if(sessions.size>=MAX_SESSIONS)fail(503,'DEVELOPMENT_BUSY','Development preview is busy. Try again later.');
    const token=random(),session={role,csrf:random(),workspace,expires_at};sessions.set(hash(token),session);saveSession(hash(token));
    return {token,session};
  }
  const server=createServer({maxHeaderSize:16384},async(req,res)=>{
    try {
      cleanup();
      const url=new URL(req.url||'/','http://development.local'),path=url.pathname,method=req.method||'GET';
      if(path==='/health'&&method==='GET')return reply(res,200,{ok:true,app:'xdplay-dashboard-development',environment:'development',data_mode:'sample',production_enabled:false,source_commit:env.RAILWAY_GIT_COMMIT_SHA||'local'});
      if(path==='/robots.txt'&&method==='GET')return reply(res,200,'User-agent: *\nDisallow: /\n',{'Content-Type':'text/plain; charset=utf-8'});
      if(path.startsWith('/v1/')||path.startsWith('/api/v4/')||path.startsWith('/api/staff')||['/api/login','/api/game-launches','/api/release-control'].includes(path)||/\/keys$|\/activate$/.test(path)) {
        fail(403,'DEVELOPMENT_ONLY','This preview has no live accounts, API credentials, game launches or release activation.');
      }
      if(path.startsWith('/api/')) {
        const cookies=parseCookies(req.headers.cookie);
        const raw=cookies.get('xdplay_dev_session');
        const session=raw&&raw.length<=100?sessions.get(hash(raw)):null;
        if(path==='/api/session'&&method==='GET') {
          if(session)return reply(res,200,view(session));
          throttle(req,'login-form',120);
          const loginToken=cookies.get('xdplay_dev_login');
          let login=loginToken&&loginToken.length<=100?logins.get(hash(loginToken)):null;
          let token=loginToken;
          if(!login) {
            if(logins.size>=512)fail(503,'DEVELOPMENT_BUSY');
            token=random();login={csrf:random(),expires_at:clock()+LOGIN_MS};logins.set(hash(token),login);
          }
          return reply(res,200,{authenticated:false,development:true,production_enabled:false,csrf:login.csrf,roles},{'Set-Cookie':cookie('xdplay_dev_login',token,300)});
        }
        if(path==='/api/development/login'&&method==='POST') {
          originGuard(req);throttle(req,'sign-in',40);
          const token=cookies.get('xdplay_dev_login');
          const login=token&&token.length<=100?logins.get(hash(token)):null;
          const data=await body(req);payloadFields(data,['role','csrf']);
          if(!login||!same(req.headers['x-csrf-token'],login.csrf)||!same(data.csrf,login.csrf))fail(403,'CSRF_REQUIRED','Reload the sign-in page and try again.');
          if(!roleById(data.role))fail(422,'INVALID_ROLE','Choose one of the four development roles.');
          if(session)removeSession(hash(raw));
          const result=newSession(data.role,fixture(clock()));logins.delete(hash(token));
          audit(result.session.workspace,'development.signed_in',data.role,clock());
          return reply(res,200,view(result.session),{'Set-Cookie':[cookie('xdplay_dev_session',result.token,SESSION_MS/1000),cookie('xdplay_dev_login','',0)]});
        }
        if(!session)fail(401,'UNAUTHENTICATED','Your development session ended. Choose a role to sign in again.');
        if(!['GET','HEAD'].includes(method)) {
          originGuard(req);throttle(req,'development-write',120);
          if(!same(req.headers['x-csrf-token'],session.csrf))fail(403,'CSRF_REQUIRED','Refresh the page and try again.');
        }
        const workspace=session.workspace;
        ensureGameSettings(workspace,clock());
        const finance=ensureFinance(workspace,clock());
        if(path==='/api/bootstrap'&&method==='GET')return reply(res,200,{
          development:true,environment:'development',production_enabled:false,identity:identity(session),
          summary:{operators:workspace.operators.length,games:workspace.games.length,sessions:workspace.sessions.length,rounds:2,pending_releases:workspace.releases.filter(item=>['requested','validated'].includes(item.status)).length},
          ...workspace,finance_summary:financeSummary(finance,clock()),updated_at:clock()
        });
        if(path==='/api/logout'&&method==='POST') {
          removeSession(hash(raw));return reply(res,200,{success:true,development:true},{'Set-Cookie':cookie('xdplay_dev_session','',0)});
        }
        if(path==='/api/development/switch-role'&&method==='POST') {
          const data=await body(req);payloadFields(data,['role']);if(!roleById(data.role))fail(422,'INVALID_ROLE');
          removeSession(hash(raw));const result=newSession(data.role,workspace,session.expires_at);
          audit(workspace,'development.role_switched',data.role,clock());
          return reply(res,200,view(result.session),{'Set-Cookie':cookie('xdplay_dev_session',result.token,Math.max(1,Math.floor((session.expires_at-clock())/1000)))});
        }
        if(path==='/api/development/reset'&&method==='POST') {
          permission(session,'workspace:reset');const data=await body(req);payloadFields(data,['confirmation']);
          if(data.confirmation!=='RESET DEVELOPMENT')fail(422,'CONFIRMATION_REQUIRED');
          session.workspace=fixture(clock());audit(session.workspace,'development.workspace_reset',session.role,clock());saveSession(hash(raw));
          return reply(res,200,{success:true,development:true});
        }
        if(path==='/api/operators'&&method==='POST') {
          permission(session,'operators:write');const data=await body(req);payloadFields(data,['name','games','currency']);
          const name=typeof data.name==='string'?data.name.trim():'';
          if(name.length<2||name.length>80||/[\u0000-\u001f\u007f]/.test(name)||data.currency!=='VCOIN'||!Array.isArray(data.games)||!data.games.length||data.games.length>3||data.games.some(game=>!workspace.games.some(item=>item.id===game)))fail(422,'INVALID_OPERATOR','Enter a name, VCOIN currency and at least one sample game.');
          if(workspace.operators.length>=100)fail(409,'DEVELOPMENT_LIMIT','Reset this workspace to create more sample operators.');
          const operator={id:id('op_dev_'),name,status:'enabled',environment:'development',currency:'VCOIN',games:[...new Set(data.games)]};
          workspace.operators.push(operator);ensureGameSettings(workspace,clock());audit(workspace,'development.operator_created',session.role,clock());saveSession(hash(raw));return reply(res,201,{operator,development:true});
        }
        if(path==='/api/operator-game-settings'&&method==='PATCH') {
          permission(session,'games:write');
          const data=await body(req);
          payloadFields(data,['operator_id','game_id','enabled','maintenance','min_bet','max_bet','currency','revision']);
          const operator=workspace.operators.find(item=>item.id===data.operator_id);
          const game=workspace.games.find(item=>item.id===data.game_id);
          if(!operator||!game||!operator.games.includes(data.game_id))fail(422,'OPERATOR_GAME_NOT_ASSIGNED');
          const existing=assignedGameSetting(workspace,operator.id,game.id,clock());
          if(!existing)fail(404,'GAME_SETTING_NOT_FOUND');
          if(!Number.isSafeInteger(data.revision)||data.revision!==existing.revision)fail(409,'STALE_GAME_SETTINGS','Settings changed. Refresh before editing.');
          if(typeof data.enabled!=='boolean'||typeof data.maintenance!=='boolean'||data.currency!=='VCOIN'||
             !Number.isSafeInteger(data.min_bet)||!Number.isSafeInteger(data.max_bet)||
             data.min_bet<1||data.max_bet>100000000||data.min_bet>data.max_bet) {
            fail(422,'INVALID_GAME_SETTINGS','Use VCOIN and valid sample limits (1 to 100,000,000), with minimum no greater than maximum.');
          }
          Object.assign(existing,{enabled:data.enabled,maintenance:data.maintenance,min_bet:data.min_bet,max_bet:data.max_bet,revision:existing.revision+1,updated_at:clock(),updated_by:session.role});
          audit(workspace,'development.operator_game_settings_updated.'+operator.id+'.'+game.id,session.role,clock());
          saveSession(hash(raw));
          return reply(res,200,{setting:existing,development:true,production_enabled:false});
        }

        // Finance is sample-only and scoped to this browser workspace.
        // Never touch the provider ledger, commercial accounts or payment gateways.
        if(path==='/api/finance/profile'&&method==='PATCH') {
          permission(session,'finance:manage');
          const data=await body(req);
          if(!workspace.operators.some(op=>op.id===data.operator_id))fail(404,'OPERATOR_NOT_FOUND');
          let profile;
          try{profile=validateProfile(data);}catch(e){fail(422,e.message,'Check the billing contact, currency and integer IDR sample fees.');}
          const existing=finance.profiles.find(p=>p.operator_id===data.operator_id);
          if(!existing)fail(404,'BILLING_PROFILE_NOT_FOUND');
          if(data.revision!==existing.revision)fail(409,'STALE_BILLING_PROFILE','Refresh and retry the newer profile.');
          Object.assign(existing,profile,{revision:existing.revision+1,updated_at:clock(),updated_by:session.role});
          audit(workspace,'development.finance.profile_updated.'+existing.operator_id,session.role,clock());
          saveSession(hash(raw));
          return reply(res,200,{profile:existing,development:true,simulation:true});
        }
        if(path==='/api/finance/invoices'&&method==='POST'){
          permission(session,'finance:manage');
          const data=await body(req);payloadFields(data,['operator_id','billing_month']);
          if(!workspace.operators.some(op=>op.id===data.operator_id))fail(404,'OPERATOR_NOT_FOUND');
          if(finance.invoices.some(i=>i.operator_id===data.operator_id&&i.billing_month===data.billing_month&&i.status!=='void'))fail(409,'INVOICE_PERIOD_EXISTS');
          if(finance.invoices.length>=200)fail(409,'DEVELOPMENT_LIMIT');
          let preview;
          try{preview=previewInvoice(workspace,data.operator_id,data.billing_month,clock());}
          catch(e){fail(422,e.message,'Check the complete billing profile and month.');}
          if(finance.sequence>=999999)fail(409,'DEVELOPMENT_LIMIT');
          finance.sequence++;
          const invoice={...preview,id:id('inv_dev_'),number:'DEMO-'+String(data.billing_month).replace('-','')+'-'+String(finance.sequence).padStart(5,'0'),
            status:'draft',issued_at:null,due_at:null,paid_at:null,voided_at:null,created_at:clock(),created_by:session.role,issued_by:null,paid_by:null};
          finance.invoices.unshift(invoice);
          audit(workspace,'development.finance.invoice_drafted.'+invoice.id,session.role,clock());
          saveSession(hash(raw));
          return reply(res,201,{invoice,simulation:true,production_enabled:false});
        }
        let invoiceMatch=path.match(/^\/api\/finance\/invoices\/(inv_dev_[a-f0-9]+)\/(issue|mark-paid|void)$/);
        if(invoiceMatch&&method==='POST'){
          const action=invoiceMatch[2];
          permission(session,action==='issue'?'finance:issue':action==='mark-paid'?'finance:record':'finance:issue');
          payloadFields(await body(req),[]);
          const invoice=finance.invoices.find(i=>i.id===invoiceMatch[1]);
          if(!invoice)fail(404,'INVOICE_NOT_FOUND');
          if(action==='issue'){
            if(invoice.status!=='draft')fail(409,'INVALID_INVOICE_TRANSITION');
            if(invoice.created_by===session.role)fail(403,'INDEPENDENT_APPROVAL_REQUIRED');
            invoice.status='issued';invoice.issued_by=session.role;invoice.issued_at=clock();
            invoice.due_at=clock()+invoice.due_days*86400000;
          } else if(action==='mark-paid'){
            if(invoice.status!=='issued')fail(409,'INVALID_INVOICE_TRANSITION');
            invoice.status='paid';invoice.paid_by=session.role;invoice.paid_at=clock();
            invoice.payment_note='DEMO CONFIRMATION ONLY - no funds received';
          } else {
            if(!['draft','issued'].includes(invoice.status))fail(409,'INVALID_INVOICE_TRANSITION');
            invoice.status='void';invoice.voided_at=clock();
          }
          audit(workspace,'development.finance.invoice_'+action+'.'+invoice.id,session.role,clock());
          saveSession(hash(raw));
          return reply(res,200,{invoice,simulation:true,production_enabled:false});
        }
        let match=path.match(/^\/api\/operators\/(op_dev_[\w-]+)$/);
        if(match&&method==='PATCH') {
          permission(session,'operators:write');const data=await body(req);payloadFields(data,['status']);
          if(!['enabled','disabled'].includes(data.status))fail(422,'INVALID_STATUS');
          const operator=workspace.operators.find(item=>item.id===match[1]);if(!operator)fail(404,'OPERATOR_NOT_FOUND');
          operator.status=data.status;audit(workspace,'development.operator_'+data.status,session.role,clock());saveSession(hash(raw));return reply(res,200,{operator,development:true});
        }
        match=path.match(/^\/api\/games\/([\w-]+)$/);
        if(match&&method==='PATCH') {
          permission(session,'games:write');const data=await body(req);payloadFields(data,['maintenance']);if(typeof data.maintenance!=='boolean')fail(422,'INVALID_MAINTENANCE');
          const game=workspace.games.find(item=>item.id===match[1]);if(!game)fail(404,'GAME_NOT_FOUND');
          game.maintenance=data.maintenance;audit(workspace,'development.game_maintenance_changed',session.role,clock());saveSession(hash(raw));return reply(res,200,{game,development:true});
        }
        if(path==='/api/release-requests'&&method==='POST') {
          permission(session,'release:request');const data=await body(req);payloadFields(data,['operator_id','game_id']);
          const operator=workspace.operators.find(item=>item.id===data.operator_id);
          if(!operator||operator.status!=='enabled'||!operator.games.includes(data.game_id))fail(422,'OPERATOR_GAME_NOT_READY');
          if(workspace.releases.some(item=>item.operator_id===data.operator_id&&item.game_id===data.game_id&&['requested','validated'].includes(item.status)))fail(409,'RELEASE_REQUEST_PENDING','A sample request for this operator and game is already pending.');
          if(workspace.releases.length>=100)fail(409,'DEVELOPMENT_LIMIT');
          const settings=assignedGameSetting(workspace,operator.id,data.game_id,clock());
          if(!settings?.enabled||settings.maintenance||workspace.games.find(item=>item.id===data.game_id)?.maintenance)fail(409,'OPERATOR_GAME_NOT_READY');
          const request={id:id('rel_dev_'),operator_id:operator.id,game_id:data.game_id,status:'requested',requested_by:session.role,approved_by:null,created_at:clock(),updated_at:clock(),simulation:true};
          workspace.releases.unshift(request);audit(workspace,'development.release_requested',session.role,clock());saveSession(hash(raw));return reply(res,201,{...request,development:true});
        }
        match=path.match(/^\/api\/release-requests\/(rel_dev_[\w-]+)\/(validate|approve|reject|cancel)$/);
        if(match&&method==='POST') {
          const action=match[2];permission(session,'release:'+action);payloadFields(await body(req),[]);
          const request=workspace.releases.find(item=>item.id===match[1]);if(!request)fail(404,'RELEASE_NOT_FOUND');
          const next={requested:{validate:'validated',reject:'rejected',cancel:'cancelled'},validated:{approve:'approved',reject:'rejected',cancel:'cancelled'}}[request.status]?.[action];
          if(!next)fail(409,'INVALID_RELEASE_TRANSITION');
          if(action==='approve'&&request.requested_by===session.role)fail(403,'INDEPENDENT_APPROVER_REQUIRED','Switch to another allowed development persona to simulate independent approval.');
          if(action==='validate'||action==='approve') {
            const operator=workspace.operators.find(item=>item.id===request.operator_id),game=workspace.games.find(item=>item.id===request.game_id);
            const settings=assignedGameSetting(workspace,request.operator_id,request.game_id,clock());
            if(!operator||operator.status!=='enabled'||!operator.games.includes(request.game_id)||!game||game.maintenance||!settings?.enabled||settings.maintenance)fail(409,'OPERATOR_GAME_NOT_READY');
          }
          request.status=next;request.updated_at=clock();if(action==='approve')request.approved_by=session.role;if(action==='validate')request.validated_by=session.role;
          audit(workspace,'development.release_'+next,session.role,clock());saveSession(hash(raw));return reply(res,200,{...request,development:true,production_enabled:false});
        }
        fail(404,'NOT_FOUND');
      }
      if(!['GET','HEAD'].includes(method))fail(405,'METHOD_NOT_ALLOWED');
      const assets={
        '/':['index.html','text/html; charset=utf-8'],
        '/index.html':['index.html','text/html; charset=utf-8'],
        '/app.js':['app.js','text/javascript; charset=utf-8'],
        '/style.css':['style.css','text/css; charset=utf-8'],
        '/Minecraft.woff2':[fileURLToPath(new URL('../public/Minecraft.woff2',import.meta.url)),'font/woff2']
      };
      const asset=assets[path];if(!asset)fail(404,'NOT_FOUND');
      const bytes=await readFile(resolve(root,asset[0]));
      return reply(res,200,method==='HEAD'?'':bytes,{'Content-Type':asset[1],'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
    } catch(error) {
      if(!res.headersSent)reply(res,error instanceof DevelopmentError?error.status:500,{error:error instanceof DevelopmentError?error.code:'INTERNAL_ERROR',message:error instanceof DevelopmentError?error.message:'The development preview could not complete this request.'});
      else res.destroy();
      if(!(error instanceof DevelopmentError))console.error('development.request_failed',error.message);
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  server.on('close',()=>{sessions.clear();logins.clear();limits.clear();store?.close();});
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const server=createDevelopmentServer();
  const port=Number(process.env.PORT||8080);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port.');
  server.listen(port,'0.0.0.0',()=>console.log('XDPLAY development dashboard listening on '+server.address().port));
  const stop=()=>server.close(()=>process.exit(0));process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
