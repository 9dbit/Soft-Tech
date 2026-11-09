import test from 'node:test';
import assert from 'node:assert/strict';
import {runVolumeRecovery} from '../volume-recovery.mjs';
import {nativeOutcomeProof} from '../native-load.mjs';
const config={environment:'preproduction',core_audience:'fixture-core',operator:{id:'op_qualification_fixture'}};
function fixture({changeOldOutcome=false}={}){
 const calls=[],rounds=new Map();let armed=false,remaining=10000;
 const outcome=(game,id)=>game==='uno-luck'?{round:{id,complete:true,payout:7,cards:[1,2,3]}}:game==='mahjong-wild'?{ticket_id:id,round:{id,win:7},stake_virtual_credits:'2',win_virtual_credits:'7',settlement:{payout_minor:'700'}}:{id,round:{winX:7},payout:'7',cost:'2',state:{balance:'fixture'}};
 const request=(ctx,id)=>({pathname:ctx.game_id==='uno-luck'?'/api/agency/pick':ctx.game_id==='mahjong-wild'?'/api/spin':'/api/agency/spin',payload:{request_id:id,expected_phase:3}});
 const adapters={
  establishSession:async(_c,i,_run,o)=>({game_id:o.game_id,session_id:'fixture-session-'+i,player_ref:'fixture-player-'+i,origin:'https://'+i+'.invalid',cookie:'never-write-this-secret',round_count:0,rounds:[]}),
  playRound:async ctx=>{const n=ctx.round_count||0,id=ctx.game_id+(n?'-pending':'-completed'),req=request(ctx,id);ctx.last_round_request=req;rounds.set(id,outcome(ctx.game_id,id));if(n){remaining--;throw Error('NATIVE_HTTP_503');}ctx.round_count=1;ctx.last_completed_request={...req,...nativeOutcomeProof(ctx.game_id,rounds.get(id))};return {native_round_id:id,duplicate_verified:true};},
  adminCall:async(_c,url)=>{if(url==='/admin/faults'){armed=true;remaining=10000;calls.push('arm');return {ok:true,data:{id:'fixture-barrier'}};}if(url==='/admin/faults/clear'){armed=false;calls.push('clear');return {ok:true};}return {ok:true,data:{faults:[{id:'fixture-barrier',remaining}]}};},
  sleep:async ms=>{assert.equal(ms,30000);assert.equal(armed,true);calls.push('snapshot-wait');},
  nativeCall:async(_ctx,_path,payload)=>{assert.equal(armed,false);calls.push(payload.request_id.endsWith('-pending')?'pending-replay':'old-replay');const r=structuredClone(rounds.get(payload.request_id));if(changeOldOutcome&&payload.request_id.endsWith('-completed'))r.round.corrupted=true;return r;},
  operatorCall:async()=>({ok:true}),
  reconcileRun:async()=>({status:'PASS',provider_rounds:6,provider_ledger_entries:12,wallet:{run_transactions:12}})
 };
 const restart=async(_c,target,_origin,o)=>{assert.equal(armed,true);calls.push(o.stage);assert.equal(o.timeoutMs,o.stage==='volume_restore'?600000:300000);return {classification:'unit_test_fixture_not_platform_evidence',target,stage:o.stage,process_boot_id_before:'old',process_boot_id_after:'new',status:'PASS'};};
 return {adapters,restart,calls};
}
test('volume drill keeps pending credit blocked across both stages and replays prior outcomes without claiming platform restore',async()=>{
 const f=fixture(),r=await runVolumeRecovery(config,{runId:'unit-volume-fixture',...f});assert.equal(r.status,'PARTIAL');assert.equal(r.application_checks_passed,true);assert.equal(r.full_volume_recovery_certified,false);assert.equal(r.platform_volume_evidence,null);assert.equal(r.cases.length,3);assert.equal(r.completed_native_rounds,6);assert.equal(r.reconciliation.status,'PASS');assert.equal(JSON.stringify(r).includes('never-write-this-secret'),false);
 for(let i=0;i<3;i++)assert.deepEqual(f.calls.slice(i*8,i*8+8),['arm','snapshot_restart','snapshot-wait','volume_restore','clear','pending-replay','pending-replay','old-replay']);
});
test('volume drill rejects changed completed outcome even when process restarts and pending retry succeed',async()=>{
 const f=fixture({changeOldOutcome:true}),r=await runVolumeRecovery(config,{runId:'unit-volume-corruption',...f});assert.equal(r.status,'FAIL');assert.match(r.error,/PRE_EXISTING_OUTCOME_CHANGED_AFTER_RESTORE/);assert.equal(r.full_volume_recovery_certified,false);assert.equal(r.cleanup[0].revoked,true);assert.equal(f.calls.at(-1),'clear');
});
test('volume drill cannot continue after absent platform restart and always removes its fault barrier',async()=>{
 const f=fixture(),r=await runVolumeRecovery(config,{runId:'unit-volume-no-restart',...f,restart:async()=>{throw Error('ACTUAL_PLATFORM_RESTART_NOT_OBSERVED');}});assert.equal(r.status,'FAIL');assert.match(r.error,/ACTUAL_PLATFORM_RESTART_NOT_OBSERVED/);assert.equal(f.calls.at(-1),'clear');assert.equal(r.completed_native_rounds,1);
});
