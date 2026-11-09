import {createHash,createHmac,randomBytes,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
export class Fault extends Error{constructor(status,code,message=code){super(message);this.status=status;this.code=code;}}
export const fail=(status,code,message)=>{throw new Fault(status,code,message);};
export const sha=x=>createHash('sha256').update(x).digest('hex');
export const random=(n=32)=>randomBytes(n).toString('base64url');
export function equal(a,b){return timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());}
export const mac=(secret,message)=>createHmac('sha256',secret).update(message).digest('hex');
export const canonical=(domain,method,path,timestamp,nonce,body)=>[domain,method.toUpperCase(),path,timestamp,nonce,sha(body)].join('\n');
export function signer(secret,domain,method,path,body,timestamp=String(Math.floor(Date.now()/1000)),nonce=randomBytes(16).toString('hex')){return {timestamp,nonce,signature:mac(secret,canonical(domain,method,path,timestamp,nonce,body))};}
export function vault(master){
 const key=createHash('sha256').update('softtech-v1:'+master).digest();
 return {
  seal(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(String(value),'utf8'),c.final()]);return [iv,c.getAuthTag(),data].map(x=>x.toString('base64url')).join('.');},
  open(value){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url'));const c=createDecipheriv('aes-256-gcm',key,iv);c.setAuthTag(tag);return Buffer.concat([c.update(data),c.final()]).toString('utf8');}
 };
}
export function text(value,name,{min=1,max=120,pattern=null}={}){if(typeof value!=='string'||value.length<min||value.length>max||/[\x00-\x1f]/.test(value)||pattern&&!pattern.test(value))fail(422,'INVALID_'+name.toUpperCase());return value;}
export function units(value,{zero=true,max=10n**24n}={}){if(typeof value!=='string'||!/^(0|[1-9]\d{0,24})$/.test(value))fail(422,'INVALID_AMOUNT','Amounts must be canonical integer strings in minor units');const n=BigInt(value);if(!zero&&!n||n>max)fail(422,'AMOUNT_OUT_OF_RANGE');return n;}
export function json(value){try{return JSON.parse(value);}catch{fail(400,'INVALID_JSON');}}
export function originURL(value,{allowLocal=false,pathAllowed=false}={}){
 let u;try{u=new URL(value);}catch{fail(422,'INVALID_URL');}
 const local=allowLocal&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(!(u.protocol==='https:'||local)||u.username||u.password||u.hash||u.search||(!pathAllowed&&u.pathname!=='/'))fail(422,'INVALID_URL');
 return u;
}
export function decimal(value,scale){const n=BigInt(value),f=10n**BigInt(scale);return scale?`${n/f}.${String(n%f).padStart(scale,'0')}`:String(n);}
