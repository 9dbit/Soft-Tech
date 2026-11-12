import test from "node:test";
import assert from "node:assert/strict";
import { validateRasterManifest } from "../src/rasterAssets.js";

const master = "a".repeat(64);
const mock = () => ({
  schemaVersion: "softtech.studio.raster-pack.v1", gameId: "neon-dragon",
  visualTier: "ART_CANDIDATE_UNAPPROVED", humanApproved: false,
  productionAllowed: false, sourceMasterSha256: master,
  assets: ["A","K","Q","J","WILD","SCATTER","background"].map(id => ({
    id, role: id === "background" ? "background" : "symbol",
    expectedAlpha: id !== "background", path: "assets/" + id + ".png",
    sizeBytes: 420, dimensions: [128,128], sha256: master,
  })),
});

function rejects(update, pattern) {
  const x = mock(); update(x);
  assert.throws(() => validateRasterManifest(x,"neon-dragon"),pattern);
}

test("art candidate manifest carries 6 independent symbol IDs and blocked release", () => {
  assert.equal(validateRasterManifest(mock(),"neon-dragon").assets.length,7);
  rejects(m => {m.visualTier="ART_APPROVED"}, /unapproved/);
  rejects(m => {m.productionAllowed=true}, /unapproved/);
  rejects(m => {m.humanApproved=true}, /unapproved/);
  assert.throws(() => validateRasterManifest(mock(),"different-game"), /this Game Factory game/);
});

test("raster intake rejects duplicate/missing symbols, fake opacity and unsafe paths", () => {
  rejects(m => {m.assets[0].id="K"}, /metadata/);
  rejects(m => {m.assets.pop()}, /background/);
  rejects(m => {m.assets.splice(0,1)}, /six independent symbols/);
  rejects(m => {m.assets[0].expectedAlpha=false}, /missing alpha/);
  rejects(m => {m.assets[6].expectedAlpha=true}, /masquerade/);
  rejects(m => {m.assets[1].path="../../private.png"}, /metadata/);
  rejects(m => {m.assets[2].path="assets/evil.svg"}, /metadata/);
});

test("raster intake rejects fabricated dimensions, hashes and large payloads", () => {
  rejects(m => {m.sourceMasterSha256="not-a-sha"}, /master hash/);
  rejects(m => {m.assets[2].sha256="abc"}, /metadata/);
  rejects(m => {m.assets[4].dimensions=[1,1]}, /metadata/);
  rejects(m => {m.assets[1].sizeBytes=9*1024*1024}, /metadata/);
  rejects(m => {m.assets=Array.from({length:36},(_,i)=>({...m.assets[0],id:"asset-"+i}))}, /inventory/);
});
