import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "../scripts/run-slot-audit.mjs";
import { inspectPilotMathReceipt } from "../src/slot/releaseGate.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bytes = await readFile(resolve(root, "contracts/slot-pilot-v1.example.json"));
const manifest = JSON.parse(bytes);
const sha = createHash("sha256").update(bytes).digest("hex");
const receipt = await runAudit(["--rounds", "40", "--seed-domain", "pilot-release-gate-review-A"]);

test("reproducible math research receipt is inspectable but NEVER production ready", () => {
  const check = inspectPilotMathReceipt(manifest, receipt, sha);
  assert.equal(check.researchReceiptValid, true, check.reasons.join("\n"));
  assert.equal(check.releaseDecision, "BLOCKED");
  assert.equal(check.productionAllowed, false);
});

test("altered input, unsigned audit or spoofed PASS cannot bypass release gate", () => {
  function forged(changes) {
    const r = structuredClone(receipt);
    changes(r);
    const check = inspectPilotMathReceipt(manifest, r, sha);
    assert.equal(check.researchReceiptValid, false);
    assert.equal(check.productionAllowed, false);
    assert.equal(check.releaseDecision, "BLOCKED");
    assert.ok(check.reasons.length);
  }
  forged(r => { r.configSha256 = "a".repeat(64); });
  forged(r => { r.gameId = "unreviewed-game"; });
  forged(r => { r.certificationStatus = "CERTIFIED"; });
  forged(r => { r.releaseDecision = "READY"; });
  forged(r => { r.gates.productionApproval = "PASS"; });
  forged(r => { r.effectiveMathOptions.maxPaidRoundMultiplier = 2; });
  forged(r => { r.metrics.baseReturnPercent = 2000; });
  forged(r => { r.metrics.completePaidRoundRtpPercent = null; });
  forged(r => { r.seedDomains = []; });
});

test("invalid or unknown manifest cannot be validated by a good receipt", () => {
  const bad = structuredClone(manifest);
  bad.extrapaytableOverride = { RTP: 96 };
  const check = inspectPilotMathReceipt(bad, receipt, sha);
  assert.equal(check.researchReceiptValid, false);
  assert.equal(check.productionAllowed, false);
});
