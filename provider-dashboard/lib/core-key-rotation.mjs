import {DatabaseSync,backup} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm,readFile,chmod,realpath,open} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {vault,equal} from './security.mjs';
import {requireFreshPath,publishFreshFile} from './recovery-io.mjs';
import {createEncryptedBackup,restoreEncryptedBackup,verifyDatabase} from '../scripts/sqlite-backup.mjs';

export const CORE_VAULT_FIELDS=Object.freeze([
 ['operators','wallet_secret'],['api_keys','secret_box'],['sessions','launch_box'],
 ['idempotency','response_box'],['staff_users','totp_secret_box'],['staff_enrollments','secret_box']
]);
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const sha=value=>createHash('sha256').update(value).digest('hex');
const exists=(db,table)=>!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table);
const columns=(db,table)=>db.prepare('PRAGMA table_info('+quote(table)+')').all();
function fields(db){
 const known=new Set(CORE_VAULT_FIELDS.map(x=>x.join('.'))),found=[];
 for(const table of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
  for(const column of columns(db,table.name))if(column.name.endsWith('_box')&&!known.has(table.name+'.'+column.name))throw Error('Unrecognized encrypted field: '+table.name+'.'+column.name);
 }
 for(const [table,column] of CORE_VAULT_FIELDS)if(exists(db,table)&&columns(db,table).some(c=>c.name===column))found.push([table,column]);
 return found;
}
function secretCheck(value,name){if(typeof value!=='string'||value.length<32||value.length>4096)throw Error(name+' must be at least 32 characters');}
function identityCheck(db,{deploymentId,environment}){
 if(!deploymentId||!['sandbox','preproduction','production'].includes(environment))throw Error('Explicit expected deployment ID and environment are required');
 const identity=verifyDatabase(db);
 if(!identity||identity.deployment_id!==deploymentId||identity.environment!==environment)throw Error('Rotation deployment identity mismatch');
 return identity;
}
function vaultProof(db,master){
 const cipher=vault(master),sentinel=db.prepare("SELECT value FROM meta WHERE key='vault_check'").get();
 if(!sentinel||cipher.open(sentinel.value)!=='softtech-core-v1')throw Error('Old master key does not open the Core vault');
 const proofs={};
 for(const [table,column] of fields(db)){
  for(const row of db.prepare('SELECT rowid AS source_rowid,'+quote(column)+' AS ciphertext FROM '+quote(table)+' WHERE '+quote(column)+' IS NOT NULL ORDER BY rowid').all())proofs[table+'.'+column+':'+row.source_rowid]=sha(cipher.open(row.ciphertext));
 }
 return proofs;
}
function applicationFingerprint(db,excludedAuditId,{rollback=false}={}){
 const digest=createHash('sha256'),encrypted=new Set(CORE_VAULT_FIELDS.map(x=>x.join('.')));
 const ignoredTables=new Set(['panel_sessions','staff_auth_challenges']);
 const mutable=new Set(['staff_users.auth_version','staff_users.updated_at','staff_sessions.revoked_at','staff_enrollments.expires_at','staff_invitations.used_at']);
 if(rollback){mutable.add('staff_users.totp_last_step');mutable.add('staff_recovery_codes.used_at');}
 for(const {name} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
  if(ignoredTables.has(name))continue;
  const selected=columns(db,name).map(c=>c.name).filter(c=>!encrypted.has(name+'.'+c)&&!mutable.has(name+'.'+c));
  digest.update(name+'\n');
  for(const row of db.prepare('SELECT '+selected.map(quote).join(',')+' FROM '+quote(name)+' ORDER BY rowid').all()){
   if(name==='meta'&&['vault_check','master_rotation_id','master_rotated_at'].includes(row.key))continue;
   if(name==='audit'&&row.id===excludedAuditId)continue;
   digest.update(JSON.stringify(row)+'\n');
  }
 }
 return digest.digest('hex');
}
function revokePanelAuthority(db,now,{rollback=false}={}){
 const result={};
 if(exists(db,'panel_sessions'))result.panel_sessions=Number(db.prepare('DELETE FROM panel_sessions').run().changes);
 if(exists(db,'staff_sessions'))result.staff_sessions=Number(db.prepare('UPDATE staff_sessions SET revoked_at=? WHERE revoked_at IS NULL').run(now).changes);
 if(exists(db,'staff_auth_challenges'))result.staff_challenges=Number(db.prepare('DELETE FROM staff_auth_challenges').run().changes);
 // Retain pending enrollment rows as authenticated evidence, but make every token unusable.
 if(exists(db,'staff_enrollments'))result.staff_enrollments=Number(db.prepare('UPDATE staff_enrollments SET expires_at=MIN(expires_at,?)').run(now-1).changes);
 if(exists(db,'staff_invitations'))result.staff_invitations=Number(db.prepare('UPDATE staff_invitations SET used_at=? WHERE used_at IS NULL').run(now).changes);
 if(exists(db,'staff_users'))result.staff_credentials=Number(db.prepare('UPDATE staff_users SET auth_version=auth_version+1,updated_at=?').run(now).changes);
 if(rollback){
  // A restored checkpoint cannot know OTP/recovery uses after it was created.
  if(exists(db,'staff_users')){result.totp_replay_floor=Math.floor(now/30000)+1;db.prepare('UPDATE staff_users SET totp_last_step=MAX(totp_last_step,?) WHERE totp_secret_box IS NOT NULL').run(result.totp_replay_floor);}
  if(exists(db,'staff_recovery_codes'))result.recovery_codes=Number(db.prepare('UPDATE staff_recovery_codes SET used_at=? WHERE used_at IS NULL').run(now).changes);
 }
 return result;
}
async function finishDatabase(db,path){
 verifyDatabase(db);db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');db.close();await chmod(path,0o600);
 const file=await open(path,'r');try{await file.sync();}finally{await file.close();}
}
export async function rotateCoreMasterKey({source,destination,rollbackDestination,oldMaster,newMaster,keys,password,activeKeyId,deploymentId,environment,offline=false,now=Date.now()}){
 if(offline!==true)throw Error('Offline preparation requires an explicit offline acknowledgement');
 secretCheck(oldMaster,'CORE_OLD_MASTER_SECRET');secretCheck(newMaster,'CORE_NEW_MASTER_SECRET');
 if(equal(oldMaster,newMaster))throw Error('New master key must differ from the old key');
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid rotation time');
 const target=await requireFreshPath(destination),rollback=await requireFreshPath(rollbackDestination),original=await realpath(source);
 if(target===rollback||target===original||rollback===original)throw Error('Rotation paths must be distinct');
 await mkdir(dirname(target),{recursive:true,mode:0o700});const tmp=await mkdtemp(join(dirname(target),'.core-rotation-')),snapshot=join(tmp,'rotated.sqlite'),rollbackVerify=join(tmp,'rollback-verified.sqlite');
 let reader,db;
 try{
  reader=new DatabaseSync(original,{readOnly:true});const sourceVersion=reader.prepare('PRAGMA data_version').get().data_version;
  identityCheck(reader,{deploymentId,environment});vaultProof(reader,oldMaster);
  await backup(reader,snapshot);db=new DatabaseSync(snapshot);db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
  const identity=identityCheck(db,{deploymentId,environment}),proofs=vaultProof(db,oldMaster),rotationId=randomUUID(),before=applicationFingerprint(db,rotationId);
  const checkpoint=await createEncryptedBackup({source:snapshot,destination:rollback,password,keys,activeKeyId,createdAt:now});
  await restoreEncryptedBackup({source:rollback,destination:rollbackVerify,password,keys,activeKeyId});
  const rollbackDb=new DatabaseSync(rollbackVerify,{readOnly:true});
  try{identityCheck(rollbackDb,{deploymentId,environment});if(applicationFingerprint(rollbackDb,rotationId)!==before||JSON.stringify(vaultProof(rollbackDb,oldMaster))!==JSON.stringify(proofs))throw Error('Rollback checkpoint verification failed');}finally{rollbackDb.close();}
  const oldVault=vault(oldMaster),newVault=vault(newMaster),rewrapped={};let revoked;
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const [table,column] of fields(db)){
    const rows=db.prepare('SELECT rowid AS source_rowid,'+quote(column)+' AS ciphertext FROM '+quote(table)+' WHERE '+quote(column)+' IS NOT NULL').all();
    const update=db.prepare('UPDATE '+quote(table)+' SET '+quote(column)+'=? WHERE rowid=?');
    for(const row of rows)update.run(newVault.seal(oldVault.open(row.ciphertext)),row.source_rowid);
    rewrapped[table+'.'+column]=rows.length;
   }
   db.prepare("UPDATE meta SET value=? WHERE key='vault_check'").run(newVault.seal('softtech-core-v1'));
   db.prepare("INSERT INTO meta(key,value) VALUES('master_rotation_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(rotationId);
   db.prepare("INSERT INTO meta(key,value) VALUES('master_rotated_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now));
   revoked=revokePanelAuthority(db,now);
   db.prepare('INSERT INTO audit(id,actor,event,scope,detail_json,created_at) VALUES(?,?,?,?,?,?)').run(rotationId,'maintenance:offline-key-rotation','vault.master_rotated',deploymentId,JSON.stringify({rotation_id:rotationId,rewrapped,revoked,rollback_ciphertext_sha256:checkpoint.sha256}),now);
   if(applicationFingerprint(db,rotationId)!==before||JSON.stringify(vaultProof(db,newMaster))!==JSON.stringify(proofs))throw Error('Rotated application data verification failed');
   let oldAccepted=false;try{oldAccepted=vault(oldMaster).open(db.prepare("SELECT value FROM meta WHERE key='vault_check'").get().value)==='softtech-core-v1';}catch{}
   if(oldAccepted)throw Error('Old master key still opens the rotated vault');
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  if(reader.prepare('PRAGMA data_version').get().data_version!==sourceVersion)throw Error('Source changed during offline preparation; repeat after quiescing writes');
  await finishDatabase(db,snapshot);db=null;
  if(reader.prepare('PRAGMA data_version').get().data_version!==sourceVersion)throw Error('Source changed during offline preparation; repeat after quiescing writes');
  const outputHash=sha(await readFile(snapshot));await publishFreshFile(snapshot,target);
  return {rotation_id:rotationId,destination:target,output_sha256:outputHash,rollback_destination:rollback,rollback_sha256:checkpoint.sha256,backup_key_id:checkpoint.key_id,deployment_identity:identity,rewrapped,revoked,integrity_verified:true,vault_plaintexts_preserved:true,old_master_rejected:true,source_written:false,requires_operator_cutover:true};
 }finally{db?.close();reader?.close();await rm(tmp,{recursive:true,force:true});}
}
export async function prepareCoreRollback({source,destination,master,password,keys,activeKeyId,deploymentId,environment,offline=false,now=Date.now()}){
 if(offline!==true)throw Error('Rollback preparation requires an explicit offline acknowledgement');
 secretCheck(master,'CORE_OLD_MASTER_SECRET');const target=await requireFreshPath(destination);
 await mkdir(dirname(target),{recursive:true,mode:0o700});const tmp=await mkdtemp(join(dirname(target),'.core-rollback-')),path=join(tmp,'rollback.sqlite');let db;
 try{
  await restoreEncryptedBackup({source,destination:path,password,keys,activeKeyId});db=new DatabaseSync(path);
  const identity=identityCheck(db,{deploymentId,environment}),proofs=vaultProof(db,master),id=randomUUID(),before=applicationFingerprint(db,id,{rollback:true});let revoked;
  db.exec('BEGIN IMMEDIATE');
  try{revoked=revokePanelAuthority(db,now,{rollback:true});db.prepare('INSERT INTO audit(id,actor,event,scope,detail_json,created_at) VALUES(?,?,?,?,?,?)').run(id,'maintenance:offline-rollback','vault.rollback_prepared',deploymentId,JSON.stringify({revoked}),now);if(applicationFingerprint(db,id,{rollback:true})!==before||JSON.stringify(vaultProof(db,master))!==JSON.stringify(proofs))throw Error('Rollback application verification failed');db.exec('COMMIT');}
  catch(error){db.exec('ROLLBACK');throw error;}
  await finishDatabase(db,path);db=null;const digest=sha(await readFile(path));await publishFreshFile(path,target);
  return {destination:target,sha256:digest,deployment_identity:identity,revoked,integrity_verified:true,requires_operator_cutover:true,source_written:false};
 }finally{db?.close();await rm(tmp,{recursive:true,force:true});}
}
