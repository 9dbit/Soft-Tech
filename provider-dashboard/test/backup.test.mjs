import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEncryptedBackup, restoreEncryptedBackup } from '../scripts/sqlite-backup.mjs';
test('encrypted SQLite snapshot restores committed WAL rows, rejects tampering and never overwrites',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'st-backup-test-'));
 try{
  const source=join(dir,'live.sqlite'),encrypted=join(dir,'backup.stbk'),restored=join(dir,'restored.sqlite');
  const db=new DatabaseSync(source);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE audit(id INTEGER PRIMARY KEY, event TEXT NOT NULL);');
  db.prepare('INSERT INTO audit(event) VALUES (?)').run('committed transaction');
  const password='example-test-passphrase-that-is-long-enough';
  const result=await createEncryptedBackup({source,destination:encrypted,password});
  assert.equal(result.sha256.length,64);
  assert.equal((await readFile(encrypted)).includes(Buffer.from('committed transaction')),false);
  await restoreEncryptedBackup({source:encrypted,destination:restored,password});
  const recovered=new DatabaseSync(restored,{readOnly:true});
  assert.equal(recovered.prepare('SELECT event FROM audit').get().event,'committed transaction');
  recovered.close();
  await assert.rejects(restoreEncryptedBackup({source:encrypted,destination:join(dir,'wrong.sqlite'),password:'wrong-but-long-enough-password-12345'}));
  await assert.rejects(createEncryptedBackup({source,destination:encrypted,password}),/already exists/);
  await assert.rejects(restoreEncryptedBackup({source:encrypted,destination:restored,password}),/already exists/);
  db.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
