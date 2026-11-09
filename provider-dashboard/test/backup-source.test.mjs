import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,readFile,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Core} from '../lib/core.mjs';
import {runOffsiteBackup} from '../lib/offsite-backup.mjs';
import {random,sha} from '../lib/security.mjs';
import {restoreEncryptedBackup} from '../scripts/sqlite-backup.mjs';

test('offsite backup uses the active Core database when a symlink plus parent traversal names another SQLite file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'softtech-backup-source-'));
 let core,restored;
 try{
  const volume=join(dir,'volume'),inside=join(volume,'inside'),deep=join(inside,'deep');
  await mkdir(deep,{recursive:true});await symlink(deep,join(volume,'link'));
  // Keep the raw string: join()/resolve() would erase the regression's link/.. pair.
  const rawPath=volume+'/link/../provider.sqlite',otherPath=join(inside,'provider.sqlite');
  const other=new DatabaseSync(otherPath);
  try{other.exec("CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES('WRONG DATABASE');");}finally{other.close();}
  const otherHash=sha(await readFile(otherPath));
  const env={NODE_ENV:'production',RAILWAY_VOLUME_MOUNT_PATH:volume,CORE_DB_PATH:rawPath,
   CORE_ENVIRONMENT:'sandbox',CORE_DEPLOYMENT_ID:'backup-source-sandbox-deployment',
   PANEL_SESSION_SECRET:random(40),CORE_ENGINE_KEYS_JSON:'[]',UNO_PROVIDER_ORIGIN:'https://uno.backup-fixture.example',
   BACKUP_PASSPHRASE:random(40),BACKUP_S3_BUCKET:'softtech-backups',BACKUP_S3_ENDPOINT:'https://storage.backup-fixture.example',
   BACKUP_S3_REGION:'iad',BACKUP_S3_ACCESS_KEY_ID:'fixture-key',BACKUP_S3_SECRET_ACCESS_KEY:'fixture-secret',BACKUP_VERIFY_REMOTE:'true'};
  core=new Core({env});
  assert.equal(core.databasePath,join(volume,'provider.sqlite'));
  assert.notEqual(core.databasePath,rawPath,'the backup must receive the validated source, not the original configuration string');
  assert.equal(await realpath(rawPath),otherPath,'the original raw path must actually resolve to the wrong database');
  assert.notEqual(await realpath(rawPath),core.databasePath);
  assert.equal(core.get('PRAGMA database_list').file,core.databasePath);

  const issued=core.createOperator({name:'Backup source fixture',games:['uno-luck'],currency:'VCOIN',scale:2,initial_minor:'12345'});
  const launch=core.createLaunch(core.operator(issued.operator.id),{game_id:'uno-luck',player_ref:'backup-source-player',currency:'VCOIN'},'backup-source-launch-001');
  const expectedIdentity=core.all('SELECT * FROM deployment_identity');
  const expectedMeta=core.all('SELECT * FROM meta ORDER BY key');
  const expectedLedger=core.all('SELECT * FROM ledger ORDER BY rowid');
  assert.equal(expectedLedger.length,1);assert.equal(expectedLedger[0].kind,'sandbox_opening');
  assert.equal(expectedLedger[0].amount_minor,'12345');

  let stored,objectUrl;const methods=[];
  const result=await runOffsiteBackup({env:{...env,CORE_DB_PATH:core.databasePath},fetcher:async(url,request)=>{
   assert.equal(new URL(url).host,'storage.backup-fixture.example');
   methods.push(request.method);
   if(request.method==='PUT'){
    objectUrl=url;stored=Buffer.from(request.body);
    assert.equal(stored.includes(Buffer.from('backup-source-player')),false);
    return {ok:true,status:200};
   }
   assert.equal(request.method,'GET');assert.equal(url,objectUrl);
   return {ok:true,status:200,arrayBuffer:async()=>stored};
  }});
  assert.deepEqual(methods,['PUT','GET']);
  assert.equal(result.remoteRestore,'verified');assert.equal(result.localIntegrity,'verified');
  assert.equal(result.sha256,sha(stored));

  const archive=join(dir,'remote.stbk'),restoredPath=join(dir,'restored.sqlite');
  await writeFile(archive,stored,{flag:'wx',mode:0o600});
  await restoreEncryptedBackup({source:archive,destination:restoredPath,password:env.BACKUP_PASSPHRASE});
  restored=new DatabaseSync(restoredPath,{readOnly:true});
  assert.deepEqual(restored.prepare('SELECT * FROM deployment_identity').all(),expectedIdentity);
  assert.deepEqual(restored.prepare('SELECT * FROM meta ORDER BY key').all(),expectedMeta);
  assert.deepEqual(restored.prepare('SELECT * FROM ledger ORDER BY rowid').all(),expectedLedger);
  assert.equal(restored.prepare('SELECT operator_id FROM sessions WHERE id=?').get(launch.session_id).operator_id,issued.operator.id);
  assert.equal(restored.prepare('SELECT balance_minor FROM players WHERE player_ref=?').get('backup-source-player').balance_minor,'12345');
  assert.equal(restored.prepare("SELECT name FROM sqlite_schema WHERE name='marker'").get(),undefined);
  assert.equal(sha(await readFile(otherPath)),otherHash,'the unrelated database must remain untouched');
 }finally{restored?.close();core?.close();await rm(dir,{recursive:true,force:true});}
});
