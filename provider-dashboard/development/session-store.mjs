import {DatabaseSync} from 'node:sqlite';
import {dirname,resolve} from 'node:path';
import {mkdirSync} from 'node:fs';

export class DevelopmentSessionStore {
  constructor(file) {
    if(typeof file!=='string'||!file.trim()||file.includes('\0'))throw Error('Invalid development database path.');
    const path=resolve(file);
    mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, csrf TEXT NOT NULL, workspace_json TEXT NOT NULL, expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_dev_session_expiry ON sessions(expires_at);");
    this.read=this.db.prepare('SELECT token_hash, role, csrf, workspace_json, expires_at FROM sessions WHERE expires_at > ?');
    this.write=this.db.prepare('INSERT INTO sessions(token_hash,role,csrf,workspace_json,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET role=excluded.role,csrf=excluded.csrf,workspace_json=excluded.workspace_json,expires_at=excluded.expires_at');
    this.removeStmt=this.db.prepare('DELETE FROM sessions WHERE token_hash = ?');
    this.pruneStmt=this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  }
  load(now) {
    this.pruneStmt.run(now);
    const items=[];
    for(const row of this.read.all(now)){
      let workspace;
      try{workspace=JSON.parse(row.workspace_json);}catch{this.removeStmt.run(row.token_hash);continue;}
      if(!workspace||typeof workspace!=='object'||!Array.isArray(workspace.operators)||!Array.isArray(workspace.releases)){
        this.removeStmt.run(row.token_hash);continue;
      }
      items.push([row.token_hash,{role:row.role,csrf:row.csrf,workspace,expires_at:row.expires_at}]);
    }
    return items;
  }
  save(key,session){
    if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid development session key.');
    this.write.run(key,session.role,session.csrf,JSON.stringify(session.workspace),session.expires_at);
  }
  remove(key){this.removeStmt.run(key);}
  prune(now){this.pruneStmt.run(now);}
  close(){this.db.close();}
}
