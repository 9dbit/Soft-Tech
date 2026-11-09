import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const port=39800+Math.floor(Math.random()*100);
const origin="http://127.0.0.1:"+port;
const env={...process.env,PORT:String(port),PANEL_ADMIN_PASSWORD:"LocalAdmin"+randomBytes(12).toString("hex"),
  PANEL_AUDITOR_PASSWORD:"LocalAudit"+randomBytes(12).toString("hex"),
  PANEL_SESSION_SECRET:randomBytes(48).toString("base64url")};
const server=spawn(process.execPath,["server.mjs"],{env,stdio:["ignore","pipe","pipe"]});
let err="";server.stderr.on("data",b=>err+=b.toString());
let browser;
const out="qa-artifacts/provider";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function ready(){for(let i=0;i<80;i++){try{let r=await fetch(origin+"/health");if(r.ok)return;}catch{}await sleep(100);}throw Error("Server never ready: "+err);}
async function signIn(page,role,password){
  await page.goto(origin,{waitUntil:"networkidle"});
  await page.locator("#role").selectOption(role);
  await page.locator("#password").fill(password);
  await page.locator("#login-button").click();
  await page.locator("#app-shell:not([hidden])").waitFor({timeout:15000});
}
async function noOverflow(page,scope){
  let w=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth}));
  assert.ok(w.scroll<=w.width+6,scope+" overflow "+JSON.stringify(w));
}
async function run(){
  await ready();await mkdir(out,{recursive:true});
  browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const desktop=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
  let errors=[];desktop.on("pageerror",e=>errors.push(e.message));
  await signIn(desktop,"admin",env.PANEL_ADMIN_PASSWORD);
  assert.match(await desktop.locator("#page-content h1").innerText(),/PROVIDER/);
  assert.equal(await desktop.locator(".nav-link").count(),6);
  await desktop.evaluate(async()=>document.fonts.ready);
  assert.equal(await desktop.locator(".brand-block img").evaluate(el=>el.complete&&el.naturalWidth>0),true);
  assert.equal(await desktop.evaluate(()=>document.fonts.check('18px "Minecraft"')),true);
  await noOverflow(desktop,"desktop dashboard");
  await desktop.screenshot({path:out+"/desktop-overview.png",fullPage:true});
  for(const route of ["games","operators","ledger","reconcile","developer"]){
    await desktop.locator('.nav-link[data-page="'+route+'"]').click();
    await desktop.locator("#breadcrumb-page").waitFor();
    assert.equal((await desktop.locator("#breadcrumb-page").innerText()).toLowerCase(),route==="ledger"?"sessions & ledger":route==="reconcile"?"reconciliation":route==="developer"?"api developer":route);
    await noOverflow(desktop,"desktop "+route);
  }
  assert.match(await desktop.locator("#page-content").innerText(),/OPENAPI JSON/);
  const downloadPromise=desktop.waitForEvent("download");
  await desktop.locator('[data-download="json"]').first().click();
  const download=await downloadPromise;
  assert.match(download.suggestedFilename(),/openapi.*\.json$/i);
  await desktop.locator('.nav-link[data-page="operators"]').click();
  await desktop.locator('[data-toggle="OP-EU-001"]').click();
  await desktop.getByText("Updated demo operator OP-EU-001").waitFor();
  await desktop.locator('.nav-link[data-page="reconcile"]').click();
  await desktop.locator("#run-reconcile").click();
  await desktop.locator(".reconcile-card .tag.good").waitFor({state:"visible",timeout:15000});
  assert.match(await desktop.locator(".reconcile-card").innerText(),/SIMULATED MATCH/);
  assert.deepEqual(errors,[],"desktop browser errors");
  const mobile=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  let mobileErrors=[];mobile.on("pageerror",e=>mobileErrors.push(e.message));
  await signIn(mobile,"admin",env.PANEL_ADMIN_PASSWORD);
  await noOverflow(mobile,"mobile overview");
  await mobile.screenshot({path:out+"/mobile-overview.png",fullPage:true});
  await mobile.locator("#menu-toggle").click();
  assert.equal(await mobile.locator("#sidebar").evaluate(el=>el.classList.contains("open")),true);
  await mobile.waitForTimeout(350);
  const sidebarBox=await mobile.locator("#sidebar").boundingBox();
  assert.ok(sidebarBox&&sidebarBox.x>=-2&&sidebarBox.width>=245,"mobile sidebar failed to enter viewport");
  await mobile.screenshot({path:out+"/mobile-menu.png",fullPage:false});
  await mobile.locator('.nav-link[data-page="games"]').click();
  assert.match(await mobile.locator("#page-content").innerText(),/UNO LUCK/);
  await noOverflow(mobile,"mobile games");
  await mobile.screenshot({path:out+"/mobile-games.png",fullPage:true});
  await mobile.locator("#menu-toggle").click();
  await mobile.locator('.nav-link[data-page="developer"]').click();
  await noOverflow(mobile,"mobile api developer");
  await mobile.screenshot({path:out+"/mobile-api-developer.png",fullPage:true});
  assert.deepEqual(mobileErrors,[],"mobile browser errors");
  const auditor=await browser.newPage({viewport:{width:1280,height:800}});
  await signIn(auditor,"auditor",env.PANEL_AUDITOR_PASSWORD);
  await auditor.locator('.nav-link[data-page="operators"]').click();
  assert.equal(await auditor.locator('[data-toggle="OP-EU-001"]').isDisabled(),true);
  await auditor.locator('.nav-link[data-page="reconcile"]').click();
  assert.equal(await auditor.locator("#run-reconcile").isDisabled(),true);
  await auditor.locator("#logout-button").click();
  await auditor.locator("#auth-layout:not([hidden])").waitFor({state:"visible",timeout:15000});
  assert.equal(await auditor.locator("#auth-layout").isVisible(),true);
  console.log("PASS: 3 browser sizes/roles, 6 routes, computed Minecraft font, logo, API download, admin controls, read-only auditor, no horizontal overflow or JS errors.");
}
try{await run();}finally{await browser?.close();server.kill("SIGTERM");}
