import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableWrites} from '../lib/durable-writes.mjs';
import {Core} from '../lib/core.mjs';
import {signer} from '../lib/security.mjs';

function database(){const dir=mkdtempSync(join(tmpdir(),'durable-group-')),file=join(dir,'data.sqlite'),db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE proofs(id TEXT PRIMARY KEY,value TEXT)');return {file,db,cleanup(){db.close();rmSync(dir,{recursive:true,force:true});}};}
test('concurrent writers acknowledge only committed data; failed operation rolls back only its own savepoint',async()=>{
 const fixture=database(),observer=new DatabaseSync(fixture.file),journal=new DurableWrites(fixture.db);
 try{
  const work=Array.from({length:256},(_,i)=>journal.run(()=>{fixture.db.prepare('INSERT INTO proofs VALUES(?,?)').run('p'+i,'value');if(i===73)throw Error('INVALID_OPERATION');return 'p'+i;}).then(id=>{assert.equal(observer.prepare('SELECT value FROM proofs WHERE id=?').get(id)?.value,'value','acknowledgement preceded visibility outside the writer transaction');return id;}));
  const result=await Promise.allSettled(work);assert.equal(result.filter(r=>r.status==='fulfilled').length,255);assert.equal(result[73].reason.message,'INVALID_OPERATION');
  assert.equal(observer.prepare('SELECT * FROM proofs WHERE id=?').get('p73'),undefined);
  assert.equal(observer.prepare('SELECT count(*) n FROM proofs').get().n,255);assert.equal(fixture.db.prepare('PRAGMA synchronous').get().synchronous,2);
  assert(journal.status().commits<=5);assert(journal.status().max_batch<=64);
 }finally{journal.close();observer.close();fixture.cleanup();}
});
test('failed durable commit releases no successful acknowledgement and leaves no partial rows',async()=>{
 const fixture=database(),journal=new DurableWrites({exec(sql){if(sql==='COMMIT')throw Error('INJECTED_COMMIT_FAILURE');return fixture.db.exec(sql);}});
 try{const result=await Promise.allSettled(Array.from({length:32},(_,i)=>journal.run(()=>fixture.db.prepare('INSERT INTO proofs VALUES(?,?)').run('p'+i,'value'))));assert(result.every(r=>r.status==='rejected'));assert.equal(fixture.db.prepare('SELECT count(*) n FROM proofs').get().n,0);assert.equal(journal.status().failed_commits,1);}finally{journal.close();fixture.cleanup();}
});
test('batched signed requests retain replay rejection across restart, including duplicates inside one batch',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'durable-auth-')),env={NODE_ENV:'test',CORE_DB_PATH:join(dir,'core.sqlite'),PANEL_SESSION_SECRET:'durable-test-master-secret-long-enough-123456',CORE_ENGINE_KEYS_JSON:JSON.stringify([{id:'engine-test',game:'uno-luck',secret:'engine-test-secret-long-enough-1234567890'}])};let core=new Core({env});
 try{
  const body='{}',path='/api/v4/agency-game/status',secret='engine-test-secret-long-enough-1234567890';
  const requests=Array.from({length:100},()=>{const s=signer(secret,'agency.v1','POST',path,body);return {method:'POST',path,body,headers:{'x-agency-key':'engine-test','x-agency-timestamp':s.timestamp,'x-agency-nonce':s.nonce,'x-agency-signature':s.signature}};});
  const results=await Promise.allSettled([...requests,requests[0]].map(r=>core.authenticateDurable(r,true)));assert.equal(results.filter(r=>r.status==='fulfilled').length,100);assert.equal(results.at(-1).reason.code,'REPLAY_DETECTED');
  assert.equal(core.get('SELECT count(*) n FROM replay_nonces').n,100);core.close();core=new Core({env});
  const replay=await Promise.allSettled(requests.map(r=>core.authenticateDurable(r,true)));assert(replay.every(r=>r.status==='rejected'&&r.reason.code==='REPLAY_DETECTED'));
 }finally{core.close();rmSync(dir,{recursive:true,force:true});}
});
