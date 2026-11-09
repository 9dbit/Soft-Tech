import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {startDiskS3Fixture} from './backup-disk-s3.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((all,value,index,values)=>{if(index%2===0)all.push([value.replace(/^--/,''),values[index+1]]);return all;},[]));
const size=Number(args['size-mib']||64);if(![64,128].includes(size))throw Error('Choose an actual 64 or 128 MiB snapshot fixture');
process.env.NODE_ENV='test';
const modulePath=args.module?pathToFileURL(resolve(args.module)):new URL('../../lib/offsite-backup.mjs',import.meta.url),{runOffsiteBackup}=await import(modulePath);
const directory=await mkdtemp(join(tmpdir(),'core-backup-memory-'));let db,storage;
try{
 const source=join(directory,'live.sqlite');db=new DatabaseSync(source);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE deployment_identity(deployment_id TEXT,environment TEXT,identity_version INTEGER,created_at INTEGER); CREATE TABLE payload(id INTEGER PRIMARY KEY,value BLOB NOT NULL);');
 const now=new Date(),identity={deployment_id:'core-streaming-memory-fixture',environment:'preproduction',identity_version:1,created_at:now.getTime()};
 db.prepare('INSERT INTO deployment_identity VALUES(?,?,?,?)').run(identity.deployment_id,identity.environment,identity.identity_version,identity.created_at);
 db.exec('BEGIN');const insert=db.prepare('INSERT INTO payload(value) VALUES(randomblob(1048576))');for(let i=0;i<size;i++)insert.run();db.exec('COMMIT');
 storage=await startDiskS3Fixture(join(directory,'s3'));
 const baseline=process.memoryUsage().rss,beforePeak=process.resourceUsage().maxRSS*1024,started=performance.now();
 const result=await runOffsiteBackup({now,env:{CORE_DB_PATH:source,CORE_ENVIRONMENT:identity.environment,CORE_DEPLOYMENT_ID:identity.deployment_id,
  BACKUP_KEYS_JSON:JSON.stringify({previous:'old-memory-fixture-key-1234567890123456789',current:'active-memory-fixture-key-123456789012345'}),BACKUP_ACTIVE_KEY_ID:'current',
  BACKUP_S3_ENDPOINT:storage.endpoint,BACKUP_S3_BUCKET:'stream-test',BACKUP_S3_REGION:'test',BACKUP_S3_ACCESS_KEY_ID:'fixture-access-key',BACKUP_S3_SECRET_ACCESS_KEY:'fixture-secret-key',
  BACKUP_VERIFY_REMOTE:'true',BACKUP_RETENTION_ENABLED:'true',BACKUP_RETENTION_MODE:'apply',BACKUP_RETENTION_PROBE:'true'}});
 const elapsed=performance.now()-started,peak=process.resourceUsage().maxRSS*1024;
 if(result.localIntegrity!=='verified'||result.remoteRestore!=='verified'||result.retention?.verified!==true||result.retention?.conditional_delete_probe?.canary_absent_verified!==true)throw Error('Full backup/remote restore/retention proof did not pass');
 console.log(JSON.stringify({classification:'local_disk_http_backup_memory_fixture',format:'STBK02',requested_payload_mib:size,snapshot_bytes:result.manifest.size,archive_bytes:result.bytes,
  baseline_rss_bytes:baseline,pre_backup_peak_rss_bytes:beforePeak,peak_process_rss_bytes:peak,incremental_peak_over_baseline_bytes:Math.max(0,peak-baseline),
  incremental_peak_to_snapshot_ratio:Math.max(0,peak-baseline)/result.manifest.size,elapsed_seconds:elapsed/1000,local_integrity:result.localIntegrity,remote_restore:result.remoteRestore,
  retention_verified:result.retention.verified,conditional_delete_canary_verified:result.retention.conditional_delete_probe.canary_absent_verified,transport:storage.stats,
  measurement_scope:'One local Node process including the disk-backed HTTP fixture; not live Railway metrics.'}));
}finally{db?.close();await storage?.close();await rm(directory,{recursive:true,force:true});}
