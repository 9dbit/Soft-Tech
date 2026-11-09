import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const sha=s=>createHash('sha256').update(s).digest('hex');
const random=()=>randomBytes(16).toString('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
function signed({url,method='GET',body='',credential,nonce=random(),idempotencyKey}){
 const u=new URL(url),ts=String(Math.floor(Date.now()/1000));
 const canonical=['softtech.v1',method,u.pathname+u.search,ts,nonce,sha(body)].join('\n');
 const signature=createHmac('sha256',credential.secret).update(canonical).digest('hex');
 return {method,headers:{'X-SoftTech-Key':credential.key_id,'X-SoftTech-Timestamp':ts,'X-SoftTech-Nonce':nonce,'X-SoftTech-Signature':signature,...(body?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body?{body}:{})};
}
test('independent operator HTTP conformance: signed game listing, launch, tenant isolation and replay', {timeout:45000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'st-operator-http-'));
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const env={...process.env,NODE_ENV:'test',PORT:String(port),CORE_DB_PATH:join(dir,'core.sqlite'),PANEL_ADMIN_PASSWORD:'admin-test-password-123456',PANEL_AUDITOR_PASSWORD:'auditor-test-password-123456',PANEL_SESSION_SECRET:'test-root-secret-longer-than-32-chars-123456789',CORE_PUBLIC_ORIGIN:base,UNO_PROVIDER_ORIGIN:base,MAHJONG_PROVIDER_ORIGIN:base,SKYGATE_PROVIDER_ORIGIN:base,CORE_ENGINE_KEYS_JSON:'[]',OFFSITE_BACKUP_ENABLED:'false'};
 const child=spawn(process.execPath,['server.mjs'],{cwd:resolve('provider-dashboard'),env,stdio:'pipe'});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 try{
  let healthy=false;
  for(let i=0;i<60;i++){if(child.exitCode!==null)break;try{const r=await fetch(base+'/health');if(r.ok){healthy=true;break;}}catch{}await pause(200);}
  assert.equal(healthy,true,'core did not become healthy: '+logs);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'admin',password:env.PANEL_ADMIN_PASSWORD})});
  assert.equal(login.status,200);
  const {csrf}=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
  const makeOperator=async(name)=>{
   const r=await fetch(base+'/api/operators',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({name,games:['uno-luck','mahjong-wild','skygate-5000'],currency:'VCOIN',scale:2})});
   assert.equal(r.status,201,await r.text());return r.json();
  };
  const a=await makeOperator('Conformance Operator A'),b=await makeOperator('Conformance Operator B');
  assert.notEqual(a.credential.key_id,b.credential.key_id);
  const gameReq=signed({url:base+'/v1/games',credential:a.credential});
  const games=await fetch(base+'/v1/games',gameReq);
  assert.equal(games.status,200);assert.equal((await games.json()).games.length,3);
  const replay=await fetch(base+'/v1/games',gameReq);
  assert.equal(replay.status,409);assert.equal((await replay.json()).error,'REPLAY_DETECTED');
  const body=JSON.stringify({game_id:'uno-luck',player_ref:'test-player-1',currency:'VCOIN'});
  const launch=await fetch(base+'/v1/game-launches',signed({url:base+'/v1/game-launches',method:'POST',body,credential:a.credential,idempotencyKey:'external-conformance-launch-001'}));
  assert.equal(launch.status,200,await launch.text());
  const launched=await launch.json();assert.match(launched.session_id,/^ss_/);
  const own=await fetch(base+'/v1/sessions/'+launched.session_id,signed({url:base+'/v1/sessions/'+launched.session_id,credential:a.credential}));
  assert.equal(own.status,200);
  const other=await fetch(base+'/v1/sessions/'+launched.session_id,signed({url:base+'/v1/sessions/'+launched.session_id,credential:b.credential}));
  assert.equal(other.status,404);
  const repeated=await fetch(base+'/v1/game-launches',signed({url:base+'/v1/game-launches',method:'POST',body,credential:a.credential,idempotencyKey:'external-conformance-launch-001'}));
  assert.equal(repeated.status,200);
  assert.equal((await repeated.json()).session_id,launched.session_id);
  const logout=await fetch(base+'/api/logout',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf}});
  assert.equal(logout.status,200);
 }finally{child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null||child.signalCode!==null)r();else{child.once('exit',r);setTimeout(()=>{child.kill('SIGKILL');r();},3000).unref();}});await rm(dir,{recursive:true,force:true});}
});
