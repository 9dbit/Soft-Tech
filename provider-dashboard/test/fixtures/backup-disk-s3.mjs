// Local HTTP fixture: object bodies stay on disk, including request and response
// transport. This deliberately does not collect uploads or downloads in memory.
import {createServer} from 'node:http';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,rm,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export async function startDiskS3Fixture(directory){
 await mkdir(directory,{recursive:true,mode:0o700});
 const objects=new Map(),stats={puts:0,gets:0,lists:0,conditional_rejections:0,deletes:0,max_upload_chunk_bytes:0,uploaded_bytes:0};
 const handle=async(request,response)=>{
  const url=new URL(request.url,'http://fixture'),key=decodeURIComponent(url.pathname.slice('/stream-test/'.length));
  if(request.method==='GET'&&url.searchParams.get('list-type')==='2'){
   stats.lists++;const keys=[...objects.keys()].filter(k=>k.startsWith(url.searchParams.get('prefix'))).sort();
   response.writeHead(200,{'Content-Type':'application/xml'});response.end('<ListBucketResult><IsTruncated>false</IsTruncated>'+keys.map(k=>'<Contents><Key>'+k+'</Key></Contents>').join('')+'</ListBucketResult>');return;
  }
  if(request.method==='PUT'){
   const path=join(directory,randomUUID()),md5=createHash('md5'),sha=createHash('sha256');let bytes=0;
   try{
    await pipeline(request,new Transform({transform(chunk,encoding,done){bytes+=chunk.length;stats.max_upload_chunk_bytes=Math.max(stats.max_upload_chunk_bytes,chunk.length);md5.update(chunk);sha.update(chunk);done(null,chunk);}}),createWriteStream(path,{flags:'wx',mode:0o600}));
    if(sha.digest('hex')!==request.headers['x-amz-content-sha256']){await rm(path);response.writeHead(400);response.end();return;}
    const prior=objects.get(key),etag='"'+md5.digest('hex')+'"';objects.set(key,{path,etag,bytes});if(prior)await rm(prior.path);
    stats.puts++;stats.uploaded_bytes+=bytes;response.writeHead(200,{ETag:etag});response.end();return;
   }catch(error){await rm(path,{force:true});throw error;}
  }
  const object=objects.get(key);
  if(!object){response.writeHead(404);response.end();return;}
  if(request.method==='GET'){
   stats.gets++;const metadata=await stat(object.path);response.writeHead(200,{ETag:object.etag,'Content-Length':String(metadata.size),'Content-Type':'application/octet-stream'});
   await pipeline(createReadStream(object.path,{highWaterMark:64*1024}),response);return;
  }
  if(request.method==='HEAD'){response.writeHead(200,{ETag:object.etag,'Content-Length':String(object.bytes)});response.end();return;}
  if(request.method==='DELETE'){
   if(request.headers['if-match']!==object.etag){stats.conditional_rejections++;response.writeHead(412);response.end();return;}
   await rm(object.path);objects.delete(key);stats.deletes++;response.writeHead(204);response.end();return;
  }
  response.writeHead(405);response.end();
 };
 const server=createServer((request,response)=>{handle(request,response).catch(()=>{if(!response.headersSent)response.writeHead(500);response.destroy();});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {objects,stats,endpoint:'http://127.0.0.1:'+server.address().port,
  close:async()=>{server.closeIdleConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
