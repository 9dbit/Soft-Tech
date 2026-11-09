import {DatabaseSync,backup} from 'node:sqlite';
import {randomBytes,createCipheriv,createDecipheriv,scryptSync,createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {backupKeys,backupKeysFromEnv} from '../lib/backup-keys.mjs';
import {requireFreshPath} from '../lib/recovery-io.mjs';
import {openBackupFile,assertBackupFileUnchanged,backupFileChunks,hashBackupFile,writeBackupChunk,publishBackupFile} from '../lib/backup-file.mjs';

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
  const snapshot=join(tmp,'snapshot.sqlite');db=new DatabaseSync(source,{readOnly:true});await backup(db,snapshot);db.close();db=null;await chmod(snapshot,0o600);
  const verified=new DatabaseSync(snapshot,{readOnly:true});let identity;
  try{identity=verifyDatabase(verified);}finally{verified.close();}
  const digest=await hashBackupFile(snapshot),manifest={format:'softtech-sqlite-backup-v2',key_id:ring.activeKeyId,created_at:createdAt,sha256:digest.sha256,size:digest.bytes,deployment_identity:identity};
  const header=Buffer.from(JSON.stringify(manifest)),length=Buffer.alloc(4);length.writeUInt32BE(header.length);
  const aad=Buffer.concat([MAGIC,length,header]),salt=randomBytes(16),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(ring.keys[ring.activeKeyId],salt),iv);cipher.setAAD(aad);
  const encrypted=await publishBackupFile(destination,async(output,path)=>{
   // STBK02 stores its GCM tag before ciphertext. Keep that exact format by
   // patching the tag in a private file before its atomic publication.
   await writeBackupChunk(output,Buffer.concat([aad,salt,iv,Buffer.alloc(16)]));
   const opened=await openBackupFile(snapshot),actual=createHash('sha256');let size=0;
   try{
    for await(const chunk of backupFileChunks(opened.file,{end:opened.before.size})){
     actual.update(chunk);size+=chunk.length;await writeBackupChunk(output,cipher.update(chunk));
    }
    await assertBackupFileUnchanged(opened.file,opened.before);
   }finally{await opened.file.close();}
   if(size!==manifest.size||actual.digest('hex')!==manifest.sha256)throw Error('Snapshot changed during encryption');
   await writeBackupChunk(output,cipher.final());await writeBackupChunk(output,cipher.getAuthTag(),aad.length+28);
   return hashBackupFile(path);
  });
  return {bytes:encrypted.bytes,sha256:encrypted.sha256,format:'STBK02',key_id:ring.activeKeyId,manifest};
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
async function readHeaderBytes(file,start,length){
 const bytes=Buffer.alloc(length);let offset=0;
 while(offset<length){const part=await file.read(bytes,offset,length-offset,start+offset);if(!part.bytesRead)throw Error('Invalid backup header');offset+=part.bytesRead;}
 return bytes;
}
async function decryptBackupToFile(source,output,options){
 const ring=backupKeys({...options,requireActive:false}),{file,before}=await openBackupFile(source);
 try{
  if(before.size<50)throw Error('Invalid backup format');
  const prefix=await readHeaderBytes(file,0,10);let offset,format,manifest=null,keyId,aad,salt,iv,tag;
  if(prefix.subarray(0,6).equals(LEGACY)){
   if(!ring.keys.legacy)throw Error('Legacy backup decrypt key unavailable');
   const header=await readHeaderBytes(file,6,44);salt=header.subarray(0,16);iv=header.subarray(16,28);tag=header.subarray(28,44);offset=50;format='STBK01';keyId='legacy';
  }else{
   if(!prefix.subarray(0,6).equals(MAGIC)||before.size<54)throw Error('Invalid backup format');
   const length=prefix.readUInt32BE(6);
   if(length<2||length>4096||before.size<10+length+44)throw Error('Invalid backup header');
   const header=await readHeaderBytes(file,10,length+44);aad=Buffer.concat([prefix,header.subarray(0,length)]);
   try{manifest=JSON.parse(header.subarray(0,length).toString('utf8'));}catch{throw Error('Invalid backup header');}
   if(!manifest||manifest.format!=='softtech-sqlite-backup-v2'||typeof manifest.key_id!=='string'||!Object.hasOwn(ring.keys,manifest.key_id))throw Error('Backup decrypt key unavailable');
   keyId=manifest.key_id;salt=header.subarray(length,length+16);iv=header.subarray(length+16,length+28);tag=header.subarray(length+28,length+44);offset=10+length+44;format='STBK02';
  }
  const decipher=createDecipheriv('aes-256-gcm',key(ring.keys[keyId],salt),iv);if(aad)decipher.setAAD(aad);decipher.setAuthTag(tag);
  const digest=createHash('sha256');let size=0;
  for await(const chunk of backupFileChunks(file,{start:offset,end:before.size})){
   const plaintext=decipher.update(chunk);digest.update(plaintext);size+=plaintext.length;await writeBackupChunk(output,plaintext);
  }
  // No destination is visible until final() authenticates the complete stream.
  const final=decipher.final();digest.update(final);size+=final.length;await writeBackupChunk(output,final);
  await assertBackupFileUnchanged(file,before);
  const plaintextHash=digest.digest('hex');
  if(manifest&&(!Number.isSafeInteger(manifest.created_at)||manifest.created_at<0||manifest.size!==size||manifest.sha256!==plaintextHash))throw Error('Backup plaintext manifest mismatch');
  return {format,key_id:keyId,manifest};
 }finally{await file.close();}
}
export async function restoreEncryptedBackup({source,destination,...options}){
 const restored=await publishBackupFile(destination,async(output,path)=>{
  const result=await decryptBackupToFile(source,output,options);await output.sync();
  const db=new DatabaseSync(path,{readOnly:true});let identity;
  try{identity=verifyDatabase(db);}finally{db.close();}
  if(result.manifest&&JSON.stringify(identity)!==JSON.stringify(result.manifest.deployment_identity))throw Error('Restored deployment identity differs from authenticated manifest');
  return {...result,deployment_identity:identity};
 });
 const {path,...result}=restored;return result;
}
export async function inspectEncryptedBackupFile(source,options={}){
 const tmp=await mkdtemp(join(tmpdir(),'softtech-verify-'));
 try{return await restoreEncryptedBackup({source,destination:join(tmp,'restored.sqlite'),...options});}
 finally{await rm(tmp,{recursive:true,force:true});}
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
