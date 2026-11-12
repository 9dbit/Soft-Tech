/**
 * Import a Game Factory demo package into the existing local Universal Studio.
 * This imports ONLY declarative project data. No scripts or live wallet contracts.
 */
import { validateLayout, SLOT_LIMITS } from "./slot/slotCore.js";

const REQUIRED = ["name", "canvas", "layers", "audio", "economy", "brand", "factory"];
const ID = /^[A-Z][A-Z0-9_]{0,31}$/;
const MAX_LENGTH = 1024 * 1024;

function object(input, name) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error(name + " must be an object");
  return input;
}
function untrustedText(value, name, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(name + " must be nonempty text");
  return value;
}
function validSvgData(data, key) {
  if (typeof data !== "string" || data.length > 24000 ||
      !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(data))
    throw new Error("Symbol " + key + " is not a small embedded SVG image");
  let xml;
  try { xml = atob(data.slice("data:image/svg+xml;base64,".length)); }
  catch { throw new Error("Symbol " + key + " has invalid SVG base64"); }
  if (!/^<svg[\s>]/.test(xml.trim()) ||
      /<script\b|<foreignobject\b|<image\b|<iframe\b|<object\b|<embed\b|<!doctype|<!entity|on[a-z]+\s*=|(?:xlink:)?href\s*=/i.test(xml))
    throw new Error("Symbol " + key + " SVG includes unsupported active content");
}

export function validateFactoryImport(input) {
  const raw = typeof input === "string" ? (() => {
    if (input.length > MAX_LENGTH) throw new Error("Game Factory JSON exceeds 1 MB");
    try { return JSON.parse(input); }
    catch { throw new Error("Invalid Game Factory JSON"); }
  })() : input;
  object(raw, "Game Factory project");
  for (const field of REQUIRED)
    if (!Object.hasOwn(raw, field)) throw new Error("Project missing " + field);
  untrustedText(raw.name, "Project name", 120);
  object(raw.canvas, "Canvas");
  if (!["dots", "squares", "clean"].includes(raw.canvas.grid) ||
      !["desktop", "mobile"].includes(raw.canvas.device) ||
      !/^#[0-9a-fA-F]{6}$/.test(raw.canvas.background))
    throw new Error("Unsupported canvas format");
  object(raw.economy, "Economy");
  const layout = validateLayout(raw.economy);
  if (!Number.isInteger(raw.economy.paylines) || raw.economy.paylines < 1 ||
      raw.economy.paylines > SLOT_LIMITS.maxPaylines)
    throw new Error("Invalid paylines count");
  object(raw.brand, "Brand");
  untrustedText(raw.brand.name, "Brand name", 120);
  object(raw.factory, "Game Factory manifest");
  const f = raw.factory;
  if (f.schemaVersion !== "softtech.studio.import.v1" ||
      f.mathBinding !== "demo-only" ||
      f.releaseDecision !== "BLOCKED")
    throw new Error("Only blocked demo-only Game Factory projects may be imported");
  untrustedText(f.gameId, "Factory game ID", 64);
  untrustedText(f.sourceGameVersion, "Factory version", 30);
  const symbolIds = f.symbolIds;
  if (!Array.isArray(symbolIds) || symbolIds.length < 4 || symbolIds.length > 20 ||
      new Set(symbolIds).size !== symbolIds.length ||
      symbolIds.some(id => typeof id !== "string" || !ID.test(id)))
    throw new Error("Invalid Factory symbol IDs");
  object(f.symbolAssets, "Factory SVG assets");
  if (Object.keys(f.symbolAssets).length !== symbolIds.length)
    throw new Error("Factory symbol assets must be independent and complete");
  for (const key of symbolIds) validSvgData(f.symbolAssets[key], key);
  object(f.configuration, "Factory math");
  if (f.configuration.reels !== layout.reels ||
      f.configuration.rows !== layout.rows ||
      !Array.isArray(f.configuration.paylines) ||
      f.configuration.paylines.length !== raw.economy.paylines)
    throw new Error("Imported layout does not match source math");
  if (!Array.isArray(f.configuration.reelStrips) ||
      f.configuration.reelStrips.length !== layout.reels ||
      f.configuration.reelStrips.some(strip =>
        !Array.isArray(strip) || strip.length < layout.rows || strip.length > 512 ||
        strip.some(id => !symbolIds.includes(id))))
    throw new Error("Invalid Factory reel strips");
  for (const line of f.configuration.paylines) {
    if (!Array.isArray(line) || line.length !== layout.reels ||
        line.some(row => !Number.isInteger(row) || row < 0 || row >= layout.rows))
      throw new Error("Invalid imported Factory paylines");
  }
  if (new Set(f.configuration.paylines.map(x => x.join(","))).size !==
      f.configuration.paylines.length)
    throw new Error("Duplicate imported Factory paylines");
  if (!Array.isArray(raw.layers) || raw.layers.length < 2 || raw.layers.length > 100)
    throw new Error("Invalid layer list");
  const layerIds = new Set();
  for (const l of raw.layers) {
    object(l, "Layer");
    if (!["background", "text", "reels", "button", "image"].includes(l.type) ||
        typeof l.id !== "string" || l.id.length > 90 || layerIds.has(l.id) ||
        !Number.isFinite(l.x) || !Number.isFinite(l.y) ||
        !Number.isFinite(l.width) || !Number.isFinite(l.height) ||
        l.width <= 0 || l.height <= 0 || l.width > 2000 || l.height > 2000)
      throw new Error("Invalid independent layer");
    layerIds.add(l.id);
    if (l.type === "image" && l.src &&
        !/^data:image\/(svg\+xml|png|webp);base64,/.test(l.src))
      throw new Error("External image links are not permitted in a local draft import");
  }
  if (!raw.layers.some(l => l.type === "reels")) throw new Error("Imported project needs a reel layer");
  if (!Array.isArray(raw.audio) || raw.audio.length > 20)
    throw new Error("Invalid audio tracks");
  // No executable code from imported JSON is ever evaluated.
  return structuredClone(raw);
}
