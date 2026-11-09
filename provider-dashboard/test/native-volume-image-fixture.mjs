// Required CI: test the exact built image contents with synthetic volume data.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const base=mkdtempSync(join(tmpdir(),'softtech-mount-image-'));
const UUID='00000000-0000-4000-8000-000000000001';
const common={RAILWAY_PROJECT_ID:'synthetic-image-project',RAILWAY_SERVICE_ID:'synthetic-image-service',RAILWAY_DEPLOYMENT_ID:UUID,RAILWAY_VOLUME_MOUNT_PATH:'/data'};
const cases=[
 {image:'softtech-core-mount-ci',file:'provider.sqlite',env:{...common,CORE_ENVIRONMENT:'preproduction',CORE_DEPLOYMENT_ID:'synthetic-image-core',CORE_DB_PATH:'/data/provider.sqlite',CORE_ENGINE_KEYS_JSON:'[]',PANEL_SESSION_SECRET:'synthetic-core-master-'.repeat(3),PANEL_ADMIN_PASSWORD:'synthetic-admin-'.repeat(3),PANEL_AUDITOR_PASSWORD:'synthetic-auditor-'.repeat(3)},
  start:`await import('./server.mjs');`},
 {image:'softtech-wallet-mount-ci',file:'wallet.sqlite',env:{...common,WALLET_ENVIRONMENT:'preproduction',WALLET_DEPLOYMENT_ID:'synthetic-image-wallet',WALLET_CORE_AUDIENCE:'synthetic-image-core',WALLET_DB_PATH:'/data/wallet.sqlite',WALLET_MASTER_KEY:'synthetic-wallet-master-'.repeat(3),WALLET_ADMIN_TOKEN:'synthetic-wallet-admin-'.repeat(3)},
  start:`const {createWalletServer}=await import('./server.mjs');const instance=createWalletServer();await new Promise(r=>instance.server.listen(8080,'127.0.0.1',r));`}
];
function docker(args){
 const name='softtech-mount-fixture-'+randomUUID();
 const result=spawnSync('docker',['run','--name',name,...args.slice(1)],{encoding:'utf8',timeout:30000,maxBuffer:32768});
 if(result.error||result.signal)spawnSync('docker',['rm','--force',name],{encoding:'utf8',timeout:10000,maxBuffer:4096});
 assert.equal(result.error,undefined,result.error?.message);return result;
}
function argumentsFor(item,mount){return ['run','--rm','--network','none',...(mount?['--mount',mount]:[]),...Object.entries(item.env).flatMap(([key,value])=>['--env',key+'='+value]),item.image];}
try{
 for(const item of cases){
  const source=join(base,item.file);mkdirSync(source);
  const missing=docker(argumentsFor(item));assert.notEqual(missing.status,0);assert.match(missing.stderr,/PERSISTENT_NATIVE_VOLUME_REQUIRED/);assert.deepEqual(readdirSync(source),[]);
  const mounted='type=bind,src='+source+',dst=/data';
  const readOnly=docker(argumentsFor(item,mounted+',readonly'));assert.notEqual(readOnly.status,0);assert.match(readOnly.stderr,/PERSISTENT_NATIVE_VOLUME_REQUIRED/);assert.deepEqual(readdirSync(source),[]);
  const probe=`import assert from 'node:assert/strict';${item.start}
   let health;for(let i=0;i<100;i++){try{const response=await fetch('http://127.0.0.1:8080/health');if(response.ok){health=await response.json();break}}catch{}await new Promise(r=>setTimeout(r,20))}
   assert.ok(health,'image health must become ready');assert.equal(health.platform_deployment_id,${JSON.stringify(UUID)});assert.equal(health.persistent_volume.required,true);assert.equal(health.persistent_volume.verified,true);assert.equal(health.persistent_volume.verification,'linux_mountinfo');assert.deepEqual(Object.keys(health.persistent_volume).sort(),['filesystem_type','required','verification','verified']);assert.equal(health.production_enabled,false);for(const value of ['mount_id','mountpoint','/proc/','/data/'])assert.equal(JSON.stringify(health).includes(value),false);await new Promise(resolve=>process.stdout.write('MOUNT_IMAGE_HEALTH_PASS '+JSON.stringify(health.deployment_identity||health.identity)+'\\n',resolve));process.exit(0);`;
  let identity;
  for(let i=0;i<2;i++){
   const positive=docker([...argumentsFor(item,mounted),'node','--input-type=module','-e',probe]);
   assert.equal(positive.status,0,positive.stderr);assert.match(positive.stdout,/MOUNT_IMAGE_HEALTH_PASS/);
   const observed=JSON.parse(positive.stdout.split('\n').find(line=>line.startsWith('MOUNT_IMAGE_HEALTH_PASS ')).slice('MOUNT_IMAGE_HEALTH_PASS '.length));
   if(identity)assert.deepEqual(observed,identity);else identity=observed;
  }
  assert.ok(existsSync(join(source,item.file)));
 }
}finally{rmSync(base,{recursive:true,force:true});}
console.log('PASS: built Core/wallet images reject absent/read-only volumes and restart with verified bind-mounted health and persisted identities');
