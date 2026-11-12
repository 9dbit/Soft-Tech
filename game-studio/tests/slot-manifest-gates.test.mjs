import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { validateSlotPilotManifest } from "../src/slot/manifestContract.js";
import { seededTestDraw } from "../src/slot/slotCore.js";
import { simulateDraftPaidRounds, playDraftPaidRound } from "../src/slot/paidRound.js";
import { runAudit } from "../scripts/run-slot-audit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(await readFile(resolve(root, "contracts/slot-pilot-v1.example.json"), "utf8"));
const copy = () => structuredClone(base);
const invalid = (change, pattern) => {
  const m = copy();
  change(m);
  assert.throws(() => validateSlotPilotManifest(m), pattern);
};

test("known example manifest is admissible only as sandbox research", () => {
  assert.strictEqual(validateSlotPilotManifest(base), base);
  assert.equal(base.walletMode, "demo-only");
  assert.equal(base.audit.isCertified, false);
});

test("AI manifest rejects unknown fields, production mode, spoofed audit and feature flags", () => {
  invalid(m => { m.overrideRtp = 96; }, /unknown field/);
  invalid(m => { m.math.undocumentedNewMechanic = true; }, /unknown field/);
  invalid(m => { m.walletMode = "live"; }, /draft demo-only/);
  invalid(m => { m.proposedFeatures.serverWalletIntegrationImplemented = true; }, /unavailable/);
  invalid(m => { m.audit.isCertified = true; }, /claim an audit/);
  invalid(m => { m.audit.completePaidRoundRtpPercent = 96; }, /claim an audit/);
});

test("AI manifest rejects malformed geometry, strips, paylines, symbols and paytable", () => {
  invalid(m => { m.math.layout.rows = 9; }, /rows/);
  invalid(m => { m.math.reelStrips.pop(); }, /reel strip/);
  invalid(m => { m.math.reelStrips[0][0] = "bad"; }, /symbol ID/);
  invalid(m => { m.math.paylines = [[0, 0, 0, 0, 9]]; }, /payline/);
  invalid(m => { m.math.paylines = [m.math.paylines[0], m.math.paylines[0]]; }, /duplicate payline/);
  invalid(m => { m.math.paytable.SCATTER = { 3: 2 }; }, /Scatter must not pay/);
  invalid(m => { delete m.math.paytable.WILD; }, /Wild-only awards/);
  invalid(m => { m.math.paytable.A["9"] = 999; }, /match count/);
});

test("unbounded payout cap and untracked audit override are rejected", async () => {
  invalid(m => { m.proposedFeatures.maxPaidRoundMultiplier = 100_001; }, /maxPaidRoundMultiplier/);
  await assert.rejects(runAudit([
    "--rounds", "10", "--max-round-multiplier", "500",
  ]), /payout cap differs/);
});

test("audit fails closed on a mutated manifest without writing an approved report", async () => {
  const folder = await mkdtemp(join(tmpdir(), "softtech-bad-manifest-"));
  try {
    const m = copy();
    m.math.reelStrips[1][0] = "unreviewed";
    const input = join(folder, "invalid.json");
    const output = join(folder, "result.json");
    await writeFile(input, JSON.stringify(m));
    await assert.rejects(runAudit([
      "--rounds", "10", "--manifest", input, "--output", output,
    ]), /symbol ID/);
    await assert.rejects(readFile(output), /ENOENT/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("bounded top-1-percent heap equals an independent full-sort tail statistic", () => {
  const math = base.math;
  const rounds = 300;
  const awards = Array.from({ length: rounds }, (_, i) => {
    const draw = seededTestDraw(i + 1);
    return playDraftPaidRound(math, draw, {
      maxPaidRoundMultiplier: base.proposedFeatures.maxPaidRoundMultiplier,
    }).totalPayout;
  });
  const audited = simulateDraftPaidRounds(
    math, rounds, i => seededTestDraw(i + 1),
    { maxPaidRoundMultiplier: base.proposedFeatures.maxPaidRoundMultiplier },
  );
  const biggest = Math.ceil(rounds / 100);
  const sumTop = awards.slice().sort((a, b) => b - a).slice(0, biggest)
    .reduce((a, b) => a + b, 0);
  const sumAll = awards.reduce((a, b) => a + b, 0);
  const expected = sumAll ? 100 * sumTop / sumAll : null;
  assert.ok(Math.abs(audited.tailShareTop1Percent - expected) < 1e-9);
  assert.equal(audited.returned, sumAll);
  assert.equal(audited.paidRounds, rounds);
});
