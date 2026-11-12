/**
 * Independent PNG/WebP art candidate intake for Universal Game Studio.
 * The ZIP contains only declarative metadata and raster bytes. No scripts are run.
 * Binary master and revisions live in IndexedDB; localStorage stores only keys.
 * No math, wallet or release decisions are affected by importing artwork.
 */
import JSZip from "jszip";

const SCHEMA = "softtech.studio.raster-pack.v1";
const DB_NAME = "softtech-universal-studio-raster-v1";
const STORE = "rasterAssets";
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,90}$/;
const PATH = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,90}\.(png|webp)$/;
const SHA = /^[a-f0-9]{64}$/;
const SYMBOLS = ["A", "K", "Q", "J", "WILD", "SCATTER"];
const MAX_ZIP = 20 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_EXPANDED = 45 * 1024 * 1024;

export function validateRasterManifest(manifest, gameId) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      manifest.schemaVersion !== SCHEMA || manifest.gameId !== gameId ||
      manifest.visualTier !== "ART_CANDIDATE_UNAPPROVED" ||
      manifest.productionAllowed !== false || manifest.humanApproved !== false)
    throw new Error("Only unapproved, production-blocked artwork for this Game Factory game is accepted");
  if (!SHA.test(manifest.sourceMasterSha256 || ""))
    throw new Error("Source art master hash is required");
  if (!Array.isArray(manifest.assets) || manifest.assets.length < 6 || manifest.assets.length > 35)
    throw new Error("Invalid raster pack inventory");
  const seen = new Set();
  let total = 0;
  for (const a of manifest.assets) {
    if (!a || typeof a !== "object" || !ID.test(a.id || "") ||
        seen.has(a.id) || !PATH.test(a.path || "") ||
        !SHA.test(a.sha256 || "") ||
        !["symbol", "layer", "background", "hero"].includes(a.role) ||
        typeof a.expectedAlpha !== "boolean" ||
        !Array.isArray(a.dimensions) || a.dimensions.length !== 2 ||
        !a.dimensions.every(x => Number.isInteger(x) && x >= 96 && x <= 4096) ||
        !Number.isSafeInteger(a.sizeBytes) || a.sizeBytes < 100 || a.sizeBytes > MAX_IMAGE)
      throw new Error("Invalid raster asset metadata");
    if (a.role === "symbol" && (a.expectedAlpha !== true || !SYMBOLS.includes(a.id)))
      throw new Error("Unexpected symbol binding or missing alpha requirement");
    if (a.role === "background" && a.expectedAlpha)
      throw new Error("Scene background cannot masquerade as transparent sprite");
    total += a.sizeBytes;
    seen.add(a.id);
  }
  if (total > MAX_EXPANDED) throw new Error("Expanded art package exceeds safe limit");
  if (SYMBOLS.some(id => !seen.has(id)))
    throw new Error("Visual pack is missing one of six independent symbols");
  if (manifest.assets.filter(x => x.role === "symbol").length !== 6)
    throw new Error("Exactly six primary symbol bindings required for this V1 pilot");
  if (!manifest.assets.some(x => x.role === "background"))
    throw new Error("Art ZIP requires a separate clean scene background");
  return manifest;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}

async function verifyImage(bytes, item) {
  const mime = item.path.endsWith(".png") ? "image/png" : "image/webp";
  const blob = new Blob([bytes], { type: mime });
  if (typeof createImageBitmap !== "function") throw new Error("This browser cannot decode artwork safely");
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width !== item.dimensions[0] || bitmap.height !== item.dimensions[1])
      throw new Error("Asset size differs from its signed inventory: " + item.id);
    if (item.expectedAlpha) {
      // Sample the actual decoded alpha channel. A checkerboard RGB source is opaque.
      const canvas = document.createElement("canvas");
      canvas.width = 64; canvas.height = 64;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Alpha decoder unavailable");
      context.clearRect(0, 0, 64, 64);
      context.drawImage(bitmap, 0, 0, 64, 64);
      const pixels = context.getImageData(0, 0, 64, 64).data;
      let transparent = false;
      for (let i = 3; i < pixels.length; i += 4)
        if (pixels[i] < 245) { transparent = true; break; }
      if (!transparent) throw new Error("Asset " + item.id + " has no actual alpha transparency");
    }
  } finally { bitmap.close(); }
  return blob;
}

function database() {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is required to retain high-resolution assets");
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE))
        r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("Raster library unavailable"));
    r.onblocked = () => reject(new Error("Raster database upgrade blocked"));
  });
}

async function saveBlobs(entries) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      for (const [key, blob] of entries) tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Raster asset storage failed"));
      tx.onabort = () => reject(tx.error || new Error("Raster asset storage aborted"));
    });
  } finally { db.close(); }
}

export async function loadRasterUrls(refs, gameId) {
  if (!refs || typeof refs !== "object") return {};
  if (typeof gameId !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(gameId))
    throw new Error("Missing trusted Game Factory asset namespace");
  const ids = Object.keys(refs);
  if (!ids.length) return {};
  if (ids.length > 35 || ids.some(id => !ID.test(id) || typeof refs[id] !== "string" ||
      refs[id].length > 220 || !refs[id].startsWith(gameId + ":")))
    throw new Error("Unsafe or cross-game raster reference");
  const db = await database();
  try {
    const blobs = await Promise.all(ids.map(id => new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(refs[id]);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Raster lookup failed"));
    })));
    const urls = {};
    ids.forEach((id, i) => { if (blobs[i] instanceof Blob) urls[id] = URL.createObjectURL(blobs[i]); });
    return urls;
  } finally { db.close(); }
}

export function revokeRasterUrls(urls) {
  for (const url of Object.values(urls || {}))
    if (typeof url === "string" && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export async function importRasterPack(file, gameId) {
  if (!(file instanceof Blob) || file.size < 200 || file.size > MAX_ZIP)
    throw new Error("Raster artwork ZIP must be 200 bytes to 20 MB");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const files = Object.values(zip.files).filter(x => !x.dir);
  if (files.length > 40 || files.some(x => {
    const name = x.name;
    return !PATH.test(name) && name !== "art-pack.json" && name !== "studio.project.json";
  })) throw new Error("Raster ZIP contains unexpected files or executable content");
  const rawManifest = zip.file("art-pack.json");
  if (!rawManifest) throw new Error("Missing art-pack.json");
  const jsonBytes = await rawManifest.async("uint8array");
  if (jsonBytes.byteLength > 200000) throw new Error("Art manifest is too large");
  const manifest = validateRasterManifest(JSON.parse(new TextDecoder().decode(jsonBytes)), gameId);
  const packId = gameId + ":" + (await sha256(jsonBytes));
  const entries = [];
  const refs = {};
  for (const item of manifest.assets) {
    const fileEntry = zip.file(item.path);
    if (!fileEntry) throw new Error("Raster pack missing " + item.path);
    const bytes = await fileEntry.async("uint8array");
    if (bytes.byteLength !== item.sizeBytes || bytes.byteLength > MAX_IMAGE ||
        await sha256(bytes) !== item.sha256)
      throw new Error("Corrupt or modified raster: " + item.id);
    const blob = await verifyImage(bytes, item);
    const key = packId + ":" + item.id;
    entries.push([key, blob]); refs[item.id] = key;
  }
  await saveBlobs(entries);
  return { refs, packId, visualTier: manifest.visualTier, count: manifest.assets.length };
}

export async function replaceRasterAsset(previousRefs, packId, id, file) {
  if (!ID.test(id) || !previousRefs?.[id] || !packId ||
      !(file instanceof Blob) || file.size > MAX_IMAGE || file.size < 100 ||
      !/\.(png|webp)$/i.test(file.name || ""))
    throw new Error("Invalid independent raster replacement");
  const mime = /\.png$/i.test(file.name) ? "image/png" : "image/webp";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  let width, height;
  try { width = bitmap.width; height = bitmap.height; }
  finally { bitmap.close(); }
  if (width < 96 || height < 96 || width > 4096 || height > 4096)
    throw new Error("Replacement dimensions outside supported bounds");
  const item = {
    id, dimensions: [width, height],
    path: "assets/replacement." + (mime === "image/png" ? "png" : "webp"),
    expectedAlpha: id !== "background",
  };
  const blob = await verifyImage(bytes, item);
  const revisionKey = packId + ":revision:" + id + ":" + crypto.randomUUID();
  await saveBlobs([[revisionKey, blob]]);
  return { ...previousRefs, [id]: revisionKey };
}
