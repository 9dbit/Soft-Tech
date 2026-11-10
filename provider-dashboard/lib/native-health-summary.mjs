// Persist the fixed health fields needed for identity and readiness. Native
// diagnostics can grow after traffic; slicing serialized JSON corrupts the
// identity record and must never be used as a storage bound.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const copyText=(target,source,key,max)=>{
 const value=source[key];
 if(typeof value==='string'&&value.length<=max)target[key]=value;
};
const copyBoolean=(target,source,key)=>{
 if(typeof source[key]==='boolean')target[key]=source[key];
};

export function nativeHealthSummary(data){
 if(!object(data))return '{}';
 const out={};
 copyBoolean(out,data,'ok');
 for(const key of ['provider','game','environment','version','engine_version'])copyText(out,data,key,100);
 if(typeof data.source_commit==='string'&&/^[a-f0-9]{40}$/.test(data.source_commit))out.source_commit=data.source_commit;
 copyText(out,data,'platform_deployment_id',100);
 if(object(data.deployment_identity)){
  const source=data.deployment_identity,identity={};
  for(const key of ['environment','deployment_id','core_deployment_id','game_id'])copyText(identity,source,key,100);
  for(const key of ['identity_bound','physical_isolation_verified','play_enabled'])copyBoolean(identity,source,key);
  if(Number.isSafeInteger(source.identity_version))identity.identity_version=source.identity_version;
  out.deployment_identity=identity;
 }
 if(object(data.native_volume)){
  const source=data.native_volume,volume={};
  for(const key of ['required','verified'])copyBoolean(volume,source,key);
  for(const key of ['verification','filesystem_type'])copyText(volume,source,key,64);
  out.native_volume=volume;
 }
 if(data.error==='engine request failed')out.error=data.error;
 return JSON.stringify(out);
}
