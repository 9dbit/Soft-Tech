/**
 * Fail-closed inspection of sandbox math receipts.
 * A valid research receipt NEVER unlocks a real-money or operator release.
 */
import { validateSlotPilotManifest } from "./manifestContract.js";

const SHA256 = /^[0-9a-f]{64}$/;

export function inspectPilotMathReceipt(manifest, receipt, expectedConfigSha256) {
  const errors = [];
  try {
    validateSlotPilotManifest(manifest);
  } catch (error) {
    errors.push("Invalid draft manifest: " + error.message);
  }
  if (!SHA256.test(expectedConfigSha256 || ""))
    errors.push("Expected config SHA-256 must come from independently read manifest bytes");
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
    errors.push("Missing machine-readable research receipt");
  else {
    if (receipt.schemaVersion !== "softtech.math-audit-report.v1")
      errors.push("Unknown audit report schema");
    if (receipt.gameId !== manifest?.gameId || receipt.gameVersion !== manifest?.gameVersion)
      errors.push("Receipt game identity/version mismatch");
    if (receipt.reportStatus !== "RESEARCH_SAMPLE_ONLY" ||
        receipt.evidenceType !== "reproducible-complete-paid-rounds" ||
        receipt.certificationStatus !== "NOT_CERTIFIED" ||
        receipt.releaseDecision !== "BLOCKED")
      errors.push("Research receipt must explicitly prohibit certification and production release");
    if (receipt.configSha256 !== expectedConfigSha256)
      errors.push("Receipt does not match the versioned math manifest");
    if (!SHA256.test(receipt.engineSha256 || "") || !SHA256.test(receipt.runnerSha256 || ""))
      errors.push("Missing engine or runner fingerprint");
    if (!Array.isArray(receipt.seedDomains) || receipt.seedDomains.length !== 1 ||
        typeof receipt.seedDomains[0] !== "string")
      errors.push("Exactly one reproducible seed domain required per raw receipt");
    if (!Number.isSafeInteger(receipt.paidRoundSamples) || receipt.paidRoundSamples < 1 ||
        !Number.isSafeInteger(receipt.screensIncludingFreeSpins) ||
        receipt.screensIncludingFreeSpins < receipt.paidRoundSamples)
      errors.push("Invalid complete paid-round sample counts");
    if (receipt.effectiveMathOptions?.maxPaidRoundMultiplier !==
          manifest?.proposedFeatures?.maxPaidRoundMultiplier ||
        receipt.effectiveMathOptions?.bonusRetriggerEnabled !== false)
      errors.push("Receipt does not bind effective math options to the manifest");
    const metrics = receipt.metrics;
    for (const key of [
      "completePaidRoundRtpPercent", "volatilityStandardDeviationX",
      "hitFrequencyPercent", "bonusEntryFrequencyPercent",
      "freeSpinsPlayed", "maxObservedPaidRoundWinX",
      "baseReturnPercent", "bonusReturnPercent",
    ]) {
      if (!Number.isFinite(metrics?.[key]) || metrics[key] < 0)
        errors.push("Missing or invalid research metric: " + key);
    }
    if (!Array.isArray(metrics?.confidenceInterval95Percent) ||
        metrics.confidenceInterval95Percent.length !== 2 ||
        !metrics.confidenceInterval95Percent.every(Number.isFinite))
      errors.push("Missing Monte Carlo uncertainty interval");
    if (Number.isFinite(metrics?.baseReturnPercent) &&
        Number.isFinite(metrics?.bonusReturnPercent) &&
        Number.isFinite(metrics?.completePaidRoundRtpPercent) &&
        Math.abs(metrics.baseReturnPercent + metrics.bonusReturnPercent -
          metrics.completePaidRoundRtpPercent) > 1e-8)
      errors.push("Base and bonus return must reconcile to total RTP");
    if (!receipt.gates || Object.keys(receipt.gates).length === 0 ||
        Object.values(receipt.gates).some(value => value !== "BLOCKED"))
      errors.push("Missing blocked release gates or forged PASS status");
  }
  return {
    researchReceiptValid: errors.length === 0,
    releaseDecision: "BLOCKED",
    productionAllowed: false,
    reasons: errors.length ? errors : [
      "Research checks can be reproduced; independent math/RNG, secure wallet, operations, legal and human release reviews remain required.",
    ],
  };
}
