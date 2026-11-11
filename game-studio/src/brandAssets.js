import JSZip from "jszip";

export const DEFAULT_BRAND = {
  name: "Cyber Punk",
  shortName: "Cyber Punk",
  description: "Enter a neon-lit futuristic world in this original arcade slot demo.",
  publicUrl: "",
  color: "#0d99ff",
  background: "#111827",
  release: "sandbox",
};

const safeColor = (input, fallback) => /^#[0-9a-fA-F]{6}$/.test(input || "") ? input : fallback;
const xml = (input) => String(input || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (text) => String(text || "game").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "game";
const initials = (name) => String(name || "Game").trim().split(/\s+/).slice(0, 2).map(x => x.charAt(0)).join("").toUpperCase() || "G";

function urlInfo(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (!u.hostname || u.hostname.endsWith(".example") || u.hostname === "localhost") return null;
    return u;
  } catch {
    return null;
  }
}

export function validateBrand(brand) {
  const errors = [];
  if (!String(brand.name || "").trim()) errors.push("Game title belum diisi.");
  if (!String(brand.description || "").trim()) errors.push("Meta description belum diisi.");
  if (String(brand.description || "").length > 160) errors.push("Meta description lebih dari 160 karakter.");
  if (!urlInfo(brand.publicUrl)) errors.push("Masukkan URL publik HTTPS yang valid sebelum publish. Draft boleh memakai placeholder.");
  return errors;
}

function canvas(w, h) {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  return el;
}

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function iconScene(ctx, size, brand, maskable) {
  const base = safeColor(brand.background, "#111827");
  const accent = safeColor(brand.color, "#0d99ff");
  const pad = maskable ? size * .18 : 0;
  const s = size - 2 * pad;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const glow = ctx.createRadialGradient(size * .65, size * .22, 1, size * .55, size * .4, size);
  glow.addColorStop(0, accent + "aa");
  glow.addColorStop(.55, accent + "35");
  glow.addColorStop(1, base + "00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const inset = pad + s * .12;
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.5, s * .018);
  ctx.strokeRect(inset, inset, s * .76, s * .76);
  ctx.fillStyle = accent;
  ctx.fillRect(inset, inset, s * .28, s * .035);
  ctx.fillRect(pad + s * .60, pad + s * .845, s * .28, s * .035);

  const letters = initials(brand.name);
  ctx.font = "900 " + Math.floor(s * (letters.length > 1 ? .38 : .56)) + "px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = accent;
  ctx.shadowBlur = s * .13;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(letters, size / 2, size / 2 + s * .01, s * .68);
  ctx.shadowBlur = 0;
}

function drawOG(ctx, brand) {
  const w = 1200, h = 630;
  const base = safeColor(brand.background, "#111827");
  const accent = safeColor(brand.color, "#0d99ff");
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, base);
  g.addColorStop(1, "#050910");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(900, 260, 15, 900, 300, 470);
  glow.addColorStop(0, accent + "aa");
  glow.addColorStop(1, accent + "00");
  ctx.fillStyle = glow;
  ctx.fillRect(400, 0, 800, 630);
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.fillStyle = accent;
  rounded(ctx, 72, 72, 74, 8, 4);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#b8c6dc";
  ctx.font = "600 28px system-ui, sans-serif";
  ctx.fillText("SOFT TECH  /  GAME", 72, 146);
  ctx.font = "900 86px system-ui, sans-serif";
  ctx.fillStyle = "#fff";
  const title = String(brand.name || "New Game");
  ctx.fillText(title, 72, 300, 750);
  ctx.fillStyle = "#afbdd0";
  ctx.font = "28px system-ui, sans-serif";
  const description = String(brand.description || "").slice(0, 135);
  const words = description.split(/\s+/);
  let line = "", y = 365;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > 680 && line) {
      ctx.fillText(line, 72, y);
      line = word; y += 42;
      if (y > 450) break;
    } else line = test;
  }
  if (y <= 450) ctx.fillText(line, 72, y);
  const tile = canvas(400, 400);
  iconScene(tile.getContext("2d"), 400, brand, false);
  ctx.shadowColor = accent;
  ctx.shadowBlur = 70;
  ctx.drawImage(tile, 818, 172, 290, 290);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,.23)";
  ctx.fillRect(72, 544, 1056, 1);
  ctx.font = "600 23px system-ui, sans-serif";
  ctx.fillStyle = "#dbeafe";
  ctx.fillText(urlInfo(brand.publicUrl)?.hostname || "PREVIEW / NOT PUBLISHED", 72, 587);
}

function picture(w, h, painter) {
  const el = canvas(w, h);
  painter(el.getContext("2d"));
  return el;
}

export function previewBrand(brand) {
  return {
    icon: picture(256, 256, c => iconScene(c, 256, brand, false)).toDataURL("image/png"),
    og: picture(1200, 630, c => drawOG(c, brand)).toDataURL("image/png"),
  };
}

export function faviconSVG(brand) {
  const base = safeColor(brand.background, "#111827");
  const accent = safeColor(brand.color, "#0d99ff");
  return '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="' + base + '"/><path d="M10 10h44v44H10z" fill="none" stroke="' + accent + '" stroke-width="2"/><text x="32" y="42" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="900" fill="white">' + xml(initials(brand.name)) + '</text></svg>';
}

export function buildMetaTags(brand) {
  const valid = urlInfo(brand.publicUrl);
  const base = valid ? valid.href.replace(/\/$/, "") : "{{PUBLIC_GAME_URL}}";
  const image = valid ? new URL("/og-telegram.png", valid.origin).href : "{{ABSOLUTE_OG_IMAGE_URL}}";
  const title = xml(brand.name || "New Game");
  const desc = xml(brand.description || "");
  const lines = [
    '<title>' + title + ' | Soft Tech</title>',
    '<meta name="description" content="' + desc + '">',
    '<meta name="theme-color" content="' + safeColor(brand.background, "#111827") + '">',
    '<meta name="robots" content="' + (brand.release === "production" ? "index,follow" : "noindex,nofollow") + '">',
    '<link rel="canonical" href="' + xml(base) + '">',
    '<link rel="icon" href="/favicon.ico" sizes="any">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Soft Tech">',
    '<meta property="og:title" content="' + title + '">',
    '<meta property="og:description" content="' + desc + '">',
    '<meta property="og:url" content="' + xml(base) + '">',
    '<meta property="og:image" content="' + xml(image) + '">',
    '<meta property="og:image:secure_url" content="' + xml(image) + '">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:alt" content="' + title + ' game preview">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + title + '">',
    '<meta name="twitter:description" content="' + desc + '">',
    '<meta name="twitter:image" content="' + xml(image) + '">',
  ];
  return lines.join("\n");
}

async function pngBlob(el) {
  return new Promise((resolve, reject) => el.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG conversion failed")), "image/png"));
}

async function iconPng(size, brand, maskable) {
  return pngBlob(picture(size, size, c => iconScene(c, size, brand, maskable)));
}

async function makeICO(brand) {
  const sizes = [16, 32];
  const pngs = await Promise.all(sizes.map(s => iconPng(s, brand, false).then(blob => blob.arrayBuffer()).then(b => new Uint8Array(b))));
  const header = new Uint8Array(6 + sizes.length * 16);
  const view = new DataView(header.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, sizes.length, true);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const position = 6 + index * 16;
    view.setUint8(position, size);
    view.setUint8(position + 1, size);
    view.setUint16(position + 4, 1, true);
    view.setUint16(position + 6, 32, true);
    view.setUint32(position + 8, pngs[index].byteLength, true);
    view.setUint32(position + 12, offset, true);
    offset += pngs[index].byteLength;
  });
  return new Blob([header, ...pngs], { type: "image/x-icon" });
}

export async function generateBrandZip(brand) {
  const zip = new JSZip();
  const images = [
    ["favicon-16x16.png", 16, false],
    ["favicon-32x32.png", 32, false],
    ["apple-touch-icon.png", 180, false],
    ["android-chrome-192x192.png", 192, false],
    ["android-chrome-512x512.png", 512, false],
    ["maskable-icon-512x512.png", 512, true],
  ];
  for (const [file, size, maskable] of images) {
    zip.file(file, await iconPng(size, brand, maskable));
  }
  zip.file("favicon.svg", faviconSVG(brand));
  zip.file("favicon.ico", await makeICO(brand));
  zip.file("og-telegram.png", await pngBlob(picture(1200, 630, c => drawOG(c, brand))));
  zip.file("meta-tags.html", buildMetaTags(brand));
  zip.file("site.webmanifest", JSON.stringify({
    name: brand.name, short_name: brand.shortName || brand.name,
    start_url: "/", display: "standalone",
    theme_color: safeColor(brand.background, "#111827"),
    background_color: safeColor(brand.background, "#111827"),
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
      { src: "/maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, null, 2));
  zip.file("asset-manifest.json", JSON.stringify({
    project: brand.name, status: brand.release, generator: "Soft Tech Studio V1",
    assets: [
      "favicon.svg", "favicon.ico", "favicon-16x16.png", "favicon-32x32.png",
      "apple-touch-icon.png", "android-chrome-192x192.png", "android-chrome-512x512.png",
      "maskable-icon-512x512.png", "og-telegram.png", "meta-tags.html", "site.webmanifest",
    ],
    warnings: validateBrand(brand),
  }, null, 2));
  zip.file("README.txt",
    "Soft Tech Game Studio - Brand & Share Asset Pack\n" +
    "Copy assets to the public root of the game website, insert meta-tags.html into its HTML head, and deploy.\n" +
    "Open Graph requires a PUBLIC HTTPS URL and reachable og-telegram.png; Telegram previews cannot be verified before deployment.\n" +
    "Verify the public page in a real browser and test Telegram preview after publishing. Telegram may cache old previews.\n" +
    "Sandbox defaults to noindex,nofollow. Set production only after release approval.\n");
  return { filename: slug(brand.name) + "-brand-share-assets.zip", blob: await zip.generateAsync({ type: "blob" }) };
}
