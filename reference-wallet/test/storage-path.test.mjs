import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,symlinkSync,readdirSync,readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReferenceWallet} from '../wallet.mjs';
import {createWalletServer} from '../server.mjs';

const ERROR={message:'PERSISTENT_NATIVE_VOLUME_REQUIRED'};
function workspace(t){const dir=mkdtempSync(join(tmpdir(),'wallet-path-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
const env=dir=>({NODE_ENV:'test',WALLET_ENVIRONMENT:'preproduction',WALLET_DEPLOYMENT_ID:'synthetic-wallet-volume',WALLET_CORE_AUDIENCE:'synthetic-core-volume',WALLET_MASTER_KEY:'synthetic-master-'.repeat(4),WALLET_ADMIN_TOKEN:'synthetic-admin-'.repeat(4),WALLET_DB_PATH:join(dir,'nested','wallet.sqlite')});

test('all Railway identity signals reject ordinary directories before mkdir or ledger writes',t=>{
 const dir=workspace(t);
 for(const name of ['RAILWAY_PROJECT_ID','RAILWAY_SERVICE_ID','RAILWAY_DEPLOYMENT_ID']){
  assert.throws(()=>new ReferenceWallet({env:{...env(dir),[name]:'synthetic-cloud-signal',RAILWAY_VOLUME_MOUNT_PATH:dir}}),ERROR);
  assert.deepEqual(readdirSync(dir),[]);
 }
 const file=join(dir,'sentinel.sqlite');writeFileSync(file,'existing non-SQLite sentinel');const before=readFileSync(file),mtime=statSync(file).mtimeMs;
 assert.throws(()=>new ReferenceWallet({env:{...env(dir),RAILWAY_PROJECT_ID:'synthetic-cloud-signal',RAILWAY_VOLUME_MOUNT_PATH:dir,WALLET_DB_PATH:file}}),ERROR);
 assert.deepEqual(readFileSync(file),before);assert.equal(statSync(file).mtimeMs,mtime);assert.deepEqual(readdirSync(dir),['sentinel.sqlite']);
});
test('local path containment rejects traversal and similarly prefixed sibling before creating parents',t=>{
 const dir=workspace(t),mount=join(dir,'volume');mkdirSync(mount);
 // Local path checks are independent of the cloud kernel-mount gate.
 for(const file of [mount+'/../escaped/wallet.sqlite',join(dir,'volume-other','nested','wallet.sqlite'),mount]){
  assert.throws(()=>new ReferenceWallet({env:{...env(dir),RAILWAY_VOLUME_MOUNT_PATH:mount,WALLET_DB_PATH:file}}),/dedicated volume/);
 }
 assert.equal(existsSync(join(dir,'escaped')),false);assert.equal(existsSync(join(dir,'volume-other')),false);assert.deepEqual(readdirSync(mount),[]);
});
test('directory, file and dangling symlinks cannot escape or create external targets',t=>{
 const dir=workspace(t),mount=join(dir,'volume'),outside=join(dir,'outside');mkdirSync(mount);mkdirSync(outside);
 symlinkSync(outside,join(mount,'redirect'));
 const sentinel=join(outside,'sentinel.sqlite');writeFileSync(sentinel,'outside sentinel');const before=readFileSync(sentinel);
 symlinkSync(sentinel,join(mount,'file-link'));symlinkSync(join(outside,'missing'),join(mount,'dangling'));
 for(const file of [join(mount,'redirect','nested','wallet.sqlite'),join(mount,'file-link')])assert.throws(()=>new ReferenceWallet({env:{...env(dir),RAILWAY_VOLUME_MOUNT_PATH:mount,WALLET_DB_PATH:file}}),/dedicated volume/);
 assert.throws(()=>new ReferenceWallet({env:{...env(dir),RAILWAY_VOLUME_MOUNT_PATH:mount,WALLET_DB_PATH:join(mount,'dangling','wallet.sqlite')}}));
 assert.deepEqual(readFileSync(sentinel),before);assert.equal(existsSync(join(outside,'nested')),false);assert.equal(existsSync(join(outside,'missing')),false);
});
test('local contained path canonicalization and immutable wallet identity survive reopening',t=>{
 const dir=workspace(t),mount=join(dir,'volume'),inside=join(mount,'inside');mkdirSync(inside,{recursive:true});symlinkSync(inside,join(mount,'link'));
 const configured={...env(dir),RAILWAY_VOLUME_MOUNT_PATH:mount,WALLET_DB_PATH:join(mount,'link','nested','wallet.sqlite')};
 let wallet=new ReferenceWallet({env:configured});const identity={...wallet.identity};assert.equal(wallet.databasePath,join(inside,'nested','wallet.sqlite'));wallet.close();
 wallet=new ReferenceWallet({env:configured});assert.deepEqual(wallet.identity,identity);assert.equal(wallet.get('PRAGMA synchronous').synchronous,2);wallet.close();
});
test('wallet health states local mount verification honestly and exposes no paths or mount IDs',async t=>{
 const dir=workspace(t),service=createWalletServer({env:env(dir)});
 await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
 try{
  const response=await fetch('http://127.0.0.1:'+service.server.address().port+'/health'),health=await response.json();
  assert.equal(response.status,200);assert.equal(health.platform_deployment_id,null);
  assert.deepEqual(health.persistent_volume,{required:false,verified:false,verification:'not_required_local',filesystem_type:null});
  assert.doesNotMatch(JSON.stringify(health),/mount_id|mountpoint|\/proc\/|synthetic-master/);assert.ok(!JSON.stringify(health).includes(dir));
 }finally{service.server.closeAllConnections();await new Promise(resolve=>service.server.close(resolve));}
});
