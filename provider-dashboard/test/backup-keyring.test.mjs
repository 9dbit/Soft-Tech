import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createCipheriv,scryptSync} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,symlink,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEncryptedBackup,restoreEncryptedBackup,decryptBackup} from '../scripts/sqlite-backup.mjs';
import {backupKeysFromEnv} from '../lib/backup-keys.mjs';
import {secretFromEnv} from '../lib/recovery-io.mjs';
const password='old-backup-key-'+randomBytes(24).toString('hex'),newPassword='new-backup-key-'+randomBytes(24).toString('hex');
test('STBK02 key ring keeps old backups readable and authenticates the key ID',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-keyring-'));
 try{
  const source=join(dir,'source.sqlite'),db=new DatabaseSync(source);db.exec("CREATE TABLE test(value TEXT);INSERT INTO test VALUES('persistent record')");db.close();
  const before=join(dir,'before.stbk'),after=join(dir,'after.stbk'),keys={key_a:password,key_b:newPassword};
  const first=await createEncryptedBackup({source,destination:before,keys,activeKeyId:'key_a'}),second=await createEncryptedBackup({source,destination:after,keys,activeKeyId:'key_b'});
  assert.equal(first.key_id,'key_a');assert.equal(second.key_id,'key_b');assert.equal(first.format,'STBK02');
  await restoreEncryptedBackup({source:before,destination:join(dir,'old-restored.sqlite'),keys});
  await restoreEncryptedBackup({source:after,destination:join(dir,'new-restored.sqlite'),keys});
  await assert.rejects(restoreEncryptedBackup({source:before,destination:join(dir,'missing-key.sqlite'),keys:{key_b:newPassword}}),/key unavailable/);
  const bytes=await readFile(before),tampered=Buffer.from(bytes);const index=tampered.indexOf(Buffer.from('key_a'));assert.ok(index>0);tampered.write('key_b',index);
  // Both labels intentionally use the same key in this tamper test: AAD must still reject it.
  assert.throws(()=>decryptBackup(tampered,{keys:{key_a:password,key_b:password}}));
  const changed=Buffer.from(bytes);changed[changed.length-1]^=1;assert.throws(()=>decryptBackup(changed,{keys}));
  const dangling=join(dir,'dangling.sqlite');await symlink(join(dir,'not-created.sqlite'),dangling);
  await assert.rejects(restoreEncryptedBackup({source:after,destination:dangling,keys}),/already exists/);
  await assert.rejects(restoreEncryptedBackup({source:after,destination:source,keys}),/already exists/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('legacy STBK01 restores through retained legacy key after active-key rotation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-legacy-backup-'));
 try{
  const source=join(dir,'source.sqlite'),db=new DatabaseSync(source);db.exec("CREATE TABLE test(value TEXT);INSERT INTO test VALUES('legacy record')");db.close();
  const plain=await readFile(source),salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(password,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024}),cipher=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
  const old=join(dir,'legacy.stbk');await writeFile(old,Buffer.concat([Buffer.from('STBK01'),salt,iv,cipher.getAuthTag(),encrypted]));
  const ring={keys:{legacy:password,current:newPassword},activeKeyId:'current'},destination=join(dir,'restored.sqlite');
  const result=await restoreEncryptedBackup({source:old,destination,...ring});assert.equal(result.format,'STBK01');
  const restored=new DatabaseSync(destination,{readOnly:true});assert.equal(restored.prepare('SELECT value FROM test').get().value,'legacy record');restored.close();
  await assert.rejects(restoreEncryptedBackup({source:old,destination:join(dir,'bad.sqlite'),keys:{current:newPassword}}),/Legacy backup decrypt key unavailable/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('key-ring environment loading supports private secret files and rejects unsafe ambiguity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-secret-input-'));
 try{
  const file=join(dir,'keys.json');await writeFile(file,JSON.stringify({legacy:password,current:newPassword}),{mode:0o600});
  const ring=await backupKeysFromEnv({BACKUP_KEYS_JSON_FILE:file,BACKUP_ACTIVE_KEY_ID:'current'});assert.equal(ring.keys.legacy,password);assert.equal(ring.activeKeyId,'current');
  await chmod(file,0o644);await assert.rejects(backupKeysFromEnv({BACKUP_KEYS_JSON_FILE:file,BACKUP_ACTIVE_KEY_ID:'current'}),/private regular file/);
  await assert.rejects(secretFromEnv({VALUE:'secret',VALUE_FILE:file},'VALUE'),/either/);
  await assert.rejects(backupKeysFromEnv({BACKUP_KEYS_JSON:'{"key":"too-short"}',BACKUP_ACTIVE_KEY_ID:'key'}),/Invalid backup key ring entry/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
