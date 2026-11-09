"use strict";
const state={role:null,data:null,page:"overview",filter:"",period:"daily",lastReconcile:null};
const $=(id)=>document.getElementById(id);
const escapeHtml=(value)=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const n=(v)=>Number(v||0).toLocaleString("en-US");
const when=(v)=>new Date(v).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"UTC"})+" UTC";
const tag=(value)=>'<span class="tag '+(value==="Enabled"||value==="Matched"?"good":value==="Disabled"?"off":value==="Demo"?"demo":"warn")+'">'+escapeHtml(value)+'</span>';
const icon={overview:"◈",games:"▣",operators:"⌘",ledger:"≡",reconcile:"⇄",developer:"⌁"};
const label={overview:"Overview",games:"Games",operators:"Operators",ledger:"Sessions & Ledger",reconcile:"Reconciliation",developer:"API Developer"};
let toastTimer=0;
function notice(message){const el=$("toast");el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,4000);}
async function request(path,options={}){
  const response=await fetch(path,{credentials:"same-origin",headers:{"Content-Type":"application/json"},cache:"no-store",...options});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw new Error(data.message||data.error||("HTTP "+response.status));
  return data;
}
function showLogin(){state.data=null;state.role=null;$("app-shell").hidden=true;$("auth-layout").hidden=false;$("password").value="";closeMenu();}
function showApp(){if(!state.data)return; $("auth-layout").hidden=true;$("app-shell").hidden=false;$("role-tag").textContent=state.role==="admin"?"ADMINISTRATOR":"AUDITOR / READ ONLY";switchPage(location.hash.slice(1)||"overview",false);}
async function load(){state.data=await request("/api/bootstrap");state.role=state.data.role;showApp();}
async function start(){
  try{const session=await request("/api/session");if(session.authenticated)await load();else showLogin();}
  catch{showLogin();$("login-error").textContent="Dashboard service is unavailable.";}
}
function switchPage(page,updateHash=true){
  if(!label[page])page="overview";state.page=page;
  if(updateHash)history.replaceState(null,"","#"+page);
  $("breadcrumb-page").textContent=label[page].toUpperCase();
  document.querySelectorAll(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $("page-content").innerHTML=pages[page]();
  $("page-content").focus({preventScroll:true});
  window.scrollTo({top:0,behavior:"instant"});
  closeMenu();
}
function closeMenu(){$("sidebar")?.classList.remove("open");$("mobile-overlay")?.classList.remove("visible");$("menu-toggle")?.setAttribute("aria-expanded","false");}
function banner(){return '<div class="banner"><span>◇</span><div><strong>Sandbox preview only.</strong> Data is synthetic. No live wallet, ledger, payments, sessions, API credentials or operators are connected to Playground. Actions are in-memory simulations and reset on restart.</div></div>';}
function heading(title,description,actions=""){
  return '<div class="page-head"><div><span class="section-label">SOFT TECH / '+escapeHtml(label[state.page]).toUpperCase()+'</span><h1>'+title+'</h1><p>'+description+'</p></div><div class="page-actions">'+actions+'</div></div>';
}
function metric(title,value,foot,symbol){
  return '<div class="metric purple-glow"><div class="metric-symbol">'+symbol+'</div><div class="metric-label">'+title+'</div><div class="metric-num">'+n(value)+'</div><div class="metric-foot">'+foot+'</div></div>';
}
function table(columns,rows){
  return '<div class="simple-table-wrap"><table><thead><tr>'+columns.map(x=>'<th>'+x+'</th>').join("")+'</tr></thead><tbody>'+rows.join("")+'</tbody></table></div>';
}
function gameBadge(g){
  return '<article class="game-panel"><div class="game-art '+(g.id==="skygate"?"sky":g.id==="mahjong"?"wild":"uno")+'"><small>ORIGINAL RELEASE / '+escapeHtml(g.id.toUpperCase())+'</small><h2>'+escapeHtml(g.name)+'</h2></div><div class="game-content"><div class="row-space"><span class="tiny">'+escapeHtml(g.category)+'</span>'+tag(g.status)+'</div><p style="margin-top:15px">Sample game entry. No live provider launch enabled.</p><div class="game-stat"><span>Sessions <strong>'+n(g.activeSessions)+'</strong></span><span>Rounds <strong>'+n(g.rounds)+'</strong></span></div></div></article>';
}
function overview(){
  const d=state.data,s=d.summary;
  return heading("PROVIDER <em>OVERVIEW.</em>","Your six-module command center for the Soft Tech original game portfolio.",
    '<button class="btn-secondary" data-page="developer">API DOCUMENTATION ↗</button>')+
    banner()+
    '<div class="grid grid-four">'+metric("Original Games",s.games,"3 portfolio titles","▣")+metric("Demo Operators",s.operators,"Enabled sample records","⌘")+metric("Sample Sessions",s.sessions,"Synthetic active sessions","◈")+metric("Sample Rounds",s.rounds,"No real wagering or payment","↻")+'</div>'+
    '<div class="row-space sub-section"><div><h2>ORIGINAL WORLDS</h2><p>Sample portfolio status</p></div><span class="pill-note">03 / 03 DEMO ONLY</span></div>'+
    '<div class="grid grid-three">'+d.games.map(gameBadge).join("")+'</div>'+
    '<div class="grid grid-two" style="margin-top:20px"><section class="panel"><div class="panel-head"><div><h2>OPERATOR HEALTH</h2><p>Illustrative status and permitted games</p></div><span class="tag demo">SIMULATED</span></div><ul class="info-list">'+d.operators.map(o=>'<li><span>'+escapeHtml(o.name)+'</span><b>'+escapeHtml(o.games.length)+' titles · '+escapeHtml(o.status)+'</b></li>').join("")+'</ul></section><section class="panel"><div class="panel-head"><div><h2>RECENT AUDIT EVENTS</h2><p>Local preview history</p></div><button class="btn-secondary" data-page="reconcile">OPEN ↗</button></div><ul class="info-list">'+d.audit.slice(0,4).map(a=>'<li><span>'+escapeHtml(a.event)+'<br><small class="tiny">'+when(a.at)+'</small></span><b>'+escapeHtml(a.scope)+'</b></li>').join("")+'</ul></section></div>';
}
function games(){
  const d=state.data;
  return heading("ORIGINAL <em>GAMES.</em>","Game launch inventory and mock operational signals. Version status indicates a prototype, not verified production integration.")+
    banner()+'<div class="grid grid-three">'+d.games.map(gameBadge).join("")+'</div>'+
    '<div class="grid grid-two" style="margin-top:20px"><section class="panel"><h2>CATALOG CONFIGURATION</h2><p>Operator availability is defined per game. Currency and credit mapping must be enforced by a real backend before public use.</p><div class="code-list"><code>SKYGATE 5000</code><code>MAHJONG WILD</code><code>UNO LUCK</code></div><button class="btn-secondary" data-page="operators">VIEW OPERATORS ↗</button></section><section class="panel"><h2>RELEASE GUARDRAILS</h2><ul class="info-list"><li><span>Session verification</span><b>Not connected</b></li><li><span>Ledger debit / credit</span><b>Not connected</b></li><li><span>Round event callbacks</span><b>Not connected</b></li><li><span>Game catalogue</span><b>Demo sample</b></li></ul></section></div>';
}
function operators(){
 const d=state.data;
 return heading("OPERATOR <em>ACCESS.</em>","Per-operator game selections, permissions and virtual currency definitions. The toggle is a demo-only server-memory action.")+
 banner()+table(["Operator ID","Operator","Region","Currency","Games","Status","Action"],d.operators.map(o=>
 '<tr><td class="mono">'+escapeHtml(o.id)+'</td><td><strong>'+escapeHtml(o.name)+'</strong></td><td>'+escapeHtml(o.region)+'</td><td>'+escapeHtml(o.currency)+'</td><td>'+escapeHtml(o.games.length)+' / 3</td><td>'+tag(o.status)+'</td><td><button class="btn-secondary" data-toggle="'+escapeHtml(o.id)+'" '+(state.role!=="admin"?"disabled title=\"Auditor read-only\"":"")+ '>'+(o.status==="Enabled"?"DISABLE":"ENABLE")+'</button></td></tr>'))+
 '<div class="grid grid-two" style="margin-top:20px"><section class="panel"><h2>ROLE PERMISSIONS</h2><ul class="info-list"><li><span>Provider Administrator</span><b>Read + demo writes</b></li><li><span>Auditor</span><b>Read only</b></li><li><span>Production wallet actions</span><b>Never allowed here</b></li></ul></section><section class="panel"><h2>OPERATOR POLICY</h2><p>Proposed live fields: operator_id, permitted_games, currency_code, scoped_credentials, allowed_origins, callback_url and signed audit events.</p><span class="pill-note">NO REAL CREDENTIALS STORED</span></section></div>';
}
function ledger(){
 const d=state.data;
 return heading("SESSION <em>LEDGER.</em>","Inspectable sample debit/credit events with reference IDs, game, operator and a simulated VCOIN running balance.",
   '<button class="btn-secondary" data-page="reconcile">RECONCILIATION ↗</button>')+
 banner()+table(["Timestamp (UTC)","Reference","Operator","Game","Event","Amount (VCOIN)","Sample Balance"],
 d.ledger.filter(x=>(!state.filter||Object.values(x).some(v=>String(v).toLowerCase().includes(state.filter.toLowerCase())))).map(x=>
 '<tr><td>'+when(x.time)+'</td><td class="mono">'+escapeHtml(x.reference)+'</td><td>'+escapeHtml(x.operator)+'</td><td>'+escapeHtml(x.game)+'</td><td>'+tag(x.type)+'</td><td class="mono" style="color:'+(x.amount>=0?'#84deb4':'#ffb0a6')+'">'+(x.amount>=0?'+':'')+n(x.amount)+'</td><td class="mono">'+n(x.balance)+'</td></tr>'))+
 '<div class="grid grid-two" style="margin-top:20px"><section class="panel"><h2>LEDGER GUARANTEES (TARGET)</h2><p>All real credits require atomic writes, idempotency keys, signed callbacks, replay resistance and a transaction reference trace.</p><span class="tag warn">DESIGN, NOT DEPLOYED</span></section><section class="panel"><h2>VIRTUAL CREDIT POLICY</h2><p>VCOIN entries are placeholders only. This panel cannot make deposits, withdrawals or player wallet changes.</p></section></div>';
}
function reconcile(){
 const d=state.data;
 return heading("RECONCILIATION <em>LAB.</em>","Compare simulated ledger entries by operator and create an illustrative audit record. No financial balances are modified.")+
 banner()+'<div class="controls-grid"><section class="panel"><h2>RUN A DEMO CHECK</h2><p>Select an operator and validate its sample ledger events. Administrator only.</p><div class="control-group"><label for="reconcile-operator">Operator</label><select id="reconcile-operator">'+d.operators.map(o=>'<option value="'+escapeHtml(o.id)+'">'+escapeHtml(o.id)+' · '+escapeHtml(o.name)+'</option>').join("")+'</select></div><button class="btn-primary" id="run-reconcile" '+(state.role!=="admin"?'disabled title="Auditor cannot reconcile"':'')+'>RUN SIMULATION ↗</button><p class="tiny" style="margin-top:17px">This check does not communicate with Playground or a live ledger.</p></section><section class="panel"><h2>LATEST RESULT</h2>'+(state.lastReconcile?'<div class="reconcile-card"><span class="tag good">SIMULATED MATCH</span><b>'+n(state.lastReconcile.net)+' VCOIN</b><p>'+n(state.lastReconcile.entries)+' sample entries for '+escapeHtml(state.lastReconcile.operator)+'</p><small class="tiny">No settlement / no financial effect</small></div>':'<div class="reconcile-card"><span class="tag demo">NO RUN IN THIS SESSION</span><p style="margin-top:18px">Run the demo reconciliation to see a signed-in audit record.</p></div>')+'</section></div>'+
 '<div class="sub-section"><h2>RECONCILIATION HISTORY</h2><p>Latest local demo audit events</p></div>'+
 table(["Timestamp","Actor","Event","Operator / Resource"],d.audit.map(a=>'<tr><td>'+when(a.at)+'</td><td>'+escapeHtml(a.actor)+'</td><td>'+escapeHtml(a.event)+'</td><td>'+escapeHtml(a.scope)+'</td></tr>'));
}
function developer(){
 return heading("API <em>DEVELOPER.</em>","Download the self-contained HTML guide or machine-readable OpenAPI definition for this sandbox provider-panel demo.",
   '<button class="btn-primary" data-download="html">DOWNLOAD HTML ↗</button><button class="btn-secondary" data-download="json">OPENAPI JSON ↓</button>')+
 banner()+'<div class="grid grid-two"><section class="panel"><div class="panel-head"><div><h2>INTEGRATION REFERENCE</h2><p>Proposed external provider flow</p></div><span class="tag warn">DESIGN ONLY</span></div><div class="code-list"><code>POST /sessions</code><code>GET /wallets/{id}</code><code>POST /wallets/{id}/debit</code><code>POST /wallets/{id}/credit</code><code>POST /rounds/events</code><code>POST /callbacks</code></div><p>Future contract requires HMAC signatures, idempotency keys, timestamps, a session life cycle, operator scopes, and auditable ledger writes.</p><button class="btn-secondary" data-download="html">DOWNLOAD DEVELOPER GUIDE ↓</button></section><section class="panel"><div class="panel-head"><div><h2>THIS DEMO API</h2><p>Actual implemented endpoints</p></div><span class="tag good">RUNNING</span></div><div class="doc-code">GET  /health\nGET  /api/session\nPOST /api/login\nPOST /api/logout\nGET  /api/bootstrap\nPOST /api/operators        [admin]\nPOST /api/reconcile        [admin]\nGET  /api/download/openapi.json\nGET  /api/download/developer.html</div></section></div>'+
 '<div class="grid grid-two" style="margin-top:20px"><section class="panel"><h2>AUTHENTICATION</h2><p>Cookie-based demo authentication, eight-hour session expiry, HTTP-only cookies and separation between Administrator and Auditor permissions. Real provider API keys and merchant credentials are not implemented.</p></section><section class="panel"><h2>SECURITY CHECKLIST</h2><ul class="info-list"><li><span>HTTPS / signed callbacks</span><b>Required for live</b></li><li><span>Idempotent wallet events</span><b>Required for live</b></li><li><span>Atomic reconciliation</span><b>Required for live</b></li><li><span>Real Playground adapter</span><b>Not connected</b></li></ul></section></div>';
}
const pages={overview,games,operators,ledger,reconcile,developer};
document.addEventListener("DOMContentLoaded",()=>{
 $("login-form").addEventListener("submit",async e=>{
   e.preventDefault();$("login-error").textContent="";const b=$("login-button");b.disabled=true;b.textContent="AUTHENTICATING…";
   try{await request("/api/login",{method:"POST",body:JSON.stringify({role:$("role").value,password:$("password").value})});await load();notice("Signed in to Soft Tech sandbox demo.");}
   catch(error){$("login-error").textContent=error.message==="INVALID_CREDENTIALS"?"Incorrect role or password.":error.message;}
   finally{b.disabled=false;b.innerHTML="ENTER DASHBOARD <span aria-hidden=\"true\">↗</span>";}
 });
 $("logout-button").addEventListener("click",async()=>{try{await request("/api/logout",{method:"POST",body:"{}"});}finally{showLogin();}});
 $("menu-toggle").addEventListener("click",()=>{const open=$("sidebar").classList.toggle("open");$("mobile-overlay").classList.toggle("visible",open);$("menu-toggle").setAttribute("aria-expanded",String(open));});
 $("mobile-overlay").addEventListener("click",closeMenu);
 document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu();});
 document.addEventListener("click",async e=>{
   const link=e.target.closest("[data-page]");if(link){switchPage(link.dataset.page);return;}
   const btn=e.target.closest("[data-download]");if(btn){window.location.href=btn.dataset.download==="html"?"/api/download/developer.html":"/api/download/openapi.json";notice("Document download requested.");return;}
   const toggled=e.target.closest("[data-toggle]");
   if(toggled){
     const op=state.data.operators.find(o=>o.id===toggled.dataset.toggle);
     if(!op)return;
     toggled.disabled=true;
     try{await request("/api/operators",{method:"POST",body:JSON.stringify({id:op.id,enabled:op.status!=="Enabled"})});state.data=await request("/api/bootstrap");switchPage("operators");notice("Updated demo operator "+op.id);}
     catch(err){notice("Change blocked: "+err.message);toggled.disabled=false;}
     return;
   }
   const reconcileBtn=e.target.closest("#run-reconcile");
   if(reconcileBtn){
     reconcileBtn.disabled=true;
     try{const result=await request("/api/reconcile",{method:"POST",body:JSON.stringify({operatorId:$("reconcile-operator").value})});state.lastReconcile=result;state.data=await request("/api/bootstrap");switchPage("reconcile");notice("Simulated reconciliation completed.");}
     catch(err){notice("Reconciliation blocked: "+err.message);reconcileBtn.disabled=false;}
   }
 });
 window.addEventListener("hashchange",()=>{if(state.data)switchPage(location.hash.slice(1)||"overview",false);});
 start();
});
