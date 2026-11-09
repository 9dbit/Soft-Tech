import {DatabaseSync} from 'node:sqlite';
import {lstatSync,mkdirSync,realpathSync,statSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {requirePersistentMount} from './native-volume.mjs';

const identitySchema=`
CREATE TABLE IF NOT EXISTS deployment_identity(
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 deployment_id TEXT NOT NULL UNIQUE,
 environment TEXT NOT NULL CHECK(environment IN ('sandbox','preproduction','production')),
 identity_version INTEGER NOT NULL CHECK(identity_version=1),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS deployment_identity_immutable_insert
 BEFORE INSERT ON deployment_identity WHEN EXISTS(SELECT 1 FROM deployment_identity)
 BEGIN SELECT RAISE(ABORT,'deployment identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS deployment_identity_immutable_update
 BEFORE UPDATE ON deployment_identity
 BEGIN SELECT RAISE(ABORT,'deployment identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS deployment_identity_immutable_delete
 BEFORE DELETE ON deployment_identity
 BEGIN SELECT RAISE(ABORT,'deployment identity is immutable'); END;
`;

function configuration(env){
 const environment=env.CORE_ENVIRONMENT??'sandbox';
 if(!['sandbox','preproduction','production'].includes(environment))throw Error('Invalid CORE_ENVIRONMENT');
 const deploymentId=env.CORE_DEPLOYMENT_ID??null;
 if(deploymentId!==null&&(typeof deploymentId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(deploymentId)))throw Error('Invalid CORE_DEPLOYMENT_ID');
 if(environment!=='sandbox'&&!deploymentId)throw Error('Explicit CORE_DEPLOYMENT_ID required; non-sandbox deployments remain locked without identity');
 return {environment,deploymentId};
}

function exists(path){
 try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
}

// Resolve the deepest existing ancestor before creating any missing directories.
// lstat also sees dangling symlinks, so realpath fails safely rather than treating
// a broken link as a new directory that could lead outside the volume later.
function realPathForCreation(path){
 let ancestor=resolve(path);const missing=[];
 while(!exists(ancestor)){
  const parent=dirname(ancestor);
  if(parent===ancestor)throw Error('Database parent directory is unavailable');
  missing.unshift(basename(ancestor));
  ancestor=parent;
 }
 return join(realpathSync(ancestor),...missing);
}

function contained(root,path){
 const rel=relative(root,path);
 return rel!==''&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);
}

function databasePath(env){
 const mounted=requirePersistentMount(env);
 const requested=env.CORE_DB_PATH||resolve('.local-data/provider.sqlite');
 if(!isAbsolute(requested))throw Error('Absolute CORE_DB_PATH required');
 const path=realPathForCreation(requested);
 if(env.NODE_ENV==='production'||mounted){
  const mount=env.RAILWAY_VOLUME_MOUNT_PATH;
  if(typeof mount!=='string'||!isAbsolute(mount))throw Error('A mounted persistent volume is required in production');
  let realMount;
  try{realMount=realpathSync(mount);if(!statSync(realMount).isDirectory())throw Error();}
  catch{throw Error('A mounted persistent volume is required in production');}
  if(!contained(realMount,path))throw Error('CORE_DB_PATH must resolve inside the mounted persistent volume');
 }
 return path;
}

function readIdentity(db){
 if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='deployment_identity'").get())return null;
 const rows=db.prepare('SELECT singleton,deployment_id,environment,identity_version,created_at FROM deployment_identity').all();
 if(rows.length!==1)throw Error('Stored deployment identity is missing or invalid');
 const row=rows[0];
 if(row.singleton!==1||!['sandbox','preproduction','production'].includes(row.environment)||row.identity_version!==1||typeof row.deployment_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(row.deployment_id)||!Number.isSafeInteger(row.created_at)||row.created_at<0)throw Error('Stored deployment identity is invalid');
 return row;
}

function matchIdentity(identity,requested){
 if(!identity)return;
 if(identity.environment!==requested.environment)throw Error('Deployment environment mismatch: an existing database cannot be relabeled');
 if(requested.deploymentId!==null&&identity.deployment_id!==requested.deploymentId)throw Error('Deployment identity mismatch: an existing database belongs to another deployment');
}

function rejectLegacyPromotion(db,identity,requested){
 if(identity||requested.environment==='sandbox')return;
 const userTables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
 if(userTables.length)throw Error('Legacy database cannot be promoted: a non-sandbox deployment requires a fresh database');
}

function publicIdentity(row){
 return Object.freeze({
  deployment_id:row.deployment_id,
  environment:row.environment,
  identity_version:row.identity_version,
  created_at:row.created_at,
  identity_bound:true,
  physical_isolation_verified:false
 });
}

/**
 * Bind a database to one immutable environment/deployment identity. Existing files are examined
 * read-only before schema setup, chmod, catalog upserts or recovery can write.
 * validateExisting lets Core check its legacy vault without changing encryption.
 * This guard does not verify that separate services/volumes have been provisioned.
 */
export function openDeploymentDatabase({env=process.env,clock=Date.now,validateExisting=()=>{}}={}){
 const requested=configuration(env);
 let path=databasePath(env);
 if(exists(path)){
  if(!statSync(path).isFile())throw Error('CORE_DB_PATH must name a database file');
  const reader=new DatabaseSync(path,{readOnly:true});
  try{const identity=readIdentity(reader);matchIdentity(identity,requested);rejectLegacyPromotion(reader,identity,requested);validateExisting(reader);}
  finally{reader.close();}
 }
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 // Recheck the actual ancestry after directory creation, before writable open.
 path=databasePath(env);
 const db=new DatabaseSync(path);
 try{
  const previous=readIdentity(db);matchIdentity(previous,requested);rejectLegacyPromotion(db,previous,requested);validateExisting(db);
  db.exec('PRAGMA busy_timeout=10000; BEGIN IMMEDIATE;');
  let identity;
  try{
   identity=readIdentity(db);matchIdentity(identity,requested);
   if(!identity){
    const createdAt=clock();
    if(!Number.isSafeInteger(createdAt)||createdAt<0)throw Error('Invalid deployment identity timestamp');
    identity={singleton:1,deployment_id:requested.deploymentId||'dep_'+randomUUID(),environment:requested.environment,identity_version:1,created_at:createdAt};
    db.exec(identitySchema);
    db.prepare('INSERT INTO deployment_identity(singleton,deployment_id,environment,identity_version,created_at) VALUES(?,?,?,?,?)').run(identity.singleton,identity.deployment_id,identity.environment,identity.identity_version,identity.created_at);
   }else db.exec(identitySchema);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {db,path,identity:publicIdentity(identity)};
 }catch(error){db.close();throw error;}
}
