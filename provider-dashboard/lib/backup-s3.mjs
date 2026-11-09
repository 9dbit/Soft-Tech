import {createHash,createHmac} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const encode=x=>encodeURIComponent(x).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const signKey=(secret,date,region)=>hmac(hmac(hmac(hmac('AWS4'+secret,date),region),'s3'),'aws4_request');
export const strongETag=value=>typeof value==='string'&&/^"[^"\x00-\x20\x7f,*]{1,256}"$/.test(value);
export function signS3({method='PUT',endpoint,bucket,key,region,accessKeyId,secretAccessKey,payload,now=new Date(),urlStyle='path',query={},ifMatch}){
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
 const date=now.toISOString().replace(/[-:]|\.\d{3}/g,'').slice(0,15)+'Z',dateOnly=date.slice(0,8),bodyHash=hash(payload);
 const headers={host:url.host,'x-amz-content-sha256':bodyHash,'x-amz-date':date,...(ifMatch?{'if-match':ifMatch}:{})},headerKeys=Object.keys(headers).sort(),signedHeaders=headerKeys.join(';');
 const canonical=method+'\n'+url.pathname+'\n'+canonicalQuery+'\n'+headerKeys.map(k=>k+':'+headers[k]+'\n').join('')+'\n'+signedHeaders+'\n'+bodyHash;
 const scope=dateOnly+'/'+region+'/s3/aws4_request',stringToSign='AWS4-HMAC-SHA256\n'+date+'\n'+scope+'\n'+hash(canonical),signature=hmac(signKey(secretAccessKey,dateOnly,region),stringToSign).toString('hex');
 const {host,...out}=headers;
 return {url:url.toString(),headers:{...out,Authorization:'AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+', SignedHeaders='+signedHeaders+', Signature='+signature},checksum:bodyHash};
}
function httpError(message,status){const error=Error(message+' HTTP '+status);error.httpStatus=status;return error;}
async function sendS3(options,method,payload=Buffer.alloc(0)){
 const signed=signS3({...options,method,payload}),fetcher=options.fetcher||fetch;
 const response=await fetcher(signed.url,{method,headers:{...signed.headers,...(method==='PUT'?{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}:{})},...(method==='PUT'?{body:payload}:{}),redirect:'manual',signal:AbortSignal.timeout(90000)});
 return {response,signed};
}
export async function putEncryptedObject(options){
 const {response,signed}=await sendS3(options,'PUT',options.payload);if(!response.ok)throw httpError('S3 upload failed',response.status);
 return {key:options.key,bytes:options.payload.length,sha256:signed.checksum,etag:response.headers?.get?.('etag')||null};
}
export async function readEncryptedObjectReceipt(options){
 const {response}=await sendS3(options,'GET');if(!response.ok)throw httpError('S3 restore read failed',response.status);
 return {bytes:Buffer.from(await response.arrayBuffer()),etag:response.headers?.get?.('etag')||null};
}
export async function readEncryptedObject(options){return (await readEncryptedObjectReceipt(options)).bytes;}
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
 const xml=await response.text();if(xml.length>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('RETENTION_INVENTORY_INVALID');
 const keys=[...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map(match=>unescapeXML(match[1]));
 const truncated=xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/),token=xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
 if(!truncated||truncated[1]==='true'&&!token)throw Error('RETENTION_INVENTORY_INVALID');
 return {keys,nextToken:truncated[1]==='true'?unescapeXML(token[1]):null};
}
