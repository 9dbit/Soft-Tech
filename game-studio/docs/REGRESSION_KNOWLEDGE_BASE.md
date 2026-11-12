# Soft Tech Game Factory: Regression Knowledge Base
Last updated: 2026-11-11. Living source of truth for code-generation reviews and future Game Factory Skill input.

This page separates **historical lessons**, **regressions now enforced in V1**, and **future release blockers**. A documented precedent is not proof that the linked original game's current deployment has the same defect.

| ID | Original learning / recurring failure | Preventive rule | Enforced now | Still pending |
| --- | --- | --- | --- | --- |
| ST-GF-001 | Skygate interrupted/fast animation vs committed outcome | Never let presentation change result; debit and award once per round | Pure outcome calculation is independent of animation in `src/slot/paidRound.js` | Server-issued rounds, immutable ledger, disconnect/retry reconciliation, idempotency |
| ST-GF-002 | Mahjong paytable or bonus change invalidates older RTP | Fingerprint code, config and runner; never reuse an audit after a math edit | `scripts/run-slot-audit.mjs` SHA-256 receipt; full simulated base+bonus results | Independent evaluator, large multi-seed review, signed durable receipt |
| ST-GF-003 | UNO session/reduced-motion callbacks may race server acknowledgement | Effects cannot finalize authoritative state; test refresh/reduced-motion | Research pure math has no UI completion callback | Actual session state machine and E2E reconnect tests |
| ST-GF-004 | Wild at first reel can lose its valid all-Wild payout or double-pay a line | Evaluate every candidate, choose highest single line award | `tests/slot-pilot-contract.test.mjs` golden vectors | Independent evaluator agreement |
| ST-GF-005 | UI hardcoded to 5×3 despite editable reel/row controls | Grid, strips, paylines and preview must follow one versioned layout | `tests/slot-core.test.mjs` and `tests/editor.spec.js` for 5×3, 5×5, 6×3, 6×5 and custom | Publishable asset/layout binding |
| ST-GF-006 | Prompt-supplied rule fields could bypass validation | Fail closed on unknown fields, invalid path/strip, fake certification or live wallet flag | `src/slot/manifestContract.js`; `tests/slot-manifest-gates.test.mjs` | External JSON Schema/independent security review |
| ST-GF-007 | Audit cap override can change payout distribution while keeping same config hash | Bind simulation payout cap to versioned manifest; require a new version to change math | `scripts/run-slot-audit.mjs` verifies requested cap matches manifest | Signed math-version approval |
| ST-GF-008 | Multi-million-round audit could allocate/sort one value per round | Track only top 1% awards with a bounded min-heap, cross-check against full-sort reference | `src/slot/paidRound.js`; `tests/slot-manifest-gates.test.mjs` | Long-running soak/profile at 1M+ rounds |
| ST-GF-009 | RNG bias or non-replayable bug reports | Explicit deterministic per-round seed domains for research; avoid modulo bias in audit index selection | `scripts/run-slot-audit.mjs`; `tests/slot-audit.test.mjs` | Independent CSPRNG / production sampling review |
| ST-GF-010 | A green CI build could be mistaken for a legal production release | CI verifies research only; release remains blocked without wallets/security/operational approval | `src/slot/releaseGate.js` and `tests/slot-release-gate.test.mjs` reject forged PASS, altered hashes and invalid research receipts | License/compliance, human release approver, operator signoff |
| ST-GF-011 | Network restart or failing bonus screen can yield partial credit | Pure research round must throw instead of returning a half-processed award | `tests/slot-pilot-contract.test.mjs` injected bonus failure | Durable transaction/rollback replay with independent logs |

## Required workflow after ANY new bug
1. Capture **game ID + exact config hash + engine commit + reproducible seed** (or network trace) before changing rules.
2. Record symptom, root cause, affected variants, patch commit, and a test that failed before the fix.
3. Add the invariant into this knowledge base and, when relevant, into the versioned manifest/schema.
4. Re-run affected tests and applicable safety gates. Math, RNG, reel strips or bonus logic changes invalidate old RTP evidence.
5. Never mark **CERTIFIED** or release **READY** based on synthetic credits, green CI alone, or a cosmetic-only test.

## Reused evidence
- [Skygate reference rules](https://github.com/9dbit/Skygate/blob/main/docs/reference-rules-v1.md)
- [Mahjong mathematics validation](https://github.com/9dbit/Mahjong-legend/blob/main/docs/MATH_V080_VALIDATION.md)
- [UNO runtime contract](https://github.com/9dbit/uno-luck/blob/main/tests/test_runtime_contract.py)
- [Complete engineering and release standards](GAME_FACTORY_ENGINEERING_STANDARDS.md)

**Scope:** browser-local/deterministic pilot research. The three existing games remain untouched and independently managed.