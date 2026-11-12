import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

test("Visual editor has selectable independent layers, grid styles, and mobile canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Visual Editor" })).toBeVisible();
  await expect(page.getByText("ANIMATION TIMELINE")).toBeVisible();
  await page.getByRole("button", { name: "Square", exact: true }).click();
  await expect(page.getByRole("button", { name: "Square", exact: true })).toHaveClass(/chosen/);
  await page.getByRole("button", { name: "Clean", exact: true }).click();
  await expect(page.getByRole("button", { name: "Clean", exact: true })).toHaveClass(/chosen/);
  await page.getByRole("button", { name: "Dots", exact: true }).click();
  await page.getByTitle("Mobile preview").click();
  await expect(page.getByText("mobile canvas")).toBeVisible();
  await page.screenshot({ path: "test-results/visual-editor.png", fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "Dots", exact: true })).toHaveClass(/chosen/);
});

test("Economy workspace is clearly draft-only; Audio workspace has four tracks", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Economy Lab" }).click();
  await expect(page.getByText("Simulation not connected")).toBeVisible();
  await expect(page.getByText("NOT VERIFIED")).toBeVisible();
  await page.getByRole("button", { name: "Audio Studio" }).click();
  await expect(page.getByText("Background Music", { exact: true })).toBeVisible();
  await expect(page.getByText("Free Spin", { exact: true })).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);
});

test("Brand workspace exports favicon, Apple icon, PWA and Telegram Open Graph assets", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Brand & Share" }).click();
  await expect(page.getByRole("img", { name: "Telegram Open Graph preview" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Apple touch icon preview" })).toBeVisible();
  await page.getByRole("textbox", { name: "Public HTTPS URL" }).fill("https://games.softtech.example.net/cyber-punk");
  await expect(page.getByText(/Masukkan URL publik HTTPS yang valid/)).toHaveCount(0);
  await page.screenshot({ path: "test-results/brand-share.png", fullPage: true });
  const pending = page.waitForEvent("download", { timeout: 45000 });
  await page.getByRole("button", { name: "Export asset pack" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/cyber-punk-brand-share-assets\.zip/);
  const buf = await readFile(await download.path());
  const zip = await JSZip.loadAsync(buf);
  for (const filename of [
    "favicon.ico", "favicon.svg", "favicon-16x16.png", "apple-touch-icon.png",
    "android-chrome-192x192.png", "android-chrome-512x512.png",
    "maskable-icon-512x512.png", "og-telegram.png", "site.webmanifest", "meta-tags.html",
  ]) {
    expect(zip.file(filename), "Missing ZIP file " + filename).toBeTruthy();
  }
  const meta = await zip.file("meta-tags.html").async("string");
  expect(meta).toContain("og:image");
  expect(meta).toContain("twitter:card");
  expect(meta).toContain("noindex,nofollow");
});


test("Canvas Fit keeps the complete stage visible across device switches", async ({ page }) => {
  await page.goto("/");
  const stage = page.locator(".stage-outer");
  const viewport = page.locator(".canvas-viewport");
  async function assertFits() {
    await expect(async () => {
      const a = await stage.boundingBox();
      const b = await viewport.boundingBox();
      expect(a, "Stage must be rendered").not.toBeNull();
      expect(b, "Canvas viewport must be rendered").not.toBeNull();
      expect(a.x).toBeGreaterThanOrEqual(b.x - 2);
      expect(a.y).toBeGreaterThanOrEqual(b.y - 2);
      expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 2);
      expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height + 2);
    }).toPass({ timeout: 15000 });
  }
  await assertFits();
  await page.getByTitle("Mobile preview").click();
  await assertFits();
  await expect(page.getByRole("button", { name: "Fit canvas to view" })).toHaveClass(/active/);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByRole("button", { name: "Fit canvas to view" })).not.toHaveClass(/active/);
  await page.getByRole("button", { name: "Fit canvas to view" }).click();
  await assertFits();
});

test("Compact workspace fits the mobile game preview on an actual phone-sized viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTitle("Mobile preview").click();
  const outer = page.locator(".stage-outer");
  const editor = page.locator(".canvas-viewport");
  await expect(async () => {
    const a = await outer.boundingBox(), b = await editor.boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a.x).toBeGreaterThanOrEqual(b.x - 2);
    expect(a.y).toBeGreaterThanOrEqual(b.y - 2);
    expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 2);
    expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height + 2);
  }).toPass({ timeout: 15000 });
  await page.screenshot({ path: "test-results/mobile-editor.png", fullPage: true });
});


test("Studio staging serves its own browser favicon", async ({ request }) => {
  const icon = await request.get("/favicon.svg");
  expect(icon.status()).toBe(200);
  expect(await icon.text()).toContain("<svg");
});

test("Slot size presets edit the real preview, persist across reload, and support custom grids", async ({ page }) => {
  await page.goto("/");
  const grid = page.locator(".reel-wrap");
  await expect(grid).toHaveAttribute("data-reels", "5");
  await expect(grid).toHaveAttribute("data-rows", "3");
  await expect(page.locator(".reel-cell")).toHaveCount(15);

  for (const [reels, rows] of [[5, 5], [6, 3], [6, 5], [5, 3]]) {
    await page.getByRole("button", { name: "Economy Lab" }).click();
    await page.getByRole("button", { name: reels + " × " + rows, exact: true }).click();
    await page.getByRole("button", { name: "Visual Editor" }).click();
    await expect(grid).toHaveAttribute("data-reels", String(reels));
    await expect(grid).toHaveAttribute("data-rows", String(rows));
    await expect(page.locator(".reel-cell")).toHaveCount(reels * rows);
  }

  await page.getByRole("button", { name: "Economy Lab" }).click();
  await page.getByRole("spinbutton", { name: "Reels" }).fill("7");
  await page.getByRole("spinbutton", { name: "Rows" }).fill("4");
  await expect(page.getByText("Custom grid: 7 reels × 4 rows", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Visual Editor" }).click();
  await expect(page.locator(".reel-cell")).toHaveCount(28);
  await page.getByTitle("Mobile preview").click();
  await expect(grid).toHaveAttribute("data-reels", "7");
  await expect(grid).toHaveAttribute("data-rows", "4");
  await page.reload();
  await expect(page.locator(".reel-cell")).toHaveCount(28);
});

test("Old imported draft cannot produce unbounded slot layouts", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const key = "softtech-universal-game-studio-v1";
    const draft = JSON.parse(localStorage.getItem(key));
    draft.economy.reels = 500;
    draft.economy.rows = -20;
    localStorage.setItem(key, JSON.stringify(draft));
  });
  await page.reload();
  await expect(page.locator(".reel-wrap")).toHaveAttribute("data-reels", "8");
  await expect(page.locator(".reel-wrap")).toHaveAttribute("data-rows", "2");
  await expect(page.locator(".reel-cell")).toHaveCount(16);
});
