#!/usr/bin/env node
/**
 * Reproducible research audit for one complete simulated paid-round configuration.
 * Test-only, not RNG certification, not a live-wager API.
 */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSlotPilotManifest } from "../src/slot/manifestContract.js";
import { simulateDraftPaidRounds } from "../src/slot/paidRound.js";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const GAME_STUDIO = resolve(CURRENT_DIR, "..");
const defaults = {
  rounds: 1000,
  domain: "softtech-slot-pilot-v1-smoke-A",
  manifest: resolve(GAME_STUDIO, "contracts/slot-pilot-v1.example.json"),
  output: null,
  maxPaidRoundMultiplier: null,
};
function parseArgs(argv) {
  const values = { ...defaults };
  const keys = {
    "--rounds": "rounds", "--seed-domain": "domain",
    "--manifest": "manifest", "--output": "output",
    "--max-round-multiplier": "maxPaidRoundMultiplier",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const field = keys[argv[i]];
    if (!field || i + 1 >= argv.length) throw new Error("Unknown or incomplete option " + argv[i]);
    const raw = argv[i + 1];
    values[field] = ["rounds", "maxPaidRoundMultiplier"].includes(field) ? Number(raw) : raw;
  }
  if (!Number.isSafeInteger(values.rounds) || values.rounds < 1 || values.rounds > 10000000)
    throw new RangeError("rounds must be an integer from 1 to 10,000,000");
  if (values.maxPaidRoundMultiplier !== null && (!Number.isSafeInteger(values.maxPaidRoundMultiplier) || values.maxPaidRoundMultiplier < 1 || values.maxPaidRoundMultiplier > 100000))
    throw new RangeError("max-round-multiplier is out of bounds");
  if (!/^[a-zA-Z0-9_.:-]{8,128}$/.test(values.domain))
    throw new Error("seed-domain must be a stable non-secret ASCII identifier (8 to 128 chars)");
  return values;
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

/**
 * Derive a different SHA-256 stream for each independently indexed paid round.
 * Reject modulo-bias draws by rejecting 32-bit values beyond the largest multiple.
 * This is reproducible audit randomness, NOT proof of production RNG certification.
 */
export function createAuditDraw(domain, paidRoundIndex) {
  if (!Number.isSafeInteger(paidRoundIndex) || paidRoundIndex < 0)
    throw new RangeError("paid-round index must be a nonnegative integer");
  const seed = createHash("sha256").update(domain + "\n" + paidRoundIndex).digest();
  let wordIndex = 8;
  let words = null;
  let counter = 0;
  return max => {
    if (!Number.isSafeInteger(max) || max < 1 || max > 10000000)
      throw new RangeError("invalid reel-strip index bound");
    const space = 4294967296;
    const limit = Math.floor(space / max) * max;
    for (;;) {
      if (wordIndex >= 8) {
        const next = createHash("sha256").update(seed)
          .update("\n" + counter++).digest();
        words = next;
        wordIndex = 0;
      }
      const n = words.readUInt32BE(wordIndex++ * 4);
      if (n < limit) return n % max;
    }
  };
}
export async function runAudit(argv = []) {
  const opts = parseArgs(argv);
  const manifestBytes = await readFile(resolve(opts.manifest));
  const manifest = JSON.parse(manifestBytes);
  validateSlotPilotManifest(manifest);
  // An audit override must never silently change the game math or payout cap.
  // To change it, create a new versioned manifest and invalidate older receipts.
  const manifestCap = manifest.proposedFeatures.maxPaidRoundMultiplier;
  if (opts.maxPaidRoundMultiplier !== null && opts.maxPaidRoundMultiplier !== manifestCap)
    throw new Error("audit payout cap differs from the versioned manifest");
  const math = manifest.math;
  const srcCore = await readFile(resolve(GAME_STUDIO, "src/slot/slotCore.js"));
  const srcPaid = await readFile(resolve(GAME_STUDIO, "src/slot/paidRound.js"));
  const srcManifestValidator = await readFile(resolve(GAME_STUDIO, "src/slot/manifestContract.js"));
  const srcRunner = await readFile(fileURLToPath(import.meta.url));
  const report = simulateDraftPaidRounds(
    math, opts.rounds, index => createAuditDraw(opts.domain, index),
    { maxPaidRoundMultiplier: manifestCap },
  );
  const receipt = {
    schemaVersion: "softtech.math-audit-report.v1",
    gameId: manifest.gameId,
    gameVersion: manifest.gameVersion,
    reportStatus: "RESEARCH_SAMPLE_ONLY",
    evidenceType: "reproducible-complete-paid-rounds",
    certificationStatus: "NOT_CERTIFIED",
    environment: "offline-isolated-sandbox",
    generatedAt: new Date().toISOString(),
    gitCommitSha: process.env.GITHUB_SHA || null,
    githubRunId: process.env.GITHUB_RUN_ID || null,
    engineSha256: sha256(Buffer.concat([srcCore, Buffer.from("\n"), srcPaid, Buffer.from("\n"), srcManifestValidator])),
    configSha256: sha256(manifestBytes),
    runnerSha256: sha256(srcRunner),
    seedDomains: [opts.domain],
    effectiveMathOptions: { maxPaidRoundMultiplier: manifestCap, bonusRetriggerEnabled: false },
    paidRoundSamples: report.paidRounds,
    screensIncludingFreeSpins: report.screensPlayed,
    metrics: {
      completePaidRoundRtpPercent: report.completePaidRoundRtpPercent,
      confidenceInterval95Percent: report.confidenceInterval95Percent,
      volatilityStandardDeviationX: report.volatilityStandardDeviationX,
      hitFrequencyPercent: report.hitFrequencyPercent,
      profitFrequencyPercent: report.profitFrequencyPercent,
      bonusEntryFrequencyPercent: report.bonusEntryFrequencyPercent,
      freeSpinsPlayed: report.freeSpinsPlayed,
      maxObservedPaidRoundWinX: report.maxObservedPaidRoundWinX,
      payoutCapHits: report.payoutCapHits,
      tailShareTop1Percent: report.tailShareTop1Percent,
      baseReturnPercent: report.baseReturnPercent,
      bonusReturnPercent: report.bonusReturnPercent,
    },
    disclaimers: [
      "Research simulator uses deterministic SHA-256 streams, not certified production RNG.",
      "Normal-approximation 95% interval may understate risk from rare, unobserved tail awards.",
      "RTP value is an estimate for the current uncalibrated synthetic manifest, not the design target.",
      "No operator wallet, durable settlement, compliance approval or release certification.",
    ],
    gates: {
      mathReferenceReview: "BLOCKED",
      multipleIndependentSeedDomains: "BLOCKED",
      csprngProductionReview: "BLOCKED",
      walletAtomicityAndIdempotency: "BLOCKED",
      operatorAcceptance: "BLOCKED",
      productionApproval: "BLOCKED",
    },
    releaseDecision: "BLOCKED",
  };
  if (opts.output) {
    const outputPath = resolve(opts.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "w" });
  }
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runAudit(process.argv.slice(2));
    console.log(JSON.stringify({
      gameId: report.gameId, paidRounds: report.paidRoundSamples,
      completePaidRoundRtpPercent: report.metrics.completePaidRoundRtpPercent,
      confidenceInterval95Percent: report.metrics.confidenceInterval95Percent,
      releaseDecision: report.releaseDecision, certificationStatus: report.certificationStatus,
    }, null, 2));
  } catch (error) {
    console.error("SLOT_RESEARCH_AUDIT_FAILED:", error.message);
    process.exitCode = 1;
  }
}
