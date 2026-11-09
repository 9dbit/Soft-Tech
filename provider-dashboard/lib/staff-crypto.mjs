import {createHmac,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {fail} from './security.mjs';

const derive=promisify(scrypt);
const cost={N:131072,r:8,p:1,maxmem:192*1024*1024};
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let hashesInFlight=0;
const common=new Set(['passwordpassword','password12345678','1234567890123456','abcdefghijklmnop','qwertyuiopasdfgh','softtechsofttech']);

export function passwordValue(value){
 if(typeof value!=='string')fail(422,'INVALID_STAFF_PASSWORD');
 const normalized=value.normalize('NFC');
 if([...normalized].length<16||[...normalized].length>128||Buffer.byteLength(normalized)>512||/[\x00-\x1f]/.test(normalized)||common.has(normalized.toLowerCase()))fail(422,'WEAK_STAFF_PASSWORD','Use a unique password or passphrase between 16 and 128 characters.');
 return normalized;
}
async function key(password,salt){
 if(hashesInFlight>=2)fail(503,'AUTH_BUSY','Authentication is busy; retry shortly.');
 hashesInFlight++;
 try{return await derive(password,salt,64,cost);}finally{hashesInFlight--;}
}
export async function hashPassword(value){
 const password=passwordValue(value),salt=randomBytes(16),digest=await key(password,salt);
 return ['scrypt',cost.N,cost.r,cost.p,salt.toString('base64url'),digest.toString('base64url')].join('$');
}
export async function verifyPassword(value,encoded){
 const parts=String(encoded||'').split('$');
 const valid=parts.length===6&&parts[0]==='scrypt'&&parts[1]==='131072'&&parts[2]==='8'&&parts[3]==='1'&&/^[A-Za-z0-9_-]{22}$/.test(parts[4])&&/^[A-Za-z0-9_-]{86}$/.test(parts[5]);
 const salt=valid?Buffer.from(parts[4],'base64url'):Buffer.alloc(16,42);
 const expected=valid?Buffer.from(parts[5],'base64url'):Buffer.alloc(64);
 const usable=typeof value==='string'&&Buffer.byteLength(value)<=512;
 const actual=await key(usable?value.normalize('NFC'):'invalid-password-input',salt);
 return !!(valid&&usable&&timingSafeEqual(actual,expected));
}
export function base32(bytes){
 let bits=0,value=0,result='';
 for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){result+=alphabet[(value>>>(bits-5))&31];bits-=5;}}
 if(bits)result+=alphabet[(value<<(5-bits))&31];
 return result;
}
export function decodeBase32(value){
 if(typeof value!=='string'||!value.length||!/^[A-Z2-7]+$/.test(value))throw Error('Invalid TOTP secret');
 let bits=0,acc=0,bytes=[];
 for(const c of value){acc=(acc<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bytes.push((acc>>>(bits-8))&255);bits-=8;}}
 return Buffer.from(bytes);
}
export const newTotpSecret=()=>base32(randomBytes(20));
export function totp(secret,{time=Date.now(),step=Math.floor(time/30000),digits=6}={}){
 if(!Number.isSafeInteger(step)||step<0||![6,8].includes(digits))throw Error('Invalid TOTP parameters');
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
 const mac=createHmac('sha1',decodeBase32(secret)).update(counter).digest(),offset=mac[mac.length-1]&15;
 return String((mac.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');
}
export function matchTotp(secret,code,now,lastStep=-1){
 if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
 const current=Math.floor(now/30000),given=Buffer.from(code);
 for(const step of [current,current-1,current+1]){
  if(step>=0&&step>lastStep&&timingSafeEqual(Buffer.from(totp(secret,{step})),given))return step;
 }
 return null;
}
