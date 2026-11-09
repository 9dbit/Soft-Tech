// Bind mounts can share st_dev with their parent. Use the kernel mount ID of
// the opened directory, then its exact mountinfo record (including stacked mounts).
// https://www.kernel.org/doc/html/latest/filesystems/proc.html
import {openSync,closeSync,readSync,fstatSync,lstatSync,realpathSync,constants} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';

export const MAX_MOUNTINFO_BYTES=1024*1024,MAX_MOUNTINFO_LINES=4096,MAX_MOUNTINFO_LINE_BYTES=65536,MAX_FDINFO_BYTES=4096;
const ERROR='PERSISTENT_NATIVE_VOLUME_REQUIRED';
const CLOUD_KEYS=['RAILWAY_PROJECT_ID','RAILWAY_SERVICE_ID','RAILWAY_DEPLOYMENT_ID'];
const VOLATILE_FS=new Set(['overlay','overlayfs','aufs','fuse.overlayfs','fuse.fuse-overlayfs','tmpfs','ramfs','rootfs','devtmpfs','proc','sysfs','devpts','cgroup','cgroup2','securityfs','configfs','debugfs','tracefs','pstore','mqueue','hugetlbfs','autofs','fusectl','rpc_pipefs','bpf','squashfs','iso9660']);
const ESCAPES={'040':' ','011':'\t','012':'\n','134':'\\'};
let cached=null;
const fail=()=>{throw Error(ERROR);};
function pathField(value){
 if(/\\(?!040|011|012|134)/.test(value))fail();
 const decoded=value.replace(/\\(040|011|012|134)/g,(_,code)=>ESCAPES[code]);
 if(!decoded.startsWith('/')||decoded.includes('\0'))fail();
 return decoded;
}
export function parseMountInfo(raw){
 if(!Buffer.isBuffer(raw)||!raw.length||raw.length>MAX_MOUNTINFO_BYTES)fail();
 const text=raw.toString('utf8');if(!Buffer.from(text).equals(raw))fail();
 const lines=text.split('\n');if(lines.at(-1)==='')lines.pop();
 if(lines.length>MAX_MOUNTINFO_LINES)fail();
 const records=new Map();
 for(const line of lines){
  if(!line||Buffer.byteLength(line)>MAX_MOUNTINFO_LINE_BYTES)fail();
  const parts=line.split(' - ');if(parts.length!==2)fail();
  const fields=parts[0].split(' '),tail=parts[1].split(' ');
  if(fields.length<6||tail.length!==3||[...fields,...tail].some(x=>!x))fail();
  if(!/^[1-9][0-9]{0,15}$/.test(fields[0])||!/^[0-9]{1,16}$/.test(fields[1])||!/^\d+:\d+$/.test(fields[2])||!/^[A-Za-z0-9_.-]{1,64}$/.test(tail[0]))fail();
  const mount_id=Number(fields[0]);if(!Number.isSafeInteger(mount_id)||records.has(mount_id))fail();
  records.set(mount_id,{mount_id,root:pathField(fields[3]),mountpoint:pathField(fields[4]),filesystem_type:tail[0],
   writable:fields[5].split(',').includes('rw')&&!fields[5].split(',').includes('ro')&&tail[2].split(',').includes('rw')&&!tail[2].split(',').includes('ro')});
 }
 return records;
}
function readBounded(path,limit){
 const fd=openSync(path,constants.O_RDONLY|constants.O_CLOEXEC),chunks=[];let length=0;
 try{
  const block=Buffer.alloc(Math.min(8192,limit+1));
  for(;;){
   const n=readSync(fd,block,0,Math.min(block.length,limit+1-length),null);
   if(!n)break;length+=n;if(length>limit)fail();chunks.push(Buffer.from(block.subarray(0,n)));
  }
  return Buffer.concat(chunks,length);
 }finally{closeSync(fd);}
}
function mountId(fd){
 const raw=readBounded('/proc/self/fdinfo/'+fd,MAX_FDINFO_BYTES).toString('utf8');
 const ids=[...raw.matchAll(/^mnt_id:[ \t]*([0-9]+)[ \t]*$/gm)];
 if(ids.length!==1)fail();const id=Number(ids[0][1]);if(!Number.isSafeInteger(id)||id<1)fail();return id;
}
function mounts(){
 const raw=readBounded('/proc/self/mountinfo',MAX_MOUNTINFO_BYTES);
 // Fresh kernel bytes on every check; parsing alone is cached until they change.
 if(!cached||cached.pid!==process.pid||!cached.raw.equals(raw))cached={pid:process.pid,raw,records:parseMountInfo(raw)};
 return cached.records;
}
export function requirePersistentMount(env=process.env){
 if(!CLOUD_KEYS.some(name=>!!env[name]))return null;
 try{
  const mount=env.RAILWAY_VOLUME_MOUNT_PATH;
  if(process.platform!=='linux'||typeof mount!=='string'||!isAbsolute(mount))fail();
  const canonical=realpathSync(mount);if(canonical==='/'||canonical!==resolve(mount))fail();
  const fd=openSync(canonical,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_CLOEXEC);
  try{
   if(!fstatSync(fd).isDirectory())fail();
   const id=mountId(fd),selected=mounts().get(id);
   if(!selected||selected.mountpoint!==canonical||!selected.writable||VOLATILE_FS.has(selected.filesystem_type.toLowerCase()))fail();
   const current=lstatSync(canonical,{bigint:true}),opened=fstatSync(fd,{bigint:true});
   if(current.dev!==opened.dev||current.ino!==opened.ino)fail();
   return {verified:true,verification:'linux_mountinfo',mount_id:id,filesystem_type:selected.filesystem_type};
  }finally{closeSync(fd);}
 }catch{throw Error(ERROR);}
}
const identifier=value=>typeof value==='string'&&/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(value)?value:null;
export function platformHealth(env=process.env){
 const proof=requirePersistentMount(env);
 return {platform_deployment_id:identifier(env.RAILWAY_DEPLOYMENT_ID),native_volume:{required:!!proof,verified:!!proof,
  verification:proof?.verification||'not_required_local',filesystem_type:proof?.filesystem_type||null}};
}
export function eventProvenance(env=process.env){
 return {event_at:new Date().toISOString(),platform_deployment_id:identifier(env.RAILWAY_DEPLOYMENT_ID)};
}
