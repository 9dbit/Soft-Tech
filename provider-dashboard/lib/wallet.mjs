import dns from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {originURL,signer,signerV2,units,fail} from './security.mjs';
import {WalletError,walletTransport} from './wallet-transport.mjs';
export {WalletError,walletTransportStatus} from './wallet-transport.mjs';
const blocked=new BlockList(),blocked6=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,bits,'ipv4');
for(const [ip,bits] of [['::',128],['::1',128],['::ffff:0:0',96],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32]])blocked6.addSubnet(ip,bits,'ipv6');
export function isPublicIP(ip){const n=isIP(ip);return n===4?!blocked.check(ip,'ipv4'):n===6?!blocked6.check(ip,'ipv6'):false;}
/** DNS addresses are checked and pinned for this request. Redirects are never followed. */
export async function walletCall(op,secret,action,payload,{allowLocal=false,timeout=6000,lookup=dns.lookup,transport=walletTransport}={}){
 return transport.run(async attempt=>{
 if(!['balance','debit','credit','reversal','status'].includes(action))fail(422,'INVALID_WALLET_ACTION');
 const base=originURL(op.wallet_url,{allowLocal,pathAllowed:true});
 if(base.hostname.endsWith('.local')||base.hostname.endsWith('.internal'))fail(422,'PRIVATE_CALLBACK');
 const host=base.hostname.replace(/^\[|\]$/g,'');
 const local=allowLocal&&['localhost','127.0.0.1','::1'].includes(host);
 const addresses=await attempt.resolve(lookup,host);
 if(!Array.isArray(addresses)||!addresses.length||addresses.some(a=>!a||!isIP(a.address)||a.family!==isIP(a.address)||!local&&!isPublicIP(a.address)))fail(422,'PRIVATE_CALLBACK');
 const address=addresses[0];
 const u=new URL(base);u.pathname=u.pathname.replace(/\/$/,'')+'/'+action;
 const body=JSON.stringify({...payload,currency:op.currency,scale:op.scale,operator_id:op.id});
 const version=op.wallet_protocol_version??1;
 if(version!==1&&version!==2)fail(422,'INVALID_WALLET_PROTOCOL');
 if(version===1&&op.environment&&op.environment!=='sandbox')fail(403,'LEGACY_WALLET_FORBIDDEN');
 if(version===2&&(!['sandbox','preproduction'].includes(op.environment)||!op.deployment_id))fail(403,'WALLET_IDENTITY_REQUIRED');
 const boundHeaders=version===2?{'X-Wallet-Version':'2','X-Wallet-Environment':op.environment,'X-Wallet-Audience':op.deployment_id}:{};
 const response=await attempt.request(u,address,body,()=>{
  const sig=version===2?signerV2(secret,'softtech.wallet.v2',op.environment,op.deployment_id,'POST',u.pathname,body):signer(secret,'softtech.wallet.v1','POST',u.pathname,body);
  return {'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-SoftTech-Key':'wallet-'+op.id,'X-SoftTech-Timestamp':sig.timestamp,'X-SoftTech-Nonce':sig.nonce,'X-SoftTech-Signature':sig.signature,...boundHeaders};
 });
 if(response.status<200||response.status>=300)throw new WalletError('WALLET_HTTP_'+response.status);
 let data;try{data=JSON.parse(response.body);}catch{throw new WalletError('WALLET_INVALID_JSON');}
 if(!data||typeof data!=='object'||data.currency!==op.currency||data.scale!==op.scale)throw new WalletError('WALLET_CURRENCY_MISMATCH');
 if(action==='balance'){
  try{units(data.balance_minor);}catch{throw new WalletError('WALLET_INVALID_BALANCE');}
  return data;
 }
 if(data.transaction_id!==payload.transaction_id||!['applied','rejected','not_found','pending'].includes(data.status))throw new WalletError('WALLET_INVALID_RECEIPT');
 if(data.status==='applied'){
  try{units(data.balance_minor);}catch{throw new WalletError('WALLET_INVALID_BALANCE');}
  if(action!=='status'&&data.amount_minor!==payload.amount_minor)throw new WalletError('WALLET_AMOUNT_MISMATCH');
 }
 return data;
 },{timeout});
}
