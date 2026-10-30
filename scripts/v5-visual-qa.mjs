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
  { width: 390, height: 844, name: "iphone-390" }
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
        await page.locator(".v5-v4-fallback").waitFor({ state: "visible" });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${output}/${viewport.name}.png`, animations: "disabled" });
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
          stage,
          logo: rect(".v5-brand"),
          navigation: rect(".v5-navigation"),
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
      if (result.desktopVisible !== isDesktop) errors.push(`${viewport.name}: incorrect desktop/mobile routing`);
      if (result.scrollWidth > result.windowWidth + 8) errors.push(`${viewport.name}: horizontal page overflow ${result.scrollWidth}px`);
      if (isDesktop && (!result.artReady || result.layers.length !== 6 || result.layers.some(x => !x.loaded))) {
        errors.push(`${viewport.name}: original six-layer computer artwork failed to load`);
      }
      if (isDesktop && viewport.width === 1586) {
        if (!result.stage || Math.abs(result.stage.x - 30) > 9) errors.push("Master reference panel horizontal alignment differs from target.");
        if (!result.stage || Math.abs(result.stage.y - 20) > 9) errors.push("Master reference panel vertical alignment differs from target.");
        if (!result.title || !result.navigation || !result.logo || !result.computer) errors.push("Missing required master layout elements.");
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
  const navPage = await browser.newPage({ viewport: {width:1586,height:992} });
  await navPage.goto(root,{waitUntil:"domcontentloaded"});
  await navPage.locator(".v5-button-primary").click();
  if (!new URL(navPage.url()).pathname.startsWith("/games")) errors.push("Explore Games CTA failed navigation.");
  await navPage.goto(root,{waitUntil:"domcontentloaded"});
  await navPage.locator(".v5-login").click();
  const dialog = navPage.locator('[role="dialog"][aria-label="Partner account notice"]');
  if (!(await dialog.isVisible())) errors.push("Partner access dialog not interactive.");
  await dialog.locator(".v5-dialog-close").click();
  if (await dialog.isVisible()) errors.push("Partner access dialog did not close.");
  await navPage.close();
} finally {
  await browser.close();
}
await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, generatedAt: new Date().toISOString() }, null, 2));
console.log("V5_QA_FINAL", JSON.stringify({ viewports: checks.length, errorCount: errors.length, errors }));
if (errors.length > 0) process.exitCode = 1;
