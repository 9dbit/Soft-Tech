import {createHash,createHmac,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createEncryptedBackup,restoreEncryptedBackup} from '../scripts/sqlite-backup.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const hmac=(k,x)=>createHmac('sha256',k).update(x).digest();
const encode=x=>encodeURIComponent(x).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const signKey=(secret,date,region)=>hmac(hmac(hmac(hmac('AWS4'+secret,date),region),'s3'),'aws4_request');
export function signS3({method='PUT',endpoint,bucket,key,region,accessKeyId,secretAccessKey,payload,now=new Date(),urlStyle='path'}){
 const url=new URL(endpoint);
 if(url.protocol!=='https:'&&process.env.NODE_ENV!=='test')throw Error('Offsite S3 endpoint must use HTTPS');
 if(url.username||url.password||url.search||url.hash)throw Error('Unexpected S3 endpoint credentials or query');
 if(!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(bucket)||!region||!accessKeyId||!secretAccessKey)throw Error('Missing S3 credentials');
 if(!/^[A-Za-z0-9/_.-]{1,250}$/.test(key)||key.includes('..'))throw Error('Invalid object key');
 if(urlStyle!=='path'&&urlStyle!=='virtual-host')throw Error('Invalid S3 URL style');
 const parts=key.split('/').map(encode).join('/');
 if(urlStyle==='virtual-host')url.hostname=bucket+'.'+url.hostname;
 url.pathname=(url.pathname.replace(/\/$/,'')||'')+'/'+(urlStyle==='path'?encode(bucket)+'/':'')+parts;
 const date=now.toISOString().replace(/[-:]|\.\d{3}/g,'').slice(0,15)+'Z';
 const dateOnly=date.slice(0,8),bodyHash=hash(payload),host=url.host;
 const headers={'host':host,'x-amz-content-sha256':bodyHash,'x-amz-date':date};
 const headerKeys=Object.keys(headers).sort(),signedHeaders=headerKeys.join(';');
 const canonical=method+'\n'+url.pathname+'\n\n'+headerKeys.map(k=>k+':'+headers[k]+'\n').join('')+'\n'+signedHeaders+'\n'+bodyHash;
 const scope=dateOnly+'/'+region+'/s3/aws4_request';
 const stringToSign='AWS4-HMAC-SHA256\n'+date+'\n'+scope+'\n'+hash(canonical);
 const signature=hmac(signKey(secretAccessKey,dateOnly,region),stringToSign).toString('hex');
 return {url:url.toString(),headers:{'x-amz-content-sha256':bodyHash,'x-amz-date':date,Authorization:'AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+', SignedHeaders='+signedHeaders+', Signature='+signature},checksum:bodyHash};
}
export async function putEncryptedObject({endpoint,bucket,region,accessKeyId,secretAccessKey,urlStyle='path',key,payload,fetcher=fetch}){
 const signed=signS3({endpoint,bucket,region,accessKeyId,secretAccessKey,urlStyle,key,payload});
 const response=await fetcher(signed.url,{method:'PUT',headers:{...signed.headers,'Content-Type':'application/octet-stream','Cache-Control':'no-store'},body:payload,redirect:'manual',signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw Error('S3 upload failed HTTP '+response.status);
 return {key,bytes:payload.length,sha256:signed.checksum};
}
export async function readEncryptedObject({endpoint,bucket,region,accessKeyId,secretAccessKey,urlStyle='path',key,fetcher=fetch}){
 const signed=signS3({method:'GET',endpoint,bucket,region,accessKeyId,secretAccessKey,urlStyle,key,payload:Buffer.alloc(0)});
 const response=await fetcher(signed.url,{method:'GET',headers:signed.headers,redirect:'manual',signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw Error('S3 restore read failed HTTP '+response.status);
 return Buffer.from(await response.arrayBuffer());
}
export async function runOffsiteBackup({env=process.env,fetcher=fetch,now=new Date()}={}){
 const source=env.CORE_DB_PATH,passphrase=env.BACKUP_PASSPHRASE;
 const bucket=env.BACKUP_S3_BUCKET,endpoint=env.BACKUP_S3_ENDPOINT,region=env.BACKUP_S3_REGION;
 const accessKeyId=env.BACKUP_S3_ACCESS_KEY_ID,secretAccessKey=env.BACKUP_S3_SECRET_ACCESS_KEY;
 if(!source||!passphrase||!bucket||!endpoint||!region||!accessKeyId||!secretAccessKey)throw Error('Offsite backup configuration incomplete');
 const tmp=await mkdtemp(join(tmpdir(),'softtech-offsite-'));
 try{
  const encrypted=join(tmp,'snapshot.stbk'),restored=join(tmp,'verified.sqlite');
  const result=await createEncryptedBackup({source,destination:encrypted,password:passphrase});
  await restoreEncryptedBackup({source:encrypted,destination:restored,password:passphrase});
  const payload=await readFile(encrypted);
  const key='provider-core/'+now.toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.stbk';
  const opts={endpoint,bucket,region,accessKeyId,secretAccessKey,urlStyle:env.BACKUP_S3_URL_STYLE||'path',key,fetcher};
  const upload=await putEncryptedObject({...opts,payload});
  let remoteRestore='not_requested';
  if(env.BACKUP_VERIFY_REMOTE==='true'){
   const remote=await readEncryptedObject(opts);
   if(hash(remote)!==upload.sha256)throw Error('Remote backup checksum mismatch');
   const remoteFile=join(tmp,'remote.stbk'),remoteRestored=join(tmp,'remote-restored.sqlite');
   await (await import('node:fs/promises')).writeFile(remoteFile,remote,{flag:'wx',mode:0o600});
   await restoreEncryptedBackup({source:remoteFile,destination:remoteRestored,password:passphrase});
   remoteRestore='verified';
  }
  return {...upload,localIntegrity:'verified',remoteRestore,encrypted:true,snapshotSha256:result.sha256};
 }finally{await rm(tmp,{recursive:true,force:true});}
}
export function startOffsiteBackup({env=process.env,onStatus=()=>{},fetcher=fetch}={}){
 if(env.OFFSITE_BACKUP_ENABLED!=='true')return {enabled:false,stop(){}};
 const interval=Number(env.OFFSITE_BACKUP_INTERVAL_HOURS||24);
 if(!Number.isFinite(interval)||interval<6||interval>168)throw Error('Backup interval must be between 6 and 168 hours');
 let running=false,stopped=false;
 const run=async()=>{
  if(running||stopped)return;
  running=true;
  try{const result=await runOffsiteBackup({env,fetcher});onStatus({ok:true,at:new Date().toISOString(),key:result.key,sha256:result.sha256,bytes:result.bytes});}
  catch(e){onStatus({ok:false,at:new Date().toISOString(),error:e.message});}
  finally{running=false;}
 };
 const timer=setInterval(run,interval*3600000);timer.unref();
 // Start after startup to avoid delaying health and deployment readiness.
 const initial=setTimeout(run,30000);initial.unref();
 return {enabled:true,stop(){stopped=true;clearTimeout(initial);clearInterval(timer);}};
}
