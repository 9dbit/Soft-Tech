import {randomUUID,createHash} from 'node:crypto';
import {providerBackupPrefix,canonicalBackupIdentity} from './backup-scope.mjs';
import {putEncryptedObject,readEncryptedObjectReceipt,headEncryptedObject,deleteEncryptedObject,listEncryptedObjects,strongETag} from './backup-s3.mjs';
import {inspectEncryptedBackup} from '../scripts/sqlite-backup.mjs';
import {enforceProviderRetention,RETENTION_POLICY} from './provider-retention.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');

export async function probeConditionalDeletion({identity,...options}){
 const deployment=canonicalBackupIdentity(identity),id=randomUUID(),key=providerBackupPrefix(deployment)+'retention-probe-'+id+'.probe';
 const first=Buffer.from(JSON.stringify({deployment_identity:deployment,probe:id,generation:1})),second=Buffer.from(JSON.stringify({deployment_identity:deployment,probe:id,generation:2}));
 try{
  const a=await putEncryptedObject({...options,key,payload:first});if(!strongETag(a.etag))return {verified:false,error_code:'RETENTION_PROBE_ETAG_UNAVAILABLE'};
  const b=await putEncryptedObject({...options,key,payload:second});if(!strongETag(b.etag)||a.etag===b.etag)return {verified:false,error_code:'RETENTION_PROBE_ETAG_UNAVAILABLE'};
  let rejected=false;
  try{await deleteEncryptedObject({...options,key,ifMatch:a.etag});}catch(error){if(error.httpStatus===412)rejected=true;else throw error;}
  if(!rejected)return {verified:false,error_code:'RETENTION_PROBE_CONDITION_IGNORED'};
  const read=await readEncryptedObjectReceipt({...options,key});if(read.etag!==b.etag||sha(read.bytes)!==sha(second))return {verified:false,error_code:'RETENTION_PROBE_CONTENT_CHANGED'};
  await deleteEncryptedObject({...options,key,ifMatch:b.etag});
  const gone=await headEncryptedObject({...options,key});if(gone.status!==404||gone.exists!==false)return {verified:false,error_code:'RETENTION_PROBE_DELETE_UNVERIFIED'};
  return {verified:true,wrong_etag_rejected:true,correct_etag_deleted:true,canary_absent_verified:true};
 }catch{return {verified:false,error_code:'RETENTION_PROBE_FAILED'};}
}
export async function runProviderRetention({env,result,ring,fetcher=fetch,now=new Date()}){
 const mode=env.BACKUP_RETENTION_MODE||'dry-run';
 if(result.remoteRestore!=='verified')return {policy:RETENTION_POLICY,enabled:true,mode,verified:false,conditional_delete_verified:false,deleted_count:0,error_code:'RETENTION_CURRENT_REMOTE_RESTORE_REQUIRED'};
 const identity=result.deployment_identity;
 if(!identity)return {policy:RETENTION_POLICY,enabled:true,mode,verified:false,conditional_delete_verified:false,deleted_count:0,error_code:'RETENTION_IDENTITY_REQUIRED'};
 const options={endpoint:env.BACKUP_S3_ENDPOINT,bucket:env.BACKUP_S3_BUCKET,region:env.BACKUP_S3_REGION,accessKeyId:env.BACKUP_S3_ACCESS_KEY_ID,secretAccessKey:env.BACKUP_S3_SECRET_ACCESS_KEY,urlStyle:env.BACKUP_S3_URL_STYLE||'path',fetcher};
 const prefix=providerBackupPrefix(identity);
 return enforceProviderRetention({identity,currentObject:result.key,currentCiphertextSha256:result.sha256,now:Math.floor(now.getTime()/1000),mode,probeRequested:env.BACKUP_RETENTION_PROBE==='true',maxDeletes:Number(env.BACKUP_RETENTION_MAX_DELETES||5),restoringObject:env.BACKUP_RESTORE_IN_PROGRESS_OBJECT||null,
  list:continuationToken=>listEncryptedObjects({...options,prefix,continuationToken}),
  download:key=>readEncryptedObjectReceipt({...options,key}),
  remove:(key,etag)=>{if(!key.startsWith(prefix))throw Error('RETENTION_OBJECT_SCOPE_INVALID');return deleteEncryptedObject({...options,key,ifMatch:etag});},
  verify:async bytes=>{const verified=await inspectEncryptedBackup(bytes,ring);if(verified.format!=='STBK02'||!verified.manifest)throw Error('RETENTION_UNAUTHENTICATED_LEGACY_MANIFEST');return verified.manifest;},
  checkConditionalDelete:()=>probeConditionalDeletion({identity,...options})
 });
}
