/** Actual panel/browser exercise; all accounts are temporary, explicit test fixtures. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {totp,matchTotp} from '../lib/staff-crypto.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),out=process.env.STAFF_BROWSER_OUTPUT||join(root,'qa-artifacts/staff-auth');
await mkdir(out,{recursive:true});
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const dir=await mkdtemp(join(tmpdir(),'staff-browser-')),base='http://127.0.0.1:'+port,password='browser-fixture-'+randomBytes(24).toString('hex');
const env={...process.env,NODE_ENV:'test',PORT:String(port),CORE_DB_PATH:join(dir,'core.sqlite'),PANEL_ADMIN_PASSWORD:randomBytes(24).toString('hex'),PANEL_AUDITOR_PASSWORD:randomBytes(24).toString('hex'),PANEL_SESSION_SECRET:randomBytes(36).toString('hex'),CORE_PUBLIC_ORIGIN:base,UNO_PROVIDER_ORIGIN:base,MAHJONG_PROVIDER_ORIGIN:base,SKYGATE_PROVIDER_ORIGIN:base,CORE_ENGINE_KEYS_JSON:'[]',OFFSITE_BACKUP_ENABLED:'false'};
const child=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let logs='',browser;child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const errors=[],checks=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
async function field(form,name,value){await form.locator('[name="'+name+'"]').fill(value);}
async function closeSecret(page){await page.locator('#core-dialog [data-close-dialog]').first().click();await page.waitForFunction(()=>!document.querySelector('#core-dialog')?.open&&!document.querySelector('#core-dialog')?.textContent);}
async function completeEnrollment(page){
 const secret=await page.locator('.staff-secret').innerText(),step=Math.floor(Date.now()/30000);
 await field(page.locator('#staff-enrollment-confirm'),'code',totp(secret,{step}));await page.locator('#staff-enrollment-confirm [type=submit]').click();
 await page.getByRole('heading',{name:'SAVE YOUR RECOVERY CODES'}).waitFor();const recovery=await page.locator('#core-dialog pre').innerText();assert.equal(recovery.trim().split('\n').length,8);
 await closeSecret(page);return {secret,step};
}
async function screenshot(page,name){await page.screenshot({path:join(out,name+'.png'),fullPage:true,animations:'disabled'});}
async function assertFit(page){const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(size.scroll<=size.width+3,JSON.stringify(size));}
try{
 let healthy=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){healthy=true;break;}}catch{}await pause(50);}assert.equal(healthy,true,logs);
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 const ownerContext=await browser.newContext({viewport:{width:1440,height:1000}}),owner=await ownerContext.newPage();owner.on('pageerror',e=>errors.push(String(e)));
 await owner.goto(base,{waitUntil:'domcontentloaded'});await owner.locator('#role').selectOption('admin');await owner.locator('#password').fill(env.PANEL_ADMIN_PASSWORD);await owner.locator('#login-button').click();await owner.locator('#app-shell:not([hidden])').waitFor();
 await owner.locator('[data-page=staff]').click();await owner.locator('[data-staff-bootstrap]').click();const bootstrap=owner.locator('#staff-bootstrap-form');
 for(const [name,value] of Object.entries({username:'browser-fixture-owner',display_name:'Browser Fixture Owner',person_ref:'browser-person-owner',password,admin_password:env.PANEL_ADMIN_PASSWORD}))await field(bootstrap,name,value);
 await bootstrap.locator('[type=submit]').click();await owner.locator('.staff-secret').waitFor();
 const ownerMfa=await completeEnrollment(owner);await owner.locator('[data-staff-invite]').waitFor();
 assert.equal(await owner.locator('#core-dialog').innerText(),'');
 assert.equal(await owner.evaluate(secret=>JSON.stringify(localStorage).includes(secret)||JSON.stringify(sessionStorage).includes(secret),ownerMfa.secret),false);
 checks.push('shared-admin bootstrap, actual enrollment confirmation, recovery-code display and secret clearing');
 await screenshot(owner,'owner-desktop');
 await owner.setViewportSize({width:390,height:844});await assertFit(owner);await screenshot(owner,'owner-mobile');await owner.setViewportSize({width:1440,height:1000});checks.push('staff view fits 1440px and 390px');

 await owner.locator('[data-staff-invite]').click();const invite=owner.locator('#staff-invite-form');
 for(const [name,value] of Object.entries({username:'browser-fixture-approver',display_name:'Browser Fixture Approver',person_ref:'browser-person-approver'}))await field(invite,name,value);
 await invite.locator('[name=role]').selectOption('approver');await invite.locator('[type=submit]').click();await owner.getByRole('heading',{name:'STAFF INVITATION'}).waitFor();
 const token=(await owner.locator('#core-dialog pre').innerText()).trim();await owner.keyboard.press('Escape');await owner.waitForFunction(()=>!document.querySelector('#core-dialog')?.textContent);checks.push('invitation secret clears on Escape');
 const checkerContext=await browser.newContext({viewport:{width:1280,height:900}}),checker=await checkerContext.newPage();checker.on('pageerror',e=>errors.push(String(e)));
 await checker.goto(base,{waitUntil:'domcontentloaded'});await checker.locator('[data-staff-activation]').click();const activation=checker.locator('#staff-activation-form');await field(activation,'activation_token',token);await field(activation,'password',password);await activation.locator('[type=submit]').click();await checker.locator('.staff-secret').waitFor();await completeEnrollment(checker);
 await checker.locator('#staff-content').getByText('YOUR ACCOUNT',{exact:true}).waitFor();assert.equal(await checker.locator('[data-staff-invite]').count(),0);await assertFit(checker);await screenshot(checker,'approver-staff');checks.push('recipient activates invitation and approver lacks staff administration');

 await owner.locator('[data-page=operators]').click();await owner.locator('[data-add-operator]').click();const operator=owner.locator('#operator-form');await field(operator,'name','Browser Staff Release Fixture');await field(operator,'return_origins','https://operator.example');await operator.locator('[type=submit]').click();await owner.locator('#core-dialog .secret-output').waitFor();const created=JSON.parse(await owner.locator('#core-dialog .secret-output').innerText());await closeSecret(owner);
 const session=await (await owner.request.get(base+'/api/session')).json();
 // Sandbox fixture setup uses the same authenticated HTTP route; the visible panel requests preproduction.
 const requested=await owner.request.post(base+'/api/release-requests',{headers:{'X-CSRF-Token':session.csrf},data:{operator_id:created.operator.id,game_id:'uno-luck',mode:'sandbox'}});assert.equal(requested.status(),201);const release=await requested.json();
 await owner.locator('[data-page=release]').click();await owner.locator('[data-advance-release="'+release.id+'"][data-release-action=validate]').waitFor();owner.once('dialog',d=>d.accept());await owner.locator('[data-advance-release="'+release.id+'"]').click();await owner.getByText('A different person must approve',{exact:true}).waitFor();assert.equal(await owner.locator('[data-release-action=approve]').count(),0);
 await checker.locator('[data-page=release]').click();await checker.locator('[data-advance-release="'+release.id+'"][data-release-action=approve]').waitFor();checker.once('dialog',d=>d.accept());await checker.locator('[data-advance-release="'+release.id+'"]').click();await checker.locator('#release-requests .tag').filter({hasText:'approved'}).waitFor();await screenshot(checker,'independent-approval');checks.push('requester has no self-approve action; distinct approver completes actual HTTP approval through UI');

 await owner.locator('#logout-button').click();await owner.locator('#auth-layout:not([hidden])').waitFor();await owner.locator('#role').selectOption('staff');await owner.locator('#staff-username').fill('browser-fixture-owner');await owner.locator('#password').fill(password);await owner.locator('#login-button').click();await owner.locator('#staff-login-mfa').waitFor();
 let wrong='000000';for(let i=0;matchTotp(ownerMfa.secret,wrong,Date.now())!==null;i++)wrong=String(i+1).padStart(6,'0');
 await field(owner.locator('#staff-login-mfa'),'code',wrong);await owner.locator('#staff-login-mfa [type=submit]').click();await owner.getByText('INVALID_MFA_CODE',{exact:true}).waitFor();
 const step=Math.max(Math.floor(Date.now()/30000),ownerMfa.step+1);await field(owner.locator('#staff-login-mfa'),'code',totp(ownerMfa.secret,{step}));await owner.locator('#staff-login-mfa [type=submit]').click();await owner.locator('[data-staff-invite]').waitFor();checks.push('individual two-step login rejects wrong TOTP and accepts a new valid code');
 assert.deepEqual(errors,[]);assert.ok(!logs.includes(password));assert.ok(!logs.includes(ownerMfa.secret));
 await writeFile(join(out,'report.json'),JSON.stringify({result:'PASS',scope:'temporary local fixtures, actual HTTP and browser UI',checks,javascript_errors:errors,production_staff_enrolled:false,real_human_approval_given:false},null,2)+'\n');
 console.log('PASS: '+checks.length+' staff browser checks; screenshots and sanitized report in '+out);
}finally{
 await browser?.close();child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null||child.signalCode!==null)return r();child.once('exit',r);setTimeout(()=>{child.kill('SIGKILL');r();},3000).unref();});child.stdout.destroy();child.stderr.destroy();await rm(dir,{recursive:true,force:true});
}
