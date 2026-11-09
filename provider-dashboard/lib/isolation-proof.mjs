import {createHash} from 'node:crypto';

// A deployment manifest records Railway resources actually inventoried by the
// release operator. It is configuration evidence, never an independent approval.
export function isolationReadiness(env=process.env,identity,now=Date.now()){
 const no=reason=>({ok:false,reason,scope:'separate Railway projects/services/volumes; not dedicated physical hosts'});
 let manifest;try{manifest=JSON.parse(env.CORE_ISOLATION_MANIFEST_JSON||'');}catch{return no('MANIFEST_MISSING');}
 if(manifest.version!==1||!Array.isArray(manifest.environments)||manifest.environments.length!==3)return no('MANIFEST_INVALID');
 const at=Date.parse(manifest.verified_at);if(!Number.isFinite(at)||at>now||now-at>90*86400000)return no('MANIFEST_STALE');
 const values={project:[],environment:[],service:[],volume:[],bucket:[],origin:[]};let current;
 for(const item of manifest.environments){
  if(!['sandbox','preproduction','production'].includes(item.environment))return no('ENVIRONMENT_INVALID');
  if(item.environment===identity.environment)current=item;
  for(const [type,key] of [['project','project_id'],['environment','railway_environment_id']]){
   if(typeof item[key]!=='string'||!/^[a-f0-9-]{36}$/.test(item[key]))return no('RESOURCE_ID_INVALID');values[type].push(item[key]);
  }
  for(const kind of ['core','uno','mahjong','skygate','wallet']){
   for(const [type,key] of [['service','services'],['volume','volumes']]){
    const id=item[key]?.[kind];if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))return no('RESOURCE_ID_INVALID');values[type].push(id);
   }
   let u;try{u=new URL(item.origins?.[kind]);}catch{return no('ORIGIN_MISSING');}
   if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)return no('ORIGIN_INVALID');values.origin.push(u.origin);
  }
  if(!Array.isArray(item.bucket_ids)||item.bucket_ids.length<2)return no('BACKUP_BUCKET_MISSING');
  values.bucket.push(...item.bucket_ids);
 }
 if(new Set(manifest.environments.map(x=>x.environment)).size!==3)return no('DUPLICATE_ENVIRONMENT');
 for(const [kind,ids] of Object.entries(values))if(new Set(ids).size!==ids.length)return no('SHARED_'+kind.toUpperCase());
 if(!current||current.services.core!==identity.deployment_id)return no('CURRENT_DEPLOYMENT_MISMATCH');
 for(const [key,expected] of [['RAILWAY_PROJECT_ID',current.project_id],['RAILWAY_ENVIRONMENT_ID',current.railway_environment_id],['RAILWAY_SERVICE_ID',current.services.core]])if(env[key]!==expected)return no('RUNTIME_RESOURCE_MISMATCH');
 for(const [key,kind] of [['CORE_PUBLIC_ORIGIN','core'],['UNO_PROVIDER_ORIGIN','uno'],['MAHJONG_PROVIDER_ORIGIN','mahjong'],['SKYGATE_PROVIDER_ORIGIN','skygate']])if(env[key]!==current.origins[kind])return no('RUNTIME_ORIGIN_MISMATCH');
 const allowed=String(env.CORE_ALLOWED_WALLET_ORIGINS||'').split(',').filter(Boolean);
 if(allowed.length!==1||allowed[0]!==current.origins.wallet)return no('WALLET_ORIGIN_MISMATCH');
 return {ok:true,verified_at:manifest.verified_at,manifest_sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),project_id:current.project_id,environment_id:current.railway_environment_id,scope:'separate Railway projects/services/volumes; not dedicated physical hosts'};
}
