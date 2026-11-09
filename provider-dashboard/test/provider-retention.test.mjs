import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {providerBackupPrefix} from '../lib/backup-scope.mjs';
import {providerRetentionPlan,enforceProviderRetention} from '../lib/provider-retention.mjs';
import {probeConditionalDeletion} from '../lib/provider-retention-s3.mjs';
import {runOffsiteBackup} from '../lib/offsite-backup.mjs';
import {createEncryptedBackup,inspectEncryptedBackup} from '../scripts/sqlite-backup.mjs';
import {signS3} from '../lib/backup-s3.mjs';

const NOW=Math.floor(new Date('2030-02-15T12:00:00Z').getTime()/1000),DAY=86400;
const identity={deployment_id:'provider-retention-fixture',environment:'sandbox',identity_version:1,created_at:(NOW-600*DAY)*1000};
const prefix=providerBackupPrefix(identity),ring={keys:{current:'current-backup-fixture-key-123456789'},activeKeyId:'current'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=(age,index=age,hash='a'.repeat(16))=>prefix+(NOW-age*DAY)+'-'+hash+'-'+String(index).padStart(16,'0')+'.stbk';
const etag=bytes=>'"'+createHash('md5').update(bytes).digest('hex')+'"';
function mockStorage(initial=new Map(),{conditional=true,changeOnDelete=false}={}){
 const objects=new Map([...initial].map(([k,v])=>[k,Buffer.from(v)])),calls=[],deleted=[];
 const fetcher=async(url,opts)=>{
  const u=new URL(url),name=decodeURIComponent(u.pathname.slice('/retention-test/'.length));calls.push({method:opts.method,key:name,query:u.search,ifMatch:opts.headers['if-match']});
  if(opts.method==='GET'&&u.searchParams.get('list-type')==='2'){
   const keys=[...objects.keys()].filter(k=>k.startsWith(u.searchParams.get('prefix'))).sort(),offset=Number(u.searchParams.get('continuation-token')||0),page=keys.slice(offset,offset+3),more=offset+3<keys.length;
   const xml='<ListBucketResult><IsTruncated>'+more+'</IsTruncated>'+page.map(k=>'<Contents><Key>'+k+'</Key></Contents>').join('')+(more?'<NextContinuationToken>'+(offset+3)+'</NextContinuationToken>':'')+'</ListBucketResult>';
   return new Response(xml,{status:200});
  }
  if(opts.method==='PUT'){objects.set(name,Buffer.from(opts.body));return new Response(null,{status:200,headers:{ETag:etag(objects.get(name))}});}
  if(!objects.has(name))return new Response(null,{status:404});
  if(opts.method==='GET')return new Response(objects.get(name),{status:200,headers:{ETag:etag(objects.get(name))}});
  if(opts.method==='HEAD')return new Response(null,{status:200,headers:{ETag:etag(objects.get(name))}});
  if(opts.method==='DELETE'){
   if(changeOnDelete&&name.endsWith('.stbk')){objects.set(name,Buffer.from('changed after verification'));changeOnDelete=false;}
   if(conditional&&opts.headers['if-match']!==etag(objects.get(name)))return new Response(null,{status:412});
   objects.delete(name);deleted.push(name);return new Response(null,{status:204});
  }
  throw Error('Unexpected mock request');
 };
 return {objects,calls,deleted,fetcher};
}
const s3={endpoint:'https://storage.example.test',bucket:'retention-test',region:'test-region',accessKeyId:'test-id',secretAccessKey:'test-secret'};

test('provider retention protects daily/weekly/monthly copies, newest two, restoration and foreign names',()=>{
 const inventory=Array.from({length:500},(_,age)=>key(age)),restoringObject=key(498),foreign='provider-core/production/foreign-deployment/old.stbk',unknown=prefix+'manual-hold.stbk';
 const plan=providerRetentionPlan([...inventory,foreign,unknown],{identity,now:NOW,restoringObject,maxDeletes:3});
 for(let age=0;age<7;age++)assert.ok(plan.keep.includes(key(age)));
 assert.ok(plan.keep.includes(restoringObject));assert.equal(plan.candidates.length,3);assert.ok(plan.candidates.every(r=>r.created_at<=NOW-7*DAY&&!plan.keep.includes(r.key)));
 assert.deepEqual(plan.ignored,[foreign,unknown]);assert.equal(plan.candidates.some(r=>r.key===foreign||r.key===unknown),false);
 assert.throws(()=>providerRetentionPlan([key(0),key(0)],{identity,now:NOW}),/DUPLICATE/);
 assert.throws(()=>providerRetentionPlan([key(-1,0)],{identity,now:NOW}),/FUTURE/);
 assert.throws(()=>providerRetentionPlan(inventory,{identity,now:NOW,maxDeletes:11}),/CONFIG/);
 assert.throws(()=>providerRetentionPlan(inventory,{identity,now:NOW,restoringObject:'unknown-restore'}),/RESTORE_SCOPE/);
});

test('conditional-delete capability probe rejects an endpoint that ignores If-Match',async()=>{
 const good=mockStorage(),goodProof=await probeConditionalDeletion({identity,...s3,fetcher:good.fetcher});assert.equal(goodProof.verified,true);assert.equal(goodProof.canary_absent_verified,true);assert.equal(good.objects.size,0);
 assert.ok(good.calls.some(call=>call.method==='DELETE'&&call.ifMatch));
 const bad=mockStorage(new Map(),{conditional:false}),badProof=await probeConditionalDeletion({identity,...s3,fetcher:bad.fetcher});assert.equal(badProof.verified,false);assert.equal(badProof.error_code,'RETENTION_PROBE_CONDITION_IGNORED');
 assert.ok(bad.deleted.every(name=>name.startsWith(prefix+'retention-probe-')));
 const signed=signS3({...s3,key:'',method:'GET',payload:Buffer.alloc(0),query:{'list-type':'2',prefix,'continuation-token':'opaque+/='}});
 assert.equal(new URL(signed.url).searchParams.get('continuation-token'),'opaque+/=');
 assert.throws(()=>signS3({...s3,key:key(0),method:'DELETE',payload:Buffer.alloc(0),ifMatch:'*'}),/strong exact ETag/);
});

test('retention verifies real encrypted archives, paginates, probes conditions and deletes only bounded owned copies',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'provider-retention-'));let db;
 try{
  const source=join(dir,'core.sqlite');db=new DatabaseSync(source);db.exec('CREATE TABLE deployment_identity(deployment_id TEXT,environment TEXT,identity_version INTEGER,created_at INTEGER);CREATE TABLE events(value TEXT);');
  db.prepare('INSERT INTO deployment_identity VALUES(?,?,?,?)').run(identity.deployment_id,identity.environment,identity.identity_version,identity.created_at);db.prepare('INSERT INTO events VALUES(?)').run('encrypted-retention-fixture');db.close();db=null;
  const archived=new Map();
  for(const age of [1,8,9,10,35,36,400,401,402]){
   const path=join(dir,'backup-'+age+'.stbk'),proof=await createEncryptedBackup({source,destination:path,...ring,createdAt:(NOW-age*DAY)*1000});archived.set(key(age,age,proof.manifest.sha256.slice(0,16)),await readFile(path));
  }
  const hold=prefix+'manual-hold.stbk',foreign='provider-core/production/different-deployment/unknown.stbk';archived.set(hold,Buffer.from('preserve unknown'));archived.set(foreign,Buffer.from('preserve foreign'));
  const env={CORE_DB_PATH:source,CORE_ENVIRONMENT:identity.environment,CORE_DEPLOYMENT_ID:identity.deployment_id,BACKUP_KEYS_JSON:JSON.stringify(ring.keys),BACKUP_ACTIVE_KEY_ID:'current',BACKUP_S3_ENDPOINT:s3.endpoint,BACKUP_S3_BUCKET:s3.bucket,BACKUP_S3_REGION:s3.region,BACKUP_S3_ACCESS_KEY_ID:s3.accessKeyId,BACKUP_S3_SECRET_ACCESS_KEY:s3.secretAccessKey,BACKUP_VERIFY_REMOTE:'true',BACKUP_RETENTION_ENABLED:'true',BACKUP_RETENTION_MAX_DELETES:'2'};
  const dry=mockStorage(archived),dryResult=await runOffsiteBackup({env,fetcher:dry.fetcher,now:new Date(NOW*1000)});
  assert.equal(dryResult.retention.verified,true);assert.equal(dryResult.retention.mode,'dry-run');assert.equal(dryResult.retention.deleted_count,0);assert.equal(dry.deleted.length,0);assert.ok(dryResult.key.startsWith(prefix));assert.equal(dryResult.key_id,'current');assert.ok(dry.calls.filter(c=>c.query).length>1);
  const qualification=mockStorage(),qualificationResult=await runOffsiteBackup({env:{...env,BACKUP_RETENTION_PROBE:'true'},fetcher:qualification.fetcher,now:new Date(NOW*1000)});
  assert.equal(qualificationResult.retention.verified,true);assert.equal(qualificationResult.retention.eligible_count,0);assert.equal(qualificationResult.retention.deleted_count,0);assert.equal(qualificationResult.retention.conditional_delete_verified,true);assert.equal(qualificationResult.retention.conditional_delete_probe.canary_absent_verified,true);assert.equal(qualification.deleted.filter(name=>name.endsWith('.stbk')).length,0);
  const applied=mockStorage(archived),applyResult=await runOffsiteBackup({env:{...env,BACKUP_RETENTION_MODE:'apply'},fetcher:applied.fetcher,now:new Date(NOW*1000)});
  assert.equal(applyResult.retention.verified,true);assert.equal(applyResult.retention.conditional_delete_verified,true);assert.equal(applyResult.retention.deleted_count,2);
  assert.equal(applied.deleted.filter(name=>name.endsWith('.stbk')).length,2);assert.ok(applied.objects.has(hold));assert.ok(applied.objects.has(foreign));assert.ok(applied.objects.has(applyResult.key));
  const unsupported=mockStorage(archived,{conditional:false}),unsupportedResult=await runOffsiteBackup({env:{...env,BACKUP_RETENTION_MODE:'apply'},fetcher:unsupported.fetcher,now:new Date(NOW*1000)});
  assert.equal(unsupportedResult.remoteRestore,'verified');assert.equal(unsupportedResult.retention.verified,false);assert.equal(unsupportedResult.retention.error_code,'RETENTION_CONDITIONAL_DELETE_UNVERIFIED');assert.equal(unsupported.deleted.filter(name=>name.endsWith('.stbk')).length,0);

  const raced=mockStorage(archived,{changeOnDelete:true}),racedResult=await runOffsiteBackup({env:{...env,BACKUP_RETENTION_MODE:'apply'},fetcher:raced.fetcher,now:new Date(NOW*1000)});
  assert.equal(racedResult.retention.verified,false);assert.equal(racedResult.retention.deleted_count,0);assert.equal(raced.deleted.filter(name=>name.endsWith('.stbk')).length,0);

  const current=dryResult.key,objects=dry.objects,baseOptions={identity,currentObject:current,currentCiphertextSha256:sha(objects.get(current)),now:NOW,mode:'apply',maxDeletes:2,list:async()=>({keys:[...objects.keys()],nextToken:null}),download:async name=>({bytes:objects.get(name),etag:etag(objects.get(name))}),verify:async bytes=>(await inspectEncryptedBackup(bytes,ring)).manifest,checkConditionalDelete:async()=>({verified:true})};
  let removed=0;
  const badCurrent=await enforceProviderRetention({...baseOptions,currentCiphertextSha256:'0'.repeat(64),remove:async()=>removed++});assert.equal(badCurrent.verified,false);assert.equal(removed,0);
  const failedProof=await enforceProviderRetention({...baseOptions,verify:async()=>{throw Error('authentication failed');},remove:async()=>removed++});assert.equal(failedProof.verified,false);assert.equal(removed,0);
  const limited=await enforceProviderRetention({...baseOptions,maxObjects:2,remove:async()=>removed++});assert.equal(limited.error_code,'RETENTION_INVENTORY_LIMIT');assert.equal(removed,0);
  const loop=await enforceProviderRetention({...baseOptions,list:async()=>({keys:[],nextToken:'loop'}),remove:async()=>removed++});assert.equal(loop.error_code,'RETENTION_PAGINATION_LOOP');assert.equal(removed,0);
  const forged=await enforceProviderRetention({...baseOptions,verify:async bytes=>({...((await inspectEncryptedBackup(bytes,ring)).manifest),deployment_identity:{...identity,deployment_id:'foreign-deployment'}}),remove:async()=>removed++});assert.equal(forged.error_code,'RETENTION_FOREIGN_OR_MALFORMED_MANIFEST');assert.equal(removed,0);
  const missingEtag=await enforceProviderRetention({...baseOptions,download:async name=>({bytes:objects.get(name),etag:'*'}),remove:async()=>removed++});assert.equal(missingEtag.error_code,'RETENTION_CONDITIONAL_DELETE_UNAVAILABLE');assert.equal(removed,0);
 }finally{db?.close();await rm(dir,{recursive:true,force:true});}
});
