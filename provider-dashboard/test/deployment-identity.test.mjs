import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Core} from '../lib/core.mjs';
import {random,sha,signer,vault} from '../lib/security.mjs';

function workspace(t){
 const dir=mkdtempSync(join(tmpdir(),'softtech-identity-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const env={NODE_ENV:'test',CORE_DB_PATH:join(dir,'core.sqlite'),PANEL_SESSION_SECRET:random(40),CORE_ENGINE_KEYS_JSON:'[]'};
 return {dir,env};
}

function open(t,env){const core=new Core({env});t.after(()=>{try{core.close();}catch{}});return core;}
function fingerprint(path){const s=statSync(path);return {sha256:sha(readFileSync(path)),bytes:s.size,mtime:s.mtimeMs,mode:s.mode};}

test('sandbox identity persists through restart and matching explicit deployment ID',t=>{
 const {env}=workspace(t);let core=new Core({env});
 const identity=core.deploymentIdentity;
 assert.match(identity.deployment_id,/^dep_/);
 assert.equal(identity.environment,'sandbox');assert.equal(identity.identity_version,1);
 assert.equal(identity.identity_bound,true);assert.equal(identity.physical_isolation_verified,false);
 assert.equal(Object.isFrozen(identity),true);
 assert.deepEqual(Object.keys(identity).sort(),['created_at','deployment_id','environment','identity_bound','identity_version','physical_isolation_verified']);
 assert.ok(!JSON.stringify(identity).includes(env.PANEL_SESSION_SECRET));
 assert.ok(!JSON.stringify(identity).includes(env.CORE_DB_PATH));
 core.close();core=new Core({env});assert.deepEqual(core.deploymentIdentity,identity);core.close();
 core=open(t,{...env,CORE_DEPLOYMENT_ID:identity.deployment_id});
 assert.deepEqual(core.deploymentIdentity,identity);
});

test('deployment identity resists update, delete and INSERT OR REPLACE',t=>{
 const {env}=workspace(t),core=open(t,env),identity=core.deploymentIdentity;
 assert.throws(()=>core.run("UPDATE deployment_identity SET deployment_id='changed-identity'"),/identity is immutable/);
 assert.throws(()=>core.run('DELETE FROM deployment_identity'),/identity is immutable/);
 assert.throws(()=>core.run('INSERT OR REPLACE INTO deployment_identity VALUES(1,?,?,1,?)','changed-identity','sandbox',Date.now()),/identity is immutable/);
 assert.equal(core.get('SELECT deployment_id FROM deployment_identity').deployment_id,identity.deployment_id);
});

test('a copied DB rejects an explicit different deployment identity before any existing DB write',t=>{
 const {env,dir}=workspace(t);const source=new Core({env:{...env,CORE_DEPLOYMENT_ID:'sandbox-original-identity'}});
 source.run("UPDATE games SET origin='https://preserved.example'");source.close();
 const copied=join(dir,'copied.sqlite');copyFileSync(env.CORE_DB_PATH,copied);const before=fingerprint(copied);
 assert.throws(()=>new Core({env:{...env,CORE_DB_PATH:copied,CORE_DEPLOYMENT_ID:'sandbox-different-identity',UNO_PROVIDER_ORIGIN:'https://must-not-be-written.example'}}),/Deployment identity mismatch/);
 assert.deepEqual(fingerprint(copied),before);
 const db=new DatabaseSync(copied,{readOnly:true});
 try{assert.equal(db.prepare('SELECT origin FROM games LIMIT 1').get().origin,'https://preserved.example');}finally{db.close();}
 // SQLite may create WAL/shared-memory bookkeeping for a read-only connection;
 // the existing database bytes, permissions, schema and catalog remain unchanged.
});

test('preproduction and production cannot relabel an existing DB or create a fresh one',t=>{
 const {env,dir}=workspace(t);const core=new Core({env});core.close();const before=fingerprint(env.CORE_DB_PATH);
 for(const environment of ['preproduction','production']){
  assert.throws(()=>new Core({env:{...env,CORE_ENVIRONMENT:environment}}),/remain locked/);
  assert.deepEqual(fingerprint(env.CORE_DB_PATH),before);
  const fresh=join(dir,environment,'new.sqlite');
  assert.throws(()=>new Core({env:{...env,CORE_ENVIRONMENT:environment,CORE_DB_PATH:fresh}}),/remain locked/);
  assert.equal(existsSync(join(dir,environment)),false);
 }
});

function legacyDatabase(env){
 const db=new DatabaseSync(env.CORE_DB_PATH),box=vault(env.PANEL_SESSION_SECRET),now=Date.now();
 db.exec(readFileSync(new URL('../lib/schema.sql',import.meta.url),'utf8'));
 const sentinel=box.seal('softtech-core-v1'),secret=random(40),sealed=box.seal(secret);
 db.prepare('INSERT INTO meta VALUES(?,?)').run('vault_check',sentinel);
 db.prepare('INSERT INTO operators VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-op','Legacy Operator','enabled','sandbox','["uno-luck"]','VCOIN',2,'sandbox','',null,'[]','10000','10000','1000000',0,now,now);
 db.prepare('INSERT INTO api_keys VALUES(?,?,?,?,?,?)').run('legacy-key','legacy-op',sealed,'["games:read"]',null,now);
 db.close();return {sentinel,secret,sealed};
}

test('legacy sandbox adopts identity once without changing vault ciphertext or v1 credentials',t=>{
 const {env}=workspace(t),legacy=legacyDatabase(env),core=open(t,env);
 assert.equal(core.deploymentIdentity.environment,'sandbox');
 assert.equal(core.get("SELECT value FROM meta WHERE key='vault_check'").value,legacy.sentinel);
 assert.equal(core.get("SELECT secret_box FROM api_keys WHERE id='legacy-key'").secret_box,legacy.sealed);
 const signature=signer(legacy.secret,'softtech.v1','GET','/v1/games','');
 const principal=core.authenticate({method:'GET',path:'/v1/games',headers:{'x-softtech-key':'legacy-key','x-softtech-timestamp':signature.timestamp,'x-softtech-nonce':signature.nonce,'x-softtech-signature':signature.signature}});
 assert.equal(principal.operator.id,'legacy-op');
});

test('wrong master key cannot write identity into a legacy DB or change existing ciphertext',t=>{
 const {env}=workspace(t);legacyDatabase(env);const before=fingerprint(env.CORE_DB_PATH);
 assert.throws(()=>new Core({env:{...env,PANEL_SESSION_SECRET:random(40)}}));
 assert.deepEqual(fingerprint(env.CORE_DB_PATH),before);
 const db=new DatabaseSync(env.CORE_DB_PATH,{readOnly:true});
 try{assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='deployment_identity'").get(),undefined);}finally{db.close();}
});

test('production runtime resolves traversal before any escaped parent directories are created',t=>{
 const {env,dir}=workspace(t),mount=join(dir,'volume');mkdirSync(mount);
 const escaped=join(dir,'escaped');
 assert.throws(()=>new Core({env:{...env,NODE_ENV:'production',RAILWAY_VOLUME_MOUNT_PATH:mount,CORE_DB_PATH:mount+'/../escaped/provider.sqlite'}}),/resolve inside the mounted/);
 assert.equal(existsSync(escaped),false);
});

test('production runtime rejects a symlinked directory escaping its volume before creating a DB',t=>{
 const {env,dir}=workspace(t),mount=join(dir,'volume'),outside=join(dir,'outside');mkdirSync(mount);mkdirSync(outside);
 symlinkSync(outside,join(mount,'redirect'));
 assert.throws(()=>new Core({env:{...env,NODE_ENV:'production',RAILWAY_VOLUME_MOUNT_PATH:mount,CORE_DB_PATH:join(mount,'redirect','nested','provider.sqlite')}}),/resolve inside the mounted/);
 assert.equal(existsSync(join(outside,'nested')),false);
});

test('production runtime rejects a database-file symlink escaping its volume without opening its target',t=>{
 const {env,dir}=workspace(t),mount=join(dir,'volume'),outside=join(dir,'outside.sqlite');mkdirSync(mount);
 writeFileSync(outside,'unchanged non-SQLite sentinel');const before=fingerprint(outside);
 symlinkSync(outside,join(mount,'provider.sqlite'));
 assert.throws(()=>new Core({env:{...env,NODE_ENV:'production',RAILWAY_VOLUME_MOUNT_PATH:mount,CORE_DB_PATH:join(mount,'provider.sqlite')}}),/resolve inside the mounted/);
 assert.deepEqual(fingerprint(outside),before);
});

test('a similarly prefixed sibling path is outside the actual volume',t=>{
 const {env,dir}=workspace(t),mount=join(dir,'volume');mkdirSync(mount);
 const sibling=join(dir,'volume-other','provider.sqlite');
 assert.throws(()=>new Core({env:{...env,NODE_ENV:'production',RAILWAY_VOLUME_MOUNT_PATH:mount,CORE_DB_PATH:sibling}}),/resolve inside the mounted/);
 assert.equal(existsSync(join(dir,'volume-other')),false);
});

test('nested database paths and internal symlinks contained by the real mounted path work',t=>{
 const {env,dir}=workspace(t),mount=join(dir,'volume'),inside=join(mount,'inside'),alias=join(dir,'mounted-alias');
 mkdirSync(inside,{recursive:true});symlinkSync(mount,alias);symlinkSync(inside,join(mount,'internal-link'));
 const core=open(t,{...env,NODE_ENV:'production',RAILWAY_VOLUME_MOUNT_PATH:alias,CORE_DB_PATH:join(alias,'internal-link','nested','provider.sqlite')});
 assert.equal(core.deploymentIdentity.environment,'sandbox');
 assert.equal(existsSync(join(inside,'nested','provider.sqlite')),true);
 assert.equal(core.deploymentIdentity.physical_isolation_verified,false);
});

test('production runtime requires a real absolute mounted directory and an absolute DB path',t=>{
 const {env,dir}=workspace(t);
 for(const mount of [undefined,'relative-volume',join(dir,'missing-volume')]){
  assert.throws(()=>new Core({env:{...env,NODE_ENV:'production',RAILWAY_VOLUME_MOUNT_PATH:mount}}),/mounted persistent volume/);
  assert.equal(existsSync(env.CORE_DB_PATH),false);
 }
 assert.throws(()=>new Core({env:{...env,CORE_DB_PATH:'relative.sqlite'}}),/Absolute CORE_DB_PATH/);
});
