import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  validateDraftRules, evaluateDraftSpin, seededTestDraw,
} from "../src/slot/slotCore.js";
import {
  playDraftPaidRound, simulateDraftPaidRounds,
} from "../src/slot/paidRound.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(await readFile(resolve(HERE, "../contracts/slot-pilot-v1.example.json"), "utf8"));
const schema = JSON.parse(await readFile(resolve(HERE, "../contracts/slot-pilot-v1.schema.json"), "utf8"));
const audit = JSON.parse(await readFile(resolve(HERE, "../contracts/math-audit-report-v1.template.json"), "utf8"));
const math = contract.math;

test("example manifest has explicit 5x3 + 20-line playable-draft contract", () => {
  assert.equal(contract.schemaVersion, "softtech.slot-pilot.v1");
  assert.equal(contract.walletMode, "demo-only");
  assert.equal(contract.evaluationMode, "left-to-right-paylines");
  assert.equal(contract.status, "draft");
  assert.equal(schema.properties.walletMode.const, "demo-only");
  assert.equal(schema.properties.evaluationMode.const, "left-to-right-paylines");
  assert.deepEqual(math.layout, { reels: 5, rows: 3 });
  assert.equal(math.paylines.length, 20);
  assert.equal(math.reelStrips.length, 5);
  assert.equal(math.betPerLine, 1);
  assert.deepEqual(math.scatterBonus, { minimum: 3, freeSpins: 8, totalBetMultiplier: 2 });
  assert.doesNotThrow(() => validateDraftRules(math));
  assert.equal(contract.audit.completePaidRoundRtpPercent, null);
  assert.equal(contract.proposedFeatures.freeSpinsRuntimeImplemented, false);
  assert.equal(contract.proposedFeatures.serverWalletIntegrationImplemented, false);
  assert.equal(audit.reportStatus, "NOT_RUN");
  assert.equal(audit.releaseDecision, "BLOCKED");
  assert.equal(audit.metrics.completePaidRoundRtpPercent, null);
});

function oneLineRules() {
  const copy = structuredClone(math);
  copy.paylines = [[0, 0, 0, 0, 0]];
  return copy;
}
function gridWithFirstRow(symbols) {
  const result = Array.from({ length: 3 }, () => Array(5).fill("J"));
  result[0] = symbols;
  return result;
}
test("golden paylines: leading Wild uses maximum one line award, no duplicate pay", () => {
  const rules = oneLineRules();
  const vectors = [
    [["A", "A", "A", "K", "J"], 2, "A"],
    [["WILD", "A", "A", "K", "J"], 2, "A"],
    [["WILD", "WILD", "WILD", "K", "J"], 6, "WILD"],
    [["WILD", "WILD", "WILD", "A", "K"], 6, "WILD"],
    [["A", "A", "SCATTER", "A", "A"], 0, null],
    [["J", "J", "K", "J", "J"], 0, null],
  ];
  for (const [symbols, expectedCredits, selected] of vectors) {
    const result = evaluateDraftSpin(rules, gridWithFirstRow(symbols));
    const totalLines = result.lineWins.reduce((sum, win) => sum + win.payout, 0);
    assert.equal(totalLines, expectedCredits, symbols.join(","));
    assert.equal(result.lineWins[0]?.symbol ?? null, selected, symbols.join(","));
    assert.ok(result.lineWins.length <= 1, "must award only one selected outcome per payline");
  }
});

test("3 anywhere Scatter awards 8 spins, but no real wallet", () => {
  const rules = oneLineRules();
  const grid = gridWithFirstRow(["A", "K", "Q", "J", "A"]);
  grid[0][0] = "SCATTER"; grid[1][3] = "SCATTER"; grid[2][4] = "SCATTER";
  const outcome = evaluateDraftSpin(rules, grid);
  assert.equal(outcome.scatterCount, 3);
  assert.equal(outcome.freeSpinsAwarded, 8);
  assert.equal(outcome.scatterPayout, 2 * outcome.totalBet);
  assert.ok(!Object.hasOwn(outcome, "walletBalance"));
});

function forcedBonusRules() {
  const rules = oneLineRules();
  // Index 0 exposes Scatter at row 0, index 1 exposes WILD at row 0.
  rules.reelStrips = Array.from({ length: 5 }, () =>
    ["SCATTER", "WILD", "A", "K", "Q", "J"]);
  return validateDraftRules(rules);
}
test("complete paid round pays one base and all eight free screens, without bonus retriggers", () => {
  const rules = forcedBonusRules();
  let drawn = 0;
  const round = playDraftPaidRound(rules, () => (drawn++ < 5 ? 0 : 1), { includeTrace: true });
  assert.equal(round.paidRoundBet, 1);
  assert.equal(round.freeSpinsAwarded, 8);
  assert.equal(round.freeSpinsPlayed, 8);
  assert.equal(round.screensPlayed, 9);
  assert.equal(round.basePayout, 2);
  assert.equal(round.bonusPayout, 8 * math.paytable.WILD[5]);
  assert.equal(round.totalPayout, round.basePayout + round.bonusPayout);
  assert.equal(round.events.length, round.screensPlayed);
  assert.equal(round.capHit, false);
  assert.equal(round.retriggersEnabled, false);
  assert.ok(round.events.slice(1).every(e => e.phase === "bonus"));
});
test("scatter in bonus pays its screen prize but does not create recursive free spins", () => {
  const rules = forcedBonusRules();
  const round = playDraftPaidRound(rules, () => 0);
  assert.equal(round.freeSpinsPlayed, 8);
  assert.equal(round.scatterBonusTriggersIgnored, 8);
  assert.equal(round.screensPlayed, 9);
  assert.equal(round.totalPayout, 18);
});
test("hard maximum paid-round award stops outstanding bonus screens and reports clipped award", () => {
  const rules = forcedBonusRules();
  let drawn = 0;
  const round = playDraftPaidRound(rules, () => (drawn++ < 5 ? 0 : 1), {
    maxPaidRoundMultiplier: 10, includeTrace: true,
  });
  assert.equal(round.totalPayout, 10);
  assert.equal(round.basePayout, 2);
  assert.equal(round.bonusPayout, 8);
  assert.equal(round.freeSpinsPlayed, 1);
  assert.equal(round.screensPlayed, 2);
  assert.equal(round.capHit, true);
  assert.equal(round.events[1].truncatedByCap, true);
});
test("drawing error fails whole round without returning a partially settled result", () => {
  const rules = forcedBonusRules();
  let drawCalls = 0;
  assert.throws(() => playDraftPaidRound(rules, () => {
    drawCalls++;
    if (drawCalls > 5) throw new Error("injected second-screen failure");
    return 0;
  }), /injected second-screen failure/);
});
test("Monte Carlo statistic uses whole paid round, is deterministic and separates base and bonus", () => {
  const rules = forcedBonusRules();
  const simulate = () => simulateDraftPaidRounds(rules, 200, i => seededTestDraw(i + 1));
  const first = simulate();
  assert.deepEqual(first, simulate());
  assert.equal(first.paidRounds, 200);
  assert.equal(first.staked, 200);
  assert.equal(first.screensPlayed, 200 + first.freeSpinsPlayed);
  assert.equal(first.returned, first.baseReturned + first.bonusReturned);
  assert.ok(first.completePaidRoundRtpPercent >= 0);
  assert.ok(first.confidenceInterval95Percent.length === 2);
  assert.ok(first.tailShareTop1Percent === null || first.tailShareTop1Percent >= 0);
  assert.equal(first.isCertified, false);
  assert.ok(!Object.hasOwn(first, "walletBalance"));
  assert.throws(() => simulateDraftPaidRounds(rules, 0, i => seededTestDraw(i + 1)), /paid-round count/);
});
test("unsafe credits, duplicate lines, invalid grid symbol and malformed cap fail closed", () => {
  const rules = oneLineRules();
  assert.throws(() => validateDraftRules({ ...math, paylines: [math.paylines[0], math.paylines[0]] }), /duplicate payline/);
  assert.throws(() => evaluateDraftSpin(rules, gridWithFirstRow(["A", "A", "A", "UNKNOWN", "K"])), /symbol absent/);
  const overflow = { ...rules, betPerLine: Number.MAX_SAFE_INTEGER };
  assert.throws(() => evaluateDraftSpin(overflow, gridWithFirstRow(["A", "A", "A", "K", "J"])), /safe (demo )?integer/);
  assert.throws(() => playDraftPaidRound(rules, () => 0, { maxPaidRoundMultiplier: 0 }), /maxPaidRoundMultiplier/);
});
