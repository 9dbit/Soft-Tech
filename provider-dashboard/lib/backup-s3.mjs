import {createHash,createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {openBackupFile,assertBackupFileUnchanged,hashOpenBackupFile,backupFileChunks,publishBackupFile,writeBackupChunk,BACKUP_CHUNK_BYTES} from './backup-file.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const encode=x=>encodeURIComponent(x).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const signKey=(secret,date,region)=>hmac(hmac(hmac(hmac('AWS4'+secret,date),region),'s3'),'aws4_request');
export const strongETag=value=>typeof value==='string'&&/^"[^"\x00-\x20\x7f,*]{1,256}"$/.test(value);
export function signS3({method='PUT',endpoint,bucket,key,region,accessKeyId,secretAccessKey,payload,payloadSha256,now=new Date(),urlStyle='path',query={},ifMatch}){
 const url=new URL(endpoint);
 if(url.protocol!=='https:'&&process.env.NODE_ENV!=='test')throw Error('Offsite S3 endpoint must use HTTPS');
 if(url.username||url.password||url.search||url.hash)throw Error('Unexpected S3 endpoint credentials or query');
 if(!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(bucket)||!region||!accessKeyId||!secretAccessKey)throw Error('Missing S3 credentials');
 const listing=method==='GET'&&key===''&&query['list-type']==='2';
 if(!listing&&(!/^[A-Za-z0-9/_.-]{1,250}$/.test(key)||key.includes('..')))throw Error('Invalid object key');
 if(urlStyle!=='path'&&urlStyle!=='virtual-host')throw Error('Invalid S3 URL style');
 if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(k=>!['list-type','prefix','continuation-token','max-keys'].includes(k)))throw Error('Invalid S3 query');
 if(Object.keys(query).length&&!listing||listing&&(!/^[A-Za-z0-9/_.-]{1,200}$/.test(query.prefix)||query.prefix.includes('..')))throw Error('Invalid listing prefix');
 if(ifMatch!==undefined&&!strongETag(ifMatch))throw Error('A strong exact ETag is required');
 const parts=key.split('/').map(encode).join('/');if(urlStyle==='virtual-host')url.hostname=bucket+'.'+url.hostname;
 url.pathname=(url.pathname.replace(/\/$/,'')||'')+'/'+(urlStyle==='path'?encode(bucket)+(key?'/':''):'')+parts;
 const canonicalQuery=Object.entries(query).map(([k,v])=>[encode(k),encode(String(v))]).sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1])).map(([k,v])=>k+'='+v).join('&');url.search=canonicalQuery;
 if(payloadSha256!==undefined&&!/^[a-f0-9]{64}$/.test(payloadSha256))throw Error('Invalid S3 payload digest');
 const date=now.toISOString().replace(/[-:]|\.\d{3}/g,'').slice(0,15)+'Z',dateOnly=date.slice(0,8),bodyHash=payloadSha256??hash(payload);
 const headers={host:url.host,'x-amz-content-sha256':bodyHash,'x-amz-date':date,...(ifMatch?{'if-match':ifMatch}:{})},headerKeys=Object.keys(headers).sort(),signedHeaders=headerKeys.join(';');
 const canonical=method+'\n'+url.pathname+'\n'+canonicalQuery+'\n'+headerKeys.map(k=>k+':'+headers[k]+'\n').join('')+'\n'+signedHeaders+'\n'+bodyHash;
 const scope=dateOnly+'/'+region+'/s3/aws4_request',stringToSign='AWS4-HMAC-SHA256\n'+date+'\n'+scope+'\n'+hash(canonical),signature=hmac(signKey(secretAccessKey,dateOnly,region),stringToSign).toString('hex');
 const {host,...out}=headers;
 return {url:url.toString(),headers:{...out,Authorization:'AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+', SignedHeaders='+signedHeaders+', Signature='+signature},checksum:bodyHash};
}
function httpError(message,status){const error=Error(message+' HTTP '+status);error.httpStatus=status;return error;}
async function sendS3(options,method,payload=Buffer.alloc(0),{payloadSha256,contentLength,streaming=false}={}){
 const signed=signS3({...options,method,payload,payloadSha256}),fetcher=options.fetcher||fetch;
 const response=await fetcher(signed.url,{method,headers:{...signed.headers,...(method==='PUT'?{'Content-Type':'application/octet-stream','Cache-Control':'no-store',...(contentLength!==undefined?{'Content-Length':String(contentLength)}:{})}:{})},...(method==='PUT'?{body:payload,...(streaming?{duplex:'half'}:{})}:{}),redirect:'manual',signal:AbortSignal.timeout(90000)});
 return {response,signed};
}
export async function putEncryptedObject(options){
 const {response,signed}=await sendS3(options,'PUT',options.payload);if(!response.ok)throw httpError('S3 upload failed',response.status);
 return {key:options.key,bytes:options.payload.length,sha256:signed.checksum,etag:response.headers?.get?.('etag')||null};
}
export async function putEncryptedObjectFile(options){
 const {file,before}=await openBackupFile(options.source);let body;
 try{
  const proof=await hashOpenBackupFile(file,before),sent=createHash('sha256');let sentBytes=0,complete=false;
  body=Readable.from((async function*(){
   for await(const chunk of backupFileChunks(file,{end:before.size})){sent.update(chunk);sentBytes+=chunk.length;yield chunk;}
   await assertBackupFileUnchanged(file,before);complete=true;
  })(),{objectMode:false,highWaterMark:BACKUP_CHUNK_BYTES});
  const bodyDone=finished(body);bodyDone.catch(()=>{});
  const {response,signed}=await sendS3(options,'PUT',body,{payloadSha256:proof.sha256,contentLength:proof.bytes,streaming:true});
  if(!response.ok){await response.body?.cancel?.();throw httpError('S3 upload failed',response.status);}
  await bodyDone;
  if(!complete||sentBytes!==proof.bytes||sent.digest('hex')!==proof.sha256)throw Error('S3 upload stream differs from signed file');
  await assertBackupFileUnchanged(file,before);await response.body?.cancel?.();
  return {key:options.key,bytes:proof.bytes,sha256:signed.checksum,etag:response.headers?.get?.('etag')||null};
 }finally{body?.destroy();await file.close();}
}
async function* responseChunks(response){
 if(!response.body||typeof response.body[Symbol.asyncIterator]!=='function')throw Error('S3 response must provide a readable body');
 for await(const chunk of response.body){if(!(chunk instanceof Uint8Array))throw Error('Invalid S3 response chunk');yield chunk;}
}
async function smallResponseBytes(response,maxBytes){
 const chunks=[];let length=0;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid S3 byte response limit');
 for await(const chunk of responseChunks(response)){length+=chunk.byteLength;if(length>maxBytes)throw Error('S3 byte response exceeds limit; use the file API');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks,length);
}
export async function readEncryptedObjectReceipt(options){
 const {response}=await sendS3(options,'GET');if(!response.ok)throw httpError('S3 restore read failed',response.status);
 return {bytes:await smallResponseBytes(response,options.maxBytes??1024*1024),etag:response.headers?.get?.('etag')||null};
}
export async function readEncryptedObject(options){return (await readEncryptedObjectReceipt(options)).bytes;}
export async function readEncryptedObjectFile(options){
 const {response}=await sendS3(options,'GET');if(!response.ok)throw httpError('S3 restore read failed',response.status);
 try{
  const result=await publishBackupFile(options.destination,async(file)=>{
   const digest=createHash('sha256');let bytes=0;
   for await(const chunk of responseChunks(response)){digest.update(chunk);bytes+=chunk.byteLength;await writeBackupChunk(file,chunk);}
   const length=response.headers?.get?.('content-length');
   if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)!==bytes))throw Error('S3 download length mismatch');
   return {bytes,sha256:digest.digest('hex'),etag:response.headers?.get?.('etag')||null};
  });
  return result;
 }finally{if(!response.body?.locked)await response.body?.cancel?.().catch(()=>{});}
}
export async function headEncryptedObject(options){
 const {response}=await sendS3(options,'HEAD');if(response.status===404)return {exists:false,status:404};
 if(!response.ok)throw httpError('S3 object check failed',response.status);
 return {exists:true,status:response.status,etag:response.headers?.get?.('etag')||null};
}
export async function deleteEncryptedObject(options){
 if(!strongETag(options.ifMatch))throw Error('A strong exact ETag is required');
 const {response}=await sendS3(options,'DELETE');if(!response.ok)throw httpError('S3 conditional deletion failed',response.status);
 return {deleted:true};
}
const unescapeXML=value=>value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,entity=>{
 const simple={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};if(simple[entity])return simple[entity];
 const code=entity.startsWith('&#x')?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);return String.fromCodePoint(code);
});
export async function listEncryptedObjects(options){
 const query={'list-type':'2',prefix:options.prefix,'max-keys':'1000',...(options.continuationToken?{'continuation-token':options.continuationToken}:{})};
 const {response}=await sendS3({...options,key:'',query},'GET');if(!response.ok)throw httpError('S3 inventory failed',response.status);
 let xml;try{xml=(await smallResponseBytes(response,2*1024*1024)).toString('utf8');}catch{throw Error('RETENTION_INVENTORY_INVALID');}
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('RETENTION_INVENTORY_INVALID');
 const keys=[...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map(match=>unescapeXML(match[1]));
 const truncated=xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/),token=xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
 if(!truncated||truncated[1]==='true'&&!token)throw Error('RETENTION_INVENTORY_INVALID');
 return {keys,nextToken:truncated[1]==='true'?unescapeXML(token[1]):null};
}
