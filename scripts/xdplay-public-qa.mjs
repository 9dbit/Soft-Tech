import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3000',output='qa-artifacts/xdplay';
const routes=['/','/games','/company','/technology','/partners','/contact','/games/uno-luck','/games/mahjong-wild','/games/skygate-5000'];
// Use the low-level HTTP client: fetch may replace Host with the URL's hostname.
const requestHost=(host,path)=>new Promise((resolve,reject)=>{
 const req=httpRequest({hostname:'127.0.0.1',port:3000,path,method:'GET',headers:{Host:host}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,host:req.getHeader('Host')}));});
 req.setTimeout(10000,()=>req.destroy(new Error('Host routing request timed out')));req.on('error',reject);req.end();
});
await mkdir(output,{recursive:true});const report={source_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',checks:[],redirects:[],errors:[]};const browser=await chromium.launch({headless:true});
try{
 for(const viewport of [{name:'desktop',width:1440,height:960},{name:'mobile',width:390,height:844}]){
  const page=await browser.newPage({viewport,reducedMotion:'reduce'});page.on('pageerror',e=>report.errors.push(viewport.name+': '+e.message));
  for(const path of routes){
   const response=await page.goto(base+path,{waitUntil:'networkidle'});assert.equal(response.status(),200,path+' HTTP status');await page.evaluate(()=>document.fonts.ready);
   const title=await page.title(),text=await page.locator('body').innerText(),canonical=await page.locator('link[rel=canonical]').getAttribute('href');
   const logos=await page.locator('img[src*="xdplay-logo"]').evaluateAll(images=>images.map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0}))),scrollWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
   assert.match(title,/XDPLAY/,path+' title');assert.doesNotMatch(text,/soft\s+tech/i,path+' visible legacy branding');assert.equal(canonical,'https://xd-play.com'+(path==='/'?'':path),path+' canonical');assert(logos.length>0&&logos.every(x=>x.loaded),path+' logo loads');assert(scrollWidth<=viewport.width+2,path+' horizontal overflow');
   const screenshot=viewport.name+'-'+(path==='/'?'home':path.slice(1).replaceAll('/','-'))+'.png';await page.screenshot({path:output+'/'+screenshot,fullPage:true,animations:'disabled'});report.checks.push({viewport:viewport.name,path,title,canonical,scrollWidth,logos:logos.length,screenshot});
  }await page.close();
 }
 for(const path of ['/robots.txt','/sitemap.xml']){const response=await fetch(base+path),text=await response.text();assert.equal(response.status,200);assert.match(text,/https:\/\/xd-play\.com/);assert.doesNotMatch(text,/soft-tech-web-production/);}
 const redirect=await requestHost('www.xd-play.com','/games/uno-luck?test=1');report.redirects.push(redirect);assert.equal(redirect.host,'www.xd-play.com');assert.equal(redirect.status,308);assert.equal(redirect.headers.location,'https://xd-play.com/games/uno-luck?test=1');
 const canonical=await requestHost('xd-play.com','/games/uno-luck?test=1');report.redirects.push(canonical);assert.equal(canonical.status,200,'Canonical host must not loop');
 assert.equal((await fetch(base+'/api/health')).status,200);
 const original=execFileSync('git',['show','2dad8bbd89c9e93a556776051961b9a4c51cca97:src/data/games.ts'],{encoding:'utf8'}),current=await readFile('src/data/games.ts','utf8'),urls=s=>[...s.matchAll(/url:"([^"]+)"/g)].map(m=>m[1].split('?')[0]);assert.deepEqual(urls(original),urls(current));assert.equal(report.errors.length,0,'browser errors');report.status='PASS';
}catch(error){report.status='FAIL';report.errors.push(error.stack);process.exitCode=1;}
finally{await browser.close();await writeFile(output+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
