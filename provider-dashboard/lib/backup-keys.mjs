import {secretFromEnv} from './recovery-io.mjs';
export function backupKeys({keys={},password,activeKeyId='legacy',requireActive=true}={}){
 if(!keys||typeof keys!=='object'||Array.isArray(keys))throw Error('Invalid backup key ring');
 const result=Object.create(null);
 for(const [id,value] of Object.entries(keys)){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)||typeof value!=='string'||value.length<24||value.length>4096)throw Error('Invalid backup key ring entry');
  result[id]=value;
 }
 if(password!==undefined){
  if(typeof password!=='string'||password.length<24||password.length>4096)throw Error('BACKUP_PASSPHRASE must be at least 24 characters');
  if(result.legacy&&result.legacy!==password)throw Error('Conflicting legacy backup keys');result.legacy=password;
 }
 if(!Object.keys(result).length||Object.keys(result).length>32)throw Error('Backup key ring must contain between 1 and 32 keys');
 if(requireActive&&(typeof activeKeyId!=='string'||!Object.hasOwn(result,activeKeyId)))throw Error('Active backup key ID missing from key ring');
 return {keys:result,activeKeyId};
}
export async function backupKeysFromEnv(env=process.env){
 let keys={};
 if(env.BACKUP_KEYS_JSON||env.BACKUP_KEYS_JSON_FILE){const encoded=await secretFromEnv(env,'BACKUP_KEYS_JSON');try{keys=JSON.parse(encoded);}catch{throw Error('Invalid BACKUP_KEYS_JSON');}}
 const password=env.BACKUP_PASSPHRASE||env.BACKUP_PASSPHRASE_FILE?await secretFromEnv(env,'BACKUP_PASSPHRASE',{minimum:24}):undefined;
 return backupKeys({keys,password,activeKeyId:env.BACKUP_ACTIVE_KEY_ID||'legacy'});
}
