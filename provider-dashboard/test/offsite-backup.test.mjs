import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buffer as consumeBuffer} from 'node:stream/consumers';
import {signS3,runOffsiteBackup,startOffsiteBackup} from '../lib/offsite-backup.mjs';

test('SigV4 signs only the intended HTTPS bucket and refuses untrusted paths',()=>{
 const x=signS3({endpoint:'https://storage.example.test',bucket:'softtech-backups',key:'provider-core/2026-11-09.stbk',region:'iad',accessKeyId:'test-key',secretAccessKey:'test-secret',payload:Buffer.from('ciphertext'),now:new Date('2026-11-09T00:00:00.000Z')});
 assert.equal(x.url,'https://storage.example.test/softtech-backups/provider-core/2026-11-09.stbk');
 assert.match(x.headers.Authorization,/AWS4-HMAC-SHA256 Credential=test-key\/20261109\/iad\/s3\/aws4_request/);
 assert.match(x.headers.Authorization,/Signature=[a-f0-9]{64}$/);
 assert.throws(()=>signS3({endpoint:'https://storage.example.test',bucket:'softtech-backups',key:'../bad',region:'iad',accessKeyId:'a',secretAccessKey:'b',payload:Buffer.from('a')}),/Invalid object key/);
});

test('offsite snapshot encrypts committed data, locally restores and uploads without plaintext',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'provider-s3-test-'));
 try{
  const dbPath=join(dir,'core.sqlite'),db=new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE events(id INTEGER PRIMARY KEY, message TEXT);');
  db.prepare('INSERT INTO events(message) VALUES(?)').run('sensitive-provider-ledger-record');
  const env={CORE_DB_PATH:dbPath,BACKUP_PASSPHRASE:'test-only-long-passphrase-123456789',BACKUP_S3_BUCKET:'softtech-backups',BACKUP_S3_ENDPOINT:'https://storage.example.test',BACKUP_S3_REGION:'iad',BACKUP_S3_ACCESS_KEY_ID:'test-key',BACKUP_S3_SECRET_ACCESS_KEY:'test-secret',BACKUP_VERIFY_REMOTE:'true'};
  let calls=0,stored;
  const result=await runOffsiteBackup({env,now:new Date('2026-11-09T12:00:00.000Z'),fetcher:async(url,opts)=>{
   calls++;
   assert.equal(new URL(url).host,'storage.example.test');
   if(opts.method==='PUT'){
    stored=await consumeBuffer(opts.body);
    assert.equal(stored.includes(Buffer.from('sensitive-provider-ledger-record')),false);
    assert.ok(stored.subarray(0,6).equals(Buffer.from('STBK02')));
    return {ok:true,status:200};
   }
   assert.equal(opts.method,'GET');
   return new Response(stored,{status:200});
  }});
  assert.equal(calls,2);
  assert.equal(result.localIntegrity,'verified');
  assert.equal(result.remoteRestore,'verified');
  assert.equal(result.encrypted,true);
  assert.match(result.key,/^provider-core\/2026-11-09T12-00-00-000Z-[a-f0-9-]+\.stbk$/);
  db.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('offsite scheduling is opt-in',()=>{
 const x=startOffsiteBackup({env:{OFFSITE_BACKUP_ENABLED:'false'}});
 assert.equal(x.enabled,false);x.stop();
 assert.throws(()=>startOffsiteBackup({env:{OFFSITE_BACKUP_ENABLED:'true',OFFSITE_BACKUP_INTERVAL_HOURS:'0'}}),/interval/);
});

test('failed offsite backup retries in five minutes, success resumes daily cadence, stop prevents further work',async()=>{
 const jobs=[],cancelled=[],statuses=[];let attempts=0;
 const runner=startOffsiteBackup({env:{OFFSITE_BACKUP_ENABLED:'true'},onStatus:status=>statuses.push(status),
  schedule:(run,delay)=>{const job={run,delay,unref(){}};jobs.push(job);return job;},cancel:job=>cancelled.push(job),
  runBackup:async()=>{attempts++;if(attempts===1)throw Error('temporary transport outage');return {key:'verified.stbk',sha256:'a'.repeat(64),bytes:4096,remoteRestore:'verified'};}
 });
 assert.equal(jobs[0].delay,30000);
 await jobs[0].run();assert.equal(statuses[0].ok,false);assert.equal(jobs[1].delay,300000);
 await jobs[1].run();assert.equal(statuses[1].ok,true);assert.equal(jobs[2].delay,86400000);
 runner.stop();assert.equal(cancelled[0],jobs[2]);
 await jobs[2].run();assert.equal(attempts,2);assert.equal(jobs.length,3);
 assert.throws(()=>startOffsiteBackup({env:{OFFSITE_BACKUP_ENABLED:'true',OFFSITE_BACKUP_RETRY_SECONDS:'0'}}),/retry/);
});
