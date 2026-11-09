// Same conservative retention policy used by native engines, scoped to one Core identity.
import {createHash} from 'node:crypto';
import {canonicalBackupIdentity,providerBackupPrefix} from './backup-scope.mjs';
import {strongETag} from './backup-s3.mjs';
export const RETENTION_POLICY='provider-7d-4w-12m-v1';
const DAY=86400,sha=value=>createHash('sha256').update(value).digest('hex');
function weekStart(seconds){const date=new Date(seconds*1000);date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));return date.getTime()/1000;}
function month(seconds){const date=new Date(seconds*1000);return date.getUTCFullYear()*12+date.getUTCMonth();}
export function providerRetentionPlan(keys,{identity,now=Math.floor(Date.now()/1000),restoringObject=null,maxDeletes=5}={}){
 const prefix=providerBackupPrefix(identity);
 if(!Number.isSafeInteger(now)||!Number.isInteger(maxDeletes)||maxDeletes<1||maxDeletes>10)throw Error('RETENTION_CONFIG_INVALID');
 const pattern=new RegExp('^'+prefix+'([0-9]{10})-([a-f0-9]{16})-([a-f0-9]{16})\\.stbk$'),records=[],ignored=[],seen=new Set();
 for(const key of keys){if(seen.has(key))throw Error('RETENTION_DUPLICATE_INVENTORY');seen.add(key);const match=typeof key==='string'&&pattern.exec(key);if(!match){ignored.push(key);continue;}const at=Number(match[1]);if(at>now)throw Error('RETENTION_FUTURE_OBJECT');records.push({key,created_at:at,hash_prefix:match[2]});}
 records.sort((a,b)=>b.created_at-a.created_at||b.key.localeCompare(a.key));
 const keep=new Set(records.slice(0,2).map(record=>record.key)),buckets=new Set(),representatives=new Set();
 if(restoringObject){if(!records.some(record=>record.key===restoringObject))throw Error('RETENTION_RESTORE_SCOPE_UNKNOWN');keep.add(restoringObject);}
 for(const record of records){
  const age=now-record.created_at;if(age<7*DAY)keep.add(record.key);
  const daily=Math.floor(now/DAY)-Math.floor(record.created_at/DAY),weekly=(weekStart(now)-weekStart(record.created_at))/(7*DAY),monthly=month(now)-month(record.created_at);
  for(const [name,index,limit] of [['day',daily,7],['week',weekly,4],['month',monthly,12]]){
   const label=name+':'+index;if(index>=0&&index<limit&&!buckets.has(label)){buckets.add(label);keep.add(record.key);if(age>=7*DAY)representatives.add(record.key);}
  }
 }
 const candidates=records.filter(record=>!keep.has(record.key)&&now-record.created_at>=7*DAY).reverse().slice(0,maxDeletes),verifyKeys=new Set([...records.slice(0,2).map(r=>r.key),...representatives,...candidates.map(r=>r.key)]);
 return {prefix,records,keep:[...keep],ignored,candidates,verifyKeys:[...verifyKeys]};
}
export async function enforceProviderRetention({identity,currentObject,currentCiphertextSha256,list,download,remove,verify,checkConditionalDelete,probeRequested=false,now=Math.floor(Date.now()/1000),restoringObject=null,mode='dry-run',maxObjects=4096,maxDeletes=5,logger=()=>{}}){
 const report={policy:RETENTION_POLICY,enabled:true,mode,verified:false,conditional_delete_verified:false,inventory_count:0,managed_count:0,retained_count:0,protected_unknown_count:0,eligible_count:0,deleted_count:0,verified_at:new Date(now*1000).toISOString()};
 try{
  const expected=canonicalBackupIdentity(identity);
  if(!['dry-run','apply'].includes(mode)||!currentObject||!/^[a-f0-9]{64}$/.test(currentCiphertextSha256)||!Number.isInteger(maxObjects)||maxObjects<1||maxObjects>4096)throw Error('RETENTION_CONFIG_INVALID');
  const keys=[],tokens=new Set();let token=null;
  do{const page=await list(token);if(!page||!Array.isArray(page.keys))throw Error('RETENTION_INVENTORY_INVALID');keys.push(...page.keys);if(keys.length>maxObjects)throw Error('RETENTION_INVENTORY_LIMIT');token=page.nextToken||null;if(token){if(tokens.has(token))throw Error('RETENTION_PAGINATION_LOOP');tokens.add(token);}}while(token);
  report.inventory_count=keys.length;if(!keys.includes(currentObject))throw Error('RETENTION_CURRENT_OBJECT_MISSING');
  const plan=providerRetentionPlan(keys,{identity:expected,now,restoringObject,maxDeletes});report.managed_count=plan.records.length;report.protected_unknown_count=plan.ignored.length;report.retained_count=plan.keep.length;report.eligible_count=plan.candidates.length;
  const required=new Set([...plan.verifyKeys,currentObject]);if(required.size>32)throw Error('RETENTION_VERIFICATION_LIMIT');
  const records=new Map(plan.records.map(record=>[record.key,record])),proofs=new Map();
  for(const key of required){
   const record=records.get(key);if(!record)throw Error('RETENTION_OBJECT_SCOPE_INVALID');
   const response=await download(key);if(!response||!Buffer.isBuffer(response.bytes))throw Error('RETENTION_DOWNLOAD_INVALID');
   const digest=sha(response.bytes);if(key===currentObject&&digest!==currentCiphertextSha256)throw Error('RETENTION_CURRENT_CIPHERTEXT_CHANGED');
   const manifest=await verify(response.bytes);
   if(!manifest||manifest.format!=='softtech-sqlite-backup-v2'||Math.floor(manifest.created_at/1000)!==record.created_at||!String(manifest.sha256).startsWith(record.hash_prefix)||JSON.stringify(canonicalBackupIdentity(manifest.deployment_identity))!==JSON.stringify(expected))throw Error('RETENTION_FOREIGN_OR_MALFORMED_MANIFEST');
   if(key===currentObject&&(now-Math.floor(manifest.created_at/1000)<0||now-Math.floor(manifest.created_at/1000)>25*3600))throw Error('RETENTION_CURRENT_BACKUP_STALE');
   proofs.set(key,{digest,etag:response.etag});
  }
  report.planned_objects=plan.candidates.map(record=>record.key);logger({event:'provider.backup.retention_plan',...report});
  if(mode==='apply'&&plan.candidates.some(record=>!strongETag(proofs.get(record.key).etag)))throw Error('RETENTION_CONDITIONAL_DELETE_UNAVAILABLE');
  if(probeRequested||mode==='apply'&&plan.candidates.length){
   if(typeof checkConditionalDelete!=='function')throw Error('RETENTION_CONDITIONAL_DELETE_UNVERIFIED');
   const proof=await checkConditionalDelete();report.conditional_delete_probe=proof;report.conditional_delete_verified=proof?.verified===true;
   if(!report.conditional_delete_verified)throw Error('RETENTION_CONDITIONAL_DELETE_UNVERIFIED');
  }
  if(mode==='apply'&&plan.candidates.length){
   for(const record of plan.candidates){await remove(record.key,proofs.get(record.key).etag);report.deleted_count++;}
  }
  report.verified=true;logger({event:'provider.backup.retention_completed',...report});return report;
 }catch(error){report.error_code=/^RETENTION_[A-Z_]+$/.test(error?.message||'')?error.message:'RETENTION_OPERATION_FAILED';logger({event:'provider.backup.retention_blocked',...report});return report;}
}
