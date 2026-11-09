import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createEncryptedBackup,restoreEncryptedBackup} from '../scripts/sqlite-backup.mjs';
import {backupKeysFromEnv} from './backup-keys.mjs';
import {providerBackupPrefix} from './backup-scope.mjs';

import {putEncryptedObjectFile,readEncryptedObjectFile} from './backup-s3.mjs';
export {signS3,putEncryptedObject,readEncryptedObject,putEncryptedObjectFile,readEncryptedObjectFile} from './backup-s3.mjs';
import {runProviderRetention} from './provider-retention-s3.mjs';
export async function runOffsiteBackup({env=process.env,fetcher=fetch,now=new Date()}={}){
 const source=env.CORE_DB_PATH;
 const bucket=env.BACKUP_S3_BUCKET,endpoint=env.BACKUP_S3_ENDPOINT,region=env.BACKUP_S3_REGION;
 const accessKeyId=env.BACKUP_S3_ACCESS_KEY_ID,secretAccessKey=env.BACKUP_S3_SECRET_ACCESS_KEY;
 if(!source||!bucket||!endpoint||!region||!accessKeyId||!secretAccessKey)throw Error('Offsite backup configuration incomplete');
 const ring=await backupKeysFromEnv(env);
 const tmp=await mkdtemp(join(tmpdir(),'softtech-offsite-'));
 try{
  const encrypted=join(tmp,'snapshot.stbk'),restored=join(tmp,'verified.sqlite');
  const result=await createEncryptedBackup({source,destination:encrypted,...ring,createdAt:now.getTime()});
  await restoreEncryptedBackup({source:encrypted,destination:restored,...ring});
  await rm(restored);
  const identity=result.manifest.deployment_identity;
  if(env.CORE_DEPLOYMENT_ID&&identity?.deployment_id!==env.CORE_DEPLOYMENT_ID||env.CORE_ENVIRONMENT&&identity?.environment!==env.CORE_ENVIRONMENT)throw Error('Offsite backup source identity differs from configured deployment');
  const key=identity?providerBackupPrefix(identity)+Math.floor(now.getTime()/1000)+'-'+result.manifest.sha256.slice(0,16)+'-'+randomUUID().replaceAll('-','').slice(0,16)+'.stbk':'provider-core/'+now.toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.stbk';
  const opts={endpoint,bucket,region,accessKeyId,secretAccessKey,urlStyle:env.BACKUP_S3_URL_STYLE||'path',key,fetcher};
  const upload=await putEncryptedObjectFile({...opts,source:encrypted});
  if(upload.sha256!==result.sha256||upload.bytes!==result.bytes)throw Error('Local backup changed before upload');
  let remoteRestore='not_requested';
  if(env.BACKUP_VERIFY_REMOTE==='true'){
   const remoteFile=join(tmp,'remote.stbk'),remoteRestored=join(tmp,'remote-restored.sqlite');
   const remote=await readEncryptedObjectFile({...opts,destination:remoteFile});
   if(remote.sha256!==upload.sha256||remote.bytes!==upload.bytes)throw Error('Remote backup checksum mismatch');
   await restoreEncryptedBackup({source:remoteFile,destination:remoteRestored,...ring});
   remoteRestore='verified';
   await rm(remoteFile);await rm(remoteRestored);
  }
  const report={...upload,localIntegrity:'verified',remoteRestore,encrypted:true,snapshotSha256:result.manifest.sha256,key_id:result.key_id,deployment_identity:identity,manifest:result.manifest};
  if(env.BACKUP_RETENTION_ENABLED==='true')report.retention=await runProviderRetention({env,result:report,ring,fetcher,now});
  return report;
 }finally{await rm(tmp,{recursive:true,force:true});}
}
export function startOffsiteBackup({env=process.env,onStatus=()=>{},fetcher=fetch,runBackup=runOffsiteBackup,schedule=setTimeout,cancel=clearTimeout}={}){
 if(env.OFFSITE_BACKUP_ENABLED!=='true')return {enabled:false,stop(){}};
 const interval=Number(env.OFFSITE_BACKUP_INTERVAL_HOURS||24);
 if(!Number.isFinite(interval)||interval<6||interval>168)throw Error('Backup interval must be between 6 and 168 hours');
 const retry=Number(env.OFFSITE_BACKUP_RETRY_SECONDS||300);
 if(!Number.isFinite(retry)||retry<60||retry>3600)throw Error('Backup retry must be between 60 and 3600 seconds');
 let running=false,stopped=false,timer;
 const queue=delay=>{if(!stopped){timer=schedule(run,delay);timer.unref?.();}};
 const run=async()=>{
  if(running||stopped)return;
  running=true;let delay=retry*1000;
  try{const result=await runBackup({env,fetcher});onStatus({ok:true,at:new Date().toISOString(),key:result.key,sha256:result.sha256,bytes:result.bytes,remoteRestore:result.remoteRestore,key_id:result.key_id||'legacy',deployment_identity:result.deployment_identity||null,retention:result.retention||null});delay=interval*3600000;}
  catch(e){onStatus({ok:false,at:new Date().toISOString(),error:e.message});}
  finally{running=false;queue(delay);}
 };
 // Start after startup to avoid delaying health and deployment readiness.
 queue(30000);
 return {enabled:true,stop(){stopped=true;cancel(timer);}};
}
