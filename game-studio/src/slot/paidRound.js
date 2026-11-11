/**
 * Complete paid-round research simulator for fictional, non-redeemable credits.
 * Pure deterministic math. It is not an RNG service, wallet or certified game.
 * No user/account history enters the calculation.
 */
import {
  validateDraftRules, validateLayout, spinDraftGrid, evaluateDraftSpin,
  SLOT_CONTRACT_VERSION,
} from "./slotCore.js";

export const PAID_ROUND_CONTRACT_VERSION = "softtech.slot-paid-round-research.v1";
export const MAX_TEST_PAID_ROUNDS = 10000000;

function safeSum(left, right, label) {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0)
    throw new RangeError(label + " exceeds safe integer demo-credit limits");
  return total;
}

/**
 * One paid base spin followed by EVERY awarded free-spin screen.
 * Scatter in bonus can pay its scatter prize, but never retriggers in Pilot V1.
 * A round's payout is capped over all base and bonus screens together.
 * No credit is debited/credited here; settlement belongs to a future server.
 */
export function playDraftPaidRound(rules, drawIndex, options = {}) {
  validateDraftRules(rules);
  if (typeof drawIndex !== "function") throw new TypeError("draft draw provider required");
  const maxPaidRoundMultiplier = options.maxPaidRoundMultiplier ?? 1000;
  const includeTrace = options.includeTrace === true;
  if (!Number.isSafeInteger(maxPaidRoundMultiplier) || maxPaidRoundMultiplier < 1 || maxPaidRoundMultiplier > 100000)
    throw new RangeError("maxPaidRoundMultiplier must be a positive bounded integer");
  const paidRoundBet = rules.betPerLine * rules.paylines.length;
  const roundCap = paidRoundBet * maxPaidRoundMultiplier;
  if (![paidRoundBet, roundCap].every(Number.isSafeInteger)) throw new RangeError("paid round cap overflow");

  let totalPayout = 0;
  let basePayout = 0;
  let bonusPayout = 0;
  let screensPlayed = 0;
  let freeSpinsAwarded = 0;
  let freeSpinsPlayed = 0;
  let scatterBonusTriggersIgnored = 0;
  let capHit = false;
  const events = includeTrace ? [] : null;
  const applyScreen = (phase, number) => {
    const { grid, stops } = spinDraftGrid(rules, drawIndex);
    const result = evaluateDraftSpin(rules, grid);
    const rawAward = result.totalPayout;
    if (!Number.isSafeInteger(rawAward) || rawAward < 0) throw new RangeError("invalid screen payout");
    const remaining = roundCap - totalPayout;
    const awarded = Math.min(rawAward, remaining);
    totalPayout = safeSum(totalPayout, awarded, "round payout");
    if (phase === "base") basePayout = safeSum(basePayout, awarded, "base payout");
    else bonusPayout = safeSum(bonusPayout, awarded, "bonus payout");
    screensPlayed++;
    if (phase === "base") freeSpinsAwarded = result.freeSpinsAwarded;
    else if (result.freeSpinsAwarded) scatterBonusTriggersIgnored++;
    if (includeTrace) events.push({
      phase, number, stops, grid, rawAward, awarded,
      truncatedByCap: rawAward > remaining,
      scatterCount: result.scatterCount,
      freeSpinsProposed: phase === "base" ? result.freeSpinsAwarded : 0,
      lineWins: result.lineWins,
    });
    if (totalPayout === roundCap) capHit = true;
    return result;
  };

  // Each error aborts the entire pure calculation; no partially payable result escapes.
  applyScreen("base", 0);
  while (!capHit && freeSpinsPlayed < freeSpinsAwarded) {
    applyScreen("bonus", freeSpinsPlayed + 1);
    freeSpinsPlayed++;
  }
  const output = {
    contract: PAID_ROUND_CONTRACT_VERSION,
    engineContract: SLOT_CONTRACT_VERSION,
    mode: "complete-paid-round-demo-research",
    layout: validateLayout(rules.layout),
    paidRoundBet, roundCap, totalPayout,
    basePayout, bonusPayout,
    screensPlayed, freeSpinsAwarded, freeSpinsPlayed,
    scatterBonusTriggersIgnored,
    capHit, retriggersEnabled: false,
    isCertified: false,
  };
  if (includeTrace) output.events = events;
  if (basePayout + bonusPayout !== totalPayout)
    throw new Error("payout reconciliation invariant violated");
  return output;
}

/** Aggregate independently completed paid rounds; statistics are observations, not certification. */
export function simulateDraftPaidRounds(rules, numberOfPaidRounds, createDrawForRound, options = {}) {
  validateDraftRules(rules);
  if (!Number.isSafeInteger(numberOfPaidRounds) || numberOfPaidRounds < 1 ||
      numberOfPaidRounds > MAX_TEST_PAID_ROUNDS)
    throw new RangeError("paid-round count outside allowed test bounds");
  if (typeof createDrawForRound !== "function") throw new TypeError("per-round draw factory required");

  const paidRoundBet = rules.betPerLine * rules.paylines.length;
  let staked = 0, returned = 0, baseReturned = 0, bonusReturned = 0, screensPlayed = 0;
  let hitRounds = 0, profitRounds = 0, triggeredRounds = 0, freeSpinsPlayed = 0, capHitRounds = 0;
  let maxObservedAward = 0, n = 0, meanReturnX = 0, m2ReturnX = 0;
  // Track only the largest 1% using a bounded min-heap.
  // Sorting every round would allocate millions of values for a full audit.
  const topLimit = Math.max(1, Math.ceil(numberOfPaidRounds * 0.01));
  const topAwards = options.includeTail === false ? null : [];
  const recordTopAward = value => {
    if (!topAwards) return;
    if (topAwards.length < topLimit) {
      topAwards.push(value);
      let i = topAwards.length - 1;
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (topAwards[parent] <= value) break;
        topAwards[i] = topAwards[parent];
        i = parent;
      }
      topAwards[i] = value;
    } else if (value > topAwards[0]) {
      let i = 0;
      while (true) {
        const left = 2 * i + 1, right = left + 1;
        if (left >= topAwards.length) break;
        const child = right < topAwards.length && topAwards[right] < topAwards[left] ? right : left;
        if (topAwards[child] >= value) break;
        topAwards[i] = topAwards[child];
        i = child;
      }
      topAwards[i] = value;
    }
  };
  for (let index = 0; index < numberOfPaidRounds; index++) {
    const draw = createDrawForRound(index);
    const r = playDraftPaidRound(rules, draw, options);
    staked = safeSum(staked, paidRoundBet, "aggregate stake");
    returned = safeSum(returned, r.totalPayout, "aggregate payout");
    baseReturned = safeSum(baseReturned, r.basePayout, "aggregate base payout");
    bonusReturned = safeSum(bonusReturned, r.bonusPayout, "aggregate bonus payout");
    screensPlayed = safeSum(screensPlayed, r.screensPlayed, "aggregate screens");
    freeSpinsPlayed = safeSum(freeSpinsPlayed, r.freeSpinsPlayed, "aggregate bonus screens");
    if (r.totalPayout > 0) hitRounds++;
    if (r.totalPayout > paidRoundBet) profitRounds++;
    if (r.freeSpinsAwarded > 0) triggeredRounds++;
    if (r.capHit) capHitRounds++;
    maxObservedAward = Math.max(maxObservedAward, r.totalPayout);
    const x = r.totalPayout / paidRoundBet;
    n++;
    const delta = x - meanReturnX;
    meanReturnX += delta / n;
    m2ReturnX += delta * (x - meanReturnX);
    recordTopAward(x);
  }
  const sdX = n > 1 ? Math.sqrt(m2ReturnX / (n - 1)) : 0;
  const ciMargin = n > 1 ? 1.959963984540054 * sdX / Math.sqrt(n) * 100 : null;
  let tailShare = null;
  if (topAwards) {
    const topTotal = topAwards.reduce((sum, x) => sum + x, 0);
    tailShare = returned > 0 ? 100 * topTotal / (returned / paidRoundBet) : null;
  }
  const rtpPercent = 100 * returned / staked;
  return {
    contract: PAID_ROUND_CONTRACT_VERSION,
    mode: "complete-paid-round-demo-research",
    isCertified: false,
    layout: validateLayout(rules.layout),
    paidRounds: n,
    screensPlayed, freeSpinsPlayed,
    staked, returned, baseReturned, bonusReturned,
    completePaidRoundRtpPercent: rtpPercent,
    baseReturnPercent: 100 * baseReturned / staked,
    bonusReturnPercent: 100 * bonusReturned / staked,
    confidenceInterval95Percent: ciMargin === null ? null : [rtpPercent - ciMargin, rtpPercent + ciMargin],
    volatilityStandardDeviationX: sdX,
    hitFrequencyPercent: 100 * hitRounds / n,
    profitFrequencyPercent: 100 * profitRounds / n,
    bonusEntryFrequencyPercent: 100 * triggeredRounds / n,
    maxObservedPaidRoundWinX: maxObservedAward / paidRoundBet,
    payoutCapHits: capHitRounds,
    tailShareTop1Percent: tailShare,
  };
}
