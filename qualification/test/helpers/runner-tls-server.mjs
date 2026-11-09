// Synthetic HTTP transport fixture only; no game/RNG/certification evidence.
import https from 'node:https';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const tls={key:readFileSync(process.argv[2]),cert:readFileSync(process.argv[3])};
const games=['uno-luck','mahjong-wild','skygate-5000'],servers=[],sessions=new Map();
let counts={requests:0,launches:0,rounds:0,duplicates:0,state:0,connections:0,roundsBeforeBarrier:0},barrier=false;
const sockets=new Set();
const committed=new Map();
for(const game of games){const server=https.createServer(tls,async(req,res)=>{
 const started=performance.now();counts.requests++;const chunks=[];for await(const c of req)chunks.push(c);let p={};try{p=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{res.writeHead(400);res.end('{}');return;}
 const send=(status,value,headers={})=>{const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body),'server-timing':'fixture;dur='+Math.round(performance.now()-started),...headers});res.end(body);};
 if(req.headers['x-fixture-mode']==='redirect'){send(302,{}, {location:'/unwanted-redirect'});return;}
 if(req.url==='/unwanted-redirect'){send(500,{error:'redirect followed'});return;}
 if(req.headers['x-fixture-mode']==='invalid'){res.end('{');return;}
 if(req.headers['x-fixture-mode']==='drop'){req.socket.destroy();return;}
 if(req.headers['x-fixture-mode']==='commit-drop'){
  let r=committed.get(p.request_id);if(!r){r={applied:1,attempts:1};committed.set(p.request_id,r);req.socket.destroy();return;}r.attempts++;send(200,r);return;
 }
 if(req.headers['x-fixture-mode']==='idle-close'){send(200,{ok:true});setTimeout(()=>req.socket.end(),30);return;}
 if(req.headers['x-fixture-mode']==='slow-body'){res.writeHead(200,{'content-type':'application/json','content-length':100});res.write('{');const timer=setInterval(()=>res.write(' '),30);res.once('close',()=>clearInterval(timer));return;}
 if(req.headers['x-fixture-mode']==='slow'){await new Promise(r=>setTimeout(r,200));send(200,{ok:true});return;}
 if(req.url==='/api/agency/launch'){const cookie=createHash('sha256').update(game+':'+p.token).digest('hex');sessions.set(cookie,{id:cookie,phase:0,connection:req.socket});counts.launches++;await new Promise(r=>setTimeout(r,50));send(200,{ok:true},{'set-cookie':['fixture_session='+cookie+'; HttpOnly; Secure; SameSite=Strict','fixture_secondary=ok; Secure']});return;}
 const cookie=/fixture_session=([a-f0-9]{64})/.exec(req.headers.cookie||'')?.[1],s=sessions.get(cookie);if(!s){send(401,{error:'fixture session required'});return;}
 if(req.url.endsWith('/state')){counts.state++;send(200,game==='uno-luck'?{rules:{stake_options:[25]}}:game==='mahjong-wild'?{ticket:{id:'ticket-'+s.id},bet_options:['1']}:{release_id:'bundled'});return;}
 if(!barrier)counts.roundsBeforeBarrier++;
 if(game==='uno-luck'){
  if(p.expected_phase===3&&s.phase===3){counts.duplicates++;send(200,s.final);return;}
  if(p.expected_phase!==s.phase+1){send(409,{error:'phase mismatch'});return;}
  s.phase++;const value={round:{id:'round-'+s.id,complete:s.phase===3,cards:['fixture-a','fixture-b','fixture-c']}};if(s.phase===3){s.final=value;counts.rounds++;}send(200,value);return;
 }
 if(s.final){counts.duplicates++;send(200,s.final);return;}
 counts.rounds++;s.final=game==='mahjong-wild'?{ticket_id:p.ticket_id,round:{id:'round-'+s.id,synthetic:true},stake_virtual_credits:'1',win_virtual_credits:'0',settlement:{payout_minor:'0'}}:{id:'round-'+s.id,round:{synthetic:true},state:{}};send(200,s.final);
 });server.keepAliveTimeout=30000;server.on('secureConnection',socket=>{counts.connections++;sockets.add(socket);socket.setNoDelay(true);socket.once('close',()=>sockets.delete(socket));});await new Promise(r=>server.listen(0,'127.0.0.1',512,r));servers.push(server);}
process.send({origins:servers.map(s=>'https://localhost:'+s.address().port)});
process.on('message',m=>{if(m==='barrier'){barrier=true;process.send({barrier:true});}if(m==='reset'){sessions.clear();counts={requests:0,launches:0,rounds:0,duplicates:0,state:0,connections:0,roundsBeforeBarrier:0};barrier=false;process.send({reset:true});}if(m==='counts')process.send({counts});if(m==='close'){for(const socket of sockets)socket.destroy();for(const s of servers)s.close();process.exit(0);}});
