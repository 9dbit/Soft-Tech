import {constants} from 'node:fs';
import {lstat,mkdir,mkdtemp,open,link,rm,realpath} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
export async function requireFreshPath(path){
 if(typeof path!=='string'||!path)throw Error('A fresh destination path is required');
 const result=resolve(path);
 try{await lstat(result);throw Error('Destination already exists: '+result);}catch(error){if(error.code!=='ENOENT')throw error;}
 return result;
}
export async function publishFreshFile(source,destination){
 const target=await requireFreshPath(destination);await mkdir(dirname(target),{recursive:true,mode:0o700});
 // Atomic link refuses existing files, including racing or dangling symlinks.
 await link(source,target);
 const directory=await open(await realpath(dirname(target)),constants.O_RDONLY);
 try{await directory.sync();}finally{await directory.close();}
 return target;
}
export async function writeFreshFile(destination,bytes){
 const target=await requireFreshPath(destination);await mkdir(dirname(target),{recursive:true,mode:0o700});
 const tempDir=await mkdtemp(join(dirname(target),'.softtech-publish-')),temp=join(tempDir,'file');
 try{
  const file=await open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  return await publishFreshFile(temp,target);
 }finally{await rm(tempDir,{recursive:true,force:true});}
}
export async function secretFromEnv(env,name,{minimum=1}={}){
 if(env[name]&&env[name+'_FILE'])throw Error('Configure either '+name+' or '+name+'_FILE');
 let value=env[name];
 if(env[name+'_FILE']){
  const file=await open(env[name+'_FILE'],constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const metadata=await file.stat();if(!metadata.isFile()||(metadata.mode&0o077)!==0||metadata.size>65536)throw Error(name+'_FILE must be a private regular file (0600)');value=(await file.readFile('utf8')).replace(/\r?\n$/,'');}
  finally{await file.close();}
 }
 if(typeof value!=='string'||value.length<minimum)throw Error(name+' must contain at least '+minimum+' characters');
 return value;
}
