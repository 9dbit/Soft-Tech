import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

const host='http://127.0.0.1:3000';
const sky='https://skygate-web-production.up.railway.app/play/';
const route='/games/skygate-5000/play';
const browser=await chromium.launch({headless:true});
const results=[];
mkdirSync('qa-artifacts/xdplay-skygate',{recursive:true});
try{
  for(const viewport of [{name:'desktop',width:1440,height:900},{name:'iphone',width:393,height:852}]){
    const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},reducedMotion:'reduce'});
    // Network fixture: production CSP is tested in Skygate's own CI. Here test
    // the XDPLAY framing policy without relying on a live external dependency.
    await context.route(sky,route=>route.fulfill({
      status:200,contentType:'text/html',
      headers:{'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors http://127.0.0.1:3000;"},
      body:'<!doctype html><title>Skygate fixture</title><body><main data-skygate-fixture>Skygate virtual demo</main></body>'
    }));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    const result=await page.goto(host+route,{waitUntil:'domcontentloaded',timeout:30000});
    assert.equal(result.status(),200,'launch route must return HTML');
    const headers=result.headers();
    const csp=headers['content-security-policy']||'';
    assert(csp.includes("frame-src https://skygate-web-production.up.railway.app"),'must allow only audited engine origin');
    assert(!csp.includes('frame-src *'),'wildcard game frames must be forbidden');
    assert(csp.includes("frame-ancestors 'none'"),'launch wrapper cannot be embedded');
    assert.equal(headers['x-frame-options'],'DENY');
    assert.equal(headers['referrer-policy'],'no-referrer');
    assert.equal(headers['cache-control'],'private, no-store');
    assert.match(headers['permissions-policy'],/payment=\(\)/);
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex, nofollow');
    const notice=page.locator('#game-virtual-credit-notice');
    assert.match(await notice.innerText(),/virtual-credit demo/);
    assert.equal(await notice.isVisible(),false,'screen reader notice should not obscure game');
    const frame=page.locator('#game-frame');
    assert.equal(await frame.count(),1);
    assert.equal(await frame.getAttribute('src'),sky);
    assert.equal(await frame.getAttribute('sandbox'),'allow-scripts allow-same-origin allow-modals allow-downloads');
    assert.equal(await frame.getAttribute('referrerpolicy'),'no-referrer');
    assert.match(await frame.getAttribute('allow'),/autoplay/);
    await page.frameLocator('#game-frame').locator('[data-skygate-fixture]').waitFor({state:'visible',timeout:15000});
    const bounds=await frame.boundingBox();
    assert(bounds&&bounds.width>=viewport.width-2&&bounds.height>=viewport.height-2,
      'immersive frame must cover the whole viewport');
    const parentBlocked=await page.frameLocator('#game-frame').locator('body')
      .evaluate(()=>{try{return Boolean(window.parent.document.body)}catch{return false}});
    assert.equal(parentBlocked,false,'cross-origin Skygate must not read XDPLAY parent DOM');
    assert.equal(errors.length,0,'browser console runtime errors');
    await page.screenshot({path:'qa-artifacts/xdplay-skygate/'+viewport.name+'.png',fullPage:true});
    await page.locator('a[aria-label="Back to Skygate 5000 on XDPLAY"]').click();
    await page.waitForURL('**/games/skygate-5000');
    results.push({viewport:viewport.name,route,iframeOrigin:sky,fullBleed:true,cspLocked:true,escapedParent:false});
    await context.close();
  }
  console.log('XDPLAY secure Skygate launch PASS',JSON.stringify(results));
} finally {
  await browser.close();
  writeFileSync('qa-artifacts/xdplay-skygate/report.json',JSON.stringify(results,null,2)+'\n');
}
