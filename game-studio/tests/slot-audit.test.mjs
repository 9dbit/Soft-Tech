import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit, createAuditDraw } from "../scripts/run-slot-audit.mjs";

test("audit SHA draw stream is reproducible per domain and round but differs by index", () => {
  const a = createAuditDraw("pilot-deterministic-A", 0);
  const b = createAuditDraw("pilot-deterministic-A", 0);
  const c = createAuditDraw("pilot-deterministic-A", 1);
  const seq = gen => Array.from({ length: 50 }, () => gen(36));
  assert.deepEqual(seq(a), seq(b));
  assert.notDeepEqual(seq(createAuditDraw("pilot-deterministic-A", 0)),
    seq(c));
  assert.throws(() => createAuditDraw("pilot-deterministic-A", -1), /index/);
  assert.throws(() => createAuditDraw("pilot-deterministic-A", 0)(0), /bound/);
});

test("audit receipt locks source fingerprints, seed domains and blocks publication", async () => {
  const args = ["--rounds", "160", "--seed-domain", "pilot-review-seed-A"];
  const first = await runAudit(args);
  const second = await runAudit(args);
  assert.equal(first.paidRoundSamples, 160);
  assert.equal(first.screensIncludingFreeSpins,
    160 + first.metrics.freeSpinsPlayed);
  assert.deepEqual(first.metrics, second.metrics);
  assert.equal(first.engineSha256.length, 64);
  assert.equal(first.configSha256.length, 64);
  assert.equal(first.runnerSha256.length, 64);
  assert.deepEqual(first.seedDomains, ["pilot-review-seed-A"]);
  assert.equal(first.releaseDecision, "BLOCKED");
  assert.equal(first.certificationStatus, "NOT_CERTIFIED");
  assert.equal(first.gates.walletAtomicityAndIdempotency, "BLOCKED");
  assert.ok(first.metrics.completePaidRoundRtpPercent >= 0);
  assert.ok(first.metrics.confidenceInterval95Percent.length === 2);
  assert.equal(first.environment, "offline-isolated-sandbox");
  const independent = await runAudit(["--rounds", "160", "--seed-domain", "pilot-review-seed-B"]);
  assert.equal(independent.configSha256, first.configSha256);
  assert.notDeepEqual(independent.metrics, first.metrics);
});

test("audit JSON report export stays blocked and exactly match computed metrics", async () => {
  const folder = await mkdtemp(join(tmpdir(), "softtech-slot-audit-"));
  try {
    const path = join(folder, "report.json");
    const expected = await runAudit([
      "--rounds", "75", "--seed-domain", "pilot-review-seed-C", "--output", path,
    ]);
    const actual = JSON.parse(await readFile(path, "utf8"));
    assert.equal(actual.releaseDecision, "BLOCKED");
    assert.deepEqual(actual.metrics, expected.metrics);
    assert.equal(actual.configSha256, expected.configSha256);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("audit refuses unbounded counts, identifiers and invalid cap", async () => {
  await assert.rejects(runAudit(["--rounds", "10000001"]), /rounds must/);
  await assert.rejects(runAudit(["--seed-domain", "short"]), /seed-domain/);
  await assert.rejects(runAudit(["--max-round-multiplier", "0"]), /max-round-multiplier/);
  await assert.rejects(runAudit(["--not-real", "yes"]), /Unknown/);
});
