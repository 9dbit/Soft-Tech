import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {createServer as netServer} from 'node:net';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Core} from '../lib/core.mjs';
import {CorePhases} from '../lib/core-phases.mjs';
import {random,signer} from '../lib/security.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
async function freePort(){const server=netServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function until(check,message){for(let i=0;i<150;i++){const value=await check();if(value)return value;await pause(20);}assert.fail(message);}

test('actual Core HTTP hooks preserve auth, body failure, financial completion after disconnect and restart replay safety',{timeout:45000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'core-phase-http-')),port=await freePort(),base='http://127.0.0.1:'+port;
 const master=random(40),engineSecret=random(40),engineId='phase-http-engine-fixture';
 const otherEngineKeys=[{id:'phase-http-mahjong-fixture',game:'mahjong-wild',secret:random(40)},{id:'phase-http-skygate-fixture',game:'skygate-5000',secret:random(40)}];
 const receipts=new Map(),balances=new Map(),debitCalls=new Map(),walletEntered=deferred(),releaseWallet=deferred();let walletSecret,holdDebit=true,walletError;
 const wallet=createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),action=req.url.split('/').at(-1);
   const expected=signer(walletSecret,'softtech.wallet.v1','POST',req.url,raw,req.headers['x-softtech-timestamp'],req.headers['x-softtech-nonce']);
   assert.equal(req.headers['x-softtech-signature'],expected.signature);
   const player=body.player_ref,balance=balances.get(player)??1000n;let response;
   if(action==='balance')response={balance_minor:String(balance),currency:body.currency,scale:body.scale};
   else if(action==='status')response=receipts.get(body.transaction_id)||{status:'not_found',transaction_id:body.transaction_id,currency:body.currency,scale:body.scale};
   else{
    if(action==='debit')debitCalls.set(player,(debitCalls.get(player)||0)+1);
    response=receipts.get(body.transaction_id);
    if(!response){const next=balance+(action==='debit'?-1n:1n)*BigInt(body.amount_minor);balances.set(player,next);response={status:'applied',transaction_id:body.transaction_id,amount_minor:body.amount_minor,balance_minor:String(next),currency:body.currency,scale:body.scale};receipts.set(body.transaction_id,response);}
    if(action==='debit'&&player==='phase-abort-player'&&holdDebit){holdDebit=false;walletEntered.resolve(body.round_id);await releaseWallet.promise;}
   }
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));
  }catch(error){walletError=error;res.writeHead(500);res.end('{}');}
 });
 await new Promise(resolve=>wallet.listen(0,'127.0.0.1',resolve));
 let child,logs='';
 const stop=async()=>{if(!child||child.exitCode!==null||child.signalCode!==null)return;const current=child;current.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{current.kill('SIGKILL');resolve();},5000);timer.unref();current.once('exit',()=>{clearTimeout(timer);resolve();});});};
 t.after(async()=>{releaseWallet.resolve();await stop();await new Promise(resolve=>wallet.close(resolve));await rm(directory,{recursive:true,force:true});});
 const env={...process.env,NODE_ENV:'test',PORT:String(port),CORE_DB_PATH:join(directory,'core.sqlite'),PANEL_ADMIN_PASSWORD:random(24),PANEL_AUDITOR_PASSWORD:random(24),PANEL_SESSION_SECRET:master,CORE_ENGINE_KEYS_JSON:JSON.stringify([{id:engineId,game:'uno-luck',secret:engineSecret},...otherEngineKeys]),CORE_PUBLIC_ORIGIN:base,UNO_PROVIDER_ORIGIN:'http://127.0.0.1:1',MAHJONG_PROVIDER_ORIGIN:'http://127.0.0.1:1',SKYGATE_PROVIDER_ORIGIN:'http://127.0.0.1:1',OFFSITE_BACKUP_ENABLED:'false'};
 // This is a synthetic local process, never a platform deployment or certificate.
 for(const key of ['RAILWAY_PROJECT_ID','RAILWAY_SERVICE_ID','RAILWAY_DEPLOYMENT_ID','RAILWAY_VOLUME_MOUNT_PATH','CORE_QUALIFICATION_ENABLED','CORE_ACCEPTANCE_RUN'])delete env[key];
 const seed=new Core({env,phases:new CorePhases()}),created=seed.createOperator({name:'Synthetic HTTP phase fixture',games:['uno-luck'],currency:'VCOIN',scale:2,wallet_mode:'seamless',wallet_url:'http://127.0.0.1:'+wallet.address().port+'/wallet'});
 walletSecret=created.wallet_signing_secret;
 const playerNames=Array.from({length:24},(_,i)=>'phase-player-'+i).concat('phase-abort-player');
 const launches=playerNames.map((player,index)=>seed.createLaunch(seed.operator(created.operator.id),{game_id:'uno-luck',player_ref:player},'phase-launch-'+index));seed.close();
 const health=async()=>{try{const response=await fetch(base+'/health');return response.ok?await response.json():null;}catch{return null;}};
 const start=async()=>{logs='';child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>{logs=(logs+data).slice(-8000);});child.stderr.on('data',data=>{logs=(logs+data).slice(-8000);});return until(health,'local Core did not start: '+logs);};
 const initial=await start();assert.equal(initial.core_phases.active_captures,0);assert.equal(initial.core_phases.completed_operations,0);assert.equal(initial.core_phases.capture_limit,1024);
 const signed=(action,payload,{raw=JSON.stringify(payload),headers={},signingId=engineId,signingSecret=engineSecret}={})=>{const path='/api/v4/agency-game/'+action,s=signer(signingSecret,'agency.v1','POST',path,raw);return {path,raw,nonce:s.nonce,options:{method:'POST',headers:{'Content-Type':'application/json','X-Agency-Key':signingId,'X-Agency-Timestamp':s.timestamp,'X-Agency-Nonce':s.nonce,'X-Agency-Signature':s.signature,...headers},body:raw}};};
 const call=async request=>{const response=await fetch(base+request.path,request.options);return {status:response.status,body:await response.json()};};
 const sessions=await Promise.all(launches.map(async(launch,index)=>{const token=new URLSearchParams(new URL(launch.launch_url).hash.slice(1)).get('softtech_launch');const response=await call(signed('redeem',{token,request_id:'phase-redeem-'+index}));assert.equal(response.status,200);return response.body;}));
 const statusPayload=session=>({tenant_id:session.tenant_id,session_id:session.session_id});
 const statusRequests=sessions.slice(0,24).map(session=>signed('status',statusPayload(session)));
 const wrong=signed('status',statusPayload(sessions[0]),{headers:{'X-Agency-Signature':'0'.repeat(64)}});
 const results=await Promise.all([...statusRequests,wrong].map(call));assert(results.slice(0,24).every(result=>result.status===200));assert.equal(results.at(-1).status,401);
 assert.equal((await call(statusRequests[0])).body.error,'REPLAY_DETECTED');
 const malformed=signed('status',{}, {raw:'{'});assert.equal((await call(malformed)).status,400);assert.equal((await call(malformed)).body.error,'REPLAY_DETECTED','valid nonce must commit before JSON/business rejection');
 assert.equal((await call(signed('status',statusPayload(sessions[0]),{headers:{'Content-Type':'text/plain'}}))).status,415);
 assert.equal((await call(signed('status',{}, {raw:' '.repeat(66000)}))).status,413);
 const rounds=await Promise.all(sessions.slice(0,12).map(async(session,index)=>{
  const payload={...statusPayload(session),round_ref:'phase-round-'+index,stake:'100',max_payout:'1000'};
  const reserved=await call(signed('reserve',payload));assert.equal(reserved.status,200);
  const settlement={tenant_id:session.tenant_id,round_id:reserved.body.id,payout:'120',evidence:'synthetic-fixed-outcome'};
  const settled=await call(signed('settle',settlement));assert.equal(settled.status,200);
  const replay=await call(signed('settle',settlement));assert.equal(replay.status,200);assert.equal(replay.body.id,reserved.body.id);
  return reserved.body.id;
 }));
 const observer=new DatabaseSync(env.CORE_DB_PATH,{readOnly:true});
 try{assert.equal(observer.prepare("SELECT count(*) n FROM ledger WHERE kind='debit'").get().n,12);assert.equal(observer.prepare("SELECT count(*) n FROM ledger WHERE kind='credit'").get().n,12);assert.equal(observer.prepare('SELECT count(*) n FROM replay_nonces WHERE nonce=?').get(statusRequests[0].nonce).n,1);assert.equal(observer.prepare('SELECT count(*) n FROM replay_nonces WHERE nonce=?').get(wrong.nonce).n,0);}finally{observer.close();}
 const abortPayload={...statusPayload(sessions.at(-1)),round_ref:'phase-aborted-reserve',stake:'100',max_payout:'1000'},abortRequest=signed('reserve',abortPayload);
 const request=httpRequest(base+abortRequest.path,{method:'POST',headers:abortRequest.options.headers});request.on('error',()=>{});request.end(abortRequest.raw);
 const abortedRound=await walletEntered.promise;const closed=new Promise(resolve=>request.once('close',resolve));request.destroy();await closed;
 const whileDisconnected=await until(async()=>{const value=await health();return value?.core_phases.active_captures===1?value:null;},'disconnected financial handler lost its active capture');
 assert.equal(whileDisconnected.core_phases.operations.engine_reserve.completed,12);
 releaseWallet.resolve();
 const afterAbort=await until(async()=>{const value=await health();return value?.core_phases.active_captures===0&&value.core_phases.operations.engine_reserve?.aborted===1?value:null;},'financial continuation did not retire after response close');
 const retry=await call(signed('reserve',abortPayload));assert.equal(retry.status,200);assert.equal(retry.body.id,abortedRound);assert.equal(debitCalls.get('phase-abort-player'),1);
 const readOnly=new DatabaseSync(env.CORE_DB_PATH,{readOnly:true});try{assert.equal(readOnly.prepare("SELECT count(*) n FROM ledger WHERE round_id=? AND kind='debit'").get(abortedRound).n,1);}finally{readOnly.close();}
 // Abort a partial body before auth. No instrumentation may turn it into a valid request.
 const incomplete=httpRequest(base+'/api/v4/agency-game/status',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'1000'}});incomplete.on('error',()=>{});incomplete.write('{');
 await until(async()=>{const value=await health();return value?.core_phases.active_captures===1;},'partial body was not observed');const partialClosed=new Promise(resolve=>incomplete.once('close',resolve));incomplete.destroy();await partialClosed;
 const final=await until(async()=>{const value=await health();return value?.core_phases.active_captures===0&&value.core_phases.operations.engine_status?.aborted===1?value:null;},'partial body abort capture did not complete');
 const metrics=final.core_phases;assert.equal(metrics.telemetry_error,false);assert.equal(metrics.saturated,false);assert.equal(metrics.invalid_clock,0);assert.equal(metrics.dropped_captures,0);assert.equal(metrics.dropped_spans,0);assert.equal(metrics.late_observations,0);
 assert.equal(metrics.operations.engine_redeem.completed,25);assert.equal(metrics.operations.engine_settle.completed,24);assert.equal(metrics.operations.engine_reserve.completed,14);
 assert.equal(metrics.operations.engine_status.counters.auth_failures,3);assert.equal(metrics.operations.engine_status.counters.body_failures,3);
 assert.equal(metrics.operations.engine_status.phases.wallet_balance.operations,24);assert.equal(metrics.operations.engine_status.phases.auth_resolve_to_resume.operations,28);
 const groups=metrics.game_attribution.groups;assert.equal(groups.unattributed.completed_operations,6);assert.equal(groups.unattributed.operations.engine_status.counters.auth_failures,3);assert.equal(groups.unattributed.operations.engine_status.counters.body_failures,3);
 assert.equal(groups['uno-luck'].operations.engine_status.completed,25,'signed malformed JSON follows authenticated key, while rejected auth/body stays unattributed');assert.equal(groups['uno-luck'].operations.engine_reserve.aborted,1);assert.equal(groups['mahjong-wild'].completed_operations,0);assert.equal(groups['skygate-5000'].completed_operations,0);
 for(const raw of [master,engineSecret,engineId,walletSecret,created.operator.id,sessions[0].session_id,statusRequests[0].nonce,'phase-abort-player','synthetic-fixed-outcome'])assert(!JSON.stringify(metrics).includes(raw),'telemetry retained request or credential data');
 assert.equal(walletError,undefined);assert.equal(rounds.length,12);assert(afterAbort.core_phases.operations.engine_reserve.phases.wallet_debit.operations>=13);
 // Headers/body game names cannot select a group. Only the verified key can,
 // including when later business validation rejects another game's session.
 assert.equal((await call(signed('status',{...statusPayload(sessions[0]),game_id:'skygate-5000'},{headers:{'X-Game-Id':'mahjong-wild'}}))).status,200);
 for(const key of otherEngineKeys){const response=await call(signed('status',{...statusPayload(sessions[0]),game_id:'uno-luck'},{signingId:key.id,signingSecret:key.secret,headers:{'X-Game-Id':'uno-luck'}}));assert.equal(response.status,404);}
 const attributed=await until(async()=>{const value=await health();return value?.core_phases.active_captures===0&&value.core_phases.game_attribution.groups['skygate-5000'].completed_operations===1?value:null;},'trusted game attribution did not finish');
 const finalGroups=attributed.core_phases.game_attribution.groups;assert.equal(finalGroups['uno-luck'].operations.engine_status.completed,26);assert.equal(finalGroups.unattributed.completed_operations,6);
 for(const key of otherEngineKeys){assert.equal(finalGroups[key.game].operations.engine_status.completed,1);assert.equal(finalGroups[key.game].operations.engine_status.errors,1);assert.equal(finalGroups[key.game].operations.engine_status.counters.auth_failures,0);assert.equal(finalGroups[key.game].operations.engine_status.phases.auth_total.operations,1);assert(!JSON.stringify(attributed.core_phases).includes(key.id));assert(!JSON.stringify(attributed.core_phases).includes(key.secret));}
 assert.equal(Object.values(finalGroups).reduce((sum,group)=>sum+group.completed_operations,0),attributed.core_phases.completed_operations);assert(Buffer.byteLength(JSON.stringify(attributed))<262144);
 await stop();const restarted=await start();assert.notEqual(restarted.process_boot_id,initial.process_boot_id);assert.notEqual(restarted.core_phases.registry_id,initial.core_phases.registry_id);assert.equal(restarted.core_phases.completed_operations,0);
 assert.equal((await call(statusRequests[0])).body.error,'REPLAY_DETECTED');assert.equal((await call(signed('reserve',abortPayload))).body.id,abortedRound);assert.equal(debitCalls.get('phase-abort-player'),1);
});
