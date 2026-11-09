// Required CI fixture in a private Linux mount namespace. Only synthetic local data.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,statSync,existsSync,symlinkSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {requirePersistentMount as coreMount,platformHealth as coreHealth} from '../lib/native-volume.mjs';
import {requirePersistentMount as walletMount,platformHealth as walletHealth} from '../../reference-wallet/native-volume.mjs';
import {Core} from '../lib/core.mjs';
import {ReferenceWallet} from '../../reference-wallet/wallet.mjs';

const ERROR={message:'PERSISTENT_NATIVE_VOLUME_REQUIRED'};
const base=mkdtempSync(join(tmpdir(),'softtech-mount-fixture-')),source=join(base,'source'),target=join(base,'mount space\ttab\nline\\slash');
mkdirSync(source);mkdirSync(target);
const env={RAILWAY_PROJECT_ID:'synthetic-project',RAILWAY_SERVICE_ID:'synthetic-service',RAILWAY_DEPLOYMENT_ID:'00000000-0000-4000-8000-000000000001',RAILWAY_VOLUME_MOUNT_PATH:target};
const guards=[coreMount,walletMount],healths=[coreHealth,walletHealth];
const coreEnv={...env,NODE_ENV:'test',CORE_ENVIRONMENT:'preproduction',CORE_DEPLOYMENT_ID:'synthetic-mounted-core',CORE_ENGINE_KEYS_JSON:'[]',PANEL_SESSION_SECRET:'synthetic-core-master-'.repeat(3),CORE_DB_PATH:join(target,'core','provider.sqlite')};
const walletEnv={...env,NODE_ENV:'test',WALLET_ENVIRONMENT:'preproduction',WALLET_DEPLOYMENT_ID:'synthetic-mounted-wallet',WALLET_CORE_AUDIENCE:'synthetic-mounted-core',WALLET_MASTER_KEY:'synthetic-wallet-master-'.repeat(3),WALLET_ADMIN_TOKEN:'synthetic-wallet-admin-'.repeat(3),WALLET_DB_PATH:join(target,'wallet','wallet.sqlite')};
const adapters=[
 {create:e=>new Core({env:e}),env:coreEnv,key:'CORE_DB_PATH',identity:x=>x.deploymentIdentity,denied:/resolve inside the mounted/},
 {create:e=>new ReferenceWallet({env:e}),env:walletEnv,key:'WALLET_DB_PATH',identity:x=>x.identity,denied:/dedicated volume/}
];
const deny=environment=>{for(const guard of guards)assert.throws(()=>guard(environment),ERROR);};
let mounts=0;
try{
 deny(env);
 execFileSync('mount',['--bind',source,target]);mounts++;
 assert.equal(statSync(source).dev,statSync(target).dev);assert.equal(statSync(target).dev,statSync(base).dev);
 for(const guard of guards){const proof=guard(env);assert.equal(proof.verified,true);assert.equal(proof.verification,'linux_mountinfo');}
 for(const health of healths){const proof=health(env);assert.equal(proof.platform_deployment_id,env.RAILWAY_DEPLOYMENT_ID);assert.equal(proof.native_volume.verified,true);assert.deepEqual(Object.keys(proof.native_volume).sort(),['filesystem_type','required','verification','verified']);}
 for(const adapter of adapters){
  let opened=adapter.create(adapter.env);const identity={...adapter.identity(opened)};assert.equal(opened.get('PRAGMA synchronous').synchronous,2);opened.close();
  opened=adapter.create(adapter.env);assert.deepEqual(adapter.identity(opened),identity);opened.close();
 }
 const outside=join(base,'outside');mkdirSync(outside);writeFileSync(join(outside,'sentinel.sqlite'),'unchanged external sentinel');
 symlinkSync(outside,join(target,'redirect'));symlinkSync(join(outside,'sentinel.sqlite'),join(target,'file-link'));symlinkSync(join(outside,'missing'),join(target,'dangling'));
 for(const adapter of adapters){
  for(const file of [target+'/../escaped/nested.sqlite',target+'-other/nested.sqlite',join(target,'redirect','nested','db.sqlite'),join(target,'file-link'),target])assert.throws(()=>adapter.create({...adapter.env,[adapter.key]:file}),adapter.denied);
  assert.throws(()=>adapter.create({...adapter.env,[adapter.key]:join(target,'dangling','db.sqlite')}));
 }
 assert.equal(readFileSync(join(outside,'sentinel.sqlite'),'utf8'),'unchanged external sentinel');
 for(const directory of [join(base,'escaped'),target+'-other',join(outside,'nested'),join(outside,'missing')])assert.equal(existsSync(directory),false);
 mkdirSync(join(target,'ordinary'));deny({...env,RAILWAY_VOLUME_MOUNT_PATH:join(target,'ordinary')});
 const alias=join(base,'alias');symlinkSync(target,alias);deny({...env,RAILWAY_VOLUME_MOUNT_PATH:alias});
 // Select the currently visible mount ID, never the older persistent record under it.
 execFileSync('mount',['-t','tmpfs','-o','size=1m,nodev,nosuid','tmpfs',target]);mounts++;deny(env);
 execFileSync('umount',[target]);mounts--;for(const guard of guards)assert.equal(guard(env).verified,true);
 execFileSync('mount',['-o','remount,bind,ro',target]);deny(env);
 for(const adapter of adapters)assert.throws(()=>adapter.create(adapter.env),ERROR);
 execFileSync('umount',[target]);mounts--;deny(env);
 for(const adapter of adapters)assert.throws(()=>adapter.create(adapter.env),ERROR);
 assert.ok(existsSync(join(source,'core','provider.sqlite'))&&existsSync(join(source,'wallet','wallet.sqlite')));
 assert.ok(!existsSync(coreEnv.CORE_DB_PATH)&&!existsSync(walletEnv.WALLET_DB_PATH));
}finally{
 while(mounts>0){execFileSync('umount',[target]);mounts--;}
 rmSync(base,{recursive:true,force:true});
}
console.log('PASS: actual escaped same-device bind, Core/wallet durable identity reopen, containment before mkdir, visible stacked mount, read-only and detached mount rejection');
