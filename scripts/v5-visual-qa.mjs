import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const root = process.env.V5_BASE_URL || "http://127.0.0.1:3000";
const output = "qa-artifacts/v5";
const checks = [];
const errors = [];
const viewports = [
  { width: 1586, height: 992, name: "master-1586x992" },
  { width: 1440, height: 900, name: "desktop-1440" },
  { width: 1366, height: 768, name: "laptop-1366" },
  { width: 1920, height: 1080, name: "wide-1920" },
  { width: 1024, height: 768, name: "tablet-landscape-1024" },
  { width: 768, height: 1024, name: "tablet-portrait-768" },
  { width: 430, height: 932, name: "iphone-430" },
  { width: 393, height: 852, name: "iphone-393" },
  { width: 390, height: 844, name: "iphone-390" },
  { width: 375, height: 812, name: "iphone-375" },
  { width: 360, height: 780, name: "android-360" }
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const jsErrors = [];
    page.on("pageerror", error => jsErrors.push(error.message));
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(root, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.locator("#main-content").waitFor({ timeout: 15000 });
      const isDesktop = viewport.width >= 1100;
      if (isDesktop) {
        await page.locator(".v5-desktop-only .v5-stage").waitFor({ state: "visible" });
        await page.waitForFunction(
          () => [...document.querySelectorAll(".v5-depth-part img")].length === 6 &&
            [...document.querySelectorAll(".v5-depth-part img")].every(img => img.complete && img.naturalWidth > 0),
          null, { timeout: 12000 }
        );
        await page.waitForFunction(
          () => document.querySelector(".v5-art-layer")?.classList.contains("v5-layers-ready"),
          null, { timeout: 10000 }
        );
      } else {
        await page.locator(".v52-mobile-only .v52-hero-surface").waitFor({ state: "visible" });
        await page.waitForFunction(
          () => [...document.querySelectorAll(".v52-depth-part img")].length === 6 &&
            [...document.querySelectorAll(".v52-depth-part img")].every(img => img.complete && img.naturalWidth > 0),
          null,{timeout:15000}
        );
        await page.waitForFunction(
          () => document.querySelector(".v52-layered-art")?.classList.contains("v52-art-ready"),
          null,{timeout:12000}
        );
        await page.waitForFunction(
          () => { const logo=document.querySelector(".v52-logo-button img");return logo?.complete&&logo.naturalWidth>0; },
          null,{timeout:12000}
        );
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${output}/${viewport.name}.png`, animations: "disabled" });
      if(!isDesktop) {
        await page.locator(".v52-hero-surface").screenshot({
          path: `${output}/${viewport.name}-hero.png`,
          animations:"disabled",timeout:20000
        });
        if (viewport.width === 393) await page.screenshot({
          path: `${output}/iphone-393-full-page.png`,
          animations:"disabled",fullPage:true
        });
      }
      const result = await page.evaluate(isDesktop => {
        const $ = s => document.querySelector(s);
        const rect = s => {
          const r = $(s)?.getBoundingClientRect();
          return r ? { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1) } : null;
        };
        const stage = rect(".v5-stage");
        return {
          scrollWidth: document.documentElement.scrollWidth,
          windowWidth: window.innerWidth,
          desktopVisible: !!$(".v5-desktop-only") && getComputedStyle($(".v5-desktop-only")).display !== "none",
          mobileVisible: !!$(".v52-mobile-only") && getComputedStyle($(".v52-mobile-only")).display !== "none",
          mobileArtReady:!!$(".v52-art-ready"),
          mobileLogoLoaded:(() => {const l=$(".v52-logo-button img");return !!l&&l.complete&&l.naturalWidth>0;})(),
          mobileHeading:$(".v52-editorial h1")?.innerText.replace(/\s+/g," ").trim(),
          mobileHero:rect(".v52-hero-surface"),
          stage,
          logo: rect(".v5-brand"),
          navigation: rect(".v5-navigation"),
          sharedHeader: rect(".site.v5-home .top-header"),
          sharedLogo: rect(".site.v5-home .top-header .top-brand"),
          sharedNavigation: rect(".site.v5-home .top-header .desktop-nav"),
          title: rect(".v5-headline"),
          computer: rect(".v5-depth-composition"),
          cta: rect(".v5-bottom-left"),
          artReady: !!$(".v5-layers-ready"),
          layers: [...document.querySelectorAll(".v5-depth-part img")].map(img => ({
            src:img.getAttribute("src"), loaded:img.complete && img.naturalWidth > 0
          })),
          headline: $(".v5-headline")?.innerText.replace(/\s+/g, " "),
          background: stage ? getComputedStyle($(".v5-stage")).backgroundColor : null
        };
      }, isDesktop);
      if (result.desktopVisible !== isDesktop || result.mobileVisible === isDesktop) errors.push(`${viewport.name}: incorrect desktop/mobile routing`);
      if (!isDesktop && (!result.mobileArtReady || !result.mobileLogoLoaded || !result.mobileHeading?.includes("GAME WORLDS"))) {
        errors.push(`${viewport.name}: mobile artwork, original logo or editorial typography incomplete`);
      }
      if (result.scrollWidth > result.windowWidth + 8) errors.push(`${viewport.name}: horizontal page overflow ${result.scrollWidth}px`);
      if (isDesktop && (!result.artReady || result.layers.length !== 6 || result.layers.some(x => !x.loaded))) {
        errors.push(`${viewport.name}: original six-layer computer artwork failed to load`);
      }
      if (isDesktop && viewport.width === 1586) {
        // V6 unified navigation replaces the intentionally hidden V5 header.
        const shared = result.sharedHeader?.w > 100 && result.sharedLogo?.w > 50 &&
          result.sharedNavigation?.w > 100;
        const legacy = result.logo?.w > 50 && result.navigation?.w > 100;
        if (!shared && !legacy) errors.push("No visible, complete desktop navigation header.");
        const targetX = shared ? 0 : 30;
        const targetY = shared ? 0 : 20;
        if (!result.stage || Math.abs(result.stage.x - targetX) > 9)
          errors.push("Master stage horizontal alignment differs from active layout.");
        if (!result.stage || Math.abs(result.stage.y - targetY) > 9)
          errors.push("Master stage vertical alignment differs from active layout.");
        if (!result.title?.w || !result.computer?.w)
          errors.push("Missing main headline or six-layer computer composition.");
      }
      if (jsErrors.length) errors.push(`${viewport.name}: Javascript exceptions ${jsErrors.join(" | ")}`);
      checks.push({ viewport, ...result, jsErrors });
      console.log(`V5_QA ${viewport.name}: ${JSON.stringify(result)}`);
    } catch (error) {
      errors.push(`${viewport.name}: ${error.message}`);
      console.error(`V5_QA ERROR ${viewport.name}:`, error.message);
    } finally {
      await page.close();
    }
  }

  // V5.7 checks every inner page, not only the homepage.
  for(const viewport of [{width:393,height:852,name:"iphone"},{width:1440,height:900,name:"desktop"}]){
    const routePage=await browser.newPage({viewport});
    for(const route of ["/games","/company","/technology","/partners","/contact"]){
      await routePage.goto(root+route,{waitUntil:"domcontentloaded",timeout:30000});
      await routePage.locator("#main-content").waitFor();
      await routePage.screenshot({path:output+"/v57-"+viewport.name+"-"+route.slice(1)+".png",fullPage:true,animations:"disabled"});
      const audit=await routePage.evaluate(()=>{
        const css=s=>getComputedStyle(document.querySelector(s));
        const headline=document.querySelector(".page-head h1,.corp-two h2");
        const badEm=[...document.querySelectorAll(".page-head h1 em,.corp-two h2 em,.site-footer h2 em,.studio-copy h2 em,.technology-feature h2 em")].filter(el=>{
          const x=getComputedStyle(el);return x.backgroundImage!=="none" || (x.backgroundColor!=="rgba(0, 0, 0, 0)" && x.backgroundColor!=="transparent");
        }).map(el=>el.textContent);
        return {headlineFont:headline?getComputedStyle(headline).fontFamily:null,badEm,
          logoBackground:css(".side-panel .brand-logo").backgroundColor,
          promoBackground:css(".side-panel .side-card").backgroundColor,
          ctaBackground:css(".footer-cta").backgroundColor,
          ctaRadius:css(".footer-cta").borderRadius,
          landscapeCards:[...document.querySelectorAll(".catalog-grid .game-card-media")].map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height};}),
          scrollWidth:document.documentElement.scrollWidth,windowWidth:innerWidth};
      });
      if(route==="/games" && (audit.landscapeCards.length!==3||audit.landscapeCards.some(c=>c.width<=c.height)))errors.push(viewport.name+" "+route+": game catalog must have three landscape covers");
      if(audit.badEm.length)errors.push(viewport.name+" "+route+": gradient rectangles "+audit.badEm.join(","));
      if(["rgb(0, 0, 0)","rgb(23, 21, 27)"].includes(audit.logoBackground))errors.push(viewport.name+" "+route+": black logo plaque");
      if(audit.promoBackground==="rgb(25, 22, 29)")errors.push(viewport.name+" "+route+": black promo panel");
      if(audit.ctaBackground!=="rgb(166, 56, 212)")errors.push(viewport.name+" "+route+": CTA not purple");
      if(audit.scrollWidth>audit.windowWidth+8)errors.push(viewport.name+" "+route+": horizontal overflow");
      checks.push({viewport:{...viewport,name:viewport.name+"-"+route.slice(1)},...audit});
      console.log("V57_ROUTE_QA",viewport.name,route,JSON.stringify(audit));
    }
    await routePage.close();
  }
  const navPage = await browser.newPage({ viewport: {width:1586,height:992} });
  await navPage.goto(root,{waitUntil:"domcontentloaded"});
  await navPage.locator(".v5-button-primary").click();
  try {
    await navPage.waitForURL("**/games", {timeout:12000});
  } catch {
    errors.push("Explore Games CTA failed navigation.");
  }
  await navPage.goto(root,{waitUntil:"domcontentloaded"});
  // The V6 shared header replaced the old V5 login and is the visible UI.
  if (await navPage.locator(".site.v5-home .top-header").isVisible()) {
    try {
      await navPage.locator(".top-header .contact-header").click({timeout:6000});
      await navPage.waitForURL("**/contact",{timeout:12000});
      await navPage.locator(".top-header .top-brand").click({timeout:6000});
      await navPage.waitForURL("**/",{timeout:12000});
    } catch (error) {
      errors.push("Shared desktop header contact/home navigation failed: "+error.message);
    }
  } else if (await navPage.locator(".v5-login").isVisible()) {
    try {
      await navPage.locator(".v5-login").click({timeout:6000});
      const dialog = navPage.locator('[role="dialog"][aria-label="Partner account notice"]');
      await dialog.waitFor({state:"visible",timeout:10000});
      await dialog.locator(".v5-dialog-close").click();
      await dialog.waitFor({state:"hidden",timeout:10000});
    } catch (error) {
      errors.push("Legacy partner access dialog failed: "+error.message);
    }
  } else {
    errors.push("No visible desktop header action to test.");
  }
  await navPage.close();

  const mobile = await browser.newPage({viewport:{width:393,height:852}});
  await mobile.emulateMedia({reducedMotion:"reduce"});
  await mobile.goto(root,{waitUntil:"domcontentloaded"});
  await mobile.locator(".v52-menu-button").click();
  if (!(await mobile.locator("#v52-site-navigation").evaluate(el=>el.classList.contains("side-open"))))
    errors.push("Mobile hamburger did not open site navigation.");
  await mobile.keyboard.press("Escape");
  if (await mobile.locator("#v52-site-navigation").evaluate(el=>el.classList.contains("side-open")))
    errors.push("Escape did not close the mobile navigation.");
  await mobile.locator(".v52-language-button").click();
  await mobile.waitForFunction(()=>document.querySelector(".v52-language-button")?.textContent?.includes("ID"));
  if(await mobile.locator(".v52-games-rail .v52-game-card").count()!==3)errors.push("Homepage must display exactly three landscape cards.");
  const cardLayout=await mobile.locator(".v52-games-rail").evaluate(el=>getComputedStyle(el).gridTemplateColumns);
  if(cardLayout.split(" ").length!==1)errors.push("Homepage game cards must stack in one column.");
  const firstCard=await mobile.locator(".v52-card-cover").first().boundingBox();
  if(!firstCard||firstCard.width<=firstCard.height)errors.push("Homepage game covers must be landscape.");
  await mobile.locator(".v52-primary-cta").click();
  try {await mobile.waitForURL("**/games",{timeout:12000});}
  catch {errors.push("Mobile Explore Games CTA failed navigation.");}
  await mobile.close();

  // V6.1 UI-locked typography regression: Minecraft only for section headers,
  // monospace for descriptive text, and original hero/nav geometry untouched.
  for (const viewport of [
    { width: 1440, height: 900, name: "type-desktop" },
    { width: 393, height: 852, name: "type-mobile" }
  ]) {
    for (const route of ["/", "/games", "/company", "/technology", "/partners", "/contact", "/games/skygate-5000"]) {
      const typePage = await browser.newPage({viewport});
      try {
        await typePage.emulateMedia({reducedMotion:"reduce"});
        await typePage.goto(root + route, {waitUntil:"domcontentloaded",timeout:30000});
        await typePage.locator("#main-content").waitFor({timeout:12000});
        const fontStates = await typePage.evaluate(async () => {
          const fonts = await document.fonts.load('24px "SoftTech Minecraft"', 'MINECRAFT');
          await document.fonts.ready;
          const head = document.querySelector(".collection-heading h2, .v52-studio-summary h2, .page-head h1, .detail-description h2, .corp-two h2");
          const paragraphs = [...document.querySelectorAll(".main-content p")].filter(x=>getComputedStyle(x).display!=="none");
          const copy = paragraphs.find(x=>x.textContent?.trim().length > 25) || paragraphs[0];
          const hero = window.innerWidth>=1100 ? document.querySelector(".v5-desktop-only .v5-headline") : document.querySelector(".v52-mobile-only .v52-editorial h1");
          const nav = document.querySelector(".top-header .desktop-nav button");
          const rect = s => { const e=document.querySelector(s);const b=e?.getBoundingClientRect();return b?{x:b.x,width:b.width}:null;};
          return {
            loadedFaces: fonts.length, fontStatus: fonts.map(f=>f.status),
            heading: head?{font:getComputedStyle(head).fontFamily,text:head.textContent?.replace(/\s+/g," ").slice(0,90)}:null,
            copy: copy?{font:getComputedStyle(copy).fontFamily,text:copy.textContent?.replace(/\s+/g," ").slice(0,60)}:null,
            heroFont: hero?getComputedStyle(hero).fontFamily:null,
            navFont: nav?getComputedStyle(nav).fontFamily:null,
            nav: rect(".top-header .desktop-nav"), stage:rect(".v5-stage"),
            scrollWidth:document.documentElement.scrollWidth, width:window.innerWidth
          };
        });
        const tag = viewport.name + " " + route;
        if (!fontStates.loadedFaces || fontStates.fontStatus.some(s=>s!=="loaded"))
          errors.push(tag+": Minecraft webfont failed loading");
        if (!fontStates.heading?.font.includes("SoftTech Minecraft"))
          errors.push(tag+": section heading is not Minecraft");
        if (!fontStates.copy?.font.includes("monospace"))
          errors.push(tag+": editorial paragraph is not monospace");
        if (route==="/" && !fontStates.heroFont?.includes("SoftTech Minecraft"))
          errors.push(tag+": main hero headline did not use Minecraft");
        if (fontStates.navFont?.includes("SoftTech Minecraft"))
          errors.push(tag+": universal navbar font was overwritten");
        if (fontStates.scrollWidth > fontStates.width + 8)
          errors.push(tag+": typography introduced horizontal overflow");
        if (viewport.width>=1100 && route==="/" && Math.abs((fontStates.stage?.width||0)-viewport.width)>4)
          errors.push(tag+": full-width orange-computer stage was changed");
        checks.push({viewport:{...viewport,name:tag},...fontStates});
        if (route==="/" || route==="/company" || route==="/games")
          await typePage.screenshot({path:output+"/"+viewport.name+"-"+(route==="/"
            ?"home":route.slice(1))+".png",fullPage:true,animations:"disabled"});
      } catch (error) {
        errors.push(viewport.name+" "+route+": typography QA exception "+error.message);
      } finally {
        await typePage.close();
      }
    }
  }

} finally {
  await browser.close();
}
await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, generatedAt: new Date().toISOString() }, null, 2));
console.log("V5_QA_FINAL", JSON.stringify({ viewports: checks.length, errorCount: errors.length, errors }));
if (errors.length > 0) process.exitCode = 1;
