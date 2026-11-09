# Soft Tech v1.1 hardening checkpoint (2026-11-09)

## Implemented in source
- Encrypted consistent SQLite backup: `provider-dashboard/scripts/sqlite-backup.mjs`.
- Uses SQLite online backup API, SQLite integrity check, AES-256-GCM with random salt/nonce, scrypt password derivation, and destination-exclusive creation.
- Isolated restore validates authenticated ciphertext and SQLite integrity before atomically moving into a NEW destination.
- Regression test `provider-dashboard/test/backup.test.mjs`; GitHub Actions `provider-backup-qa.yml` also runs existing provider core tests.
- Backup passphrase must be supplied as environment variable, never as a CLI argument.
- No production service, live DB, RNG, existing ledger or marketing UI was modified by this change.

## Still required before enabling production backup
1. Set dedicated, separately stored backup encryption secret in a secret manager. Do not reuse PANEL_SESSION_SECRET.
2. Provision offsite object storage with restricted upload-only runtime credentials, retention and object-versioning controls.
3. Schedule independent backup for provider core, UNO, Mahjong, and Skygate databases; coordinate transaction consistency per service.
4. Encrypt and export each backup, store SHA-256 manifest and provenance; test isolated restore and consistency checks. Verify all four restored services and transaction journals.
5. Define retention, alerting, disaster-recovery runbook and target RPO/RTO before claiming production backup complete.
6. Avoid writing backup payloads into GitHub artifacts, build logs, or source control.

## Other v1.1 work not yet implemented
- Individual staff identities and MFA.
- Real live-browser Test Play journey on physical Safari, including disconnect/reconnect.
- External operator conformance runner and wallet callback fault matrix.
- Centralized release approval and engine version controls.
- Load test, capacity limits and recovery drill.

## Guardrails
- Keep the current provider acceptance ID and six verified sandbox rounds as baseline.
- No real-money activation or operator production certification.
- Do not silently deploy this utility or enable a schedule until storage and secret controls are verified.
