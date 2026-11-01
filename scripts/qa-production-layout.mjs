import fs from "node:fs";
import path from "node:path";
import {chromium} from "playwright";

const origin="http://127.0.0.1:3000";
const out=path.resolve("qa-artifacts/production-layout");
fs.mkdirSync(out,{recursive:true});
const errors=[];
const checks=[];
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});

const fontResponse=await (await browser.newPage()).request.get(origin+"/fonts/softtech-minecraft.woff2");
if(fontResponse.status()!==200)errors.push("Self-hosted Minecraft WOFF2 missing: HTTP "+fontResponse.status());
const bytes=await fontResponse.body();
if(bytes.byteLength<1200)errors.push("Minecraft WOFF2 too small: "+bytes.byteLength);

for(const viewport of [
 {name:"desktop-1440",width:1440,height:900},
 {name:"desktop-1920",width:1920,height:1080},
 {name:"tablet-768",width:768,height:1024},
 {name:"iphone-390",width:390,height:844},
 {name:"iphone-360",width:360,height:780},
]){
 const page=await browser.newPage({viewport,deviceScaleFactor:1});
 const runtimeErrors=[];
 page.on("pageerror",e=>runtimeErrors.push(e.message));
 await page.goto(origin+"/",{waitUntil:"domcontentloaded",timeout:40000});
 await page.locator(".v4-playground").waitFor();
 const faces=await page.evaluate(async()=>await document.fonts.load('32px "SoftTech Minecraft"').then(x=>x.length));
 await page.evaluate(()=>document.fonts.ready);
 
 // Actually enter every reveal's viewport. CSS smooth-scroll can make
 // scrollTo() asynchronous, so use explicit Playwright visibility passes.
 await page.evaluate(()=>{
   document.documentElement.style.scrollBehavior="auto";
   document.body.style.scrollBehavior="auto";
 });
 const reveals=page.locator(".reveal");
 const count=await reveals.count();
 for(let n=0;n<count;n++){
   const element=reveals.nth(n);
   if(!(await element.isVisible()))continue;
   await element.scrollIntoViewIfNeeded({timeout:8000});
   await page.waitForTimeout(90);
 }
 await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
 await page.waitForTimeout(190);
 const revealStats=await page.evaluate(()=>{
   const elements=[...document.querySelectorAll(".reveal")].filter(x=>getComputedStyle(x).display!=="none");
   return {total:elements.length,shown:elements.filter(x=>x.classList.contains("is-visible")).length};
 });
 if(revealStats.total>0&&revealStats.shown<revealStats.total-1)
   errors.push(viewport.name+": content reveal missed "+(revealStats.total-revealStats.shown)+" section(s)");
 await page.screenshot({path:path.join(out,viewport.name+".png"),fullPage:true,animations:"disabled"});
 const metric=await page.evaluate(()=>{
  const find=s=>document.querySelector(s);
  const rect=s=>{const e=find(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
  const style=s=>{let e=find(s);return e?getComputedStyle(e):null};
  const heading=style(".v4-story h2"),heroTitle=style(".v4-left-rail h2"),brand=style(".top-brand");
  return {
   documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,
   stage:rect(".v4-playground"),heroTitleBox:rect(".v4-left-rail h2"),
   leftRail:rect(".v4-left-rail"),poster:rect(".v4-main-art"),
   story:rect(".v4-story h2"),storyColumn:rect(".v4-story-left"),
   mobileMenu:rect(".hamburger"),languageButton:rect(".language-switch"),logoBox:rect(".top-brand"),
   logoBackground:brand?.backgroundColor,heroFont:heroTitle?.fontFamily,
   storyFont:heading?.fontFamily,heroLineHeight:heroTitle?.lineHeight,
   beyondOpacity:style(".v4-word-beyond")?.opacity
  };
 });
 if(viewport.width<=1040&&metric.mobileMenu&&metric.languageButton){
  if(metric.mobileMenu.x<metric.languageButton.right-2)errors.push(viewport.name+": hamburger not rightmost after language");
  if(metric.logoBox&&metric.logoBox.right>metric.languageButton.x+2)errors.push(viewport.name+": logo collides with language");
 }
 if(!metric.heroFont?.includes("SoftTech Minecraft"))errors.push(viewport.name+": hero title is not Minecraft");
 if(!metric.storyFont?.includes("SoftTech Minecraft"))errors.push(viewport.name+": story title is not Minecraft");
 if(!faces)errors.push(viewport.name+": font face not loaded");
 if(metric.documentWidth>metric.viewportWidth+4)errors.push(viewport.name+": horizontal overflow "+metric.documentWidth);
 if(metric.logoBackground&&!["rgba(0, 0, 0, 0)","transparent"].includes(metric.logoBackground))
  errors.push(viewport.name+": logo plaque returned "+metric.logoBackground);
 if(metric.heroTitleBox&&metric.leftRail&&metric.heroTitleBox.bottom>metric.leftRail.bottom+8)
  errors.push(viewport.name+": hero title exceeds title rail");
 if(viewport.width>=1100&&metric.poster&&metric.heroTitleBox){
  const w=Math.max(0,Math.min(metric.poster.right,metric.heroTitleBox.right)-Math.max(metric.poster.x,metric.heroTitleBox.x));
  const h=Math.max(0,Math.min(metric.poster.bottom,metric.heroTitleBox.bottom)-Math.max(metric.poster.y,metric.heroTitleBox.y));
  if(w*h>metric.heroTitleBox.width*metric.heroTitleBox.height*.2)errors.push(viewport.name+": game poster occludes title");
 }
 if(runtimeErrors.length)errors.push(viewport.name+": browser exception(s) "+runtimeErrors.join(" | "));
 checks.push({viewport,...metric,loadedFaces:faces,revealStats,runtimeErrors});
 await page.close();
}
for(const route of ["/games","/company","/technology","/partners","/contact"]){
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(origin+route,{waitUntil:"domcontentloaded",timeout:40000});
 const result=await page.evaluate(()=>{
  const title=document.querySelector(".page-head h1,.collection-heading h2,.studio-copy h2,.corp-two h2,.technology-feature h2");
  return {titleText:title?.textContent?.slice(0,80),titleFont:title?getComputedStyle(title).fontFamily:null,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
 });
 if(result.titleFont&&!result.titleFont.includes("SoftTech Minecraft"))errors.push(route+": heading font not Minecraft");
 if(result.scrollWidth>result.viewport+4)errors.push(route+": overflow");
 await page.screenshot({path:path.join(out,"route-"+route.slice(1)+".png"),fullPage:false,animations:"disabled"});
 checks.push({route,...result});
 await page.close();
}
await browser.close();
const report={result:errors.length?"FAIL":"PASS",errors,checks};
fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(errors.length)process.exitCode=1;
