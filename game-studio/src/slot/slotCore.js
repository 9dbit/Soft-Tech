/**
 * Soft Tech Slot Engine V1 draft mathematical contract.
 * Simulation only. Never use this module for authoritative wagers or payouts.
 */
export const SLOT_CONTRACT_VERSION = "softtech.slot-draft.v1";
export const SLOT_LIMITS = Object.freeze({
  minReels: 3, maxReels: 8, minRows: 2, maxRows: 8, maxCells: 64, maxPaylines: 50,
});

export function validateLayout(layout) {
  const reels = Number(layout?.reels);
  const rows = Number(layout?.rows);
  if (!Number.isInteger(reels) || reels < SLOT_LIMITS.minReels || reels > SLOT_LIMITS.maxReels)
    throw new RangeError("reels must be an integer from 3 to 8");
  if (!Number.isInteger(rows) || rows < SLOT_LIMITS.minRows || rows > SLOT_LIMITS.maxRows)
    throw new RangeError("rows must be an integer from 2 to 8");
  if (reels * rows > SLOT_LIMITS.maxCells) throw new RangeError("slot grid is too large");
  return { reels, rows };
}

// Browser-local drafts made before this contract may contain out-of-range values.
export function clampDraftLayout(layout) {
  const clamp = (value, lower, upper, fallback) => {
    const number = Number(value);
    return Math.max(lower, Math.min(upper, Number.isFinite(number) ? Math.round(number) : fallback));
  };
  return validateLayout({
    reels: clamp(layout?.reels, SLOT_LIMITS.minReels, SLOT_LIMITS.maxReels, 5),
    rows: clamp(layout?.rows, SLOT_LIMITS.minRows, SLOT_LIMITS.maxRows, 3),
  });
}

// Unique sample paylines for previews only. Production paylines must be approved explicitly.
export function createDraftPaylines(layout, count = 20) {
  const { reels, rows } = validateLayout(layout);
  if (!Number.isInteger(count) || count < 1 || count > SLOT_LIMITS.maxPaylines)
    throw new RangeError("payline count must be an integer from 1 to 50");
  const lines = [];
  const seen = new Set();
  const add = path => {
    const key = path.join(",");
    if (!seen.has(key)) { seen.add(key); lines.push(path); }
  };
  for (let row = 0; row < rows; row++) add(Array(reels).fill(row));
  const variants = Math.pow(3, reels - 1);
  for (let code = 0; code < variants && lines.length < count; code++) {
    for (let first = 0; first < rows && lines.length < count; first++) {
      let row = first;
      let digits = code;
      const path = [row];
      for (let col = 1; col < reels; col++) {
        const delta = (digits % 3) - 1;
        digits = Math.floor(digits / 3);
        row = Math.max(0, Math.min(rows - 1, row + delta));
        path.push(row);
      }
      add(path);
    }
  }
  if (lines.length < count) throw new RangeError("requested more unique paylines than this grid permits");
  return lines.slice(0, count);
}

export function validateDraftRules(rules) {
  const layout = validateLayout(rules?.layout);
  if (!Array.isArray(rules?.reelStrips) || rules.reelStrips.length !== layout.reels)
    throw new Error("one reel strip is required for each reel");
  for (const strip of rules.reelStrips) {
    if (!Array.isArray(strip) || strip.length < layout.rows || strip.some(s => typeof s !== "string" || !s))
      throw new Error("each reel strip must contain enough nonempty symbol IDs");
  }
  if (!Array.isArray(rules.paylines) || !rules.paylines.length || rules.paylines.length > SLOT_LIMITS.maxPaylines)
    throw new Error("paylines must contain 1 to 50 paths");
  for (const line of rules.paylines) {
    if (!Array.isArray(line) || line.length !== layout.reels ||
        line.some(row => !Number.isInteger(row) || row < 0 || row >= layout.rows))
      throw new Error("each payline must provide one valid row index per reel");
  }
  if (!Number.isSafeInteger(rules.betPerLine) || rules.betPerLine <= 0)
    throw new Error("betPerLine must be a positive integer number of demo credits");
  const symbols = new Set(rules.reelStrips.flat());
  const wild = rules.wildSymbol;
  const scatter = rules.scatterSymbol;
  if (typeof wild !== "string" || !symbols.has(wild) || typeof scatter !== "string" || !symbols.has(scatter) || wild === scatter)
    throw new Error("wild and scatter must be distinct symbols present on the strips");
  if (!rules.paytable || typeof rules.paytable !== "object") throw new Error("paytable is required");
  for (const [symbol, multipliers] of Object.entries(rules.paytable)) {
    if (!symbols.has(symbol) || !multipliers || typeof multipliers !== "object")
      throw new Error("paytable contains an invalid symbol");
    for (const [count, payout] of Object.entries(multipliers)) {
      if (!Number.isInteger(Number(count)) || Number(count) < 3 || Number(count) > layout.reels ||
          !Number.isSafeInteger(payout) || payout < 0) throw new Error("invalid payout multiplier");
    }
  }
  const bonus = rules.scatterBonus;
  if (!bonus || !Number.isInteger(bonus.minimum) || bonus.minimum < 1 || bonus.minimum > layout.reels * layout.rows ||
      !Number.isSafeInteger(bonus.freeSpins) || bonus.freeSpins < 0 ||
      !Number.isSafeInteger(bonus.totalBetMultiplier) || bonus.totalBetMultiplier < 0)
    throw new Error("scatter bonus must contain nonnegative integer demo rules");
  return rules;
}

export function spinDraftGrid(rules, drawIndex) {
  const { reels, rows } = validateDraftRules(rules).layout;
  if (typeof drawIndex !== "function") throw new Error("a random index provider is required for the draft simulation");
  const grid = Array.from({ length: rows }, () => Array(reels));
  const stops = [];
  for (let reel = 0; reel < reels; reel++) {
    const strip = rules.reelStrips[reel];
    const stop = drawIndex(strip.length);
    if (!Number.isInteger(stop) || stop < 0 || stop >= strip.length)
      throw new RangeError("random index is outside the reel strip");
    stops.push(stop);
    for (let row = 0; row < rows; row++) grid[row][reel] = strip[(stop + row) % strip.length];
  }
  return { grid, stops };
}

export function evaluateDraftSpin(rules, grid) {
  const { reels, rows } = validateDraftRules(rules).layout;
  if (!Array.isArray(grid) || grid.length !== rows || grid.some(line => !Array.isArray(line) || line.length !== reels))
    throw new Error("spin grid dimensions do not match the selected layout");
  const lines = [];
  for (let i = 0; i < rules.paylines.length; i++) {
    const path = rules.paylines[i];
    const sequence = path.map((row, col) => grid[row][col]);
    // Evaluate every eligible target rather than using the first non-Wild symbol.
    // Leading Wilds can pay on their own even when a later Scatter blocks ordinary wins.
    // Pay one best outcome per payline: highest payout, then longest match, then
    // ordinary symbol before all-Wild on exact ties, then stable symbol ID order.
    const candidates = [];
    for (const target of Object.keys(rules.paytable)) {
      if (target === rules.scatterSymbol) continue;
      let matches = 0;
      for (const symbol of sequence) {
        if (symbol !== target && !(target !== rules.wildSymbol && symbol === rules.wildSymbol)) break;
        matches++;
      }
      const multiplier = matches >= 3 ? (rules.paytable[target]?.[matches] || 0) : 0;
      if (multiplier) {
        const payout = rules.betPerLine * multiplier;
        if (!Number.isSafeInteger(payout)) throw new RangeError("line payout exceeds safe demo integer limits");
        candidates.push({ index: i, symbol: target, matches, multiplier, payout });
      }
    }
    candidates.sort((a, b) => b.payout - a.payout || b.matches - a.matches ||
      Number(a.symbol === rules.wildSymbol) - Number(b.symbol === rules.wildSymbol) ||
      a.symbol.localeCompare(b.symbol));
    if (candidates[0]) lines.push(candidates[0]);
  }
  const scatterCount = grid.flat().filter(symbol => symbol === rules.scatterSymbol).length;
  const triggered = scatterCount >= rules.scatterBonus.minimum;
  const totalBet = rules.betPerLine * rules.paylines.length;
  const scatterPayout = triggered ? rules.scatterBonus.totalBetMultiplier * totalBet : 0;
  const linePayout = lines.reduce((sum, item) => sum + item.payout, 0);
  return {
    contract: SLOT_CONTRACT_VERSION,
    layout: { reels, rows },
    totalBet,
    lineWins: lines,
    scatterCount,
    scatterPayout,
    freeSpinsAwarded: triggered ? rules.scatterBonus.freeSpins : 0,
    totalPayout: linePayout + scatterPayout,
  };
}

// Deterministic PRNG for reproducible tests ONLY, never for a deployed money game.
export function seededTestDraw(seed) {
  if (!Number.isSafeInteger(seed) || seed === 0) throw new RangeError("nonzero integer test seed required");
  let state = seed >>> 0;
  return max => {
    if (!Number.isSafeInteger(max) || max <= 0) throw new RangeError("invalid draw bound");
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % max;
  };
}

export function simulateDraftSpins(rules, spins, drawIndex) {
  validateDraftRules(rules);
  if (!Number.isSafeInteger(spins) || spins < 1 || spins > 10000000)
    throw new RangeError("simulation spins must be between 1 and 10,000,000");
  let staked = 0, returned = 0, hits = 0, freeSpinTriggers = 0;
  for (let index = 0; index < spins; index++) {
    const outcome = evaluateDraftSpin(rules, spinDraftGrid(rules, drawIndex).grid);
    staked += outcome.totalBet;
    returned += outcome.totalPayout;
    if (outcome.totalPayout > 0) hits++;
    if (outcome.freeSpinsAwarded) freeSpinTriggers++;
  }
  return {
    contract: SLOT_CONTRACT_VERSION,
    mode: "draft-simulation-only",
    layout: validateLayout(rules.layout),
    spins, paylines: rules.paylines.length, staked, returned,
    empiricalRtpPercent: staked ? (100 * returned) / staked : 0,
    hitFrequencyPercent: (100 * hits) / spins,
    freeSpinTriggerFrequencyPercent: (100 * freeSpinTriggers) / spins,
    isCertified: false,
  };
}

export function createSampleDraftRules(layout, count = 20) {
  const valid = validateLayout(layout);
  const strips = [];
  const set = ["A", "K", "Q", "J", "WILD", "SCATTER", "A", "Q", "K", "J", "A", "Q"];
  for (let reel = 0; reel < valid.reels; reel++)
    strips.push(Array.from({ length: 36 }, (_, i) => set[(i * 7 + reel * 3) % set.length]));
  const paytable = {};
  for (const symbol of ["A", "K", "Q", "J", "WILD"]) {
    paytable[symbol] = {};
    for (let n = 3; n <= valid.reels; n++)
      paytable[symbol][n] = (symbol === "WILD" ? 3 : 1) * Math.pow(2, n - 2);
  }
  return validateDraftRules({
    layout: valid,
    reelStrips: strips,
    paylines: createDraftPaylines(valid, count),
    betPerLine: 1,
    wildSymbol: "WILD",
    scatterSymbol: "SCATTER",
    paytable,
    scatterBonus: { minimum: 3, freeSpins: 8, totalBetMultiplier: 2 },
  });
}
