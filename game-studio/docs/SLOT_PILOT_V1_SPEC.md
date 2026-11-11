# Soft Tech Slot Pilot V1: Win Rules and Mathematical Data Contract
**Status:** PROPOSED FOR CREATIVE/MATH REVIEW · 2026-11-11 · isolated browser-only sandbox.
**Engineering playbook:** [GAME_FACTORY_ENGINEERING_STANDARDS.md](GAME_FACTORY_ENGINEERING_STANDARDS.md).  
**Machine-readable:** [pilot manifest](../contracts/slot-pilot-v1.example.json), [manifest schema](../contracts/slot-pilot-v1.schema.json), [audit-report template](../contracts/math-audit-report-v1.template.json).

## 1. Scope and exclusions
Pilot preset: **5 reels × 3 rows, 20 fixed paylines**, configurable layout (tested 5×3, 5×5, 6×3, 6×5; editor supports 3–8 reels, 2–8 rows). The `left-to-right-paylines` evaluator is ONE module, not a universal rule for later ways or pay-anywhere games. Those modes require independent evaluators, schemas and math reviews.

This is **not** a live gambling game or a certified math model. All numbers and symbol strips are illustrative, for **non-redeemable demo credits**; a 96% target in the editor is design metadata, not calibrated or measured RTP. No real money, deposits, payout settlement, operator wallets, live production, buy-bonus, cascades, jackpot or ante bet in this pilot.

## 2. Deterministic proposed rules

| Element | Proposed V1 behavior | Test / implementation status |
| --- | --- | --- |
| Grid | `reels` independent from `rows`; each reel chooses one stop on a cyclic strip and renders the following `rows` symbols; runtime checks physical layout | Grid generation/validation drafted |
| Stake | `betPerLine = 1` integer **demo credit** × 20 active lines = **20 credits** per paid base spin. Free spins do not consume a new paid wager | Base-spin calculation drafted; no wallet |
| Paylines | Explicit ordered arrays of zero-based row indexes, exactly one row per reel; 20 unique paylines in preset; evaluate strictly from the **leftmost** reel and require 3+ contiguous matching symbols, with Wild substitutions | Draft evaluator and unit fixtures; full math review pending |
| Symbol set | A, K, Q, J, WILD, SCATTER. Fixed reel strips in the example, not inferred from visuals. **Scatter cannot be substituted by Wild** and must never pay via normal paylines | Draft evaluator |
| Wild | Replaces A/K/Q/J. Leading Wilds may form a Wild-only 3+ win or form a longer substituted ordinary win. **Choose the single highest payable outcome per line**, do not double count; stable tie-break per contract | Requires best-of evaluator fixtures; see release gates |
| Paytable | Multipliers expressed **per winning line wager**, not as percent of total stake; three or more consecutive matches; see versioned example JSON | Draft evaluator |
| Scatter | At least **3 Scatter anywhere** in visible grid triggers an award of **8 free spins** and an example scatter prize of **2× base total bet**, independent of paylines | Trigger and prize drafted; free-spin execution not implemented |
| Bonus rounds | A bonus round must include *all* awarded free spins in the original **paid-round** settlement; inherited line bet and paytable; **no retrigger in V1**; all proceeds credited once, at paid-round completion | **NOT IMPLEMENTED**: currently only awards a count of free spins |
| Maximum award | Proposed **1,000× original paid-round stake** across base and all free spins, applied once to complete-round payout; no silently truncated outcomes | **NOT IMPLEMENTED**; requires cap + invariant tests |
| UI vs math | Turbo, animations, sound, mobile portrait, page refresh, reduced-motion and network retries must not change the committed result | Server-authoritative lifecycle and recovery **NOT IMPLEMENTED** |

### Example paytable (design placeholders)
The example manifest contains integer line multipliers, represented by counts **3**, **4**, **5**. Values here are only synthetic fixtures, not audited probabilities:

| Symbol | 3 matches | 4 matches | 5 matches |
| --- | ---: | ---: | ---: |
| A / K / Q / J | 2× | 4× | 8× |
| WILD | 6× | 12× | 24× |
| SCATTER | No line win | No line win | No line win |

If a 6-reel game is created, its configuration must explicitly define a 6-symbol paytable before math review; do not silently reuse 5-reel payouts and claim a particular RTP.

## 3. Golden test vectors (one active payline unless otherwise stated)
Input shape is `grid[row][reel]`. In these fixtures, `betPerLine = 1`.

| First-row sequence of five reels | Expected payout / explanation |
| --- | --- |
| A, A, A, K, J | 2 demo credits from the line |
| WILD, A, A, K, J | 2 demo credits; Wild substitutes A |
| WILD, WILD, WILD, K, J | 6 demo credits (3× Wild); do not discard a valid Wild-only win |
| WILD, WILD, WILD, A, K | **6** demo credits, highest of 3× Wild (6) versus 4× A (4), never 10 |
| A, A, SCATTER, A, A | 0 line credits (Scatter blocks the contiguous line) |
| J, J, K, J, J | 0 line credits (only 2 contiguous J) |
| Any 3 visible Scatter across rows/columns | 8 bonus spins awarded + 2× **total base bet** scatter prize, not 2× individual line bet |

For the last row, bonus-spin **award count is not equivalent to executing and settling free spins**. All full-round RTP statements remain blocked until that engine stage exists.

## 4. Mandatory manifest fields
Use `slot-pilot-v1.example.json` as the versioned game manifest: `schemaVersion`, `gameId`, `gameVersion`, `status`, `walletMode`, `evaluationMode`, `creditScale`, `math` (layout, strips, explicit paylines, stake, paytable, Wild/Scatter, bonus trigger), `proposedFeatures`, and `audit`. The example is **not** a certified source of truth; it is an input contract for reproducible experimentation.

Never override `math.reelStrips`, `math.paylines`, `math.paytable`, or the random sampler from a visual asset or an unreviewed chat prompt. Requested changes to these fields create a **new game math version** and invalidate previous math approval until re-tested. Configuration and engine hashes must be derived from bytes of the artifacts and stored in an immutable receipt.

## 5. Required audit report and release gate
The report template intentionally uses `NOT_RUN` and `null` for every metric until actual runs finish. A completed report must reference:

- Engine SHA-256, config SHA-256, test runner SHA-256, commit, exact version and environment.
- Independent deterministic seed domains, sample sizes, time and aggregate full paid rounds (**one base wager, followed by all earned bonus screens and retriggers**). Never use the UI-only seeded xorshift helper for authoritative RNG quality claims.
- RTP estimate and uncertainty interval, hit frequency, bonus-entry frequency, max observed payout, cap-hit count, tail concentration, volatility, base/bonus return breakdown, reproducible failing-round trace.
- Separate stress results (500 and 1,000 sessions), crash and network-retry tests, wallet isolation/idempotency, browser/PWA QA, security/independent review and human release approval.

**Hard block:** `completePaidRoundRtpPercent` is **null** until bonus settlement is implemented. The existing base-screen simulator cannot be called a full-game RTP audit. A 96% target is not evidence of achieved 96% RTP.

## 6. Acceptance sequence
1. **This PR:** agree exact paylines, Wild best-of semantics, Scatter count and example fixtures; validate machine-readable manifest and all grid variants with unit tests.
2. **Engine milestone:** implement complete paid round (bonus execution, caps, event log) + deterministic replay + independent reference evaluator; correct bound and overflow behavior.
3. **Audit milestone:** generate signed/fingerprinted, independently reproduced multi-seed report with full-round Monte Carlo and confidence intervals; no math certification claim.
4. **Wallet/integration milestone:** server-issued CSPRNG and result, IDR-scale 0 protocol v2 in isolated sandbox only, once-only atomic ledger, disconnected/restart/load tests.
5. **Release milestone:** human creative, security, compliance and operator QA approvals; production remains locked unless all gates genuinely pass.

This document reflects a **proposal**, not final approved operator odds or a statement of production readiness. The goal is to review concrete behavior before expensive reruns.
