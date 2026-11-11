import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

for (const path of ["index.html", "src/main.jsx", "src/App.jsx", "src/styles.css", "src/brandAssets.js"]) {
  assert.ok(existsSync(resolve(root, path)), "Missing studio file: " + path);
}

const app = read("src/App.jsx");
const assets = read("src/brandAssets.js");
assert.ok(app.includes('["visual"') && app.includes('["audio"') && app.includes('["economy"') && app.includes('["brand"'), "Missing Studio workspaces");
assert.ok(app.includes('value="dots"') && app.includes('value="squares"') && app.includes('value="clean"'), "Missing canvas grid modes");
for (const file of ["apple-touch-icon.png", "favicon.ico", "favicon.svg", "og-telegram.png", "site.webmanifest"]) {
  assert.ok(assets.includes(file), "Missing brand output: " + file);
}
for (const tag of ["og:image", "twitter:card", "apple-touch-icon", "rel=\"canonical\""]) {
  assert.ok(assets.includes(tag), "Missing metadata tag: " + tag);
}
assert.ok(assets.includes("noindex,nofollow"), "Sandbox metadata must default to noindex");
console.log("Studio source smoke check passed.");
