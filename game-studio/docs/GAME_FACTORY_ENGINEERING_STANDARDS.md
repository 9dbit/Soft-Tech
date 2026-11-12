# Soft Tech Game Factory: Reusable Engineering Standards (V1)

Status: **required design and QA contract for new game generators**, not a claim of certification or production readiness.  
Last reviewed: 2026-11-11. All existing game repositories remain independently deployed.  
Purpose: carry forward the actual lessons of Skygate, Mahjong Legend and UNO Luck without copying genre-specific mechanics into the universal engine.

## Evidence and lessons from existing games

| Source and evidence | Reusable lesson | Enforced by |
| --- | --- | --- |
| [Skygate reference rules](https://github.com/9dbit/Skygate/blob/main/docs/reference-rules-v1.md) | Debit **once** on a newly generated result; award **once** after final outcome; retries/replays must never debit or award again. Interrupted animation may not lose settlement. | Round-state, idempotency and ledger integration tests before wallet integration |
| [Skygate math & jackpot](https://github.com/9dbit/Skygate/blob/main/studio/MATH_AND_JACKPOT.md) | Target RTP is metadata, not a result manipulator. Synthetic weights, jackpot probabilities, maximum liability and spin caps require explicit review. Presentation tiers cannot influence RNG. | Independent math validation; explicit paytable and configuration hash |
| [Skygate reference tests](https://github.com/9dbit/Skygate/blob/main/studio/tests/reference_rules.test.mjs) | Failed watchdogs must void a round rather than silently truncating a payable result; speed/Auto/Skip effects must not change the mathematically committed outcome. | Deterministic round replays and watchdog-failure tests |
| [Skygate iPhone aspect-ratio correction](https://github.com/9dbit/Skygate/blob/main/studio/CONTINUITY_CHECKPOINT_v0.14.3.md) | Percent-width combined with percent-height can deform a circular button. Verify physical bounding boxes at multiple aspect ratios and iOS PWA. | Responsive Playwright assertions, real iPhone manual gate |
| [Mahjong 5M-round audit](https://github.com/9dbit/Mahjong-legend/blob/main/docs/MATH_V080_VALIDATION.md) | Simulate **complete paid rounds**, including cascades, free spins and retriggers. Exclude free-spin stake from the RTP denominator. Freeze engine/config hashes, use disjoint seed domains, report uncertainty and do not treat old RTP samples as current. | Reproducible multi-seed math report with source/config fingerprint and interval |
| [Mahjong invariants](https://github.com/9dbit/Mahjong-legend/blob/main/tests/test_additional_invariants.py) | Config validation must reject invalid probabilities, be immutable during a round, and reconcile paid awards exactly to event sums and the cap. | Pure engine unit/property tests and reconciliation |
| [Mahjong UI0.9.1 release](https://github.com/9dbit/Mahjong-legend/blob/main/docs/RELEASE_V091.md) | Fix artwork/UI without perturbing math, credit balances or active pinned rounds; preserve approved art and actual button hitboxes. Automated device simulations do **not** replace physical-device signoff. | Snapshot + visual + route/asset cache + independent math-diff gates |
| [UNO Luck staging README](https://github.com/9dbit/uno-luck/blob/main/README.md) | Authoritative spin/card results and demo credits are server-side; idempotency keys and immutable ledgers prevent duplicate charges. SQLite temp paths are not durable; one-replica constraints prohibit naive horizontal scaling. | Durable datastore, transaction locks, replay and restart tests |
| [UNO runtime contract](https://github.com/9dbit/uno-luck/blob/main/tests/test_runtime_contract.py) | Railway port and /health must agree with runtime config. Verify startup and HTTP availability, not just a green build. | Deployment smoke/health checks |
| [UNO v1.1 reduced motion bug](https://github.com/9dbit/uno-luck/blob/main/docs/UNO_LUCK_v11.md) | A visual completion callback must not clear the pending server acknowledgement before consumers can read it; test reduced-motion, visibility changes, refresh/replay and resumed sessions. | State-machine and accessible-motion browser tests |

Historical issues raised during game reviews, including UNO's potential high process count, Mahjong's invalidated RTP after math changes and Skygate's RNG/logging questions, are **risks to re-audit**, not proof that their current code remains defective. Do not copy suspected fixes without reproducing the failure.

## Universal engine invariants (hard requirements)

1. **Game-specific configuration, shared engine**: grid geometry, reel strips, symbol set, payouts, triggers, bonus rules, maximum awards and presentation reside in a versioned config schema. Reels and rows are independent, bounded values, not a hardcoded 5x3. Support 5x3, 5x5, 6x3 and 6x5 in unit tests and visual previews; don't conflate fixed paylines, ways and pay-anywhere mechanics.
2. **Pure math vs visual effects**: deterministic evaluator accepts immutable config + committed draw. UI animation, speed, audio, turbo, accessibility preferences, reloads and partial rendering never modify settlement.
3. **Secure randomness where authoritative**: seeded pseudo-RNG is for deterministic QA only. Future server-authoritative randomness requires documented CSPRNG, independently reviewed sampling/rejection rules and verifiable results. No per-player odds manipulation or hidden reroll triggered by balance or prior losses.
4. **Correct money representation**: integer minor units or exact decimal, never floating-point for live balances; explicitly version currency scale (IDR scale 0 on Soft Tech integrations), bet limits, payout rounding, jackpot caps and maximum liability. Draft simulator demo credits are not money and cannot connect to live wallets.
5. **Idempotent atomic settlements**: unique round ID + request key + account scope, immutable ledger and transactional commit. A repeat, timeout, process restart or duplicate request must return the same result without double debit/credit. Reconcile ledger, journal and finished result after recovery.
6. **Pinned version and audit trace**: record gameID, operatorID, engine/schema/config version, content hash, audit seed domain (tests only), paytable/feature rules, result and settlement state. Resume in-flight rounds using their original rule version.
7. **Strictly bounded work**: max reels/rows, spin count, cascade iterations, free-spin retriggers, room size, CPU time, process/thread count, log volume and input sizes. Overflow / timeout means a documented safe fail/void, **never silent partial payout**.
8. **Security and isolation**: secrets server-side; validate user input and origin; no cross-operator or cross-player leaks; ensure roles, MFA and release approver separation for financial or production functions.
9. **Asset/UI contract**: independent art layers, canonical resolution, load/error placeholders, PWA/icon/OG metadata, orientation / safe-area checks, no forced sound autoplay, no overflow/overlap, and app accessibility including reduced motion.
10. **Production must remain gated**: draft previews and math simulations are not RNG certification, jurisdictional licensing, wallet certification, operator acceptance or permission to publish.

## When to run which tests

| Change | Minimum required checks |
| --- | --- |
| UI/asset/audio only | Frontend build, asset decode, preview screenshot diff, mobile/desktop viewport fit, touch/keyboard/reduced-motion, and math/config fingerprint unchanged |
| Reels/rows/layout changed | Schema validation, entire grid shape, unique valid paylines, win-evaluation invariants, responsive preview, 5x3/5x5/6x3/6x5 regression matrix |
| Paytable, symbols, RNG, reel strips or bonus modified | All math unit and independent reference tests; rerun fresh-seed **complete-round** Monte Carlo; summarize RTP, interval, volatility, hit rate, bonus rate and tail liability; record immutable engine/config hash |
| API, wallet, session, infra modified | Atomic debit/credit, retries, duplicate requests, concurrent settlement, crash-and-restore, credential/session isolation, 500/1,000 real simulated sessions, soak, resource and trace/log bounds |
| Release or deployment | Isolated staging, PR review by another person, green CI, deployment SUCCESS **and** HTTP health, QA artifact, signed build/config identity, rollback rehearsal, production approval gate |

### Design and release sequence

- Develop a contract first: inputs, output, win rules, caps, fee/credit arithmetic, known exclusions.
- Have the AI generator output an explicit **game manifest**, a versioned layout config and generated source. Reject unknown properties and invalid ranges.
- Produce reference cases and test vectors **before** accepting a new mechanic, with verified fixed seeds for QA.
- Keep a machine-readable `test-report.json` containing engine/config SHA-256, CI run ID, test categories, simulator seed domains, sample sizes, measured metrics, confidence intervals and pass/fail. Do not fake missing measurements.
- Require the Game Factory Skill to read this playbook before generating or editing a game. Do not silently skip categories, rebrand a simulated result as certified, or change production/game math merely to pass a visual test.
- After a failed test: record reproducible seed, minimal failing case, root cause, added regression test and corrective commit before rerunning the suite.
- Before new-game approval: human reviews outcome math, game UX, legal/IP/licensing, security, traffic capacity and operational recovery. **No auto-publish**.

## V1 status and limitations

- The new `src/slot/slotCore.js` is a **draft mathematical contract** to explore variable-size layouts and reproducible test data; it is not attached to live credits, a remote game service or certified RNG.
- The V1 visual editor stores drafts in a local browser, not a versioned server store. Its display can follow configurable rows/reels; this is not evidence of payout correctness.
- The intended Game Factory Skill and end-to-end math/ledger/release infrastructure remain planned. Promote a test as PASS only after CI has returned an actual successful result for the specific commit.
