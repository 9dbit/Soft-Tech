import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {Core} from '../lib/core.mjs';
import {random,sha,signer} from '../lib/security.mjs';
import {createEncryptedBackup,restoreEncryptedBackup} from '../scripts/sqlite-backup.mjs';

const tables=['meta','deployment_identity','games','operators','api_keys','replay_nonces','panel_sessions','players','sessions','idempotency','rounds','ledger','wallet_ops','audit','checks','selftests','operator_game_modes','release_requests'];
const snapshot=core=>Object.fromEntries(tables.map(table=>[table,core.all('SELECT * FROM '+table+' ORDER BY rowid')]));
const code=expected=>error=>error.code===expected;

function signedRequest(core,credential,domain,path,body=''){
 const method=body?'POST':'GET',prefix=domain==='agency.v1'?'x-agency-':'x-softtech-';
 const signature=signer(credential.secret,domain,method,path,body,String(Math.floor(core.clock()/1000)));
 return {method,path,body,headers:{[prefix+'key']:credential.key_id,[prefix+'timestamp']:signature.timestamp,[prefix+'nonce']:signature.nonce,[prefix+'signature']:signature.signature}};
}

async function nativeCallback(core,credential,action,payload){
 const request=signedRequest(core,credential,'agency.v1','/api/v4/agency-game/'+action,JSON.stringify(payload));
 const engine=core.authenticate(request,true);
 return core.engineAction(engine,action,payload);
}

test('provider application restores encrypted committed-WAL state and completes pending sandbox settlement exactly once',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'softtech-provider-restore-'));
 const source=join(dir,'original','provider.sqlite'),archive=join(dir,'backup','provider.stbk'),restoredPath=join(dir,'rehearsal','provider.sqlite');
 const now=Date.now(),clock=()=>now,master=random(40),password=random(40);
 const engineCredential={key_id:'restore-drill-uno-engine',secret:random(40)};
 const env={NODE_ENV:'test',CORE_ENVIRONMENT:'sandbox',CORE_DEPLOYMENT_ID:'restore-drill-sandbox-deployment',CORE_DB_PATH:source,PANEL_SESSION_SECRET:master,CORE_ENGINE_KEYS_JSON:JSON.stringify([{id:engineCredential.key_id,game:'uno-luck',secret:engineCredential.secret}]),UNO_PROVIDER_ORIGIN:'https://uno.restore-fixture.example',CORE_PUBLIC_ORIGIN:'https://provider.restore-fixture.example'};
 let live,restored;
 try{
  live=new Core({env,clock});
  live.db.exec('PRAGMA wal_autocheckpoint=0');
  const issued=live.createOperator({name:'Restore drill virtual-credit fixture',games:['uno-luck'],currency:'VCOIN',scale:2,initial_minor:'10000',max_stake_minor:'1000',max_payout_minor:'10000',return_origins:['https://operator.restore-fixture.example']});
  const op=live.operator(issued.operator.id);
  const launchInput={game_id:'uno-luck',player_ref:'restore-fixture-player',currency:'VCOIN',return_url:'https://operator.restore-fixture.example'};
  const launch=live.createLaunch(op,launchInput,'restore-drill-launch-001');
  const token=new URLSearchParams(new URL(launch.launch_url).hash.slice(1)).get('softtech_launch');
  const session=await nativeCallback(live,engineCredential,'redeem',{token,request_id:'restore-drill-redeem-001'});
  assert.equal(live.session(session.session_id).status,'active');

  // Exercise real signature verification and engine callback state transitions.
  // Outcomes are test fixtures; no external native runtime or operator is contacted.
  const reserveOne={tenant_id:op.id,session_id:session.session_id,round_ref:'restore-drill-round-settled',stake:'100',max_payout:'1000'};
  const roundOne=await nativeCallback(live,engineCredential,'reserve',reserveOne);
  const settleOne={tenant_id:op.id,round_id:roundOne.id,payout:'250',evidence:'restore-fixture:uno-outcome-1'};
  await nativeCallback(live,engineCredential,'settle',settleOne);
  const reserveTwo={tenant_id:op.id,session_id:session.session_id,round_ref:'restore-drill-round-pending',stake:'200',max_payout:'1000'};
  const roundTwo=await nativeCallback(live,engineCredential,'reserve',reserveTwo);
  assert.equal(roundTwo.status,'reserved');
  assert.equal(live.get('SELECT balance_minor FROM players WHERE id=?',session.player_id).balance_minor,'9950');
  assert.equal(live.get('SELECT count(*) n FROM ledger').n,4);

  const usedRequest=signedRequest(live,issued.credential,'softtech.v1','/v1/games');
  live.authenticate(usedRequest);
  // This exact signature is issued before backup but is first consumed after restore.
  const unusedRequest=signedRequest(live,issued.credential,'softtech.v1','/v1/games');
  const before=snapshot(live),identity=live.deploymentIdentity;
  const reconciliationBefore=live.reconciliation(op.id,'restore-drill',false);
  assert.equal(reconciliationBefore.status,'attention');
  assert.deepEqual(reconciliationBefore.issues,[{round_id:roundTwo.id,code:'PENDING',status:'reserved'}]);
  assert.equal(live.get('PRAGMA journal_mode').journal_mode,'wal');
  assert.ok((await stat(source+'-wal')).size>32,'committed application state must exist in live WAL frames');
  const originalDatabaseHash=sha(await readFile(source)),originalWalHash=sha(await readFile(source+'-wal'));

  const backup=await createEncryptedBackup({source,destination:archive,password});
  const encrypted=await readFile(archive);
  assert.equal(sha(encrypted),backup.sha256);
  assert.equal(encrypted.includes(Buffer.from('restore-fixture-player')),false);
  await assert.rejects(restoreEncryptedBackup({source:archive,destination:source,password}),/already exists/);

  const restoreStarted=performance.now();
  await restoreEncryptedBackup({source:archive,destination:restoredPath,password});
  const restoreElapsedMs=performance.now()-restoreStarted;
  const restoredEnv={...env,CORE_DB_PATH:restoredPath},restoredBeforeOpenHash=sha(await readFile(restoredPath));
  assert.throws(()=>new Core({env:{...restoredEnv,PANEL_SESSION_SECRET:random(40)},clock}));
  assert.equal(sha(await readFile(restoredPath)),restoredBeforeOpenHash,'wrong master must not rewrite restored DB');
  assert.throws(()=>new Core({env:{...restoredEnv,CORE_DEPLOYMENT_ID:'another-sandbox-deployment'},clock}),/Deployment identity mismatch/);
  assert.equal(sha(await readFile(restoredPath)),restoredBeforeOpenHash,'wrong identity must not rewrite restored DB');

  const reopenStarted=performance.now();
  restored=new Core({env:restoredEnv,clock});
  const reopenElapsedMs=performance.now()-reopenStarted;
  assert.deepEqual(restored.deploymentIdentity,identity);
  assert.deepEqual(snapshot(restored),before,'all persisted application tables must survive encrypted restore');
  assert.equal(restored.authenticate(unusedRequest).operator.id,op.id,'restored vault must verify the original credential signature');
  assert.throws(()=>restored.authenticate(usedRequest),code('REPLAY_DETECTED'),'nonce replay protection must survive restore');
  assert.equal(restored.session(session.session_id).status,'active');
  assert.deepEqual(restored.createLaunch(restored.operator(op.id),launchInput,'restore-drill-launch-001'),launch,'launch idempotency record must survive restore');
  const reconciliationRestored=restored.reconciliation(op.id,'restore-drill',false);
  assert.equal(reconciliationRestored.status,reconciliationBefore.status);
  assert.deepEqual(reconciliationRestored.issues,reconciliationBefore.issues);

  const restoredSettledLedger=restored.all('SELECT * FROM ledger WHERE round_id=? ORDER BY rowid',roundOne.id);
  await nativeCallback(restored,engineCredential,'settle',settleOne);
  await nativeCallback(restored,engineCredential,'settle',settleOne);
  assert.deepEqual(restored.all('SELECT * FROM ledger WHERE round_id=? ORDER BY rowid',roundOne.id),restoredSettledLedger);
  assert.equal(restored.get('SELECT count(*) n FROM ledger').n,4,'duplicate completed settlement must add no ledger entry');

  assert.equal((await nativeCallback(restored,engineCredential,'reserve',reserveTwo)).id,roundTwo.id);
  const settleTwo={tenant_id:op.id,round_id:roundTwo.id,payout:'75',evidence:'restore-fixture:uno-outcome-2'};
  const completions=await Promise.all([nativeCallback(restored,engineCredential,'settle',settleTwo),nativeCallback(restored,engineCredential,'settle',settleTwo)]);
  assert.ok(completions.every(result=>result.status==='settled'));
  assert.equal(restored.get('SELECT count(*) n FROM ledger').n,5);
  assert.deepEqual(restored.all('SELECT kind,amount_minor FROM ledger WHERE round_id=? ORDER BY rowid',roundTwo.id).map(row=>({...row})),[{kind:'debit',amount_minor:'-200'},{kind:'credit',amount_minor:'75'}]);
  assert.equal(restored.get('SELECT balance_minor FROM players WHERE id=?',session.player_id).balance_minor,'10025');
  const finalReconciliation=restored.reconciliation(op.id,'restore-drill',false);
  assert.equal(finalReconciliation.status,'matched');assert.equal(finalReconciliation.rounds_checked,2);assert.deepEqual(finalReconciliation.issues,[]);

  assert.deepEqual(snapshot(live),before,'rehearsal completion must not mutate the original application');
  assert.equal(live.round(roundTwo.id).status,'reserved');
  assert.equal(sha(await readFile(source)),originalDatabaseHash,'original database file must remain untouched');
  assert.equal(sha(await readFile(source+'-wal')),originalWalHash,'original committed WAL must remain untouched');
  t.diagnostic(JSON.stringify({scope:'local encrypted provider-application fixture rehearsal',restore_elapsed_ms:Number(restoreElapsedMs.toFixed(2)),provider_reopen_ms:Number(reopenElapsedMs.toFixed(2)),restored_rounds:2,restored_ledger_entries:4,final_ledger_entries:5,original_unchanged:true,live_volume_loss_tested:false,production_rto_measured:false}));
 }finally{
  restored?.close();live?.close();await rm(dir,{recursive:true,force:true});
 }
});
