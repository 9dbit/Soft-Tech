/**
 * Closed, versioned input gate for AI-generated Slot Pilot V1 manifests.
 * Not an approval for real-money operation or a substitute for JSON Schema review.
 * Reject unknown fields rather than silently trusting prompt-generated objects.
 */
import { validateDraftRules, SLOT_LIMITS } from "./slotCore.js";

const idPattern = /^[A-Z][A-Z0-9_]{0,31}$/;
const gamePattern = /^[a-z0-9][a-z0-9-]{2,63}$/;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;

function keysExactly(value, expected, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(name + " must be a plain object");
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!expected.includes(key)) throw new Error(name + " has unknown field " + key);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) throw new Error(name + " missing required field " + key);
  }
}

function boundedInteger(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(name + " must be an integer from " + min + " to " + max);
}

function symbolId(value, name) {
  if (typeof value !== "string" || !idPattern.test(value))
    throw new TypeError(name + " must be a valid uppercase symbol ID");
}

export function validateSlotPilotManifest(m) {
  keysExactly(m, [
    "schemaVersion", "gameId", "gameVersion", "status", "walletMode",
    "evaluationMode", "creditScale", "math", "proposedFeatures", "audit",
  ], "manifest");

  if (m.schemaVersion !== "softtech.slot-pilot.v1" ||
      m.status !== "draft" || m.walletMode !== "demo-only" ||
      m.evaluationMode !== "left-to-right-paylines" || m.creditScale !== 0)
    throw new Error("slot pilot supports draft demo-only fixed-payline research");
  if (typeof m.gameId !== "string" || !gamePattern.test(m.gameId))
    throw new TypeError("invalid gameId");
  if (typeof m.gameVersion !== "string" || !versionPattern.test(m.gameVersion))
    throw new TypeError("invalid gameVersion");

  const math = m.math;
  keysExactly(math, [
    "layout", "reelStrips", "paylines", "betPerLine",
    "wildSymbol", "scatterSymbol", "paytable", "scatterBonus",
  ], "math");
  keysExactly(math.layout, ["reels", "rows"], "math.layout");
  boundedInteger(math.layout.reels, SLOT_LIMITS.minReels, SLOT_LIMITS.maxReels, "reels");
  boundedInteger(math.layout.rows, SLOT_LIMITS.minRows, SLOT_LIMITS.maxRows, "rows");
  if (!Array.isArray(math.reelStrips) || math.reelStrips.length !== math.layout.reels)
    throw new Error("one configured reel strip is required per reel");
  for (const [i, strip] of math.reelStrips.entries()) {
    if (!Array.isArray(strip) || strip.length < math.layout.rows || strip.length > 10000)
      throw new RangeError("reel strip " + i + " length is outside the supported range");
    for (const value of strip) symbolId(value, "reel strip " + i);
  }
  if (!Array.isArray(math.paylines) || math.paylines.length < 1 ||
      math.paylines.length > SLOT_LIMITS.maxPaylines)
    throw new RangeError("invalid payline count");
  boundedInteger(math.betPerLine, 1, 1000000, "betPerLine");
  symbolId(math.wildSymbol, "wildSymbol");
  symbolId(math.scatterSymbol, "scatterSymbol");
  if (math.wildSymbol === math.scatterSymbol) throw new Error("Wild cannot equal Scatter");
  keysExactly(math.scatterBonus,
    ["minimum", "freeSpins", "totalBetMultiplier"], "scatterBonus");
  boundedInteger(math.scatterBonus.minimum, 1, math.layout.reels * math.layout.rows, "scatter minimum");
  boundedInteger(math.scatterBonus.freeSpins, 0, 200, "freeSpins");
  boundedInteger(math.scatterBonus.totalBetMultiplier, 0, 100000, "scatter multiplier");

  if (math.paytable === null || typeof math.paytable !== "object" ||
      Array.isArray(math.paytable) || Object.keys(math.paytable).length === 0)
    throw new TypeError("paytable must be a nonempty object");
  if (!Object.hasOwn(math.paytable, math.wildSymbol))
    throw new Error("Wild-only awards require an explicit Wild paytable");
  if (Object.hasOwn(math.paytable, math.scatterSymbol))
    throw new Error("Scatter must not pay through normal paylines");
  for (const [symbol, counts] of Object.entries(math.paytable)) {
    symbolId(symbol, "paytable symbol");
    if (counts === null || typeof counts !== "object" ||
        Array.isArray(counts) || !Object.keys(counts).length)
      throw new TypeError("invalid paytable entry " + symbol);
    for (const [count, multiplier] of Object.entries(counts)) {
      if (!/^[3-8]$/.test(count) || Number(count) > math.layout.reels)
        throw new Error("invalid paytable match count " + count);
      boundedInteger(multiplier, 0, 100000000, "paytable multiplier");
    }
  }
  validateDraftRules(math);

  keysExactly(m.proposedFeatures, [
    "bonusRetriggerEnabled", "maxPaidRoundMultiplier",
    "freeSpinsRuntimeImplemented", "paidRoundCapImplemented",
    "serverAuthoritativeRngImplemented", "serverWalletIntegrationImplemented",
  ], "proposedFeatures");
  for (const key of [
    "bonusRetriggerEnabled", "freeSpinsRuntimeImplemented",
    "paidRoundCapImplemented", "serverAuthoritativeRngImplemented",
    "serverWalletIntegrationImplemented",
  ]) {
    if (m.proposedFeatures[key] !== false)
      throw new Error(key + " is unavailable in this research-only pilot");
  }
  boundedInteger(m.proposedFeatures.maxPaidRoundMultiplier, 1, 100000, "maxPaidRoundMultiplier");
  const fullBet = math.betPerLine * math.paylines.length;
  if (!Number.isSafeInteger(fullBet * m.proposedFeatures.maxPaidRoundMultiplier))
    throw new RangeError("paid-round cap exceeds safe integer bounds");

  keysExactly(m.audit, [
    "status", "isCertified", "completePaidRoundRtpPercent",
    "engineSha256", "configSha256",
  ], "audit");
  if (m.audit.status !== "NOT_RUN" || m.audit.isCertified !== false ||
      m.audit.completePaidRoundRtpPercent !== null ||
      m.audit.engineSha256 !== null || m.audit.configSha256 !== null)
    throw new Error("unapproved manifest cannot claim an audit, certification or source hashes");

  return m;
}
