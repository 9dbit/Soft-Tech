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
