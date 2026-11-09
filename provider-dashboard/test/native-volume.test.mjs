import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,symlinkSync,readdirSync,readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseMountInfo,requirePersistentMount,platformHealth,MAX_MOUNTINFO_BYTES,MAX_MOUNTINFO_LINES,MAX_MOUNTINFO_LINE_BYTES} from '../lib/native-volume.mjs';
import {Core} from '../lib/core.mjs';

const ROOT='10 1 8:1 / / rw,relatime - ext4 /dev/fixture rw\n';
const BIND='11 10 8:1 /owned/volume /data rw,relatime shared:4 future:ignored - ext4 /dev/fixture rw\n';
const UUID='00000000-0000-4000-8000-000000000001',ERROR={message:'PERSISTENT_NATIVE_VOLUME_REQUIRED'};
const provider=dirname(dirname(fileURLToPath(import.meta.url))),repo=dirname(provider);
const cloud=mount=>({RAILWAY_SERVICE_ID:'synthetic-service',RAILWAY_DEPLOYMENT_ID:UUID,RAILWAY_VOLUME_MOUNT_PATH:mount});
const local=dir=>({NODE_ENV:'test',CORE_DB_PATH:join(dir,'nested','core.sqlite'),PANEL_SESSION_SECRET:'synthetic-core-master-'.repeat(3),CORE_ENGINE_KEYS_JSON:'[]'});
function temporary(t){const dir=mkdtempSync(join(tmpdir(),'softtech-volume-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

test('independent Core and wallet build contexts carry the same reviewed guard bytes',()=>{
 assert.deepEqual(readFileSync(new URL('../lib/native-volume.mjs',import.meta.url)),readFileSync(new URL('../../reference-wallet/native-volume.mjs',import.meta.url)));
});
test('parser preserves same-device binds, optional fields, escaped paths and stacked mount IDs',()=>{
 const escaped=BIND.replace('/data',String.raw`/data\040space\011tab\012line\134040`);
 const records=parseMountInfo(Buffer.from(ROOT+escaped));
 assert.deepEqual(records.get(11),{mount_id:11,root:'/owned/volume',mountpoint:'/data space\ttab\nline\\040',filesystem_type:'ext4',writable:true});
 const stacked=parseMountInfo(Buffer.from(ROOT+BIND+'12 11 0:9 / /data rw - tmpfs tmpfs rw\n'));
 assert.equal(stacked.get(11).filesystem_type,'ext4');assert.equal(stacked.get(12).filesystem_type,'tmpfs');
 for(const line of [BIND.replace('rw,relatime','ro,relatime'),BIND.replace('rw,relatime','rw,ro'),BIND.replace('fixture rw','fixture ro'),BIND.replace('fixture rw','fixture relatime')])assert.equal(parseMountInfo(Buffer.from(ROOT+line)).get(11).writable,false);
});
test('invalid UTF-8, malformed records and each parser resource bound fail closed',()=>{
 const invalid=['','invalid',ROOT+BIND+BIND,BIND.replace(' - ',' '),BIND.replace('11 10','x 10'),BIND.replace('8:1','not-device'),
  BIND.replace('/data',String.raw`/data\077`),BIND.replace('/data','data'),BIND.replace('/data','/data\0'),BIND.replace(' ext4 ',' ext/4 '),
  BIND.replace('11 10','9007199254740992 10'),'x'.repeat(MAX_MOUNTINFO_BYTES+1),
  ROOT+'11 10 8:1 / /data rw '+'x'.repeat(MAX_MOUNTINFO_LINE_BYTES)+' - ext4 disk rw\n',
  Array.from({length:MAX_MOUNTINFO_LINES+1},(_,i)=>`${i+1} 0 8:1 / /data rw - ext4 disk rw\n`).join('')];
 for(const raw of invalid)assert.throws(()=>parseMountInfo(Buffer.from(raw)),ERROR);
 assert.throws(()=>parseMountInfo(Buffer.concat([Buffer.from(ROOT),Buffer.from([0xff])])),ERROR);
});
test('every Railway identity signal requires a visible mount even under NODE_ENV=test',t=>{
 const dir=temporary(t),mount=join(dir,'data');mkdirSync(mount);
 for(const key of ['RAILWAY_PROJECT_ID','RAILWAY_SERVICE_ID','RAILWAY_DEPLOYMENT_ID']){
  const env={NODE_ENV:'test',[key]:'synthetic-cloud-signal',RAILWAY_VOLUME_MOUNT_PATH:mount};
  assert.throws(()=>requirePersistentMount(env),ERROR);
  assert.throws(()=>new Core({env:{...local(mount),...env}}),ERROR);
 }
 assert.deepEqual(readdirSync(mount),[]);
});
test('real ordinary, symlink, missing, root and volatile mounts cannot qualify',t=>{
 const dir=temporary(t),mount=join(dir,'data'),alias=join(dir,'alias');mkdirSync(mount);symlinkSync(mount,alias);
 for(const target of [mount,alias,join(mount,'missing'),'/', 'relative'])assert.throws(()=>requirePersistentMount(cloud(target)),ERROR);
 if(process.platform==='linux'&&existsSync('/dev/shm'))assert.throws(()=>requirePersistentMount(cloud('/dev/shm')),ERROR);
 assert.throws(()=>requirePersistentMount({RAILWAY_PROJECT_ID:'synthetic'}),ERROR);
 assert.equal(requirePersistentMount({}),null);
});
test('Core rejects an ordinary cloud directory before touching existing files',t=>{
 const dir=temporary(t),file=join(dir,'sentinel.sqlite');writeFileSync(file,'unchanged non-SQLite sentinel');
 const before=readFileSync(file),stat=statSync(file);
 assert.throws(()=>new Core({env:{...local(dir),...cloud(dir),CORE_DB_PATH:file}}),ERROR);
 assert.deepEqual(readFileSync(file),before);assert.equal(statSync(file).mtimeMs,stat.mtimeMs);
 assert.deepEqual(readdirSync(dir),['sentinel.sqlite']);
});
test('unreadable proc metadata cannot fall back to an existing directory',t=>{
 const dir=temporary(t);
 const source=`import {requirePersistentMount} from ${JSON.stringify(new URL('../lib/native-volume.mjs',import.meta.url).href)};try{requirePersistentMount(${JSON.stringify(cloud(dir))});process.exit(2)}catch(e){if(e.message!=='PERSISTENT_NATIVE_VOLUME_REQUIRED')throw e;process.stdout.write('blocked')}`;
 const child=spawnSync(process.execPath,['--permission','--allow-fs-read='+join(provider,'lib'),'--allow-fs-read='+dir,'--input-type=module','-e',source],{encoding:'utf8',timeout:5000,maxBuffer:4096});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'blocked');
});
test('both Core entrypoints and wallet entrypoint refuse ordinary cloud storage before creation',t=>{
 for(const [cwd,entry,extra] of [
  [provider,'server.mjs',{PANEL_ADMIN_PASSWORD:'synthetic-admin-'.repeat(3),PANEL_AUDITOR_PASSWORD:'synthetic-auditor-'.repeat(3)}],
  [provider,'scripts/start-provider.mjs',{CORE_MASTER_ROTATION_ON_START:'invalid-must-not-be-read'}],
  [join(repo,'reference-wallet'),'server.mjs',{WALLET_ENVIRONMENT:'preproduction',WALLET_DEPLOYMENT_ID:'synthetic-wallet',WALLET_CORE_AUDIENCE:'synthetic-core',WALLET_MASTER_KEY:'synthetic-wallet-master-'.repeat(3),WALLET_ADMIN_TOKEN:'synthetic-wallet-admin-'.repeat(3)}]
 ]){
  const dir=temporary(t),env={PATH:process.env.PATH,...local(dir),...cloud(dir),WALLET_DB_PATH:join(dir,'nested','wallet.sqlite'),...extra};
  const child=spawnSync(process.execPath,[entry],{cwd,env,encoding:'utf8',timeout:5000,maxBuffer:8192});
  assert.notEqual(child.status,0);assert.match(child.stderr,/PERSISTENT_NATIVE_VOLUME_REQUIRED/);
  assert.doesNotMatch(child.stderr,/Invalid CORE_MASTER_ROTATION_ON_START/);assert.deepEqual(readdirSync(dir),[]);
 }
});
test('startup wrapper calls no preparation on mount denial and preserves local preparation order',t=>{
 const dir=temporary(t),loader=join(dir,'observe-startup.mjs'),trace=join(dir,'trace.jsonl');
 const prep=new URL('../lib/core-startup-rotation.mjs',import.meta.url).href,server=new URL('../server.mjs',import.meta.url).href;
 const preparation=`import {appendFileSync} from 'node:fs';export async function prepareCoreStartup(){appendFileSync(${JSON.stringify(trace)},'prepare\\n');return {env:{...process.env},report:{enabled:false}}}`;
 const serverSource=`import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(trace)},'server\\n')`;
 writeFileSync(loader,`import {registerHooks} from 'node:module';registerHooks({load(url,context,next){if(url===${JSON.stringify(prep)})return {format:'module',shortCircuit:true,source:${JSON.stringify(preparation)}};if(url===${JSON.stringify(server)})return {format:'module',shortCircuit:true,source:${JSON.stringify(serverSource)}};return next(url,context)}});`);
 const args=['--import',loader,resolve(provider,'scripts/start-provider.mjs')];
 const denied=spawnSync(process.execPath,args,{env:{PATH:process.env.PATH,...cloud(dir)},encoding:'utf8',timeout:5000,maxBuffer:8192});
 assert.equal(denied.status,1,denied.stderr);assert.match(denied.stderr,/PERSISTENT_NATIVE_VOLUME_REQUIRED/);assert.equal(existsSync(trace),false);
 const allowed=spawnSync(process.execPath,args,{env:{PATH:process.env.PATH},encoding:'utf8',timeout:5000,maxBuffer:8192});
 assert.equal(allowed.status,0,allowed.stderr);assert.equal(readFileSync(trace,'utf8'),'prepare\nserver\n');
});
test('public mount health contains bounded metadata and no kernel mount identity',()=>{
 assert.deepEqual(platformHealth({}),{platform_deployment_id:null,native_volume:{required:false,verified:false,verification:'not_required_local',filesystem_type:null}});
});
