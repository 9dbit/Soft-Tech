import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDevelopmentServer,validateDevelopmentEnvironment} from '../development/server.mjs';

const localEnvironment=()=>({NODE_ENV:'test',PORT:'0',XDPLAY_DEVELOPMENT_ONLY:'true',CORE_ENVIRONMENT:'development'});
const railwayEnvironment=()=>({...localEnvironment(),
 RAILWAY_ENVIRONMENT_NAME:'development',
 RAILWAY_PROJECT_ID:'11111111-1111-4111-8111-111111111111',
 RAILWAY_ENVIRONMENT_ID:'22222222-2222-4222-8222-222222222222',
 RAILWAY_SERVICE_ID:'33333333-3333-4333-8333-333333333333',
 XDPLAY_DEVELOPMENT_PROJECT_ID:'11111111-1111-4111-8111-111111111111',
 XDPLAY_DEVELOPMENT_ENVIRONMENT_ID:'22222222-2222-4222-8222-222222222222',
 XDPLAY_DEVELOPMENT_SERVICE_ID:'33333333-3333-4333-8333-333333333333'
});

async function fixture(t,env=localEnvironment()){
 let now=Date.UTC(2026,10,18,8);
 const server=createDevelopmentServer({env,clock:()=>now});
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
 const base='http://127.0.0.1:'+server.address().port;
 const browser=()=>{
  const jar=new Map();let csrf;
  return {
   jar,
   get csrf(){return csrf;},
   async call(path,{method='GET',body,raw,headers={},origin=true,withCsrf=true,withCookies=true,remember=true}={}){
    const mutation=!['GET','HEAD'].includes(method),requestHeaders={
     ...(body!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),
     ...(mutation&&origin?{Origin:env.XDPLAY_DEVELOPMENT_ORIGIN||base}:{}),
     ...(mutation&&withCsrf&&csrf?{'X-CSRF-Token':csrf}:{}),
     ...(withCookies&&jar.size?{Cookie:[...jar].map(([key,value])=>key+'='+value).join('; ')}:{}),
     ...headers
    };
    const response=await fetch(base+path,{method,headers:requestHeaders,...(body===undefined&&raw===undefined?{}:{body:raw===undefined?JSON.stringify(body):raw}),redirect:'manual'});
    const text=await response.text();let data;
    try{data=JSON.parse(text);}catch{data={text};}
    const cookies=response.headers.getSetCookie();
    if(remember){
     for(const cookie of cookies){const pair=cookie.split(';',1)[0],separator=pair.indexOf('='),key=pair.slice(0,separator),value=pair.slice(separator+1);if(/(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cookie)||!value)jar.delete(key);else jar.set(key,value);}
     if(typeof data.csrf==='string')csrf=data.csrf;
    }
    return {status:response.status,data,cookies,headers:response.headers,text};
   },
   async login(role){
    const preauth=await this.call('/api/session');expectStatus(preauth,200);
    assert.equal(preauth.data.authenticated,false);
    assert.equal(preauth.data.development,true);
    assert.ok(preauth.data.csrf);
    const signed=await this.call('/api/development/login',{method:'POST',body:{role,csrf:preauth.data.csrf}});
    expectStatus(signed,200);return signed;
   }
  };
 };
 return {base,browser,advance:milliseconds=>{now+=milliseconds;}};
}

function expectStatus(response,expected){assert.equal(response.status,expected,JSON.stringify(response.data));return response.data;}
function expectDenied(response){assert.ok(response.status>=400&&response.status<500,'Expected a client rejection, got '+response.status+': '+JSON.stringify(response.data));return response.data;}
const entity=(data,key)=>data[key]||data;
const operatorPayload=(name='Development Sample Operator')=>({name,games:['uno-luck'],currency:'VCOIN'});
async function createOperator(browser,name){const response=await browser.call('/api/operators',{method:'POST',body:operatorPayload(name)});expectStatus(response,201);const operator=entity(response.data,'operator');assert.ok(operator.id);return operator;}
async function requestRelease(browser,operator){const response=await browser.call('/api/release-requests',{method:'POST',body:{operator_id:operator.id,game_id:'uno-luck'}});expectStatus(response,201);const release=entity(response.data,'request');assert.ok(release.id);return release;}

test('development startup requires explicit opt-in and rejects sandbox, preproduction and production identities',()=>{
 assert.doesNotThrow(()=>validateDevelopmentEnvironment(localEnvironment()));
 for(const patch of [{XDPLAY_DEVELOPMENT_ONLY:undefined},{XDPLAY_DEVELOPMENT_ONLY:'false'},{XDPLAY_DEVELOPMENT_ONLY:'1'},{CORE_ENVIRONMENT:undefined},{CORE_ENVIRONMENT:'sandbox'},{CORE_ENVIRONMENT:'preproduction'},{CORE_ENVIRONMENT:'production'}]){
  assert.throws(()=>validateDevelopmentEnvironment({...localEnvironment(),...patch}),JSON.stringify(patch));
 }
});

test('Railway isolation checks project, environment and service bindings rather than the display name alone',()=>{
 assert.doesNotThrow(()=>validateDevelopmentEnvironment(railwayEnvironment()));
 for(const key of ['RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID','XDPLAY_DEVELOPMENT_PROJECT_ID','XDPLAY_DEVELOPMENT_ENVIRONMENT_ID','XDPLAY_DEVELOPMENT_SERVICE_ID']){
  assert.throws(()=>validateDevelopmentEnvironment({...railwayEnvironment(),[key]:'44444444-4444-4444-8444-444444444444'}),key+' mismatch must reject');
  const missing=railwayEnvironment();delete missing[key];assert.throws(()=>validateDevelopmentEnvironment(missing),key+' absence must reject');
 }
 assert.throws(()=>validateDevelopmentEnvironment({...railwayEnvironment(),RAILWAY_ENVIRONMENT_NAME:'production'}));
});

test('inherited production databases, authentication, engine, wallet and backup configuration prevent startup',()=>{
 const forbidden={CORE_DB_PATH:'/data/provider.sqlite',PANEL_SESSION_SECRET:'fixture-secret',PANEL_ADMIN_PASSWORD:'fixture-password',PANEL_AUDITOR_PASSWORD:'fixture-password',CORE_ENGINE_KEYS_JSON:'[]',UNO_PROVIDER_ORIGIN:'https://engine.example',MAHJONG_PROVIDER_ORIGIN:'https://engine.example',SKYGATE_PROVIDER_ORIGIN:'https://engine.example',DATABASE_URL:'postgres://fixture.invalid/database',WALLET_SECRET:'fixture-wallet-secret',OFFSITE_BACKUP_SECRET_ACCESS_KEY:'fixture-backup-secret'};
 for(const [key,value] of Object.entries(forbidden))assert.throws(()=>validateDevelopmentEnvironment({...localEnvironment(),[key]:value}),key+' must not enter the development server');
});

test('unauthenticated visitors get a bounded preauth cookie but cannot read the dashboard',async t=>{
 const f=await fixture(t),browser=f.browser();
 expectStatus(await browser.call('/api/bootstrap'),401);
 const response=await browser.call('/api/session');expectStatus(response,200);
 assert.equal(response.data.authenticated,false);assert.equal(response.data.development,true);assert.ok(response.data.csrf);
 assert.deepEqual(new Set(response.data.roles.map(role=>typeof role==='string'?role:role.role||role.id)),new Set(['owner','operator','approver','auditor']));
 const cookie=response.cookies.find(value=>value.startsWith('xdplay_dev_login='));assert.ok(cookie);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Strict/i);assert.doesNotMatch(cookie,/Domain=/i);assert.doesNotMatch(cookie,/stp_session/);
});

test('login requires same-origin intent and matching preauth cookie, body and header CSRF',async t=>{
 const f=await fixture(t);
 for(const options of [{origin:false},{headers:{Origin:'https://attacker.example'}},{headers:{'Sec-Fetch-Site':'cross-site'}},{withCsrf:false},{withCookies:false},{headers:{'X-CSRF-Token':'unrelated-token'}},{bodyCsrf:'unrelated-token'},{bodyCsrf:'é'.repeat(43)},{headers:{'X-CSRF-Token':'é'.repeat(43)}}]){
  const browser=f.browser(),pre=await browser.call('/api/session');expectStatus(pre,200);
  const {bodyCsrf,...requestOptions}=options;
  expectDenied(await browser.call('/api/development/login',{method:'POST',body:{role:'owner',csrf:bodyCsrf||pre.data.csrf},...requestOptions}));
  assert.equal((await browser.call('/api/session')).data.authenticated,false);
 }
});

test('unknown roles and client supplied authority cannot create a development session',async t=>{
 const f=await fixture(t);
 for(const role of ['admin','production','OWNER','','__proto__',null]){
  const browser=f.browser(),pre=await browser.call('/api/session');
  expectDenied(await browser.call('/api/development/login',{method:'POST',body:{role,csrf:pre.data.csrf}}));
 }
 const browser=f.browser(),pre=await browser.call('/api/session');
 expectDenied(await browser.call('/api/development/login',{method:'POST',body:{role:'owner',csrf:pre.data.csrf,mfa_verified:true,production_enabled:true}}));
});

test('all four sign-in buttons yield development identities without MFA or production authority',async t=>{
 const f=await fixture(t);
 for(const role of ['owner','operator','approver','auditor']){
  const browser=f.browser(),signed=await browser.login(role);
  const cookie=signed.cookies.find(value=>value.startsWith('xdplay_dev_session='));assert.ok(cookie);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Strict/i);assert.doesNotMatch(cookie,/Domain=/i);assert.equal(browser.jar.has('xdplay_dev_login'),false);
  const session=await browser.call('/api/session');expectStatus(session,200);assert.equal(session.data.authenticated,true);assert.equal(session.data.development,true);
  const bootstrap=await browser.call('/api/bootstrap');expectStatus(bootstrap,200);
  const identity=bootstrap.data.identity||session.data.identity;
  assert.equal(identity.kind,'development');assert.equal(identity.staff?.role||identity.role,role);assert.equal(identity.mfa_verified,false);
  assert.equal(bootstrap.data.production_enabled,false);assert.equal(bootstrap.data.environment,'development');
  assert.equal(signed.cookies.some(value=>value.startsWith('stp_session=')),false);
 }
 const railway=await fixture(t,{...railwayEnvironment(),NODE_ENV:'production',XDPLAY_DEVELOPMENT_ORIGIN:'https://development.example'}),browser=railway.browser();
 const preauth=await browser.call('/api/session');assert.match(preauth.cookies.find(value=>value.startsWith('xdplay_dev_login=')),/; Secure(?:;|$)/);
 const signed=await browser.login('owner');assert.match(signed.cookies.find(value=>value.startsWith('xdplay_dev_session=')),/; Secure(?:;|$)/);
});

test('successful sign-in consumes the preauth token and rejects its replay',async t=>{
 const f=await fixture(t),browser=f.browser(),pre=await browser.call('/api/session'),preauthCookie=[...browser.jar].map(([k,v])=>k+'='+v).join('; ');
 const payload={role:'owner',csrf:pre.data.csrf};expectStatus(await browser.call('/api/development/login',{method:'POST',body:payload}),200);
 expectDenied(await browser.call('/api/development/login',{method:'POST',body:payload,headers:{Cookie:preauthCookie,'X-CSRF-Token':pre.data.csrf},remember:false}));
 expectStatus(await browser.call('/api/bootstrap'),200);
});

test('development sessions and preauth challenges expire using server time',async t=>{
 const f=await fixture(t),expiredPreauth=f.browser(),pre=await expiredPreauth.call('/api/session');f.advance(5*60*1000+1);
 expectDenied(await expiredPreauth.call('/api/development/login',{method:'POST',body:{role:'owner',csrf:pre.data.csrf}}));
 const browser=f.browser();await browser.login('owner');f.advance(2*60*60*1000+1);expectStatus(await browser.call('/api/bootstrap'),401);
});

test('authenticated writes reject missing or forged CSRF and cross-origin requests',async t=>{
 const f=await fixture(t),browser=f.browser();await browser.login('owner');
 const before=await browser.call('/api/bootstrap');
 for(const options of [{origin:false},{headers:{Origin:'https://attacker.example'}},{headers:{'Sec-Fetch-Site':'cross-site'}},{withCsrf:false},{headers:{'X-CSRF-Token':'forged-token'}}])expectDenied(await browser.call('/api/operators',{method:'POST',body:operatorPayload('Rejected Sample'),...options}));
 const after=await browser.call('/api/bootstrap');assert.equal(after.data.operators.length,before.data.operators.length);
});

test('owner and operator may manage sample operators; approver and auditor remain read-only for operations',async t=>{
 const f=await fixture(t);
 for(const role of ['owner','operator']){const browser=f.browser();await browser.login(role);const operator=await createOperator(browser,'Allowed '+role);expectStatus(await browser.call('/api/operators/'+operator.id,{method:'PATCH',body:{status:'disabled'}}),200);}
 for(const role of ['approver','auditor']){const browser=f.browser();await browser.login(role);const initial=await browser.call('/api/bootstrap');expectStatus(await browser.call('/api/operators',{method:'POST',body:operatorPayload('Forbidden '+role)}),403);if(initial.data.operators[0])expectStatus(await browser.call('/api/operators/'+initial.data.operators[0].id,{method:'PATCH',body:{status:'disabled'}}),403);}
});

test('sample operators cannot carry external callback URLs, real currencies or signing credentials',async t=>{
 const f=await fixture(t),browser=f.browser();await browser.login('owner');
 for(const patch of [{wallet_url:'https://wallet.example'},{wallet_mode:'seamless'},{currency:'IDR'},{secret:'external-secret'},{environment:'production'}])expectDenied(await browser.call('/api/operators',{method:'POST',body:{...operatorPayload(),...patch}}));
 const op=await createOperator(browser);expectDenied(await browser.call('/api/operators/'+op.id,{method:'PATCH',body:{status:'enabled',wallet_url:'https://wallet.example'}}));
});

test('browser fixtures are isolated and role changes preserve only the current browser fixture',async t=>{
 const f=await fixture(t),first=f.browser(),second=f.browser();await first.login('owner');await second.login('owner');
 const operator=await createOperator(first,'Only Browser One');
 assert.ok(!(await second.call('/api/bootstrap')).data.operators.some(row=>row.id===operator.id));
 const oldToken=first.jar.get('xdplay_dev_session'),oldCsrf=first.csrf;
 expectStatus(await first.call('/api/development/switch-role',{method:'POST',body:{role:'auditor'}}),200);
 assert.notEqual(first.jar.get('xdplay_dev_session'),oldToken);assert.notEqual(first.csrf,oldCsrf);
 assert.ok((await first.call('/api/bootstrap')).data.operators.some(row=>row.id===operator.id));
 expectStatus(await first.call('/api/bootstrap',{headers:{Cookie:'xdplay_dev_session='+oldToken},remember:false}),401);
 expectStatus(await first.call('/api/operators',{method:'POST',body:operatorPayload('No Longer Owner')}),403);
 expectStatus(await second.call('/api/bootstrap'),200);
});

test('role changes reject invalid roles without revoking the current valid session',async t=>{
 const f=await fixture(t),browser=f.browser();await browser.login('owner');const token=browser.jar.get('xdplay_dev_session');
 expectDenied(await browser.call('/api/development/switch-role',{method:'POST',body:{role:'superadmin'}}));
 assert.equal(browser.jar.get('xdplay_dev_session'),token);expectStatus(await browser.call('/api/bootstrap'),200);
});

test('logout revokes the server token and cannot log out another browser',async t=>{
 const f=await fixture(t),first=f.browser(),second=f.browser();await first.login('owner');await second.login('auditor');const token=first.jar.get('xdplay_dev_session');
 expectStatus(await first.call('/api/logout',{method:'POST',body:{}}),200);assert.equal(first.jar.has('xdplay_dev_session'),false);
 expectStatus(await first.call('/api/bootstrap',{headers:{Cookie:'xdplay_dev_session='+token},remember:false}),401);
 expectStatus(await second.call('/api/bootstrap'),200);
});

test('sample release workflow enforces order, role permissions and independent approval',async t=>{
 const f=await fixture(t),browser=f.browser();await browser.login('owner');const operator=await createOperator(browser),release=await requestRelease(browser,operator);
 expectDenied(await browser.call('/api/release-requests/'+release.id+'/approve',{method:'POST',body:{}}));
 expectStatus(await browser.call('/api/release-requests/'+release.id+'/validate',{method:'POST',body:{}}),200);
 const ownApproval=await browser.call('/api/release-requests/'+release.id+'/approve',{method:'POST',body:{}});expectStatus(ownApproval,403);assert.equal(ownApproval.data.error,'INDEPENDENT_APPROVER_REQUIRED');
 expectStatus(await browser.call('/api/development/switch-role',{method:'POST',body:{role:'operator'}}),200);
 expectStatus(await browser.call('/api/release-requests/'+release.id+'/approve',{method:'POST',body:{}}),403);
 expectStatus(await browser.call('/api/development/switch-role',{method:'POST',body:{role:'approver'}}),200);
 const approved=await browser.call('/api/release-requests/'+release.id+'/approve',{method:'POST',body:{}});expectStatus(approved,200);
 const record=entity(approved.data,'request');assert.notEqual(record.approved_by,record.requested_by);
 expectStatus(await browser.call('/api/release-requests/'+release.id+'/activate',{method:'POST',body:{}}),403);
});

test('release request cannot be promoted into a production request or activation',async t=>{
 const f=await fixture(t),browser=f.browser();await browser.login('owner');const operator=await createOperator(browser);
 expectDenied(await browser.call('/api/release-requests',{method:'POST',body:{operator_id:operator.id,game_id:'uno-luck',mode:'production'}}));
 for(const path of ['/api/release-control','/api/release-requests/arbitrary/activate'])expectDenied(await browser.call(path,{method:'POST',body:{mode:'production',confirmation:'CONFIRM PRODUCTION'}}));
});

test('production authentication, keys, launches and operator/engine APIs are absent even for preview owner',async t=>{
 const f=await fixture(t),browser=f.browser();await browser.login('owner');
 for(const path of ['/api/login','/api/staff/login','/api/staff','/api/staff/bootstrap','/api/game-launches','/api/operators/sample/keys','/v1/game-launches','/api/v4/agency-game/spin'])expectDenied(await browser.call(path,{method:'POST',body:{role:'admin',password:'anything',game_id:'uno-luck'}}));
 for(const path of ['/v1/games','/v1/transactions','/api/v4/agency-game/balance'])expectDenied(await browser.call(path));
});

test('reset is owner-only, requires explicit confirmation and leaves other browsers untouched',async t=>{
 const f=await fixture(t),first=f.browser(),second=f.browser();await first.login('owner');await second.login('owner');
 const firstOp=await createOperator(first,'Reset This Fixture'),secondOp=await createOperator(second,'Keep This Fixture');
 expectDenied(await first.call('/api/development/reset',{method:'POST',body:{confirmation:'RESET PRODUCTION'}}));
 expectStatus(await first.call('/api/development/switch-role',{method:'POST',body:{role:'operator'}}),200);
 expectStatus(await first.call('/api/development/reset',{method:'POST',body:{confirmation:'RESET DEVELOPMENT'}}),403);
 expectStatus(await first.call('/api/development/switch-role',{method:'POST',body:{role:'owner'}}),200);
 expectStatus(await first.call('/api/development/reset',{method:'POST',body:{confirmation:'RESET DEVELOPMENT'}}),200);
 assert.ok(!(await first.call('/api/bootstrap')).data.operators.some(row=>row.id===firstOp.id));
 assert.ok((await second.call('/api/bootstrap')).data.operators.some(row=>row.id===secondOp.id));
});

test('malformed and oversized bodies fail safely without mutating fixtures',async t=>{
 const f=await fixture(t),browser=f.browser();await browser.login('owner');const before=(await browser.call('/api/bootstrap')).data.operators.length;
 expectDenied(await browser.call('/api/operators',{method:'POST',raw:'{"name":'}));
 expectDenied(await browser.call('/api/operators',{method:'POST',body:operatorPayload(),headers:{'Content-Type':'text/plain'}}));
 expectDenied(await browser.call('/api/operators',{method:'POST',body:operatorPayload('x'.repeat(70000))}));
 assert.equal((await browser.call('/api/bootstrap')).data.operators.length,before);
});


test('SQLite development workspace persists over restart, remains browser-isolated and expires normally',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'xdplay-development-store-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const env={...localEnvironment(),XDPLAY_DEVELOPMENT_DB_PATH:join(dir,'sessions.sqlite')};
 let clock=Date.UTC(2026,10,18,8);
 const firstServer=createDevelopmentServer({env,clock:()=>clock});
 firstServer.listen(0,'127.0.0.1');await once(firstServer,'listening');
 const origin='http://127.0.0.1:'+firstServer.address().port;
 let cookie='',csrf='';
 async function call(base,path,method='GET',payload){
  const response=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
  const set=response.headers.getSetCookie();
  for(const item of set)if(item.startsWith('xdplay_dev_')){const piece=item.split(';')[0];cookie=cookie.split('; ').filter(x=>!x.startsWith(piece.split('=')[0]+'=')).concat(piece).join('; ');}
  const data=await response.json();if(data.csrf)csrf=data.csrf;
  return {status:response.status,data};
 }
 const start=await call(origin,'/api/session');
 assert.equal(start.status,200);
 assert.equal((await call(origin,'/api/development/login','POST',{role:'owner',csrf:start.data.csrf})).status,200);
 const op=await call(origin,'/api/operators','POST',operatorPayload('Persistent Operator'));
 assert.equal(op.status,201);
 const retainedCookie=cookie,retainedCsrf=csrf;
 firstServer.closeAllConnections();await new Promise(resolve=>firstServer.close(resolve));
 const nextServer=createDevelopmentServer({env,clock:()=>clock});
 nextServer.listen(0,'127.0.0.1');await once(nextServer,'listening');
 t.after(async()=>{nextServer.closeAllConnections();await new Promise(resolve=>nextServer.close(resolve));});
 const secondOrigin='http://127.0.0.1:'+nextServer.address().port;
 cookie=retainedCookie;csrf=retainedCsrf;
 const after=await call(secondOrigin,'/api/bootstrap');
 assert.equal(after.status,200);
 assert.ok(after.data.operators.some(item=>item.id===op.data.operator.id));
 const anon=await fetch(secondOrigin+'/api/bootstrap');assert.equal(anon.status,401);
 assert.equal((await call(secondOrigin,'/api/logout','POST',{})).status,200);
 assert.equal((await call(secondOrigin,'/api/bootstrap')).status,401);
});


test('per-operator game controls validate limits, enforce role access and block paused release',async t=>{
 const f=await fixture(t),browser=f.browser();await browser.login('owner');
 const initial=expectStatus(await browser.call('/api/bootstrap'),200);
 const original=initial.game_settings.find(item=>item.operator_id==='op_dev_alpha'&&item.game_id==='uno-luck');
 assert.ok(original);
 const endpoint='/api/operator-game-settings';
 const valid={operator_id:original.operator_id,game_id:original.game_id,revision:original.revision,enabled:true,maintenance:true,min_bet:400,max_bet:9000,currency:'VCOIN'};
 for(const patch of [{min_bet:10000,max_bet:9999},{currency:'IDR'},{min_bet:-1},{max_bet:100000001},{min_bet:'400'},{rtp:99},{wallet_url:'https://example.invalid'},{operator_id:'op_missing'}]){
  const rejected=await browser.call(endpoint,{method:'PATCH',body:{...valid,...patch}});
  expectDenied(rejected);
 }
 const changed=expectStatus(await browser.call(endpoint,{method:'PATCH',body:valid}),200).setting;
 assert.equal(changed.maintenance,true);assert.equal(changed.max_bet,9000);assert.equal(changed.revision,original.revision+1);
 const refreshed=expectStatus(await browser.call('/api/bootstrap'),200);
 const untouched=refreshed.game_settings.find(item=>item.operator_id==='op_dev_beta'&&item.game_id==='uno-luck');
 assert.equal(untouched.maintenance,false);
 assert.equal((await browser.call('/api/release-requests',{method:'POST',body:{operator_id:original.operator_id,game_id:'uno-luck'}})).status,409);
 assert.equal((await browser.call(endpoint,{method:'PATCH',body:valid})).status,409);
 expectStatus(await browser.call('/api/development/switch-role',{method:'POST',body:{role:'auditor'}}),200);
 assert.equal((await browser.call(endpoint,{method:'PATCH',body:{...valid,revision:changed.revision}})).status,403);
 expectStatus(await browser.call('/api/development/switch-role',{method:'POST',body:{role:'owner'}}),200);
 expectStatus(await browser.call(endpoint,{method:'PATCH',body:{...valid,revision:changed.revision,maintenance:false}}),200);
 const newOp=await createOperator(browser,'Configured Later');
 const later=expectStatus(await browser.call('/api/bootstrap'),200).game_settings.find(item=>item.operator_id===newOp.id&&item.game_id==='uno-luck');
 assert.ok(later);assert.equal(later.currency,'VCOIN');
});
