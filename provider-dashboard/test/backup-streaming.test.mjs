import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createHash,randomBytes,scryptSync} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile,appendFile,readdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createEncryptedBackup,restoreEncryptedBackup,decryptBackup,inspectEncryptedBackupFile} from '../scripts/sqlite-backup.mjs';
import {putEncryptedObjectFile,readEncryptedObjectFile,readEncryptedObjectReceipt,signS3} from '../lib/backup-s3.mjs';
import {enforceProviderRetention} from '../lib/provider-retention.mjs';
import {providerBackupPrefix} from '../lib/backup-scope.mjs';
import {hashBackupFile} from '../lib/backup-file.mjs';
import {runOffsiteBackup} from '../lib/offsite-backup.mjs';
import {startDiskS3Fixture} from './fixtures/backup-disk-s3.mjs';

const password='legacy-fixture-password-1234567890123456789',current='current-fixture-password-1234567890123456789';
const ring={keys:{legacy:password,current},activeKeyId:'current'};
const identity={deployment_id:'core-streaming-test-fixture',environment:'preproduction',identity_version:1,created_at:1700000000000};
const sha=value=>createHash('sha256').update(value).digest('hex');
const s3={endpoint:'https://streaming.fixture.test',bucket:'stream-test',key:'provider-core/test.stbk',region:'test',accessKeyId:'test-id',secretAccessKey:'test-secret'};
async function temporary(t){const dir=await mkdtemp(join(tmpdir(),'core-stream-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function database(path,{mib=1}={}){
 const db=new DatabaseSync(path);
 try{
  db.exec('CREATE TABLE deployment_identity(deployment_id TEXT,environment TEXT,identity_version INTEGER,created_at INTEGER);CREATE TABLE payload(value BLOB);');
  db.prepare('INSERT INTO deployment_identity VALUES(?,?,?,?)').run(identity.deployment_id,identity.environment,identity.identity_version,identity.created_at);
  for(let i=0;i<mib;i++)db.exec('INSERT INTO payload VALUES(randomblob(1048576))');
 }finally{db.close();}
}
// Independent, original one-shot format writer for compatibility and valid-GCM
// malformed-content tests; only small fixture databases enter this byte helper.
function oldArchive(plain,{legacy=false,changes={}}={}){
 const salt=randomBytes(16),iv=randomBytes(12),manifest={format:'softtech-sqlite-backup-v2',key_id:'current',created_at:1700000001000,sha256:sha(plain),size:plain.length,deployment_identity:identity,...changes};
 const header=Buffer.from(JSON.stringify(manifest)),length=Buffer.alloc(4);length.writeUInt32BE(header.length);
 const aad=legacy?Buffer.from('STBK01'):Buffer.concat([Buffer.from('STBK02'),length,header]);
 const cipher=createCipheriv('aes-256-gcm',scryptSync(legacy?password:current,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024}),iv);
 if(!legacy)cipher.setAAD(aad);
 const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([aad,salt,iv,cipher.getAuthTag(),ciphertext]);
}
async function absent(path){await assert.rejects(lstat(path),{code:'ENOENT'});}

test('streamed archives interoperate with old STBK02 bytes and retained STBK01 keys',async t=>{
 const dir=await temporary(t),source=join(dir,'source.sqlite');await database(source);
 const plain=await readFile(source),fresh=join(dir,'new.stbk'),created=await createEncryptedBackup({source,destination:fresh,...ring});
 const oldReader=decryptBackup(await readFile(fresh),ring);assert.equal(oldReader.manifest.sha256,sha(oldReader.plaintext));assert.deepEqual(oldReader.manifest,created.manifest);
 assert.deepEqual((await inspectEncryptedBackupFile(fresh,ring)).deployment_identity,identity);
 for(const legacy of [false,true]){
  const archive=join(dir,legacy?'old-v1.stbk':'old-v2.stbk'),target=archive+'.sqlite';await writeFile(archive,oldArchive(plain,{legacy}));
  const result=await restoreEncryptedBackup({source:archive,destination:target,...ring});assert.equal(result.format,legacy?'STBK01':'STBK02');assert.deepEqual(result.deployment_identity,identity);
  assert.equal((await hashBackupFile(target)).sha256,sha(plain));assert.equal((await lstat(target)).mode&0o777,0o600);
 }
});

test('streamed restore rejects tampering, truncation and authenticated false metadata without publishing plaintext',async t=>{
 const dir=await temporary(t),source=join(dir,'source.sqlite');await database(source);const plain=await readFile(source),valid=oldArchive(plain);
 const changed=Buffer.from(valid);changed[changed.length-1]^=1;
 const aad=Buffer.from(valid),timeIndex=aad.indexOf(Buffer.from('1700000001000'));aad.write('1700000001001',timeIndex);
 const variants=[changed,valid.subarray(0,valid.length-1),Buffer.concat([valid,Buffer.from([0])]),aad,
  oldArchive(plain,{changes:{sha256:'0'.repeat(64)}}),oldArchive(plain,{changes:{size:plain.length+1}}),
  oldArchive(plain,{changes:{deployment_identity:{...identity,deployment_id:'foreign-core-deployment'}}}),oldArchive(Buffer.from('authenticated but not SQLite'))];
 for(let i=0;i<variants.length;i++){
  const archive=join(dir,'bad-'+i+'.stbk'),target=join(dir,'bad-'+i+'.sqlite');await writeFile(archive,variants[i]);
  await assert.rejects(restoreEncryptedBackup({source:archive,destination:target,...ring}));await absent(target);
  assert.equal((await readdir(dir)).some(name=>name.startsWith('.softtech-stream-')),false);
 }
 const malformed=Buffer.from(valid);malformed.writeUInt32BE(4097,6);const path=join(dir,'large-header.stbk');await writeFile(path,malformed);
 await assert.rejects(restoreEncryptedBackup({source:path,destination:join(dir,'large-header.sqlite'),...ring}),/header/);
});

test('streaming S3 download is atomic on transport failure, length mismatch and a racing destination',async t=>{
 const dir=await temporary(t);
 for(const [name,response] of [
  ['truncated',()=>new Response(Buffer.from('short'),{headers:{'Content-Length':'100'}})],
  ['interrupted',()=>new Response(Readable.toWeb(Readable.from((async function*(){yield Buffer.alloc(65536);throw Error('transport interrupted');})())))]
 ]){
  const target=join(dir,name);await assert.rejects(readEncryptedObjectFile({...s3,destination:target,fetcher:async()=>response()}));await absent(target);
 }
 const race=join(dir,'race'),guard=Buffer.from('existing file survives');let part=0;
 const response=new Response(new ReadableStream({async pull(controller){if(part++===0){controller.enqueue(Buffer.from('first'));return;}if(part===2){await writeFile(race,guard,{flag:'wx'});controller.enqueue(Buffer.from('second'));return;}controller.close();}},{highWaterMark:0}));
 await assert.rejects(readEncryptedObjectFile({...s3,destination:race,fetcher:async()=>response}),/already exists|EEXIST/);
 assert.deepEqual(await readFile(race),guard);assert.equal((await readdir(dir)).some(name=>name.startsWith('.softtech-stream-')),false);
 await assert.rejects(readEncryptedObjectReceipt({...s3,maxBytes:16,fetcher:async()=>new Response(Buffer.alloc(17))}),/exceeds limit/);
});

test('file upload binds SigV4 to exact length and digest and rejects a changing source',async t=>{
 const dir=await temporary(t),source=join(dir,'ciphertext.stbk'),payload=randomBytes(256*1024);await writeFile(source,payload,{mode:0o600});
 const now=new Date('2030-02-15T12:00:00Z'),signed=signS3({...s3,payload,now});let chunks=0;
 const result=await putEncryptedObjectFile({...s3,source,now,fetcher:async(url,request)=>{
  assert.equal(request.duplex,'half');assert.equal(request.headers['Content-Length'],String(payload.length));assert.equal(request.headers.Authorization,signed.headers.Authorization);
  const digest=createHash('sha256');for await(const chunk of request.body){assert.ok(chunk.length<=65536);digest.update(chunk);chunks++;}assert.equal(digest.digest('hex'),sha(payload));return new Response(null,{status:200,headers:{ETag:'"fixture"'}});
 }});assert.equal(result.sha256,sha(payload));assert.equal(result.bytes,payload.length);assert.ok(chunks>1);
 await assert.rejects(putEncryptedObjectFile({...s3,source,fetcher:async(url,request)=>{
  let first=true;for await(const chunk of request.body){if(first){first=false;await appendFile(source,'changed');}}return new Response(null,{status:200});
 }}),/changed/);
});

test('retention refuses a modified downloaded file before any manifest verification or deletion',async t=>{
 const dir=await temporary(t),path=join(dir,'download.stbk'),now=1907841600,key=providerBackupPrefix(identity)+now+'-'+'a'.repeat(16)+'-'+'b'.repeat(16)+'.stbk';await writeFile(path,'ciphertext');let verified=0,removed=0;
 const result=await enforceProviderRetention({identity,currentObject:key,currentCiphertextSha256:sha('ciphertext'),now,mode:'apply',list:async()=>({keys:[key],nextToken:null}),
  download:async()=>({path,bytes:10,sha256:'0'.repeat(64),etag:'"strong"'}),verifyFile:async()=>{verified++;},remove:async()=>{removed++;}});
 assert.equal(result.verified,false);assert.equal(result.error_code,'RETENTION_DOWNLOADED_FILE_CHANGED');assert.equal(verified,0);assert.equal(removed,0);
});

test('real HTTP transport completes backup, remote SQLite restore, retention and conditional-delete canary using streams',async t=>{
 const dir=await temporary(t),source=join(dir,'live.sqlite');await database(source,{mib:8});const storage=await startDiskS3Fixture(join(dir,'s3'));
 const oldNodeEnv=process.env.NODE_ENV;process.env.NODE_ENV='test';
 try{
  const result=await runOffsiteBackup({env:{CORE_DB_PATH:source,CORE_ENVIRONMENT:identity.environment,CORE_DEPLOYMENT_ID:identity.deployment_id,BACKUP_KEYS_JSON:JSON.stringify(ring.keys),BACKUP_ACTIVE_KEY_ID:'current',
   BACKUP_S3_ENDPOINT:storage.endpoint,BACKUP_S3_BUCKET:'stream-test',BACKUP_S3_REGION:'test',BACKUP_S3_ACCESS_KEY_ID:'fixture',BACKUP_S3_SECRET_ACCESS_KEY:'fixture-secret',BACKUP_VERIFY_REMOTE:'true',BACKUP_RETENTION_ENABLED:'true',BACKUP_RETENTION_MODE:'apply',BACKUP_RETENTION_PROBE:'true'},
   fetcher:async(url,request)=>{
    if(request.method==='PUT'&&new URL(url).pathname.endsWith('.stbk')){assert.equal(Buffer.isBuffer(request.body),false);assert.equal(request.duplex,'half');}
    const response=await fetch(url,request);response.arrayBuffer=()=>{throw Error('Whole response buffering is forbidden');};response.text=()=>{throw Error('Whole response buffering is forbidden');};return response;
   }});
  assert.ok(result.manifest.size>8*1024*1024);assert.equal(result.remoteRestore,'verified');assert.equal(result.localIntegrity,'verified');assert.equal(result.retention.verified,true);assert.equal(result.retention.conditional_delete_probe.canary_absent_verified,true);
  assert.equal(storage.stats.conditional_rejections,1);assert.equal(storage.objects.size,1);assert.ok(storage.stats.gets>=3);
 }finally{if(oldNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldNodeEnv;await storage.close();}
});
