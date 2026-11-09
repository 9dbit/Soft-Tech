# Provider Core: Global / Operator / Game Release Control

Release date: 2026-11-09

## Implemented
- Global `release_mode` stored in `meta`, sandbox by default. Admin-only, CSRF-protected, audited switch between sandbox and preproduction; preproduction requires verified offsite backup.
- Per-operator per-game policy persisted in `operator_game_modes`, keyed by `(operator_id,game_id)`. Defaults to sandbox. Modes: sandbox, preproduction, disabled. Production is explicitly rejected (409 PRODUCTION_LOCKED) until separate wallet, legal, MFA, recovery and certification gates are completed.
- Operator admin endpoint: `POST /api/operators/:operator_id/games/:game_id/mode` with JSON `{ "mode": "sandbox" | "preproduction" | "disabled" }`. Administrator login, CSRF and audit required.
- Operators page: GAME MODES button opens independent selectors for each assigned game.
- Signed operator `GET /v1/games` includes `operator_mode`.
- Signed game launches enforce disabled mode and global preproduction prerequisite. Other operators are unaffected. Previously accepted rounds remain settleable.
- No production monetary operations; all credits virtual and non-redeemable.

## Release precedence
1. Global production lock and game maintenance override all operator policies.
2. Operator must be enabled and have access to the game.
3. Operator-game disabled blocks new launches.
4. Operator-game preproduction requires global preproduction.
5. Sandbox remains available independent of other operator-game choices.

## Deliberately not implemented
- Production wallet credentials, separate production ledger, real-money flows, production game activation, MFA, and regulatory approval.
- Engine game math and independent operator platforms are not modified.
- An existing sandbox session is not migrated to another wallet or accounting environment. The preproduction label is only an integration rehearsal mode using virtual credits.
