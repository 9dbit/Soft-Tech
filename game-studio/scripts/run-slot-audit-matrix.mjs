#!/usr/bin/env node
/**
 * Multi-domain research audit smoke test.
 * The sampled RTP of three deterministic domains is NOT a certified RTP.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "./run-slot-audit.mjs";

const currentFile = fileURLToPath(import.meta.url);
export const MATRIX_DOMAINS = Object.freeze([
  "softtech-pilot-independent-A",
  "softtech-pilot-independent-B",
  "softtech-pilot-independent-C",
]);

export async function runResearchAuditMatrix(roundsPerDomain = 1000, output = null) {
  if (!Number.isSafeInteger(roundsPerDomain) || roundsPerDomain < 1 ||
      roundsPerDomain > 10000000)
    throw new RangeError("rounds per domain must be 1 to 10,000,000");
  const reports = [];
  for (const domain of MATRIX_DOMAINS) {
    reports.push(await runAudit([
      "--rounds", String(roundsPerDomain),
      "--seed-domain", domain,
    ]));
  }
  const first = reports[0];
  for (const report of reports) {
    if (report.configSha256 !== first.configSha256 ||
        report.engineSha256 !== first.engineSha256 ||
        report.runnerSha256 !== first.runnerSha256)
      throw new Error("multi-seed domain reports have mixed source/config versions");
    if (report.releaseDecision !== "BLOCKED" ||
        report.certificationStatus !== "NOT_CERTIFIED")
      throw new Error("research receipt cannot claim production readiness");
    if (report.paidRoundSamples !== roundsPerDomain ||
        !Number.isFinite(report.metrics.completePaidRoundRtpPercent))
      throw new Error("domain samples were incomplete");
  }
  const totalRounds = reports.reduce((sum, r) => sum + r.paidRoundSamples, 0);
  const meanRtp = reports.reduce(
    (sum, r) => sum + r.metrics.completePaidRoundRtpPercent * r.paidRoundSamples,
    0,
  ) / totalRounds;
  const domainRtp = reports.map(r => r.metrics.completePaidRoundRtpPercent);
  const result = {
    schemaVersion: "softtech.math-research-matrix.v1",
    reportStatus: "RESEARCH_MATRIX_SAMPLE_ONLY",
    certificationStatus: "NOT_CERTIFIED",
    releaseDecision: "BLOCKED",
    productionAllowed: false,
    gameId: first.gameId,
    gameVersion: first.gameVersion,
    configSha256: first.configSha256,
    engineSha256: first.engineSha256,
    runnerSha256: first.runnerSha256,
    domains: MATRIX_DOMAINS.map((domain, i) => ({
      domain,
      rounds: reports[i].paidRoundSamples,
      measuredRtpPercent: reports[i].metrics.completePaidRoundRtpPercent,
      confidenceInterval95Percent: reports[i].metrics.confidenceInterval95Percent,
      screensIncludingFreeSpins: reports[i].screensIncludingFreeSpins,
      freeSpinsPlayed: reports[i].metrics.freeSpinsPlayed,
      payoutCapHits: reports[i].metrics.payoutCapHits,
    })),
    totalPaidRounds: totalRounds,
    observedMeanRtpPercent: meanRtp,
    observedRtpRangePercent: [Math.min(...domainRtp), Math.max(...domainRtp)],
    outstandingGates: [
      "Independent mathematical reference implementation and large sample verification",
      "Production CSPRNG and operator wallet integration",
      "Failure/restart, load, security and human compliance sign-off",
    ],
    caveat: "CI domains are deterministic reproducibility checks; small samples cannot establish or certify the design-target RTP.",
  };
  if (output) {
    const outputFile = resolve(output);
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, JSON.stringify(result, null, 2) + "\n");
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    let rounds = 1000, output = null;
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i += 2) {
      if (!argv[i + 1]) throw new Error("missing option value");
      if (argv[i] === "--rounds-per-domain") rounds = Number(argv[i + 1]);
      else if (argv[i] === "--output") output = argv[i + 1];
      else throw new Error("unknown argument " + argv[i]);
    }
    const report = await runResearchAuditMatrix(rounds, output);
    console.log(JSON.stringify({
      totalPaidRounds: report.totalPaidRounds,
      observedMeanRtpPercent: report.observedMeanRtpPercent,
      observedRtpRangePercent: report.observedRtpRangePercent,
      releaseDecision: report.releaseDecision,
    }, null, 2));
  } catch (error) {
    console.error("SLOT_RESEARCH_MATRIX_FAILED:", error.message);
    process.exitCode = 1;
  }
}
