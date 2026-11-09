import {DatabaseSync,backup} from 'node:sqlite';
import {randomBytes,createCipheriv,createDecipheriv,scryptSync,createHash} from 'node:crypto';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {backupKeys,backupKeysFromEnv} from '../lib/backup-keys.mjs';
import {requireFreshPath,writeFreshFile} from '../lib/recovery-io.mjs';

const LEGACY=Buffer.from('STBK01'),MAGIC=Buffer.from('STBK02');
const SCRYPT={N:16384,r:8,p:1,maxmem:64*1024*1024};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=(password,salt)=>scryptSync(password,salt,32,SCRYPT);
export function databaseIdentity(db){
 if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='deployment_identity'").get())return null;
 const rows=db.prepare('SELECT deployment_id,environment,identity_version,created_at FROM deployment_identity').all();
 if(rows.length!==1||!['sandbox','preproduction','production'].includes(rows[0].environment)||!/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(rows[0].deployment_id)||rows[0].identity_version!==1||!Number.isSafeInteger(rows[0].created_at))throw Error('Invalid snapshot deployment identity');
 return {...rows[0]};
}
export function verifyDatabase(db){
 const rows=db.prepare('PRAGMA integrity_check').all();
 if(rows.length!==1||rows[0].integrity_check!=='ok')throw Error('SQLite integrity check failed');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQLite foreign key check failed');
 return databaseIdentity(db);
}
export function decryptBackup(bytes,{password,keys,activeKeyId}={}){
 const ring=backupKeys({password,keys,activeKeyId,requireActive:false}),buf=Buffer.from(bytes);
 if(buf.length<50)throw Error('Invalid backup format');
 if(buf.subarray(0,6).equals(LEGACY)){
  if(!ring.keys.legacy)throw Error('Legacy backup decrypt key unavailable');
  const decipher=createDecipheriv('aes-256-gcm',key(ring.keys.legacy,buf.subarray(6,22)),buf.subarray(22,34));decipher.setAuthTag(buf.subarray(34,50));
  const plaintext=Buffer.concat([decipher.update(buf.subarray(50)),decipher.final()]);
  return {plaintext,format:'STBK01',manifest:null,key_id:'legacy'};
 }
 if(!buf.subarray(0,6).equals(MAGIC)||buf.length<54)throw Error('Invalid backup format');
 const length=buf.readUInt32BE(6);
 if(length<2||length>4096||buf.length<10+length+44)throw Error('Invalid backup header');
 const aad=buf.subarray(0,10+length);let manifest;
 try{manifest=JSON.parse(buf.subarray(10,10+length).toString('utf8'));}catch{throw Error('Invalid backup header');}
 if(!manifest||manifest.format!=='softtech-sqlite-backup-v2'||typeof manifest.key_id!=='string'||!Object.hasOwn(ring.keys,manifest.key_id))throw Error('Backup decrypt key unavailable');
 const offset=10+length,decipher=createDecipheriv('aes-256-gcm',key(ring.keys[manifest.key_id],buf.subarray(offset,offset+16)),buf.subarray(offset+16,offset+28));
 decipher.setAAD(aad);decipher.setAuthTag(buf.subarray(offset+28,offset+44));
 const plaintext=Buffer.concat([decipher.update(buf.subarray(offset+44)),decipher.final()]);
 // Metadata becomes trusted only after GCM authentication and plaintext verification.
 if(!Number.isSafeInteger(manifest.created_at)||manifest.created_at<0||manifest.size!==plaintext.length||manifest.sha256!==hash(plaintext))throw Error('Backup plaintext manifest mismatch');
 return {plaintext,format:'STBK02',manifest,key_id:manifest.key_id};
}
export async function createEncryptedBackup({source,destination,password,keys,activeKeyId,createdAt=Date.now()}){
 const ring=backupKeys({password,keys,activeKeyId});if(!source||!destination||!Number.isSafeInteger(createdAt)||createdAt<0)throw Error('source, destination and valid creation time required');
 await requireFreshPath(destination);const tmp=await mkdtemp(join(tmpdir(),'softtech-backup-'));let db;
 try{
  const snapshot=join(tmp,'snapshot.sqlite');db=new DatabaseSync(source,{readOnly:true});await backup(db,snapshot);db.close();db=null;
  const verified=new DatabaseSync(snapshot,{readOnly:true});let identity;
  try{identity=verifyDatabase(verified);}finally{verified.close();}
  const bytes=await readFile(snapshot),manifest={format:'softtech-sqlite-backup-v2',key_id:ring.activeKeyId,created_at:createdAt,sha256:hash(bytes),size:bytes.length,deployment_identity:identity};
  const header=Buffer.from(JSON.stringify(manifest)),length=Buffer.alloc(4);length.writeUInt32BE(header.length);
  const aad=Buffer.concat([MAGIC,length,header]),salt=randomBytes(16),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(ring.keys[ring.activeKeyId],salt),iv);cipher.setAAD(aad);
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]),data=Buffer.concat([aad,salt,iv,cipher.getAuthTag(),encrypted]);
  await writeFreshFile(destination,data);
  return {bytes:data.length,sha256:hash(data),format:'STBK02',key_id:ring.activeKeyId,manifest};
 }finally{db?.close();await rm(tmp,{recursive:true,force:true});}
}
export async function inspectEncryptedBackup(bytes,options={}){
 const result=decryptBackup(bytes,options),tmp=await mkdtemp(join(tmpdir(),'softtech-verify-'));
 try{
  const path=join(tmp,'restored.sqlite');await writeFile(path,result.plaintext,{flag:'wx',mode:0o600});
  const db=new DatabaseSync(path,{readOnly:true});let identity;
  try{identity=verifyDatabase(db);}finally{db.close();}
  if(result.manifest&&JSON.stringify(identity)!==JSON.stringify(result.manifest.deployment_identity))throw Error('Restored deployment identity differs from authenticated manifest');
  return {...result,deployment_identity:identity};
 }finally{await rm(tmp,{recursive:true,force:true});}
}
export async function restoreEncryptedBackup({source,destination,...options}){
 await requireFreshPath(destination);const result=await inspectEncryptedBackup(await readFile(source),options);
 await writeFreshFile(destination,result.plaintext);
 return {format:result.format,key_id:result.key_id,manifest:result.manifest,deployment_identity:result.deployment_identity};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,source,destination]=process.argv.slice(2);
 try{
  const ring=await backupKeysFromEnv();
  if(mode==='backup')console.log(JSON.stringify(await createEncryptedBackup({source,destination,...ring})));
  else if(mode==='restore'){const result=await restoreEncryptedBackup({source,destination,...ring});console.log(JSON.stringify({restored:destination,...result}));}
  else throw Error('Usage: node scripts/sqlite-backup.mjs backup|restore SOURCE DESTINATION');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
