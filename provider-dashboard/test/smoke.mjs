import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const port=39700+Math.floor(Math.random()*100);
const base="http://127.0.0.1:"+port;
const config={...process.env,PORT:String(port),PANEL_ADMIN_PASSWORD:"DemoAdmin#"+randomBytes(10).toString("hex"),
  PANEL_AUDITOR_PASSWORD:"DemoAudit#"+randomBytes(10).toString("hex"),
  PANEL_SESSION_SECRET:randomBytes(40).toString("hex")};
const child=spawn(process.execPath,["server.mjs"],{cwd:process.cwd(),env:config,stdio:["ignore","pipe","pipe"]});
let serverLog="";child.stderr.on("data",b=>serverLog+=b.toString());
async function fetchJson(path,init={}){const r=await fetch(base+path,init);let data={};try{data=await r.json();}catch{}return {r,data};}
async function waitForService(){
  for(let i=0;i<70;i++){try{let r=await fetch(base+"/health");if(r.status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}
  throw Error("Server never ready: "+serverLog);
}
const headers=(cookie)=>({"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})});
async function run(){
  await waitForService();
  const health=await fetchJson("/health");assert.equal(health.data.status,"ok");
  let r=await fetchJson("/api/bootstrap");assert.equal(r.r.status,401,"private data protected");
  r=await fetchJson("/api/login",{method:"POST",headers:headers(),body:JSON.stringify({role:"admin",password:"wrong-password"})});assert.equal(r.r.status,401);
  r=await fetchJson("/api/login",{method:"POST",headers:headers(),body:JSON.stringify({role:"auditor",password:config.PANEL_AUDITOR_PASSWORD})});assert.equal(r.r.status,200);
  const auditorCookie=r.r.headers.get("set-cookie").split(";")[0];assert.ok(auditorCookie.startsWith("stp_session="));
  r=await fetchJson("/api/bootstrap",{headers:headers(auditorCookie)});assert.equal(r.r.status,200);assert.equal(r.data.role,"auditor");
  assert.equal(r.data.games.length,3);assert.equal(r.data.operators.length,3);assert.equal(r.data.mode,"SANDBOX DEMO");assert.equal(r.data.connected,false);
  r=await fetchJson("/api/operators",{method:"POST",headers:headers(auditorCookie),body:JSON.stringify({id:"OP-EU-001",enabled:false})});assert.equal(r.r.status,403,"auditor read only");
  let doc=await fetch(base+"/api/download/openapi.json",{headers:headers(auditorCookie)});
  assert.equal(doc.status,200);assert.match(doc.headers.get("content-disposition"),/attachment/);
  let schema=await doc.json();assert.equal(schema.openapi,"3.1.0");assert.equal(schema["x-future-integration"].status,"NOT_IMPLEMENTED");
  doc=await fetch(base+"/api/download/developer.html",{headers:headers(auditorCookie)});
  assert.equal(doc.status,200);assert.match(await doc.text(),/SANDBOX REFERENCE ONLY/);
  r=await fetchJson("/api/login",{method:"POST",headers:headers(),body:JSON.stringify({role:"admin",password:config.PANEL_ADMIN_PASSWORD})});assert.equal(r.r.status,200);
  const adminCookie=r.r.headers.get("set-cookie").split(";")[0];
  r=await fetchJson("/api/operators",{method:"POST",headers:headers(adminCookie),body:JSON.stringify({id:"OP-EU-001",enabled:false})});
  assert.equal(r.r.status,200);assert.equal(r.data.operator.status,"Disabled");
  r=await fetchJson("/api/reconcile",{method:"POST",headers:headers(adminCookie),body:JSON.stringify({operatorId:"OP-EU-001"})});
  assert.equal(r.r.status,200);assert.equal(r.data.matched,true);assert.equal(r.data.mode,"demo");
  r=await fetchJson("/api/bootstrap",{headers:headers(adminCookie)});assert.equal(r.data.operators[0].status,"Disabled");
  const html=await (await fetch(base+"/")).text();for(const section of ["overview","games","operators","ledger","reconcile","developer"])assert.match(html,new RegExp('data-page="'+section+'"'));
  const css=await (await fetch(base+"/style.css")).text();assert.match(css,/@font-face/);assert.match(css,/Minecraft/);
  const font=await fetch(base+"/Minecraft.woff2");assert.equal(font.status,200);
  const logo=await fetch(base+"/logo.png");assert.equal(logo.status,200);
  const traversal=await fetch(base+"/../.env");assert.equal(traversal.status,404);
  const loggedOut=await fetchJson("/api/logout",{method:"POST",headers:headers(adminCookie),body:"{}"});assert.equal(loggedOut.r.status,200);
  console.log("PASS: private session, role separation, six modules, HTML/OpenAPI downloads, demo operators, reconciliation, font assets");
}
try{await run();}finally{child.kill("SIGTERM");}
