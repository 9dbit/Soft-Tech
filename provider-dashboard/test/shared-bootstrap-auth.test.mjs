import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
const cwd=new URL('../',import.meta.url).pathname;
async function fixture(t,environment='sandbox'){
 const dir=await mkdtemp(join(tmpdir(),'staff-bootstrap-boundary-'));const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const env={...process.env,NODE_ENV:'test',PORT:String(port),CORE_DB_PATH:join(dir,'core.sqlite'),CORE_ENVIRONMENT:environment,CORE_DEPLOYMENT_ID:'fixture-bootstrap-'+environment,PANEL_ADMIN_PASSWORD:randomBytes(30).toString('hex'),PANEL_AUDITOR_PASSWORD:randomBytes(30).toString('hex'),PANEL_SESSION_SECRET:randomBytes(40).toString('hex'),CORE_ENGINE_KEYS_JSON:'[]',CORE_ACCEPTANCE_RUN:'',OFFSITE_BACKUP_ENABLED:'false',CORE_QUALIFICATION_ENABLED:'false'};
 let child,logs='';const start=async()=>{child=spawn(process.execPath,['server.mjs'],{cwd,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);child.on('error',e=>logs+=e.message);for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error('Fixture exited: '+logs);try{if((await fetch('http://127.0.0.1:'+port+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,20));}throw Error('Fixture did not start: '+logs);};
 const stop=async()=>{if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}};t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});await start();
 const call=async(path,data,{cookie,csrf,forwarded}={})=>{const r=await fetch('http://127.0.0.1:'+port+path,{method:data===undefined?'GET':'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...(forwarded?{'x-forwarded-for':forwarded}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 return {env,call,restart:async()=>{await stop();await start();}};
}
test('forged forwarding headers cannot evade shared bootstrap login throttling',async t=>{
 const f=await fixture(t);for(let i=0;i<10;i++)assert.equal((await f.call('/api/login',{role:'admin',password:'wrong'},{forwarded:'198.51.100.'+(i+1)})).status,401);
 assert.equal((await f.call('/api/login',{role:'admin',password:f.env.PANEL_ADMIN_PASSWORD},{forwarded:'203.0.113.111'})).status,429);
 await f.restart();for(let i=0;i<10;i++)assert.equal((await f.call('/api/login',{role:'admin',password:'wrong'},{forwarded:'203.0.113.'+(i+1)})).status,401);
 await f.restart();for(let i=0;i<9;i++)assert.equal((await f.call('/api/login',{role:'admin',password:'wrong'},{forwarded:'192.0.2.'+(i+1)})).status,401);
 assert.equal((await f.call('/api/login',{role:'admin',password:f.env.PANEL_ADMIN_PASSWORD},{forwarded:'192.0.2.200'})).status,429);
});
test('preproduction shared login and existing shared sessions close after first owner registration',async t=>{
 const f=await fixture(t,'preproduction'),login=await f.call('/api/login',{role:'admin',password:f.env.PANEL_ADMIN_PASSWORD});assert.equal(login.status,200);
 const auth={cookie:login.cookie,csrf:login.data.csrf};const enrollment=await f.call('/api/staff/bootstrap',{admin_password:f.env.PANEL_ADMIN_PASSWORD,username:'fixture-owner',display_name:'Temporary Test Owner',person_ref:'fixture:owner',password:'temporary-test-password-2026'},auth);assert.equal(enrollment.status,201);
 assert.equal((await f.call('/api/bootstrap',undefined,auth)).status,401);
 assert.equal((await f.call('/api/login',{role:'admin',password:f.env.PANEL_ADMIN_PASSWORD})).status,403);
 await f.restart();assert.equal((await f.call('/api/bootstrap',undefined,auth)).status,401);assert.equal((await f.call('/api/login',{role:'auditor',password:f.env.PANEL_AUDITOR_PASSWORD})).status,403);
});
