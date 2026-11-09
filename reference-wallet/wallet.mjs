import {DatabaseSync} from 'node:sqlite';
import {createHash,createHmac,randomBytes,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdirSync,chmodSync,existsSync,realpathSync,lstatSync,statSync} from 'node:fs';
import path from 'node:path';
import {types} from 'node:util';
import {DurableWrites} from './durable-writes.mjs';
import {requirePersistentMount} from './native-volume.mjs';
export class WalletFault extends Error { constructor(status,code){super(code);this.status=status;this.code=code;} }
export const fail=(status,code)=>{throw new WalletFault(status,code);};
const hash=s=>createHash('sha256').update(s).digest('hex');
const equal=(a,b)=>timingSafeEqual(Buffer.from(hash(String(a))),Buffer.from(hash(String(b))));
const id=(s,name,max=150)=>{if(typeof s!=='string'||s.length<1||s.length>max||/[\x00-\x1f]/.test(s))fail(422,'INVALID_'+name);return s;};
const amount=(s,zero=true)=>{if(typeof s!=='string'||!/^(0|[1-9][0-9]{0,24})$/.test(s)||BigInt(s)>10n**24n||(!zero&&BigInt(s)===0n))fail(422,'INVALID_AMOUNT');return BigInt(s);};
export function canonical(version,environment,audience,method,pathname,timestamp,nonce,body){return [`softtech.wallet.v${version}`,...(version===2?[environment,audience]:[]),method.toUpperCase(),pathname,timestamp,nonce,hash(body)].join('\n');}
export function walletHeaders({secret,operatorId,version=2,environment,audience,method='POST',pathname,body,timestamp=String(Math.floor(Date.now()/1000)),nonce=randomBytes(18).toString('hex')}){return {'content-type':'application/json','x-softtech-key':'wallet-'+operatorId,'x-softtech-timestamp':timestamp,'x-softtech-nonce':nonce,'x-softtech-signature':createHmac('sha256',secret).update(canonical(version,environment,audience,method,pathname,timestamp,nonce,body)).digest('hex'),...(version===2?{'x-wallet-version':'2','x-wallet-environment':environment,'x-wallet-audience':audience}:{})};}

function exists(pathname){
 try{lstatSync(pathname);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function realPathForCreation(requested){
 let ancestor=path.resolve(requested);const missing=[];
 while(!exists(ancestor)){
  const parent=path.dirname(ancestor);
  if(parent===ancestor)throw Error('Wallet database parent is unavailable');
  missing.unshift(path.basename(ancestor));ancestor=parent;
 }
 // lstat above sees dangling links. realpath must reject them before mkdir or SQLite.
 return path.join(realpathSync(ancestor),...missing);
}
function databasePath(env){
 requirePersistentMount(env);
 const file=realPathForCreation(env.WALLET_DB_PATH||'./data/wallet.sqlite');
 if(env.RAILWAY_VOLUME_MOUNT_PATH){
  const mount=realpathSync(env.RAILWAY_VOLUME_MOUNT_PATH),relative=path.relative(mount,file);
  if(!statSync(mount).isDirectory()||relative===''||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Wallet database must be on its dedicated volume');
 }
 return file;
}
export class ReferenceWallet {
 constructor({env=process.env,clock=Date.now}={}){
  this.env=env;this.clock=clock;this.authCount=0;this.transactionDepth=0;this.transactionSequence=0;this.writeMetrics={statements:0,total_ms:0,max_ms:0};
  const environment=env.WALLET_ENVIRONMENT||'sandbox',deploymentId=env.WALLET_DEPLOYMENT_ID,audience=env.WALLET_CORE_AUDIENCE;
  if(!['sandbox','preproduction','production'].includes(environment)||!/^[-\w.]{8,100}$/.test(deploymentId||'')||!/^[-\w.]{8,100}$/.test(audience||''))throw Error('Explicit wallet environment, deployment ID and Core audience are required');
  if(typeof env.WALLET_MASTER_KEY!=='string'||env.WALLET_MASTER_KEY.length<32||typeof env.WALLET_ADMIN_TOKEN!=='string'||env.WALLET_ADMIN_TOKEN.length<40)throw Error('Wallet master and admin secrets are required');
  if(environment==='production'&&env.WALLET_TEST_CONTROL_ENABLED==='true')throw Error('Production test control is forbidden');
  this.testControl=environment!=='production'&&env.WALLET_TEST_CONTROL_ENABLED==='true';
  this.key=createHash('sha256').update('softtech-reference-wallet-v1:'+env.WALLET_MASTER_KEY).digest();
  let file=databasePath(env);
  mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  // Recheck the live mount and actual ancestry before opening a writable database.
  file=databasePath(env);
  if(existsSync(file)){const previous=new DatabaseSync(file,{readOnly:true});try{const row=previous.prepare('SELECT * FROM identity WHERE id=1').get();if(!row||row.environment!==environment||row.deployment_id!==deploymentId||row.core_audience!==audience)throw Error('Wallet database identity mismatch');if(this.open(row.key_check)!=='wallet-key-check')throw Error('Wallet key mismatch');}finally{previous.close();}}
  this.db=new DatabaseSync(file);this.databasePath=file;chmodSync(file,0o600);
  this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS identity(id INTEGER PRIMARY KEY CHECK(id=1),environment TEXT NOT NULL,deployment_id TEXT NOT NULL,core_audience TEXT NOT NULL,key_check TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS operators(id TEXT PRIMARY KEY,secret_box TEXT NOT NULL,currency TEXT NOT NULL,scale INTEGER NOT NULL,protocol_version INTEGER NOT NULL CHECK(protocol_version IN (1,2)),enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS accounts(operator_id TEXT NOT NULL,player_ref TEXT NOT NULL,balance_minor TEXT NOT NULL,seed_minor TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(operator_id,player_ref),FOREIGN KEY(operator_id) REFERENCES operators(id));
   CREATE TABLE IF NOT EXISTS transactions(operator_id TEXT NOT NULL,id TEXT NOT NULL,action TEXT NOT NULL,player_ref TEXT NOT NULL,round_id TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(operator_id,id),UNIQUE(operator_id,round_id,action),FOREIGN KEY(operator_id) REFERENCES operators(id));
   CREATE TABLE IF NOT EXISTS ledger(seq INTEGER PRIMARY KEY AUTOINCREMENT,operator_id TEXT NOT NULL,player_ref TEXT NOT NULL,transaction_id TEXT NOT NULL,kind TEXT NOT NULL,amount_minor TEXT NOT NULL,balance_minor TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(operator_id,transaction_id,kind));
   CREATE TABLE IF NOT EXISTS nonces(operator_id TEXT NOT NULL,nonce TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(operator_id,nonce));
   CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,operator_id TEXT,detail_json TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS faults(id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,action TEXT NOT NULL,kind TEXT NOT NULL,remaining INTEGER NOT NULL,delay_ms INTEGER NOT NULL,created_at INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS ledger_operator_sequence ON ledger(operator_id,seq);
   CREATE INDEX IF NOT EXISTS transactions_operator_time ON transactions(operator_id,created_at,id);
   CREATE INDEX IF NOT EXISTS nonces_time ON nonces(created_at);
   CREATE INDEX IF NOT EXISTS faults_operator_action ON faults(operator_id,action,remaining,created_at);
   CREATE TRIGGER IF NOT EXISTS identity_no_update BEFORE UPDATE ON identity BEGIN SELECT RAISE(ABORT,'immutable identity');END;
   CREATE TRIGGER IF NOT EXISTS identity_no_delete BEFORE DELETE ON identity BEGIN SELECT RAISE(ABORT,'immutable identity');END;
   CREATE TRIGGER IF NOT EXISTS identity_no_replace BEFORE INSERT ON identity WHEN EXISTS(SELECT 1 FROM identity) BEGIN SELECT RAISE(ABORT,'immutable identity');END;
   CREATE TRIGGER IF NOT EXISTS ledger_no_replace BEFORE INSERT ON ledger WHEN EXISTS(SELECT 1 FROM ledger WHERE seq=NEW.seq OR (operator_id=NEW.operator_id AND transaction_id=NEW.transaction_id AND kind=NEW.kind)) BEGIN SELECT RAISE(ABORT,'immutable ledger');END;
   CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'immutable ledger');END;
   CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'immutable ledger');END;
   CREATE TRIGGER IF NOT EXISTS tx_no_replace BEFORE INSERT ON transactions WHEN EXISTS(SELECT 1 FROM transactions WHERE operator_id=NEW.operator_id AND (id=NEW.id OR (round_id=NEW.round_id AND action=NEW.action))) BEGIN SELECT RAISE(ABORT,'immutable receipt');END;
   CREATE TRIGGER IF NOT EXISTS tx_no_update BEFORE UPDATE ON transactions BEGIN SELECT RAISE(ABORT,'immutable receipt');END;
   CREATE TRIGGER IF NOT EXISTS tx_no_delete BEFORE DELETE ON transactions BEGIN SELECT RAISE(ABORT,'immutable receipt');END;
   CREATE TRIGGER IF NOT EXISTS audit_no_replace BEFORE INSERT ON audit WHEN EXISTS(SELECT 1 FROM audit WHERE seq=NEW.seq) BEGIN SELECT RAISE(ABORT,'immutable audit');END;
   CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit');END;
   CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit');END;`);
  if(!this.get('SELECT 1 FROM identity'))this.run('INSERT INTO identity VALUES(1,?,?,?,?,?)',environment,deploymentId,audience,this.seal('wallet-key-check'),clock());
  this.identity={environment,deployment_id:deploymentId,core_audience:audience};
  this.journal=new DurableWrites(this.db,{fault:code=>new WalletFault(503,code)});
 }
 close(){this.journal.close();this.db.close();} get(sql,...p){return this.db.prepare(sql).get(...p);} all(sql,...p){return this.db.prepare(sql).all(...p);}
 run(sql,...p){const start=performance.now();try{return this.db.prepare(sql).run(...p);}finally{const elapsed=performance.now()-start;this.writeMetrics.statements++;this.writeMetrics.total_ms+=elapsed;this.writeMetrics.max_ms=Math.max(this.writeMetrics.max_ms,elapsed);}}
 durable(fn){return this.journal.run(fn);}
 transaction(fn){
  if(typeof fn!=='function'||types.isAsyncFunction(fn)||types.isGeneratorFunction(fn))throw Error('Synchronous wallet transaction required');
  const nested=this.journal?.inOperation||this.transactionDepth>0,savepoint='wallet_transaction_'+(++this.transactionSequence);
  this.db.exec(nested?'SAVEPOINT '+savepoint:'BEGIN IMMEDIATE');this.transactionDepth++;
  try{const result=fn();if(result?.then)throw Error('Asynchronous wallet transaction forbidden');this.db.exec(nested?'RELEASE '+savepoint:'COMMIT');return result;}
  catch(error){if(nested){this.db.exec('ROLLBACK TO '+savepoint);this.db.exec('RELEASE '+savepoint);}else this.db.exec('ROLLBACK');throw error;}
  finally{this.transactionDepth--;}
 }
 seal(s){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,iv),body=Buffer.concat([c.update(s,'utf8'),c.final()]);return [iv,c.getAuthTag(),body].map(x=>x.toString('base64url')).join('.');}
 open(s){const [iv,tag,body]=s.split('.').map(x=>Buffer.from(x,'base64url')),c=createDecipheriv('aes-256-gcm',this.key,iv);c.setAuthTag(tag);return Buffer.concat([c.update(body),c.final()]).toString();}
 audit(event,operator,detail={}){this.run('INSERT INTO audit(event,operator_id,detail_json,created_at) VALUES(?,?,?,?)',event,operator,JSON.stringify(detail),this.clock());}
 admin(token){if(!token||!equal(token,this.env.WALLET_ADMIN_TOKEN))fail(401,'ADMIN_AUTH_REQUIRED');}
 register(p){
  if(this.identity.environment==='production')fail(423,'PRODUCTION_WALLET_LOCKED');
  const op=id(p.operator_id,'OPERATOR',100),secret=p.secret,currency=p.currency,scale=p.scale,version=p.protocol_version??2;
  if(typeof secret!=='string'||secret.length<32||secret.length>256)fail(422,'INVALID_SECRET');
  if(typeof currency!=='string'||!/^[A-Z][A-Z0-9]{2,11}$/.test(currency)||!Number.isInteger(scale)||scale<0||scale>8)fail(422,'INVALID_CURRENCY');
  if(![1,2].includes(version)||version===1&&this.identity.environment!=='sandbox')fail(422,'VERSION_NOT_ALLOWED');
  const existing=this.get('SELECT * FROM operators WHERE id=?',op);if(existing){if(existing.currency!==currency||existing.scale!==scale||existing.protocol_version!==version||!equal(this.open(existing.secret_box),secret))fail(409,'OPERATOR_CONFIG_MISMATCH');return {operator_id:op,currency,scale,protocol_version:version,duplicate:true};}
  this.transaction(()=>{this.run('INSERT INTO operators VALUES(?,?,?,?,?,1,?)',op,this.seal(secret),currency,scale,version,this.clock());this.audit('operator.registered',op,{currency,scale,protocol_version:version});});
  return {operator_id:op,currency,scale,protocol_version:version};
 }
 seed(p){
  if(!this.testControl)fail(403,'TEST_CONTROL_DISABLED');const op=this.operator(id(p.operator_id,'OPERATOR',100)),player=id(p.player_ref,'PLAYER',120),n=amount(p.amount_minor);
  return this.transaction(()=>{const old=this.get('SELECT * FROM accounts WHERE operator_id=? AND player_ref=?',op.id,player);if(old){if(old.seed_minor!==String(n))fail(409,'SEED_CONFLICT');return {operator_id:op.id,player_ref:player,balance_minor:old.balance_minor,seed_minor:old.seed_minor,duplicate:true};}this.run('INSERT INTO accounts VALUES(?,?,?,?,?)',op.id,player,String(n),String(n),this.clock());this.run('INSERT INTO ledger(operator_id,player_ref,transaction_id,kind,amount_minor,balance_minor,created_at) VALUES(?,?,?,?,?,?,?)',op.id,player,'seed:'+hash(player),'seed',String(n),String(n),this.clock());this.audit('account.seeded',op.id,{player_ref:player,amount_minor:String(n)});return {operator_id:op.id,player_ref:player,balance_minor:String(n),duplicate:false};});
 }
 operator(op){const row=this.get('SELECT * FROM operators WHERE id=? AND enabled=1',op);if(!row)fail(401,'INVALID_SIGNATURE');return row;}
 authenticate(method,pathname,raw,h){
  if(h['x-wallet-version']!==undefined&&!['1','2'].includes(h['x-wallet-version']))fail(401,'PROTOCOL_MISMATCH');
  const key=h['x-softtech-key'],ts=h['x-softtech-timestamp'],nonce=h['x-softtech-nonce'],sig=h['x-softtech-signature'];
  if(typeof key!=='string'||!key.startsWith('wallet-')||typeof ts!=='string'||!/^\d{10,11}$/.test(ts)||typeof nonce!=='string'||!/^[-\w]{16,80}$/.test(nonce)||typeof sig!=='string'||!/^[a-f0-9]{64}$/.test(sig))fail(401,'INVALID_SIGNATURE');
  if(Math.abs(this.clock()/1000-Number(ts))>300)fail(401,'SIGNATURE_EXPIRED');
  const op=this.operator(key.slice(7)),version=h['x-wallet-version']==='2'?2:1;
  if(version!==op.protocol_version||version===1&&this.identity.environment!=='sandbox')fail(401,'PROTOCOL_MISMATCH');
  if(version===1&&(h['x-wallet-environment']!==undefined||h['x-wallet-audience']!==undefined))fail(401,'PROTOCOL_MISMATCH');
  if(version===2&&(h['x-wallet-environment']!==this.identity.environment||h['x-wallet-audience']!==this.identity.core_audience))fail(401,'WALLET_AUDIENCE_MISMATCH');
  const expected=createHmac('sha256',this.open(op.secret_box)).update(canonical(version,this.identity.environment,this.identity.core_audience,method,pathname,ts,nonce,raw)).digest('hex');
  if(!equal(expected,sig))fail(401,'INVALID_SIGNATURE');
  if(this.get('SELECT 1 FROM nonces WHERE operator_id=? AND nonce=?',op.id,nonce))fail(409,'REPLAY_DETECTED');
  this.run('INSERT INTO nonces VALUES(?,?,?)',op.id,nonce,this.clock());if(++this.authCount%1000===0)this.run('DELETE FROM nonces WHERE created_at<?',this.clock()-600000);
  return op;
 }
 setFault(p){
  if(!this.testControl)fail(403,'TEST_CONTROL_DISABLED');this.operator(p.operator_id);
  if(!['balance','debit','credit','reversal','status'].includes(p.action)||!['before_disconnect','after_disconnect','before_timeout','after_timeout','reject','pending_once','network_partition'].includes(p.kind))fail(422,'INVALID_FAULT');
  const remaining=p.count??1,delay=p.delay_ms??1000;if(!Number.isInteger(remaining)||remaining<1||remaining>10000||!Number.isInteger(delay)||delay<10||delay>30000)fail(422,'INVALID_FAULT_LIMIT');
  const fid='fault_'+randomBytes(12).toString('hex');this.run('INSERT INTO faults VALUES(?,?,?,?,?,?,?)',fid,p.operator_id,p.action,p.kind,remaining,delay,this.clock());this.audit('test.fault_armed',p.operator_id,{id:fid,action:p.action,kind:p.kind,count:remaining});return {id:fid,kind:p.kind,count:remaining};
 }
 takeFault(op,action){return this.transaction(()=>{const row=this.get('SELECT * FROM faults WHERE operator_id=? AND action=? AND remaining>0 ORDER BY created_at,id LIMIT 1',op,action);if(row)this.run('UPDATE faults SET remaining=remaining-1 WHERE id=?',row.id);return row;});}
 clearFaults(op){if(!this.testControl)fail(403,'TEST_CONTROL_DISABLED');this.run('UPDATE faults SET remaining=0 WHERE operator_id=?',op);return {cleared:true};}
 perform(op,action,p,{reject=false}={}){
  if(this.identity.environment==='production')fail(423,'PRODUCTION_WALLET_LOCKED');
  if(p.operator_id!==op.id)fail(403,'OPERATOR_MISMATCH');if(p.currency!==op.currency||p.scale!==op.scale)fail(422,'CURRENCY_MISMATCH');
  const player=id(p.player_ref,'PLAYER',120),account=this.get('SELECT * FROM accounts WHERE operator_id=? AND player_ref=?',op.id,player);if(!account)fail(404,'PLAYER_NOT_FOUND');
  const common={currency:op.currency,scale:op.scale};
  if(action==='balance')return {...common,balance_minor:account.balance_minor};
  const txid=id(p.transaction_id,'TRANSACTION',200),old=this.get('SELECT * FROM transactions WHERE operator_id=? AND id=?',op.id,txid);
  if(action==='status'){if(old&&old.player_ref!==player)fail(404,'TRANSACTION_NOT_FOUND');return old?JSON.parse(old.receipt_json):{...common,transaction_id:txid,status:'not_found'};}
  if(!['debit','credit','reversal'].includes(action))fail(404,'ACTION_NOT_FOUND');
  const n=amount(p.amount_minor,action!=='debit'),round=id(p.round_id,'ROUND',150),session=id(p.session_id,'SESSION',150),game=id(p.game_id,'GAME',120);
  const fingerprint=hash(JSON.stringify({action,player,round,session,game,amount_minor:String(n),original:p.original_transaction_id||null}));
  if(old){if(old.payload_hash!==fingerprint)fail(409,'IDEMPOTENCY_CONFLICT');return JSON.parse(old.receipt_json);}
  return this.transaction(()=>{
   if(this.get('SELECT 1 FROM transactions WHERE operator_id=? AND round_id=? AND action=?',op.id,round,action))fail(409,'ROUND_TRANSACTION_EXISTS');
   const current=this.get('SELECT * FROM accounts WHERE operator_id=? AND player_ref=?',op.id,player);let balance=BigInt(current.balance_minor),reason=reject?'TEST_REJECTED':null;
   if(action==='debit'){if(balance<n)reason='INSUFFICIENT_FUNDS';else if(!reason)balance-=n;}
   else {
    const debit=this.get("SELECT * FROM transactions WHERE operator_id=? AND round_id=? AND action='debit' AND status='applied'",op.id,round);
    if(!debit||debit.player_ref!==player)fail(409,'DEBIT_NOT_FOUND');
    const other=action==='credit'?'reversal':'credit';if(this.get('SELECT 1 FROM transactions WHERE operator_id=? AND round_id=? AND action=? AND status=?',op.id,round,other,'applied'))fail(409,'ROUND_ALREADY_CLOSED');
    if(action==='reversal'&&(p.original_transaction_id!==debit.id||JSON.parse(debit.receipt_json).amount_minor!==String(n)))fail(409,'REVERSAL_MISMATCH');
    if(!reason)balance+=n;if(balance>10n**24n)fail(422,'BALANCE_LIMIT');
   }
   const receipt={...common,transaction_id:txid,status:reason?'rejected':'applied',amount_minor:String(n),balance_minor:String(balance),...(reason?{reason}:{} )};
   this.run('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)',op.id,txid,action,player,round,fingerprint,receipt.status,JSON.stringify(receipt),this.clock());
   if(!reason){this.run('UPDATE accounts SET balance_minor=? WHERE operator_id=? AND player_ref=?',String(balance),op.id,player);this.run('INSERT INTO ledger(operator_id,player_ref,transaction_id,kind,amount_minor,balance_minor,created_at) VALUES(?,?,?,?,?,?,?)',op.id,player,txid,action,String(action==='debit'?-n:n),String(balance),this.clock());}
   this.audit('wallet.'+receipt.status,op.id,{transaction_id:txid,action,amount_minor:String(n)});return receipt;
  });
 }
 reconcile(opId){this.operator(opId);const accounts=this.all('SELECT * FROM accounts WHERE operator_id=?',opId),rows=this.db.prepare('SELECT * FROM ledger WHERE operator_id=? ORDER BY seq').iterate(opId),errors=[];let ledgerCount=0;const balances=new Map();for(const row of rows){ledgerCount++;const next=(balances.get(row.player_ref)||0n)+BigInt(row.amount_minor);if(next!==BigInt(row.balance_minor))errors.push({code:'LEDGER_CHAIN',seq:row.seq});balances.set(row.player_ref,next);}for(const a of accounts)if(String(balances.get(a.player_ref)||0n)!==a.balance_minor)errors.push({code:'BALANCE_MISMATCH',player_ref:a.player_ref});return {operator_id:opId,status:errors.length?'mismatch':'matched',accounts:accounts.length,ledger_entries:ledgerCount,transactions:this.get('SELECT count(*) n FROM transactions WHERE operator_id=?',opId).n,errors};}
 report(opId,{limit=1000,offset=0,includeReconciliation=true}={}){this.operator(opId);limit=Math.min(1000,Math.max(1,Number(limit)||1000));offset=Math.max(0,Number(offset)||0);return {reconciliation:includeReconciliation?this.reconcile(opId):null,accounts:this.all('SELECT player_ref,balance_minor,seed_minor FROM accounts WHERE operator_id=? ORDER BY player_ref LIMIT ? OFFSET ?',opId,limit,offset),transactions:this.all('SELECT id,action,player_ref,round_id,status,receipt_json,created_at FROM transactions WHERE operator_id=? ORDER BY created_at,id LIMIT ? OFFSET ?',opId,limit,offset).map(t=>({...t,receipt:JSON.parse(t.receipt_json),receipt_json:undefined})),faults:this.all('SELECT id,action,kind,remaining,created_at FROM faults WHERE operator_id=? ORDER BY created_at DESC LIMIT 100',opId),pagination:{limit,offset},identity:this.identity};}
}
