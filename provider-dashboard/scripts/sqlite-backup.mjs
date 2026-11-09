import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const MAGIC=Buffer.from('STBK01');
const KEYLEN=32;
const SCRYPT={N:16384,r:8,p:1,maxmem:64*1024*1024};
function key(password,salt){return scryptSync(password,salt,KEYLEN,SCRYPT);}
function requirePassword(password){if(typeof password!=='string'||password.length<24)throw Error('BACKUP_PASSPHRASE must be at least 24 characters');}
async function ensureMissing(file){try{await stat(file);throw Error('Destination already exists: '+file);}catch(e){if(e.code!=='ENOENT')throw e;}}
export async function createEncryptedBackup({source,destination,password}){
 requirePassword(password);if(!source||!destination)throw Error('source and destination required');
 await ensureMissing(destination);
 const tmp=await mkdtemp(join(tmpdir(),'softtech-backup-'));
 let db;
 try{
  const snapshot=join(tmp,'snapshot.sqlite');
  db=new DatabaseSync(source,{readOnly:true});
  await backup(db,snapshot);
  db.close();db=null;
  const verified=new DatabaseSync(snapshot,{readOnly:true});
  try{if(verified.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite integrity check failed');}
  finally{verified.close();}
  const bytes=await readFile(snapshot),salt=randomBytes(16),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(password,salt),iv);
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
  const data=Buffer.concat([MAGIC,salt,iv,cipher.getAuthTag(),encrypted]);
  await mkdir(dirname(resolve(destination)),{recursive:true});
  await writeFile(destination,data,{flag:'wx',mode:0o600});
  return {bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
 }finally{db?.close();await rm(tmp,{recursive:true,force:true});}
}
export async function restoreEncryptedBackup({source,destination,password}){
 requirePassword(password);await ensureMissing(destination);
 const buf=await readFile(source);
 if(buf.length<MAGIC.length+44||!buf.subarray(0,6).equals(MAGIC))throw Error('Invalid backup format');
 const salt=buf.subarray(6,22),iv=buf.subarray(22,34),tag=buf.subarray(34,50);
 const decipher=createDecipheriv('aes-256-gcm',key(password,salt),iv);decipher.setAuthTag(tag);
 const plain=Buffer.concat([decipher.update(buf.subarray(50)),decipher.final()]);
 await mkdir(dirname(resolve(destination)),{recursive:true});
 const temp=destination+'.restore-'+randomBytes(8).toString('hex');
 try{
  await writeFile(temp,plain,{flag:'wx',mode:0o600});
  const db=new DatabaseSync(temp,{readOnly:true});
  try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Restored database integrity check failed');}
  finally{db.close();}
  await ensureMissing(destination);
  await rename(temp,destination);
 }finally{await rm(temp,{force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 const [mode,source,destination]=process.argv.slice(2);
 const password=process.env.BACKUP_PASSPHRASE;
 try{
  if(mode==='backup')console.log(JSON.stringify(await createEncryptedBackup({source,destination,password})));
  else if(mode==='restore'){await restoreEncryptedBackup({source,destination,password});console.log('Restored and integrity-checked to '+destination);}
  else throw Error('Usage: node scripts/sqlite-backup.mjs backup|restore SOURCE DESTINATION');
 }catch(e){console.error(e.message);process.exitCode=1;}
}
