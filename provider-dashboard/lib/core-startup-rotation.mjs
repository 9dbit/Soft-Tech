import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {equal} from './security.mjs';
import {secretFromEnv,writeFreshFile} from './recovery-io.mjs';
import {backupKeysFromEnv} from './backup-keys.mjs';
import {rotateCoreMasterKey,verifyCoreVaultFile} from './core-key-rotation.mjs';

const FORMAT='softtech-core-startup-master-rotation-v1';
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
const signature=(master,payload)=>createHmac('sha256',master).update(FORMAT+'\n'+canonical(payload)).digest('hex');
const signed=(master,payload)=>({payload,hmac_sha256:signature(master,payload)});
const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
async function regular(path,{optional=false,privateFile=false}={}){
 let file;
 try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}
 catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
 try{
  const before=await file.stat();
  if(!before.isFile()||before.nlink!==1||privateFile&&(before.mode&0o077)!==0)throw Error('Rotation paths must contain private regular files without aliases');
  return {file,before};
 }catch(e){await file.close();throw e;}
}
async function fingerprintFile(path,{optional=false}={}){
 const opened=await regular(path,{optional});if(!opened)return null;
 const {file,before}=opened;
 try{
  const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let bytes=0;
  for(;;){const part=await file.read(buffer,0,buffer.length,null);if(!part.bytesRead)break;hash.update(buffer.subarray(0,part.bytesRead));bytes+=part.bytesRead;}
  const after=await file.stat();
  if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('File changed during rotation verification');
  return {bytes,sha256:hash.digest('hex')};
 }finally{await file.close();}
}
async function sourceFingerprint(source){
 if(await exists(source+'-journal'))throw Error('Source has a rollback journal; recover and quiesce it before rotation');
 return {database:await fingerprintFile(source),wal:await fingerprintFile(source+'-wal',{optional:true})};
}
async function readSigned(path,master){
 const {file,before}=await regular(path,{privateFile:true});
 try{
  if(before.size>65536)throw Error('Rotation receipt is too large');
  const record=JSON.parse(await file.readFile('utf8'));
  if(!record?.payload||typeof record.hmac_sha256!=='string'||!equal(record.hmac_sha256,signature(master,record.payload)))throw Error('Rotation receipt authentication failed');
  return record.payload;
 }finally{await file.close();}
}
async function pathsFromEnv(env){
 for(const name of ['CORE_MASTER_ROTATION_SOURCE_PATH','CORE_DB_PATH','CORE_MASTER_ROTATION_ROLLBACK_PATH'])if(typeof env[name]!=='string'||!env[name])throw Error(name+' is required for startup rotation');
 const paths={source:resolve(env.CORE_MASTER_ROTATION_SOURCE_PATH),destination:resolve(env.CORE_DB_PATH),rollback:resolve(env.CORE_MASTER_ROTATION_ROLLBACK_PATH),receipt:resolve(env.CORE_MASTER_ROTATION_RECEIPT_PATH||env.CORE_DB_PATH+'.rotation.json')};
 paths.preparation=paths.receipt+'.preparing';
 if(new Set(Object.values(paths)).size!==5)throw Error('All rotation paths must be distinct');
 const directory=dirname(paths.destination),physicalDirectory=await realpath(directory);
 if(directory!==physicalDirectory||Object.values(paths).some(path=>dirname(path)!==directory))throw Error('Rotation paths must share one physical volume directory without symlinks');
 if(env.RAILWAY_VOLUME_MOUNT_PATH&&await realpath(env.RAILWAY_VOLUME_MOUNT_PATH)!==directory)throw Error('Rotation paths must be on the attached Railway volume');
 for(const path of Object.values(paths))if(await exists(path)){
  const opened=await regular(path,{privateFile:true});await opened.file.close();
 }
 return paths;
}
function matchPayload(payload,{paths,deploymentId,environment,state}){
 if(payload?.format!==FORMAT||payload.state!==state||payload.deployment_id!==deploymentId||payload.environment!==environment||canonical(payload.paths)!==canonical(paths)||typeof payload.attempt_id!=='string'||!payload.source_fingerprint?.database?.sha256)throw Error('Rotation receipt configuration or deployment identity mismatch');
}
async function verifyCompleted({env,paths,master,preparation,receipt}){
 const expected={paths,deploymentId:env.CORE_DEPLOYMENT_ID,environment:env.CORE_ENVIRONMENT};
 matchPayload(preparation,{...expected,state:'preparing'});matchPayload(receipt,{...expected,state:'completed'});
 if(receipt.attempt_id!==preparation.attempt_id||canonical(receipt.source_fingerprint)!==canonical(preparation.source_fingerprint)||typeof receipt.rotation_id!=='string')throw Error('Rotation completion does not match its preparation');
 if(canonical(await sourceFingerprint(paths.source))!==canonical(receipt.source_fingerprint))throw Error('Frozen original database changed after rotation; refuse stale cutover');
 const rollback=await fingerprintFile(paths.rollback);
 if(rollback.sha256!==receipt.rollback_sha256)throw Error('Rotation rollback checkpoint changed');
 for(const suffix of ['-wal','-shm','-journal'])if(await exists(paths.destination+suffix)){const opened=await regular(paths.destination+suffix);await opened.file.close();}
 const proof=verifyCoreVaultFile({source:paths.destination,master,deploymentId:env.CORE_DEPLOYMENT_ID,environment:env.CORE_ENVIRONMENT,rotationId:receipt.rotation_id});
 // The active DB is allowed to change after cutover. Its initial byte hash is historical evidence only.
 return {enabled:true,prepared:false,verified:true,rotation_id:receipt.rotation_id,deployment_identity:proof.deployment_identity,database_path:paths.destination,receipt_path:paths.receipt,rollback_path:paths.rollback,frozen_source_verified:true,rollback_checkpoint_verified:true,encrypted_values_verified:proof.encrypted_values_verified};
}
function runtimeEnv(env,master){
 const result={...env,PANEL_SESSION_SECRET:master};
 for(const name of ['PANEL_SESSION_SECRET_FILE','CORE_OLD_MASTER_SECRET','CORE_OLD_MASTER_SECRET_FILE','CORE_NEW_MASTER_SECRET','CORE_NEW_MASTER_SECRET_FILE'])delete result[name];
 return result;
}

export async function prepareCoreStartup({env=process.env}={}){
 if(env.CORE_MASTER_ROTATION_ON_START!=='true'){
  if(env.CORE_MASTER_ROTATION_ON_START&&env.CORE_MASTER_ROTATION_ON_START!=='false')throw Error('Invalid CORE_MASTER_ROTATION_ON_START flag');
  return {env:{...env},report:{enabled:false}};
 }
 if(env.CORE_ENVIRONMENT!=='preproduction')throw Error('Automatic startup master rotation is restricted to preproduction');
 if(typeof env.CORE_DEPLOYMENT_ID!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(env.CORE_DEPLOYMENT_ID))throw Error('Explicit deployment identity is required for startup rotation');
 const paths=await pathsFromEnv(env),master=await secretFromEnv(env,'PANEL_SESSION_SECRET',{minimum:32});
 const hasPreparation=await exists(paths.preparation),hasReceipt=await exists(paths.receipt);
 if(hasPreparation||hasReceipt){
  if(!hasPreparation||!hasReceipt)throw Error('Incomplete rotation preparation; manual recovery is required before startup');
  const preparation=await readSigned(paths.preparation,master),receipt=await readSigned(paths.receipt,master);
  const report=await verifyCompleted({env,paths,master,preparation,receipt});
  return {env:runtimeEnv(env,master),report};
 }
 for(const path of [paths.destination,paths.rollback,paths.destination+'-wal',paths.destination+'-shm',paths.destination+'-journal'])if(await exists(path))throw Error('Unmarked rotation output or checkpoint already exists');
 if(env.CORE_MASTER_ROTATION_OFFLINE!=='true')throw Error('Initial startup rotation requires the offline single-writer acknowledgement');
 const oldMaster=await secretFromEnv(env,'CORE_OLD_MASTER_SECRET',{minimum:32});
 if(equal(master,oldMaster))throw Error('New runtime master key must differ from the old key');
 if(env.CORE_NEW_MASTER_SECRET||env.CORE_NEW_MASTER_SECRET_FILE){const explicit=await secretFromEnv(env,'CORE_NEW_MASTER_SECRET',{minimum:32});if(!equal(explicit,master))throw Error('CORE_NEW_MASTER_SECRET must equal the new PANEL_SESSION_SECRET');}
 const keys=await backupKeysFromEnv(env);
 // Validate configuration and old key before placing the durable preparation barrier.
 verifyCoreVaultFile({source:paths.source,master:oldMaster,deploymentId:env.CORE_DEPLOYMENT_ID,environment:env.CORE_ENVIRONMENT});
 const preparation={format:FORMAT,state:'preparing',attempt_id:randomUUID(),prepared_at:Date.now(),deployment_id:env.CORE_DEPLOYMENT_ID,environment:env.CORE_ENVIRONMENT,paths,source_fingerprint:await sourceFingerprint(paths.source),source_commit:env.RAILWAY_GIT_COMMIT_SHA||'local'};
 await writeFreshFile(paths.preparation,Buffer.from(JSON.stringify(signed(master,preparation))+'\n'));
 const result=await rotateCoreMasterKey({source:paths.source,destination:paths.destination,rollbackDestination:paths.rollback,oldMaster,newMaster:master,...keys,deploymentId:env.CORE_DEPLOYMENT_ID,environment:env.CORE_ENVIRONMENT,offline:true});
 if(canonical(await sourceFingerprint(paths.source))!==canonical(preparation.source_fingerprint))throw Error('Source changed during startup rotation; manual recovery is required');
 const receipt={...preparation,state:'completed',completed_at:Date.now(),rotation_id:result.rotation_id,initial_output_sha256:result.output_sha256,rollback_sha256:result.rollback_sha256,backup_key_id:result.backup_key_id,rewrapped:result.rewrapped,revoked:result.revoked,old_master_rejected:result.old_master_rejected};
 // Atomic publication is the completion boundary. A crash before this is never retried automatically.
 await writeFreshFile(paths.receipt,Buffer.from(JSON.stringify(signed(master,receipt))+'\n'));
 const report=await verifyCompleted({env,paths,master,preparation,receipt});
 return {env:runtimeEnv(env,master),report:{...report,prepared:true,old_master_rejected:true,rewrapped:result.rewrapped,revoked:result.revoked}};
}
