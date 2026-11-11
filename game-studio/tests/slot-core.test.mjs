import test from "node:test";
import assert from "node:assert/strict";
import {
  SLOT_CONTRACT_VERSION, SLOT_LIMITS, validateLayout, clampDraftLayout,
  createDraftPaylines, createSampleDraftRules, validateDraftRules,
  spinDraftGrid, evaluateDraftSpin, seededTestDraw, simulateDraftSpins,
} from "../src/slot/slotCore.js";

for (const [reels, rows] of [[5, 3], [6, 3], [5, 5], [6, 5], [8, 8]]) {
  test("custom layout " + reels + "x" + rows + " builds coherent reels, rows, paylines and outcome", () => {
    const rules = createSampleDraftRules({ reels, rows }, 20);
    const paylines = createDraftPaylines({ reels, rows }, 20);
    assert.equal(rules.reelStrips.length, reels);
    assert.equal(paylines.length, 20);
    assert.equal(new Set(paylines.map(path => path.join(","))).size, 20);
    paylines.forEach(path => {
      assert.equal(path.length, reels);
      path.forEach(index => assert.ok(index >= 0 && index < rows));
    });
    const { grid, stops } = spinDraftGrid(rules, seededTestDraw(123));
    assert.equal(grid.length, rows);
    grid.forEach(line => assert.equal(line.length, reels));
    assert.equal(stops.length, reels);
    const result = evaluateDraftSpin(rules, grid);
    assert.equal(result.contract, SLOT_CONTRACT_VERSION);
    assert.deepEqual(result.layout, { reels, rows });
    assert.equal(result.totalBet, 20);
    assert.equal(result.totalPayout, result.lineWins.reduce((s, w) => s + w.payout, 0) + result.scatterPayout);
    const report = simulateDraftSpins(rules, 200, seededTestDraw(42));
    assert.equal(report.isCertified, false);
    assert.equal(report.spins, 200);
    assert.ok(Number.isFinite(report.empiricalRtpPercent));
    assert.deepEqual(report.layout, { reels, rows });
  });
}

test("out-of-range reels/rows fail closed, while old browser drafts can be clamped", () => {
  assert.throws(() => validateLayout({ reels: 9, rows: 3 }), /reels/);
  assert.throws(() => validateLayout({ reels: 5, rows: 9 }), /rows/);
  assert.throws(() => validateLayout({ reels: 5.5, rows: 3 }), /reels/);
  assert.deepEqual(clampDraftLayout({ reels: 100, rows: -1 }), { reels: SLOT_LIMITS.maxReels, rows: SLOT_LIMITS.minRows });
  assert.deepEqual(clampDraftLayout({}), { reels: 5, rows: 3 });
  assert.throws(() => createDraftPaylines({ reels: 5, rows: 3 }, 51), /payline/);
});

test("payline evaluation supports leading wild and left-to-right 3+ match", () => {
  const rules = createSampleDraftRules({ reels: 5, rows: 3 }, 1);
  rules.paylines = [[0, 0, 0, 0, 0]];
  const grid = Array.from({ length: 3 }, () => Array(5).fill("J"));
  grid[0] = ["WILD", "A", "A", "K", "J"];
  const result = evaluateDraftSpin(rules, grid);
  assert.equal(result.lineWins.length, 1);
  assert.equal(result.lineWins[0].symbol, "A");
  assert.equal(result.lineWins[0].matches, 3);
  assert.equal(result.lineWins[0].payout, rules.paytable.A[3] * rules.betPerLine);
  assert.equal(result.freeSpinsAwarded, 0);
});

test("scatter awards free spins without a paid live transaction", () => {
  const rules = createSampleDraftRules({ reels: 6, rows: 5 }, 1);
  const grid = Array.from({ length: 5 }, () => Array(6).fill("J"));
  grid[0][0] = "SCATTER";
  grid[1][1] = "SCATTER";
  grid[4][5] = "SCATTER";
  const result = evaluateDraftSpin(rules, grid);
  assert.equal(result.scatterCount, 3);
  assert.equal(result.freeSpinsAwarded, 8);
  assert.equal(result.scatterPayout, 2 * result.totalBet);
});

test("reel strips, payline lengths, row indexes and injected draws are validated", () => {
  const base = createSampleDraftRules({ reels: 5, rows: 3 }, 20);
  assert.throws(() => validateDraftRules({ ...base, reelStrips: base.reelStrips.slice(1) }), /strip/);
  assert.throws(() => validateDraftRules({ ...base, paylines: [[0, 0, 0]] }), /payline/);
  assert.throws(() => validateDraftRules({ ...base, paylines: [[0, 0, 0, 9, 0]] }), /payline/);
  assert.throws(() => spinDraftGrid(base, () => -1), /random index/);
  assert.throws(() => spinDraftGrid(base, () => 999), /random index/);
  assert.throws(() => evaluateDraftSpin(base, Array(3).fill(["A"])), /dimensions/);
});

test("simulation is reproducible, exposes no target-RTP certification and no wallet", () => {
  const rules = createSampleDraftRules({ reels: 6, rows: 5 }, 20);
  const first = simulateDraftSpins(rules, 1000, seededTestDraw(93217));
  const second = simulateDraftSpins(rules, 1000, seededTestDraw(93217));
  assert.deepEqual(first, second);
  assert.equal(first.mode, "draft-simulation-only");
  assert.ok(!Object.hasOwn(first, "certifiedRtp"));
  assert.ok(!Object.hasOwn(first, "walletBalance"));
  assert.throws(() => simulateDraftSpins(rules, 0, seededTestDraw(1)), /simulation spins/);
});
