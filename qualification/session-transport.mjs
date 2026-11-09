// One real keep-alive HTTP connection per virtual user. It is created by that
// user's launch request, never by a preplay or a request outside the workload.
import https from 'node:https';
import http from 'node:http';
import {createSecureContext} from 'node:tls';
import {createGunzip,createInflate,createBrotliDecompress} from 'node:zlib';

let secureContext;
export class SessionTransport {
 constructor(origin,{allowLocal=false}={}){const u=new URL(origin);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('SESSION_TRANSPORT_ORIGIN_INVALID');if(u.protocol!=='https:'&&!(allowLocal&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('SESSION_TRANSPORT_HTTPS_REQUIRED');this.origin=u.origin;this.https=u.protocol==='https:';this.closed=false;
  // Reusing a default-trust SSLContext avoids reparsing trust roots per VU.
  // Certificate chain and hostname validation remain enabled on every socket.
  const options={keepAlive:true,maxSockets:1,maxTotalSockets:1,maxFreeSockets:1,scheduling:'lifo',maxCachedSessions:1,rejectUnauthorized:true};
  if(this.https)options.secureContext=secureContext??=createSecureContext();
  this.agent=this.https?new https.Agent(options):new http.Agent(options);
 }
 async request(url,{method='GET',headers={},body,timeout=45000,expectJSON=true,trace}={}){if(this.closed)throw Error('SESSION_TRANSPORT_CLOSED');const u=new URL(url);if(u.origin!==this.origin||u.username||u.password)throw Error('SESSION_TRANSPORT_ORIGIN_MISMATCH');const signal=AbortSignal.timeout(timeout),started=performance.now();
  try{return await new Promise((resolve,reject)=>{const req=(this.https?https:http).request(u,{agent:this.agent,method,headers:{'accept':'*/*','accept-encoding':'gzip, deflate, br',...headers},signal},res=>{
    trace?.headers();const responseHeaders=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)responseHeaders.append(res.rawHeaders[i],res.rawHeaders[i+1]);
    if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.destroy();reject(Error('REDIRECT_FORBIDDEN'));return;}
    const encoding=String(res.headers['content-encoding']||'identity').toLowerCase();let stream=res;
    if(encoding==='gzip')stream=res.pipe(createGunzip());else if(encoding==='deflate')stream=res.pipe(createInflate());else if(encoding==='br')stream=res.pipe(createBrotliDecompress());else if(encoding!=='identity'){res.destroy();reject(Error('UNSUPPORTED_RESPONSE_ENCODING'));return;}
    const chunks=[];res.once('error',reject);res.once('aborted',()=>reject(Error('RESPONSE_INCOMPLETE')));stream.once('error',e=>{res.destroy();reject(e);});stream.on('data',chunk=>chunks.push(chunk));stream.once('end',()=>{try{if(!res.complete)throw Error('RESPONSE_INCOMPLETE');const text=Buffer.concat(chunks).toString('utf8');let data;try{data=JSON.parse(text);}catch{if(expectJSON)throw Error('NON_JSON_RESPONSE');data=text;}resolve({status:res.statusCode,ok:res.statusCode>=200&&res.statusCode<300,data,headers:responseHeaders,duration_ms:performance.now()-started});}catch(e){reject(e);}});
   });req.once('finish',()=>trace?.sent(req.socket));req.once('error',reject);req.end(body);});}catch(e){if(signal.aborted)throw signal.reason;throw e;}
 }
 close(){if(!this.closed){this.closed=true;this.agent.destroy();}}
}
