import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MATRIX_DOMAINS, runResearchAuditMatrix } from "../scripts/run-slot-audit-matrix.mjs";

test("three independent seed domains report reproducible full-round observations", async () => {
  const a = await runResearchAuditMatrix(40);
  const b = await runResearchAuditMatrix(40);
  assert.deepEqual(a, b);
  assert.equal(a.totalPaidRounds, 120);
  assert.equal(a.domains.length, 3);
  assert.equal(new Set(a.domains.map(x => x.domain)).size, 3);
  assert.deepEqual(a.domains.map(x => x.domain), [...MATRIX_DOMAINS]);
  assert.ok(a.domains.every(x => x.rounds === 40));
  assert.ok(a.domains.every(x => x.screensIncludingFreeSpins >= 40));
  const [min, max] = a.observedRtpRangePercent;
  assert.ok(min <= a.observedMeanRtpPercent && a.observedMeanRtpPercent <= max);
  assert.equal(a.releaseDecision, "BLOCKED");
  assert.equal(a.productionAllowed, false);
  assert.equal(a.certificationStatus, "NOT_CERTIFIED");
  assert.equal(a.configSha256.length, 64);
});

test("matrix writes a machine-readable research artifact without passing release gates", async () => {
  const folder = await mkdtemp(join(tmpdir(), "softtech-matrix-"));
  try {
    const path = join(folder, "matrix.json");
    const expected = await runResearchAuditMatrix(12, path);
    const actual = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(actual, expected);
    assert.equal(actual.reportStatus, "RESEARCH_MATRIX_SAMPLE_ONLY");
    assert.equal(actual.releaseDecision, "BLOCKED");
    assert.ok(actual.outstandingGates.length >= 3);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("matrix rejects invalid round counts before any calculation", async () => {
  await assert.rejects(runResearchAuditMatrix(0), /rounds per domain/);
  await assert.rejects(runResearchAuditMatrix(10_000_001), /rounds per domain/);
  await assert.rejects(runResearchAuditMatrix(1.5), /rounds per domain/);
});
