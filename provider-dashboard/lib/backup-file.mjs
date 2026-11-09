import {constants} from 'node:fs';
import {open,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {requireFreshPath,publishFreshFile} from './recovery-io.mjs';

// Every archive path uses bounded chunks. Byte APIs are reserved for callers
// that already hold a small payload (for example the retention canary).
export const BACKUP_CHUNK_BYTES=64*1024;
export async function openBackupFile(path){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await file.stat();
  if(!before.isFile()||!Number.isSafeInteger(before.size))throw Error('Backup source must be a regular file');
  return {file,before};
 }catch(error){await file.close();throw error;}
}
export async function assertBackupFileUnchanged(file,before){
 const after=await file.stat();
 if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.ino!==before.ino||after.dev!==before.dev)throw Error('Backup file changed while being read');
}
export async function* backupFileChunks(file,{start=0,end}={}){
 const limit=end??(await file.stat()).size;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(limit)||start<0||limit<start)throw Error('Invalid backup file range');
 for(let position=start;position<limit;){
  // A fresh chunk is necessary when an HTTP consumer retains the previous one.
  const buffer=Buffer.allocUnsafe(Math.min(BACKUP_CHUNK_BYTES,limit-position));
  const {bytesRead}=await file.read(buffer,0,buffer.length,position);
  if(!bytesRead)throw Error('Truncated backup file');
  position+=bytesRead;yield buffer.subarray(0,bytesRead);
 }
}
export async function hashOpenBackupFile(file,before){
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of backupFileChunks(file,{end:before.size})){hash.update(chunk);bytes+=chunk.length;}
 await assertBackupFileUnchanged(file,before);
 return {bytes,sha256:hash.digest('hex')};
}
export async function hashBackupFile(path){
 const {file,before}=await openBackupFile(path);
 try{return await hashOpenBackupFile(file,before);}finally{await file.close();}
}
export async function writeBackupChunk(file,buffer,position=null){
 for(let offset=0;offset<buffer.length;){
  const {bytesWritten}=await file.write(buffer,offset,buffer.length-offset,position===null?null:position+offset);
  if(!bytesWritten)throw Error('Backup file write made no progress');
  offset+=bytesWritten;
 }
}
export async function publishBackupFile(destination,writer){
 const target=await requireFreshPath(destination);await mkdir(dirname(target),{recursive:true,mode:0o700});
 const directory=await mkdtemp(join(dirname(target),'.softtech-stream-')),path=join(directory,'file');let file;
 try{
  file=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);
  const result=await writer(file,path);await file.sync();await file.close();file=null;
  await publishFreshFile(path,target);return {path:target,...result};
 }finally{await file?.close();await rm(directory,{recursive:true,force:true});}
}
