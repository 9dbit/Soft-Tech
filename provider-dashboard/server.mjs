import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";

const port = Number(process.env.PORT || 8080);
const root = resolve(import.meta.dirname, "public");
const adminPassword = process.env.PANEL_ADMIN_PASSWORD || "";
const auditorPassword = process.env.PANEL_AUDITOR_PASSWORD || "";
const secret = process.env.PANEL_SESSION_SECRET || "";
if (adminPassword.length < 16 || auditorPassword.length < 16 || secret.length < 32) {
  console.error("Missing PANEL_ADMIN_PASSWORD (16+), PANEL_AUDITOR_PASSWORD (16+), or PANEL_SESSION_SECRET (32+).");
  process.exit(1);
}
const games = [
  { id:"skygate", name:"SKYGATE 5000", category:"Fantasy / Arcade", status:"Demo", version:"Prototype", activeSessions:42, rounds:1080, cover:"SKY" },
  { id:"mahjong", name:"MAHJONG WILD", category:"Puzzle / Wild", status:"Demo", version:"Prototype", activeSessions:28, rounds:740, cover:"WILD" },
  { id:"uno", name:"UNO LUCK", category:"Card / Social", status:"Demo", version:"Prototype", activeSessions:35, rounds:900, cover:"UNO" }
];
const operators = [
  { id:"OP-EU-001", name:"Sandbox Operator EU", region:"Europe", currency:"VCOIN", status:"Enabled", games:["skygate","mahjong","uno"], createdAt:"2026-11-01T08:20:00Z" },
  { id:"OP-DEMO-002", name:"Sandbox Operator B", region:"Testing", currency:"VCOIN", status:"Enabled", games:["skygate","uno"], createdAt:"2026-11-02T12:00:00Z" },
  { id:"OP-AUDIT-003", name:"Auditor Sample", region:"Sandbox", currency:"VCOIN", status:"Disabled", games:["mahjong"], createdAt:"2026-11-03T10:00:00Z" }
];
const ledger = [
  { id:"LD-1052", time:"2026-11-08T09:01:00Z", operator:"OP-EU-001", game:"SKYGATE 5000", type:"Credit", amount:1200, balance:12900, reference:"SIM-RND-052" },
  { id:"LD-1051", time:"2026-11-08T08:59:00Z", operator:"OP-EU-001", game:"SKYGATE 5000", type:"Debit", amount:-200, balance:11700, reference:"SIM-RND-052" },
  { id:"LD-1050", time:"2026-11-08T08:51:00Z", operator:"OP-DEMO-002", game:"UNO LUCK", type:"Debit", amount:-400, balance:8000, reference:"SIM-RND-051" },
  { id:"LD-1049", time:"2026-11-08T08:44:00Z", operator:"OP-DEMO-002", game:"UNO LUCK", type:"Credit", amount:750, balance:8400, reference:"SIM-RND-050" },
  { id:"LD-1048", time:"2026-11-08T08:31:00Z", operator:"OP-EU-001", game:"MAHJONG WILD", type:"Debit", amount:-150, balance:11900, reference:"SIM-RND-049" }
];
const audit = [
  { at:"2026-11-08T09:12:00Z", actor:"System Demo", event:"Reconciliation preview generated", scope:"OP-EU-001" },
  { at:"2026-11-08T09:01:00Z", actor:"System Demo", event:"Simulated round completed", scope:"SKYGATE 5000" }
];
const rate = new Map();
const contentTypes = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".woff2":"font/woff2",".png":"image/png",".svg":"image/svg+xml"};

function send(res, status, data, type="application/json; charset=utf-8", extra={}) {
  const body = type.startsWith("application/json") ? JSON.stringify(data) : data;
  res.writeHead(status, { "Content-Type":type, "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"same-origin", "X-Frame-Options":"DENY", ...extra });
  res.end(body);
}
function equal(a,b){
  const x=createHash("sha256").update(a).digest(),y=createHash("sha256").update(b).digest();
  return timingSafeEqual(x,y);
}
function sign(value){return createHmac("sha256",secret).update(value).digest("base64url");}
function token(role){ const data=Buffer.from(JSON.stringify({role,exp:Date.now()+8*3600000,nonce:randomBytes(8).toString("hex")})).toString("base64url");return data+"."+sign(data); }
function session(req){
  const header=req.headers.cookie||"";
  const raw=header.split(";").map(x=>x.trim()).find(x=>x.startsWith("stp_session="))?.slice(12);
  if(!raw)return null;
  const [payload,sig]=raw.split(".");
  if(!payload||!sig||!equal(sign(payload),sig))return null;
  try {const out=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));return out.exp>Date.now()&&["admin","auditor"].includes(out.role)?out:null;}
  catch {return null;}
}
function cookie(req,val,maxAge){
  const secure=req.headers["x-forwarded-proto"]==="https" || String(req.headers.host||"").endsWith(".railway.app");
  return "stp_session="+val+"; HttpOnly; Path=/; SameSite=Strict; Max-Age="+maxAge+(secure?"; Secure":"");
}
function deny(res){send(res,401,{error:"UNAUTHENTICATED",message:"Sign in to access provider demo data."});}
function checkOrigin(req){
  if(!req.headers.origin)return true;
  try{return new URL(req.headers.origin).host===req.headers.host;}catch{return false;}
}
async function body(req){
  let s="";for await(const c of req){s+=c;if(s.length>4096)throw new Error("Request body too large");}
  try{return JSON.parse(s||"{}");}catch{throw new Error("Invalid JSON");}
}
function bootstrap(role){
  return {mode:"SANDBOX DEMO",connected:false,description:"Illustrative game/provider data. No real Playground ledger or payment system is connected.",
   role,games,operators,ledger,audit,summary:{games:3,operators:operators.filter(o=>o.status==="Enabled").length,sessions:games.reduce((a,g)=>a+g.activeSessions,0),rounds:games.reduce((a,g)=>a+g.rounds,0)},
   updatedAt:new Date().toISOString(), currencies:["VCOIN"], actionsEnabled:role==="admin"};
}
function openapi(){
  return {openapi:"3.1.0",info:{title:"Soft Tech Provider Panel Demo API",version:"0.1.0-demo",description:"Sandbox dashboard administration endpoints only. The game/wallet integration contract is a design reference, NOT a deployed public API."},
   servers:[{url:"/"}],security:[{cookieAuth:[]}],
   paths:{
    "/health":{get:{summary:"Public readiness check",responses:{"200":{description:"Service ready"}}}},
    "/api/session":{get:{summary:"Session/role status",responses:{"200":{description:"Session status"}}}},
    "/api/login":{post:{summary:"Sign in (admin/auditor)",responses:{"200":{description:"Authenticated"},"401":{description:"Invalid credentials"}}}},
    "/api/bootstrap":{get:{summary:"Read example games, operators, ledger and audit records",security:[{cookieAuth:[]}],responses:{"200":{description:"Demo data"},"401":{description:"Login required"}}}},
    "/api/operators":{post:{summary:"Admin-only in-memory demo operator toggle",responses:{"200":{description:"Demo state updated"},"403":{description:"Auditors read-only"}}}},
    "/api/reconcile":{post:{summary:"Admin-only simulated reconciliation",responses:{"200":{description:"Illustrative audit result"},"403":{description:"Auditors read-only"}}}}
   },components:{securitySchemes:{cookieAuth:{type:"apiKey",in:"cookie",name:"stp_session"}}},
   "x-future-integration":{"status":"NOT_IMPLEMENTED","required-contract":["POST /sessions","GET /wallets/{id}","POST /wallets/{id}/debit","POST /wallets/{id}/credit","POST /rounds/events","POST /callbacks"],
   "requirements":["HTTPS","HMAC signed callbacks","Idempotency-Key for debit/credit","Replay protection","Per-operator currency/limits","Atomic ledger writes","Detailed error codes","Audit logging"]}};
}
function developerHtml(){
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Soft Tech | API Developer Draft</title><style>body{background:#0d0e13;color:#efebfa;font:15px/1.7 ui-monospace,monospace;max-width:920px;margin:auto;padding:40px 24px}h1,h2{color:#cf9cff}code{background:#252031;padding:3px 6px;border-radius:5px}pre{white-space:pre-wrap;background:#19151e;padding:18px;border-radius:12px}small{color:#af9cbf}a{color:#cda1ff}</style><small>SOFT TECH / API DEVELOPER • SANDBOX REFERENCE ONLY</small><h1>Provider API Integration Draft</h1><p>This is a design reference, not a production API. No external ledger, wallet or game endpoints are live through this dashboard.</p><h2>Integration Flow</h2><ol><li>Provision one operator ID and access scopes</li><li>Start a signed game session</li><li>Get wallet snapshot</li><li>Send idempotent debit and credit requests</li><li>Publish round result events with timestamps</li><li>Reconcile operator ledger and retain audit trail</li></ol><h2>Proposed Endpoint Shapes (Not Implemented)</h2><pre>POST /sessions {operator_id, game_id, player_ref, currency}\nGET /wallets/{player_ref}\nPOST /wallets/{player_ref}/debit {amount, round_id, idempotency_key}\nPOST /wallets/{player_ref}/credit {amount, round_id, idempotency_key}\nPOST /rounds/events {round_id, status, outcome_ref, timestamp}\nPOST /callbacks {event_id, operator_id, signature, timestamp}</pre><h2>Security &amp; Reliability</h2><p>Use HTTPS, per-operator scoped credentials, HMAC signatures, replay windows, atomic ledger operations, idempotency for all value movements, correlation IDs, retries with backoff, and authenticated reconciliation reporting.</p><h2>What This Demo Actually Provides</h2><p><code>GET /api/bootstrap</code>, <code>POST /api/operators</code>, <code>POST /api/reconcile</code>, cookie-based demo login, and protected downloads. All values are fictional and reset when the server restarts.</p><p><small>Soft Tech Provider Dashboard • 2026 • Draft v0.1</small></p></html>';
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||"/","http://localhost"),path=url.pathname,role=session(req)?.role;
  if(path==="/health"){send(res,200,{status:"ok",app:"soft-tech-provider-panel",mode:"demo"});return;}
  if(path.startsWith("/api/")){
    if(req.method==="POST"&&!checkOrigin(req)){send(res,403,{error:"INVALID_ORIGIN"});return;}
    if(path==="/api/session"&&req.method==="GET"){send(res,200,{authenticated:!!role,role:role||null,mode:"demo"});return;}
    if(path==="/api/login"&&req.method==="POST"){
      const ip=String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"").split(",")[0],now=Date.now();
      const attempts=(rate.get(ip)||[]).filter(t=>t>now-10*60000);
      if(attempts.length>=10){send(res,429,{error:"RATE_LIMITED"});return;}
      let value;try{value=await body(req);}catch{send(res,400,{error:"BAD_BODY"});return;}
      const valid=(value.role==="admin"&&equal(String(value.password||""),adminPassword))||
                  (value.role==="auditor"&&equal(String(value.password||""),auditorPassword));
      if(!valid){attempts.push(now);rate.set(ip,attempts);send(res,401,{error:"INVALID_CREDENTIALS"});return;}
      rate.delete(ip);send(res,200,{role:value.role,mode:"demo"},"application/json; charset=utf-8",{"Set-Cookie":cookie(req,token(value.role),8*3600)});return;
    }
    if(path==="/api/logout"&&req.method==="POST"){send(res,200,{success:true},"application/json; charset=utf-8",{"Set-Cookie":cookie(req,"",0)});return;}
    if(!role){deny(res);return;}
    if(path==="/api/bootstrap"&&req.method==="GET"){send(res,200,bootstrap(role));return;}
    if(path==="/api/download/openapi.json"&&req.method==="GET"){send(res,200,openapi(),"application/json; charset=utf-8",{"Content-Disposition":'attachment; filename="soft-tech-provider-openapi-demo.json"'});return;}
    if(path==="/api/download/developer.html"&&req.method==="GET"){send(res,200,developerHtml(),"text/html; charset=utf-8",{"Content-Disposition":'attachment; filename="soft-tech-provider-api-developer-demo.html"'});return;}
    if(path==="/api/operators"&&req.method==="POST"){
      if(role!=="admin"){send(res,403,{error:"READ_ONLY_ROLE"});return;}
      let value;try{value=await body(req);}catch{send(res,400,{error:"BAD_BODY"});return;}
      const op=operators.find(x=>x.id===value.id);
      if(!op||typeof value.enabled!=="boolean"){send(res,422,{error:"INVALID_OPERATOR"});return;}
      op.status=value.enabled?"Enabled":"Disabled";
      audit.unshift({at:new Date().toISOString(),actor:"Demo Admin",event:"Sample operator changed to "+op.status,scope:op.id});
      send(res,200,{mode:"demo",operator:op});return;
    }
    if(path==="/api/reconcile"&&req.method==="POST"){
      if(role!=="admin"){send(res,403,{error:"READ_ONLY_ROLE"});return;}
      let value;try{value=await body(req);}catch{send(res,400,{error:"BAD_BODY"});return;}
      const op=operators.find(x=>x.id===value.operatorId);
      if(!op){send(res,422,{error:"INVALID_OPERATOR"});return;}
      const entries=ledger.filter(x=>x.operator===op.id);
      const net=entries.reduce((sum,x)=>sum+x.amount,0);
      const item={at:new Date().toISOString(),actor:"Demo Admin",event:"Simulated reconciliation completed (net "+net+" VCOIN, "+entries.length+" entries)",scope:op.id};
      audit.unshift(item);send(res,200,{mode:"demo",operator:op.id,entries:entries.length,net,matched:true,audit:item});return;
    }
    send(res,404,{error:"NOT_FOUND"});return;
  }
  if(req.method!=="GET"){send(res,405,{error:"METHOD_NOT_ALLOWED"});return;}
  const file=path==="/" ? "/index.html":path;
  if(!["/index.html","/app.js","/style.css","/Minecraft.woff2","/logo.png"].includes(file)){send(res,404,{error:"NOT_FOUND"});return;}
  try{
    const contents=await readFile(resolve(root,"."+file));
    const ext=extname(file);
    send(res,200,contents,contentTypes[ext]||"application/octet-stream",{
      "Cache-Control":ext===".html"?"no-store":"public, max-age=3600",
      "Content-Security-Policy":"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
  }catch{send(res,404,{error:"NOT_FOUND"});}
});
server.listen(port,"0.0.0.0",()=>console.log("Soft Tech Provider Panel demo ready on port "+port));
