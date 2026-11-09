/* Creates only synthetic internal qualification credentials. This is never staff
   authentication, release approval, external-operator certification or production enablement. */
import {timingSafeEqual,createHash} from 'node:crypto';
const same=(a,b)=>timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());
function need(ok,message){if(!ok)throw Error('Qualification bootstrap: '+message);}
export async function bootstrapQualification(core,{fetchImpl=fetch}={}){
 const env=core.env;if(env.CORE_QUALIFICATION_ENABLED!=='true')return {enabled:false};
 const identity=core.deploymentIdentity;need(['sandbox','preproduction'].includes(identity.environment),'production is forbidden');
 let config;try{config=JSON.parse(env.CORE_QUALIFICATION_CONFIG_JSON||'');}catch{throw Error('Qualification bootstrap: invalid protected configuration');}
 need(config.environment===identity.environment&&config.core_audience===identity.deployment_id,'identity mismatch');
 const credentials=config.operator||{},opId=credentials.id;need(typeof opId==='string'&&/^op_qualification_[-\w]{4,60}$/.test(opId),'reserved operator ID required');
 need(typeof credentials.key_id==='string'&&/^st_[-\w]{16,80}$/.test(credentials.key_id),'invalid key ID');
 for(const s of [credentials.secret,credentials.wallet_secret,config.wallet_admin_token])need(typeof s==='string'&&s.length>=40&&s.length<=256,'distinct strong credentials required');
 need(new Set([credentials.secret,credentials.wallet_secret,config.wallet_admin_token,env.PANEL_SESSION_SECRET]).size===4,'credential reuse');
 need(credentials.protocol_version===2,'v2 required');
 let wallet;try{wallet=new URL(config.wallet_url);}catch{throw Error('Qualification bootstrap: invalid wallet origin');}
 const local=env.NODE_ENV==='test'&&wallet.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(wallet.hostname);
 need((wallet.protocol==='https:'||local)&&!wallet.username&&!wallet.password&&!wallet.search&&!wallet.hash&&wallet.pathname==='/','wallet must be a dedicated origin');
 const allowlist=String(env.CORE_QUALIFICATION_WALLET_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);need(allowlist.includes(wallet.origin),'wallet origin is not explicitly allowlisted');
 const currency=config.currency||'VCOIN',scale=config.scale??2;need(currency==='VCOIN'&&scale===2,'qualification uses virtual test credits only');
 const walletURL=wallet.origin+'/wallet',now=core.clock();let existing=core.get('SELECT * FROM operators WHERE id=?',opId);
 if(!existing){
  const created=core.createOperator({name:'Soft Tech Internal Wallet Qualification',games:['uno-luck','mahjong-wild','skygate-5000'],currency,scale,wallet_mode:'seamless',wallet_url:walletURL,protocol_version:2,return_origins:[env.CORE_PUBLIC_ORIGIN],initial_minor:'0',max_stake_minor:'10000000',max_payout_minor:'1000000000000'},'system:qualification',{internal:true,id:opId});
  core.transaction(()=>{
   core.run('UPDATE api_keys SET revoked_at=? WHERE operator_id=?',now,opId);
   core.run('INSERT INTO api_keys VALUES(?,?,?,?,?,?)',credentials.key_id,opId,core.vault.seal(credentials.secret),JSON.stringify(['games:read','sessions:write','reports:read']),null,now);
   core.run('INSERT INTO api_key_protocol(key_id,version) VALUES(?,?)',credentials.key_id,2);
   core.run('UPDATE operators SET wallet_secret=? WHERE id=?',core.vault.seal(credentials.wallet_secret),opId);
   core.run('INSERT INTO operator_wallet_protocol(operator_id,version) VALUES(?,?) ON CONFLICT(operator_id) DO UPDATE SET version=excluded.version',opId,2);
   core.audit('system:qualification','qualification.operator_provisioned',opId,{environment:identity.environment,core_audience:identity.deployment_id,classification:'internal_reference_wallet',production_enabled:false});
  });
  existing=core.get('SELECT * FROM operators WHERE id=?',opId);
 }
 need(existing.internal===1&&existing.environment===identity.environment&&existing.wallet_mode==='seamless'&&existing.wallet_url===walletURL&&existing.currency===currency&&existing.scale===scale,'existing operator configuration mismatch');
 const key=core.get('SELECT * FROM api_keys WHERE id=? AND operator_id=? AND revoked_at IS NULL',credentials.key_id,opId);
 need(key&&same(core.vault.open(key.secret_box),credentials.secret),'existing API credential mismatch');
 need(same(core.vault.open(existing.wallet_secret),credentials.wallet_secret),'existing wallet credential mismatch');
 need(core.get('SELECT version FROM api_key_protocol WHERE key_id=?',credentials.key_id)?.version===2&&core.get('SELECT version FROM operator_wallet_protocol WHERE operator_id=?',opId)?.version===2,'existing protocol mismatch');
 const healthResponse=await fetchImpl(wallet.origin+'/health',{signal:AbortSignal.timeout(10000),redirect:'error'});const health=await healthResponse.json();
 need(healthResponse.ok&&health.ok===true&&health.service==='softtech-reference-wallet'&&health.classification==='internal-test-reference'&&health.production_enabled===false&&health.identity?.environment===identity.environment&&health.identity?.core_audience===identity.deployment_id,'wallet identity mismatch');
 const registration=await fetchImpl(wallet.origin+'/admin/operators',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+config.wallet_admin_token},body:JSON.stringify({operator_id:opId,secret:credentials.wallet_secret,currency,scale,protocol_version:2}),signal:AbortSignal.timeout(10000),redirect:'error'});const reply=await registration.json();
 need(registration.ok&&reply.operator_id===opId&&reply.currency===currency&&reply.scale===scale&&reply.protocol_version===2,'wallet registration mismatch');
 return {enabled:true,operator_id:opId,environment:identity.environment,core_audience:identity.deployment_id,wallet_deployment_id:health.identity.deployment_id,classification:'internal_reference_wallet',production_enabled:false};
}
