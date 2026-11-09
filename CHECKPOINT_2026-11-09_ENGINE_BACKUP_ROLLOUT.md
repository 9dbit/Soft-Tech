# Soft Tech native engine backup rollout checkpoint (2026-11-09)

## Deployed engines
- UNO LUCK: Railway service softtech-engine-uno, deployment 45f8dfc2-924a-4262-bbf7-8a29bdd51478, SUCCESS. Backup loop enabled with ENGINE_BACKUP_ENABLED=true and 86400 second interval. **No positive remote backup confirmation observed in Railway deploy logs**.
- Mahjong Wild: Railway service softtech-engine-mahjong, deployment b19d83ab-e0b6-4802-824c-3b36ca847734, SUCCESS. Backup loop enabled with ENGINE_BACKUP_ENABLED=true and 86400 second interval. **No positive remote backup confirmation observed in Railway deploy logs**.
- Skygate 5000: Railway service softtech-engine-skygate, deployment 11a4971f-a4f9-4f50-aef2-21cb159074b8, SUCCESS. Backup loop enabled. Runtime log includes `[ENGINE BACKUP] verified`, emitted after encrypted S3 upload, readback, AES-GCM decrypt, SHA-256 and SQLite integrity check on isolated temp file.

## Security controls
- Separate AES-256-GCM keys per engine in Railway service environment variables.
- S3 credentials configured via Railway bucket variable references, not committed to GitHub.
- Snapshot uses SQLite online backup to include WAL state.
- Remote object is read back and restored to isolated temporary file; no live database overwritten.
- All 3 native backup CI workflows passed.
- No external operator wallet integration or Production enablement.

## Follow-up requirements before claiming complete disaster recovery
1. Confirm UNO and Mahjong first remote object and isolated restore from logs or bucket inventory; diagnose silent background workers if no object.
2. Define bucket lifecycle retention and independent monitoring/alerting for missed backups, not just failure logs.
3. Verify 24-hour second-run scheduling, key rotation, multi-day retention and engine recovery after simulated volume loss.
4. Isolate preproduction and production wallet, ledger, API secrets, sessions and volume namespaces.
5. Independent external operator conformance and legal/security gates; no Playground or Genesis integration.
