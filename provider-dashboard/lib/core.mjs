import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,chmodSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {catalog} from './catalog.mjs';
import {Fault,fail,sha,random,equal,canonical,mac,vault,text,units,originURL} from './security.mjs';
import {walletCall,WalletError} from './wallet.mjs';
const scopes=['games:read','sessions:write','reports:read'];
const parse=x=>JSON.parse(x);
export class Core {
 constructor({env=process.env,clock=Date.now,transport=walletCall}={}){
  this.env=env;this.clock=clock;this.transport=transport;this.locks=new Map();
  const master=env.PANEL_SESSION_SECRET||'';if(master.length<32)throw Error('PANEL_SESSION_SECRET is required');
  this.vault=vault(master);this.allowLocal=env.NODE_ENV==='test';
  const path=env.CORE_DB_PATH||resolve('.local-data/provider.sqlite');
  if(!isAbsolute(path))throw Error('Absolute CORE_DB_PATH required');
  if(env.NODE_ENV==='production'&&(!env.RAILWAY_VOLUME_MOUNT_PATH||!path.startsWith(env.RAILWAY_VOLUME_MOUNT_PATH.replace(/\/$/,'')+'/')))throw Error('A mounted persistent volume is required in production');
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);this.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));chmodSync(path,0o600);
  const sentinel=this.get('SELECT value FROM meta WHERE key=?','vault_check');
  if(sentinel){if(this.vault.open(sentinel.value)!=='softtech-core-v1')throw Error('Key mismatch: restore original master key');}
  else this.run('INSERT INTO meta VALUES(?,?)','vault_check',this.vault.seal('softtech-core-v1'));
  this.run("INSERT OR IGNORE INTO meta VALUES('schema_version','1')");
  this.engineKeys=new Map();
  for(const k of parse(env.CORE_ENGINE_KEYS_JSON||'[]')){
   text(k.id,'engine_key',{max:80});if(!catalog.some(g=>g.id===k.game)||typeof k.secret!=='string'||k.secret.length<32)throw Error('Invalid game transport credentials');
   this.engineKeys.set(k.id,k);
  }
  for(const g of catalog){
   let origin=env[g.env]||'';if(origin)origin=originURL(origin,{allowLocal:this.allowLocal}).origin;
   this.run(`INSERT INTO games(id,name,origin,original_origin,play_path,cover,source,source_commit) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,origin=CASE WHEN excluded.origin<>'' THEN excluded.origin ELSE games.origin END,cover=excluded.cover,source=excluded.source,source_commit=excluded.source_commit`,g.id,g.name,origin,g.original,g.play,g.cover,g.source,g.sourceCommit);
  }
 }
 close(){this.db.close();}
 run(sql,...args){return this.db.prepare(sql).run(...args);}
 get(sql,...args){return this.db.prepare(sql).get(...args);}
 all(sql,...args){return this.db.prepare(sql).all(...args);}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();if(value?.then)throw Error('Async transaction forbidden');this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 async serial(key,fn){const before=this.locks.get(key)||Promise.resolve();const next=before.catch(()=>{}).then(fn);this.locks.set(key,next);try{return await next;}finally{if(this.locks.get(key)===next)this.locks.delete(key);}}
 audit(actor,event,scope,detail={}){this.run('INSERT INTO audit VALUES(?,?,?,?,?,?)',randomUUID(),actor,event,scope,JSON.stringify(detail),this.clock());}
 operator(id){const op=this.get('SELECT * FROM operators WHERE id=?',id);if(!op)fail(404,'OPERATOR_NOT_FOUND');return op;}
 operatorView(op){return {id:op.id,name:op.name,status:op.status,environment:op.environment,games:parse(op.games_json),currency:op.currency,scale:op.scale,wallet_mode:op.wallet_mode,wallet_url:op.wallet_url,return_origins:parse(op.return_origins_json),initial_minor:op.initial_minor,max_stake_minor:op.max_stake_minor,max_payout_minor:op.max_payout_minor,internal:!!op.internal,created_at:op.created_at};}
 createOperator(input,actor='admin',{internal=false,id=null}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail(422,'OBJECT_REQUIRED');
  const name=text(input.name,'name',{max:80});const gameIds=input.games;
  if(!Array.isArray(gameIds)||!gameIds.length||gameIds.some(g=>!catalog.some(x=>x.id===g))||new Set(gameIds).size!==gameIds.length)fail(422,'INVALID_GAMES');
  const currency=text(input.currency||'VCOIN','currency',{max:12,pattern:/^[A-Z][A-Z0-9]{2,11}$/});const scale=input.scale??2;
  if(!Number.isInteger(scale)||scale<0||scale>8)fail(422,'INVALID_SCALE');
  const mode=input.wallet_mode||'sandbox';if(!['sandbox','seamless'].includes(mode))fail(422,'INVALID_WALLET_MODE');
  const url=mode==='seamless'?originURL(input.wallet_url,{allowLocal:this.allowLocal,pathAllowed:true}).href:'';
  const origins=input.return_origins||[];if(!Array.isArray(origins)||origins.length>20)fail(422,'INVALID_RETURN_ORIGINS');
  const allowed=origins.map(u=>originURL(u,{allowLocal:this.allowLocal}).origin);
  const initial=String(units(input.initial_minor??'10000000'));const maxStake=String(units(input.max_stake_minor??'10000000',{zero:false}));const maxPayout=String(units(input.max_payout_minor??'1000000000000',{zero:false}));
  const opId=id||'op_'+random(15),keyId='st_'+random(18),secret=random(40),walletSecret=random(40),now=this.clock();
  this.transaction(()=>{
   this.run('INSERT INTO operators VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',opId,name,'enabled','sandbox',JSON.stringify(gameIds),currency,scale,mode,url,mode==='seamless'?this.vault.seal(walletSecret):null,JSON.stringify(allowed),initial,maxStake,maxPayout,internal?1:0,now,now);
   this.run('INSERT INTO api_keys VALUES(?,?,?,?,?,?)',keyId,opId,this.vault.seal(secret),JSON.stringify(scopes),null,now);
   this.audit(actor,'operator.created',opId,{wallet_mode:mode,currency,scale,internal});
  });
  return {operator:this.operatorView(this.operator(opId)),credential:{key_id:keyId,secret,scopes},...(mode==='seamless'?{wallet_signing_secret:walletSecret}:{}),note:'Secrets are shown only now. Store server-side.'};
 }
 internalOperator(){let op=this.get("SELECT * FROM operators WHERE id='st-internal'");if(!op){this.createOperator({name:'Soft Tech Internal QA',games:catalog.map(g=>g.id),currency:'VCOIN',scale:2,return_origins:[this.env.CORE_PUBLIC_ORIGIN||'https://soft-tech-provider-panel.up.railway.app']},'system',{internal:true,id:'st-internal'});op=this.operator('st-internal');}return op;}
 updateOperator(id,input,actor='admin'){
  const op=this.operator(id);if(op.internal)fail(409,'INTERNAL_OPERATOR_PROTECTED');
  if(input.status!==undefined&&!['enabled','disabled'].includes(input.status))fail(422,'INVALID_STATUS');
  const games=input.games||parse(op.games_json);if(!Array.isArray(games)||games.some(g=>!catalog.some(x=>x.id===g)))fail(422,'INVALID_GAMES');
  this.transaction(()=>{this.run('UPDATE operators SET status=?,games_json=?,updated_at=? WHERE id=?',input.status||op.status,JSON.stringify([...new Set(games)]),this.clock(),id);this.audit(actor,'operator.updated',id,{status:input.status||op.status,games});});
  return this.operatorView(this.operator(id));
 }
 rotateKey(id,actor='admin'){
  this.operator(id);const keyId='st_'+random(18),secret=random(40),now=this.clock();
  this.transaction(()=>{this.run('UPDATE api_keys SET revoked_at=? WHERE operator_id=? AND revoked_at IS NULL',now,id);this.run('INSERT INTO api_keys VALUES(?,?,?,?,?,?)',keyId,id,this.vault.seal(secret),JSON.stringify(scopes),null,now);this.audit(actor,'operator.keys_rotated',id);});
  return {key_id:keyId,secret,scopes};
 }
 authenticate({method,path,body='',headers},engine=false){
  const prefix=engine?'x-agency-':'x-softtech-',id=headers[prefix+'key'],ts=headers[prefix+'timestamp'],nonce=headers[prefix+'nonce'],sig=headers[prefix+'signature'];
  if(typeof id!=='string'||typeof ts!=='string'||!/^\d{10,11}$/.test(ts)||typeof nonce!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(nonce)||typeof sig!=='string'||!/^[a-f0-9]{64}$/.test(sig))fail(401,'INVALID_SIGNATURE');
  if(Math.abs(this.clock()/1000-Number(ts))>300)fail(401,'SIGNATURE_EXPIRED');
  let secret,principal;
  if(engine){principal=this.engineKeys.get(id);if(!principal)fail(401,'INVALID_SIGNATURE');secret=principal.secret;}
  else{const k=this.get('SELECT * FROM api_keys WHERE id=? AND revoked_at IS NULL',id);if(!k)fail(401,'INVALID_SIGNATURE');secret=this.vault.open(k.secret_box);principal={operator:this.operator(k.operator_id),scopes:parse(k.scopes_json),key_id:id};}
  if(!equal(sig,mac(secret,canonical(engine?'agency.v1':'softtech.v1',method,path,ts,nonce,body))))fail(401,'INVALID_SIGNATURE');
  if(this.get('SELECT 1 FROM replay_nonces WHERE key_id=? AND nonce=?',id,nonce))fail(409,'REPLAY_DETECTED');
  this.run('INSERT INTO replay_nonces VALUES(?,?,?)',id,nonce,this.clock());
  if(engine)this.run('UPDATE games SET signed_seen_at=? WHERE id=?',this.clock(),principal.game);
  return principal;
 }
 requireScope(principal,scope){if(!principal.scopes.includes(scope))fail(403,'SCOPE_DENIED');}
 ensureOperatorEnabled(op){if(op.status!=='enabled')fail(403,'OPERATOR_DISABLED');}
 safeGame(g){const age=g.checked_at===null?null:this.clock()-g.checked_at;return {...g,enabled:!!g.enabled,maintenance:!!g.maintenance,health:age!==null&&age>120000?'stale':g.health,health_json:undefined,checked_at:g.checked_at,adapter_verified:!!g.signed_seen_at,session_count:this.get('SELECT count(*) n FROM sessions WHERE game_id=?',g.id).n,round_count:this.get("SELECT count(*) n FROM rounds WHERE game_id=? AND status='settled'",g.id).n,capabilities:['sandbox','provider-session','durable-rounds','operator-isolation']};}
 games(op=null){const allowed=op?parse(op.games_json):null;return this.all('SELECT * FROM games ORDER BY id').filter(g=>!allowed||allowed.includes(g.id)).map(g=>this.safeGame(g));}
 setGame(id,p,actor='admin'){
  if(typeof p.maintenance!=='boolean')fail(422,'INVALID_MAINTENANCE');if(!this.get('SELECT id FROM games WHERE id=?',id))fail(404,'GAME_NOT_FOUND');
  this.transaction(()=>{this.run('UPDATE games SET maintenance=? WHERE id=?',p.maintenance?1:0,id);this.audit(actor,'game.maintenance',id,{enabled:p.maintenance,policy:'block new launches and reserves; finish accepted rounds'});});return this.games().find(g=>g.id===id);
 }
 createLaunch(op,input,idem,actor='operator'){
  text(idem,'idempotency_key',{min:8,max:100});const gameId=text(input.game_id,'game_id');const playerRef=text(input.player_ref,'player_ref',{max:120});
  const g=this.get('SELECT * FROM games WHERE id=?',gameId);if(!g||!parse(op.games_json).includes(gameId))fail(403,'GAME_NOT_ALLOWED');
  if(input.currency&&input.currency!==op.currency)fail(422,'CURRENCY_MISMATCH');
  const returnUrl=input.return_url||'';
  if(returnUrl){const u=originURL(returnUrl,{allowLocal:this.allowLocal,pathAllowed:true});if(!parse(op.return_origins_json).includes(u.origin))fail(422,'RETURN_ORIGIN_NOT_ALLOWED');}
  const fingerprint=sha(JSON.stringify({gameId,playerRef,currency:op.currency,returnUrl}));
  return this.transaction(()=>{
   this.ensureOperatorEnabled(op);
   const old=this.get('SELECT * FROM idempotency WHERE operator_id=? AND route=? AND key=?',op.id,'launch',idem);
   if(old){if(old.payload_hash!==fingerprint)fail(409,'IDEMPOTENCY_CONFLICT');return parse(this.vault.open(old.response_box));}
   if(!g.enabled||g.maintenance)fail(409,'GAME_MAINTENANCE');if(!g.origin)fail(503,'ENGINE_NOT_CONFIGURED');
   const pid='pl_'+sha(op.id+'\n'+playerRef+'\n'+op.currency).slice(0,40);const now=this.clock();
   if(!this.get('SELECT id FROM players WHERE id=?',pid)){
    this.run('INSERT INTO players VALUES(?,?,?,?,?,?,?)',pid,op.id,playerRef,op.currency,op.scale,'0',now);
    if(op.wallet_mode==='sandbox')this.append(op,pid,null,null,null,'sandbox_opening',BigInt(op.initial_minor),'opening:'+pid);
   }
   const token=random(36),sid='ss_'+random(24),expires=now+8*3600000;
   this.run('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',sid,op.id,pid,gameId,op.currency,op.scale,'created',sha(token),this.vault.seal(token),now+120000,null,returnUrl,now,expires,now,g.version);
   const response={session_id:sid,game_id:gameId,environment:'sandbox',currency:op.currency,scale:op.scale,launch_url:g.origin+g.play_path+'#softtech_launch='+token,launch_expires_at:new Date(now+120000).toISOString(),expires_at:new Date(expires).toISOString()};
   this.run('INSERT INTO idempotency VALUES(?,?,?,?,?,?)',op.id,'launch',idem,fingerprint,this.vault.seal(JSON.stringify(response)),now);
   this.audit(actor,'session.created',sid,{operator_id:op.id,game_id:gameId});return response;
  });
 }
 session(id,opId=null,gameId=null){const s=this.get('SELECT * FROM sessions WHERE id=?',id);if(!s||opId&&s.operator_id!==opId||gameId&&s.game_id!==gameId)fail(404,'SESSION_NOT_FOUND');return s;}
 sessionView(s){return {id:s.id,operator_id:s.operator_id,game_id:s.game_id,player_id:s.player_id,currency:s.currency,scale:s.scale,status:s.status==='active'&&s.expires_at<this.clock()?'expired':s.status,expires_at:s.expires_at,created_at:s.created_at,last_seen_at:s.last_seen_at,release:s.release};}
 revoke(opId,id,actor='operator'){this.session(id,opId);this.transaction(()=>{this.run("UPDATE sessions SET status='revoked' WHERE id=?",id);this.audit(actor,'session.revoked',id,{operator_id:opId});});return {session_id:id,status:'revoked',pending_round_policy:'accepted rounds remain settleable'};}
 redeem(key,p){
  text(p.token,'token',{min:30,max:120});text(p.request_id,'request_id',{min:8,max:120});
  return this.transaction(()=>{
   const s=this.get('SELECT * FROM sessions WHERE launch_hash=?',sha(p.token));if(!s||s.game_id!==key.game)fail(404,'LAUNCH_NOT_FOUND');
   const op=this.operator(s.operator_id);this.ensureOperatorEnabled(op);
   if(s.redeem_request&&s.redeem_request!==p.request_id)fail(409,'TOKEN_ALREADY_CONSUMED');
   if(s.status==='revoked'||s.expires_at<=this.clock())fail(401,'SESSION_EXPIRED');
   if(s.launch_expires_at<=this.clock())fail(401,'LAUNCH_EXPIRED');
   this.run("UPDATE sessions SET status='active',redeem_request=?,last_seen_at=? WHERE id=?",p.request_id,this.clock(),s.id);
   return {tenant_id:op.id,operator_id:op.id,player_id:s.player_id,session_id:s.id,game:s.game_id,coin_scale:s.scale,currency:s.currency,provider:'soft-tech',environment:'sandbox',expires_at:new Date(s.expires_at).toISOString(),navigation:s.return_url?{home_url:s.return_url,label:'Soft Tech'}:null};
  });
 }
 async status(key,p){
  const s=this.session(p.session_id,p.tenant_id,key.game);const op=this.operator(s.operator_id),player=this.get('SELECT * FROM players WHERE id=?',s.player_id);
  this.run('UPDATE sessions SET last_seen_at=? WHERE id=?',this.clock(),s.id);
  const bal=op.wallet_mode==='sandbox'?{balance_minor:player.balance_minor}:await this.transport(op,this.vault.open(op.wallet_secret),'balance',{player_ref:player.player_ref},{allowLocal:this.allowLocal});
  units(bal.balance_minor);
  return {session_id:s.id,tenant_id:op.id,player_id:s.player_id,game:s.game_id,balance:bal.balance_minor,reserved:'0',coin_scale:s.scale,currency:s.currency,expires_at:new Date(s.expires_at).toISOString(),session_expired:s.status==='revoked'||s.expires_at<=this.clock(),navigation:s.return_url?{home_url:s.return_url,label:'Soft Tech'}:null};
 }
 append(op,pid,sid,rid,gid,kind,amount,reference,balanceOverride=null){
  if(this.get('SELECT id FROM ledger WHERE operator_id=? AND reference=? AND kind=?',op.id,reference,kind))return;
  const p=this.get('SELECT * FROM players WHERE id=? AND operator_id=?',pid,op.id);if(!p)fail(404,'PLAYER_NOT_FOUND');
  let balance=null;
  if(op.wallet_mode==='sandbox'){balance=BigInt(p.balance_minor)+amount;if(balance<0n)fail(409,'INSUFFICIENT_BALANCE');this.run('UPDATE players SET balance_minor=? WHERE id=?',String(balance),pid);}
  else if(balanceOverride!==null){units(balanceOverride);balance=balanceOverride;this.run('UPDATE players SET balance_minor=? WHERE id=?',balanceOverride,pid);}
  this.run('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),op.id,pid,sid,rid,gid,kind,String(amount),op.currency,op.scale,balance===null?null:String(balance),reference,this.clock());
 }
 round(id,opId=null,gameId=null){const r=this.get('SELECT * FROM rounds WHERE id=?',id);if(!r||opId&&r.operator_id!==opId||gameId&&r.game_id!==gameId)fail(404,'ROUND_NOT_FOUND');return r;}
 async external(op,r,action,amount){
  const txid=r.id+':'+action;const player=this.get('SELECT * FROM players WHERE id=?',r.player_id);
  const payload={transaction_id:txid,player_ref:player.player_ref,session_id:r.session_id,round_id:r.id,game_id:r.game_id,amount_minor:amount,...(action==='reversal'?{original_transaction_id:r.id+':debit'}:{})};
  const encoded=JSON.stringify(payload),hash=sha(encoded),now=this.clock();
  this.run('INSERT OR IGNORE INTO wallet_ops(id,operator_id,round_id,action,payload_json,payload_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,\'pending\',?,?)',txid,op.id,r.id,action,encoded,hash,now,now);
  let row=this.get('SELECT * FROM wallet_ops WHERE id=?',txid);
  if(row.payload_hash!==hash)fail(409,'IDEMPOTENCY_CONFLICT');
  if(row.status==='ok')return parse(row.response_json);if(row.status==='rejected')fail(409,'WALLET_REJECTED');
  const secret=this.vault.open(op.wallet_secret);let receipt;
  try{
   if(row.attempts){receipt=await this.transport(op,secret,'status',{transaction_id:txid,player_ref:player.player_ref},{allowLocal:this.allowLocal});if(receipt.status==='pending')throw new WalletError('WALLET_OUTCOME_UNKNOWN');}
   if(!receipt||receipt.status==='not_found'){
    this.run('UPDATE wallet_ops SET attempts=attempts+1,updated_at=? WHERE id=?',this.clock(),txid);
    receipt=await this.transport(op,secret,action,payload,{allowLocal:this.allowLocal});
   }
   if(receipt.status==='rejected'){this.run("UPDATE wallet_ops SET status='rejected',response_json=?,updated_at=? WHERE id=?",JSON.stringify(receipt),this.clock(),txid);fail(409,'WALLET_REJECTED');}
   if(receipt.status!=='applied'||receipt.transaction_id!==txid||receipt.amount_minor!==amount||receipt.currency!==op.currency||receipt.scale!==op.scale)throw new WalletError('WALLET_OUTCOME_UNKNOWN');
   units(receipt.balance_minor);
   this.run("UPDATE wallet_ops SET status='ok',response_json=?,last_error=NULL,updated_at=? WHERE id=?",JSON.stringify(receipt),this.clock(),txid);return receipt;
  }catch(e){if(e.code!=='WALLET_REJECTED')this.run("UPDATE wallet_ops SET status='unknown',last_error=?,updated_at=? WHERE id=?",e.code||'NETWORK_ERROR',this.clock(),txid);throw e;}
 }
 async reserve(key,p){
  const s=this.session(p.session_id,p.tenant_id,key.game),op=this.operator(s.operator_id);
  const stake=units(p.stake,{zero:false}),maximum=units(p.max_payout);text(p.round_ref,'round_ref',{min:3,max:150});
  const fingerprint=sha(JSON.stringify({session:s.id,stake:String(stake),maximum:String(maximum)}));
  const lock=op.id+':'+s.player_id;
  return this.serial(lock,async()=>{
   let r=this.get('SELECT * FROM rounds WHERE operator_id=? AND game_id=? AND round_ref=?',op.id,key.game,p.round_ref);
   if(r&&r.payload_hash!==fingerprint)fail(409,'IDEMPOTENCY_CONFLICT');
   if(!r){
    this.ensureOperatorEnabled(this.operator(op.id));const current=this.session(s.id);const g=this.get('SELECT * FROM games WHERE id=?',key.game);
    if(current.status!=='active'||current.expires_at<=this.clock())fail(401,'SESSION_EXPIRED');
    if(!parse(op.games_json).includes(key.game))fail(403,'GAME_NOT_ALLOWED');
    if(g.maintenance||!g.enabled)fail(409,'GAME_MAINTENANCE');
    if(stake>BigInt(op.max_stake_minor)||maximum>BigInt(op.max_payout_minor))fail(422,'OPERATOR_LIMIT_EXCEEDED');
    const id='rd_'+random(24);
    this.transaction(()=>{this.run('INSERT INTO rounds(id,operator_id,player_id,session_id,game_id,round_ref,payload_hash,status,currency,scale,stake_minor,max_payout_minor,created_at) VALUES(?,?,?,?,?,?,?,\'intent\',?,?,?,?,?)',id,op.id,s.player_id,s.id,key.game,p.round_ref,fingerprint,op.currency,op.scale,String(stake),String(maximum),this.clock());this.audit('engine:'+key.game,'round.intent',id,{session_id:s.id});});
    r=this.round(id);
   }
   if(r.status==='rejected'||r.status==='voided')fail(409,'ROUND_NOT_RESERVABLE');
   if(r.status==='intent'){
    let receipt=null;
    try{
     if(op.wallet_mode==='seamless')receipt=await this.external(op,r,'debit',r.stake_minor);
     this.transaction(()=>{this.append(op,r.player_id,r.session_id,r.id,r.game_id,'debit',-BigInt(r.stake_minor),r.id+':debit',receipt?.balance_minor??null);this.run("UPDATE rounds SET status='reserved' WHERE id=?",r.id);});
    }catch(e){if(['INSUFFICIENT_BALANCE','WALLET_REJECTED'].includes(e.code))this.run("UPDATE rounds SET status='rejected',finished_at=? WHERE id=?",this.clock(),r.id);throw e;}
   }
   return {id:r.id,round_id:r.id,round_ref:r.round_ref,status:this.round(r.id).status,currency:r.currency,stake:r.stake_minor};
  });
 }
 async settle(key,p){
  const first=this.round(p.round_id,p.tenant_id,key.game);const payout=String(units(p.payout));text(p.evidence,'evidence',{max:300});
  return this.serial(first.operator_id+':'+first.player_id,async()=>{
   const r=this.round(first.id),op=this.operator(r.operator_id);
   if(r.payout_minor!==null&&(r.payout_minor!==payout||r.evidence!==p.evidence))fail(409,'SETTLEMENT_CONFLICT');
   if(r.status==='settled')return {id:r.id,status:'settled',payout:r.payout_minor};
   if(r.reversal_requested)fail(409,'REVERSAL_IN_PROGRESS');
   if(r.status!=='reserved')fail(409,'ROUND_NOT_RESERVED');
   if(BigInt(payout)>BigInt(r.max_payout_minor))fail(422,'PAYOUT_EXCEEDS_RESERVED_CAP');
   // Store settlement intent before any external credit. Retry/recovery reuses this exact payload.
   this.run('UPDATE rounds SET payout_minor=?,evidence=? WHERE id=?',payout,p.evidence,r.id);
   let receipt=null;if(op.wallet_mode==='seamless')receipt=await this.external(op,r,'credit',payout);
   this.transaction(()=>{this.append(op,r.player_id,r.session_id,r.id,r.game_id,'credit',BigInt(payout),r.id+':credit',receipt?.balance_minor??null);this.run("UPDATE rounds SET status='settled',finished_at=? WHERE id=?",this.clock(),r.id);this.audit('engine:'+key.game,'round.settled',r.id,{operator_id:op.id,payout_minor:payout,evidence:p.evidence});});
   return {id:r.id,status:'settled',payout};
  });
 }
 async voidRound(key,p){
  const first=this.round(p.round_id,p.tenant_id,key.game);
  return this.serial(first.operator_id+':'+first.player_id,async()=>{
   const r=this.round(first.id),op=this.operator(r.operator_id);
   if(r.status==='voided')return {id:r.id,status:'voided'};
   if(r.status!=='reserved'||r.payout_minor!==null)fail(409,'ROUND_CANNOT_BE_REVERSED');
   this.run('UPDATE rounds SET reversal_requested=1 WHERE id=?',r.id);
   let receipt=null;if(op.wallet_mode==='seamless')receipt=await this.external(op,r,'reversal',r.stake_minor);
   this.transaction(()=>{this.append(op,r.player_id,r.session_id,r.id,r.game_id,'reversal',BigInt(r.stake_minor),r.id+':reversal',receipt?.balance_minor??null);this.run("UPDATE rounds SET status='voided',finished_at=? WHERE id=?",this.clock(),r.id);this.audit('engine:'+key.game,'round.reversed',r.id);});return {id:r.id,status:'voided'};
  });
 }
 async engineAction(key,action,p){
  if(!p||typeof p!=='object'||Array.isArray(p))fail(422,'OBJECT_REQUIRED');
  if(action==='redeem')return this.redeem(key,p);
  if(!p.tenant_id)fail(422,'OPERATOR_SCOPE_REQUIRED');
  if(action==='status')return this.status(key,p);
  if(action==='reserve')return this.reserve(key,p);
  if(action==='settle')return this.settle(key,p);
  if(action==='void')return this.voidRound(key,p);
  fail(404,'UNSUPPORTED_ENGINE_ACTION');
 }
 reconciliation(opId=null,actor='admin',save=true){
  if(opId)this.operator(opId);
  const rounds=this.all('SELECT * FROM rounds'+(opId?' WHERE operator_id=?':'')+' ORDER BY created_at DESC LIMIT 1000',...(opId?[opId]:[]));
  const issues=[];
  for(const r of rounds){
   const rows=this.all('SELECT * FROM ledger WHERE round_id=?',r.id),debits=rows.filter(x=>x.kind==='debit'),credits=rows.filter(x=>x.kind==='credit'),reversals=rows.filter(x=>x.kind==='reversal');
   if(r.status==='intent'||r.status==='reserved')issues.push({round_id:r.id,code:'PENDING',status:r.status});
   if(['reserved','settled','voided'].includes(r.status)&&(debits.length!==1||debits[0].amount_minor!=='-'+r.stake_minor))issues.push({round_id:r.id,code:'DEBIT_MISMATCH'});
   if(r.status==='settled'&&(credits.length!==1||credits[0].amount_minor!==r.payout_minor))issues.push({round_id:r.id,code:'CREDIT_MISMATCH'});
   if(r.status==='voided'&&(reversals.length!==1||reversals[0].amount_minor!==r.stake_minor))issues.push({round_id:r.id,code:'REVERSAL_MISMATCH'});
  }
  const players=this.all("SELECT p.* FROM players p JOIN operators o ON o.id=p.operator_id WHERE o.wallet_mode='sandbox'"+(opId?' AND p.operator_id=?':''),...(opId?[opId]:[]));
  for(const p of players){const total=this.all('SELECT amount_minor FROM ledger WHERE player_id=?',p.id).reduce((n,x)=>n+BigInt(x.amount_minor),0n);if(total!==BigInt(p.balance_minor))issues.push({player_id:p.id,code:'BALANCE_MISMATCH'});}
  const result={id:'check_'+random(16),operator_id:opId,status:!rounds.length?'no_activity':issues.length?'attention':'matched',rounds_checked:rounds.length,issues,scope:'provider journal; external-wallet acknowledgements, not unrelated operator transactions',checked_at:this.clock()};
  if(save)this.transaction(()=>{this.run('INSERT INTO checks VALUES(?,?,?,?)',result.id,opId,JSON.stringify(result),this.clock());this.audit(actor,'reconciliation.completed',opId||'all',{status:result.status,issues:issues.length});});return result;
 }
 reports(opId=null,{limit=100,offset=0,game=null}={}){
  limit=Math.min(200,Math.max(1,Math.floor(Number(limit)||100)));offset=Math.max(0,Math.floor(Number(offset)||0));
  const where=[],args=[];if(opId){where.push('operator_id=?');args.push(opId);}if(game){where.push('game_id=?');args.push(game);}
  const w=where.length?' WHERE '+where.join(' AND '):'';
  return {sessions:this.all('SELECT * FROM sessions'+w+' ORDER BY created_at DESC LIMIT ? OFFSET ?',...args,limit,offset).map(x=>this.sessionView(x)),rounds:this.all('SELECT * FROM rounds'+w+' ORDER BY created_at DESC LIMIT ? OFFSET ?',...args,limit,offset),transactions:this.all('SELECT * FROM ledger'+w+' ORDER BY created_at DESC LIMIT ? OFFSET ?',...args,limit,offset),pagination:{limit,offset}};
 }
 bootstrap(role){
  const reports=this.reports(),games=this.games();
  const summary={games:games.length,operators:this.get('SELECT count(*) n FROM operators WHERE internal=0').n,sessions:this.get("SELECT count(*) n FROM sessions WHERE status='active' AND expires_at>? AND last_seen_at>?",this.clock(),this.clock()-300000).n,rounds:this.get("SELECT count(*) n FROM rounds WHERE status='settled'").n,pending:this.get("SELECT count(*) n FROM rounds WHERE status IN('intent','reserved')").n,connected_games:games.filter(g=>g.adapter_verified&&g.health==='ok').length};
  return {mode:'PROVIDER CORE',environment:'sandbox',version:'1.0.0',role,connected:games.some(g=>g.adapter_verified),persistent:true,source_commit:this.env.RAILWAY_GIT_COMMIT_SHA||'local',summary,games,operators:this.all('SELECT * FROM operators ORDER BY internal DESC,created_at DESC').map(o=>this.operatorView(o)),...reports,audit:this.all('SELECT * FROM audit ORDER BY created_at DESC LIMIT 100').map(a=>({...a,detail:parse(a.detail_json),detail_json:undefined})),checks:this.all('SELECT * FROM checks ORDER BY created_at DESC LIMIT 30').map(c=>parse(c.result_json)),selftests:this.all('SELECT id,status,created_at,updated_at FROM selftests ORDER BY created_at DESC LIMIT 10'),updated_at:this.clock()};
 }
 async refreshHealth(){
  await Promise.all(this.all('SELECT * FROM games').map(async g=>{
   if(!g.origin){this.run("UPDATE games SET health='not_configured',checked_at=? WHERE id=?",this.clock(),g.id);return;}
   let status='unreachable',data={};
   try{const r=await fetch(g.origin+'/health',{signal:AbortSignal.timeout(10000),redirect:'error'});data=await r.json();status=r.ok&&data.ok===true&&data.provider==='soft-tech'?'ok':'degraded';}catch{data={error:'engine request failed'};}
   this.run('UPDATE games SET health=?,health_json=?,version=?,checked_at=? WHERE id=?',status,JSON.stringify(data).slice(0,16000),String(data.version||data.engine_version||data.source_commit?.slice(0,12)||g.version).slice(0,80),this.clock(),g.id);
  }));return this.games();
 }
 async recover(){
  this.run('DELETE FROM replay_nonces WHERE created_at<?',this.clock()-600000);this.run('DELETE FROM panel_sessions WHERE expires_at<?',this.clock());
  const pending=this.all("SELECT * FROM rounds WHERE status='intent' OR (status='reserved' AND (payout_minor IS NOT NULL OR reversal_requested=1)) ORDER BY created_at LIMIT 50");
  for(const r of pending){try{
   const key={game:r.game_id};
   if(r.status==='intent')await this.reserve(key,{tenant_id:r.operator_id,session_id:r.session_id,round_ref:r.round_ref,stake:r.stake_minor,max_payout:r.max_payout_minor});
   else if(r.reversal_requested)await this.voidRound(key,{tenant_id:r.operator_id,round_id:r.id});
   else await this.settle(key,{tenant_id:r.operator_id,round_id:r.id,payout:r.payout_minor,evidence:r.evidence});
  }catch{}}
 }
}
