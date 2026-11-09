import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForReadiness} from './readiness.mjs';
const runId='readiness-regression-01';
const ready=()=>({ok:true,app:'soft-tech-provider-core',acceptance:{id:runId,status:'running'}});
const games=()=>['uno-luck','mahjong-wild','skygate-5000'].map(id=>({id,health:'ok'}));
const core={env:{CORE_PUBLIC_ORIGIN:'https://core.example.test'},refreshHealth:async()=>games()};

test('waits for stale deployment route to switch to current core',async()=>{
 let calls=0,pauses=0;
 const result=await waitForReadiness(core,runId,{probe:async url=>{assert.match(url,/acceptance_probe=/);calls++;return calls<3?{...ready(),acceptance:{id:'old-run',status:'failed'}}:ready();},sleep:async()=>{pauses++;},attempts:4});
 assert.equal(result.attempts,3);assert.equal(pauses,2);assert.equal(result.public_core_ready,true);
});
test('waits until last native engine is healthy',async()=>{
 let calls=0;
 const result=await waitForReadiness({...core,refreshHealth:async()=>{calls++;const list=games();if(calls<2)list[1].health='unavailable';return list;}},runId,{probe:async()=>ready(),sleep:async()=>{},attempts:3});
 assert.equal(result.attempts,2);
});
test('does not treat public HTTP failure as ready',async()=>{
 await assert.rejects(waitForReadiness(core,runId,{probe:async()=>{throw Error('connection dial timeout');},sleep:async()=>{},attempts:2}),/Public core route/);
});
test('does not use old completed report for readiness',async()=>{
 await assert.rejects(waitForReadiness(core,runId,{probe:async()=>({...ready(),acceptance:{id:runId,status:'passed'}}),sleep:async()=>{},attempts:1}),/Public core route/);
});
test('rejects HTTP and credential-bearing public origins',async()=>{
 for(const origin of ['http://core.example.test','https://user:pass@core.example.test'])await assert.rejects(waitForReadiness({...core,env:{CORE_PUBLIC_ORIGIN:origin}},runId,{probe:async()=>ready(),sleep:async()=>{}}),/HTTPS provider origin/);
});
test('all three engines are required and attempts are bounded',async()=>{
 let calls=0;
 await assert.rejects(waitForReadiness({...core,refreshHealth:async()=>{calls++;return games().slice(0,2);}},runId,{probe:async()=>ready(),sleep:async()=>{},attempts:3}),/Not all provider engines/);
 assert.equal(calls,3);
});
