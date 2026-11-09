import test from 'node:test';
import assert from 'node:assert/strict';
import {backupReadiness} from '../lib/backup-readiness.mjs';

const now=Date.parse('2026-11-10T00:00:00.000Z');
const env={RAILWAY_GIT_COMMIT_SHA:'a'.repeat(40)};
const proof=()=>({enabled:true,last:{ok:true,at:new Date(now-60000).toISOString(),source_commit:env.RAILWAY_GIT_COMMIT_SHA,remoteRestore:'verified',sha256:'b'.repeat(64),bytes:4096,key:'private-backup-key',error:'private-diagnostic'}});

test('backup readiness requires fresh remote restore proof from the running source',()=>{
 const result=backupReadiness(proof(),{env,now});
 assert.equal(result.ok,true);assert.equal(result.backup_verified,true);
 assert.equal(result.source_commit,env.RAILWAY_GIT_COMMIT_SHA);
 assert.equal(result.verified_at,proof().last.at);
 assert.equal('key' in result,false);assert.equal('error' in result,false);assert.equal('sha256' in result,false);
});

test('backup readiness fails closed for absent, failed, unverified or wrong-build evidence',()=>{
 const cases=[
  [{enabled:false},'BACKUP_DISABLED'],[{enabled:true,last:null},'BACKUP_PENDING'],
  [{...proof(),last:{...proof().last,ok:false}},'BACKUP_FAILED'],
  [{...proof(),last:{...proof().last,remoteRestore:'not_requested'}},'REMOTE_RESTORE_UNVERIFIED'],
  [{...proof(),last:{...proof().last,source_commit:'c'.repeat(40)}},'BACKUP_BUILD_MISMATCH'],
  [{...proof(),last:{...proof().last,sha256:'bad'}},'BACKUP_PROOF_INVALID'],
  [{...proof(),last:{...proof().last,bytes:0}},'BACKUP_PROOF_INVALID']
 ];
 for(const [state,reason] of cases){const result=backupReadiness(state,{env,now});assert.equal(result.ok,false,reason);assert.equal(result.backup_verified,false,reason);assert.equal(result.reason,reason);}
});

test('stale, malformed and future backup timestamps cannot satisfy the release prerequisite',()=>{
 for(const at of [new Date(now-25*3600000-1).toISOString(),'invalid',new Date(now+1).toISOString()]){
  assert.equal(backupReadiness({...proof(),last:{...proof().last,at}},{env,now}).ok,false,at);
 }
 assert.equal(backupReadiness({...proof(),last:{...proof().last,at:new Date(now-25*3600000).toISOString()}},{env,now}).ok,true);
 assert.equal(backupReadiness(proof(),{env:{...env,OFFSITE_BACKUP_INTERVAL_HOURS:'NaN'},now}).ok,false);
 assert.equal(backupReadiness({...proof(),last:{...proof().last,at:new Date(now-8*3600000).toISOString()}},{env:{...env,OFFSITE_BACKUP_INTERVAL_HOURS:'6'},now}).ok,false);
});
