# Native engine backup implementation contract (2026-11-09)

## Provisioned infrastructure
Railway bucket `softtech-native-engine-backups`, bucket ID `ce728e5e-b960-491f-a204-d8b771f3dc0f`, region `iad`, scoped to environment `9d39a708-0653-4d6c-9f88-d1e730833492`. This is a **storage destination only**; no native engine backup job has been enabled or verified.

## Source databases and volumes
- UNO LUCK: service `f79366ac-acd4-4b3f-8adb-bd54d29c6c55`, volume `softtech-uno-data` mounted at `/data`, SQLite path configured by `UNO_AGENCY_DB_PATH`.
- Mahjong Wild: service `8aea4f06-7f65-43ff-a9f6-08d6e08c8009`, volume `softtech-mahjong-data` at `/data`, SQLite path configured by `MAHJONG_AGENCY_DB_PATH`.
- Skygate: service `edd381a3-11db-4d19-a0f8-23dbccb8e3a6`, volume `softtech-skygate-data` at `/data`, SQLite path configured by `SKYGATE_AGENCY_DB_PATH`.

## Required next implementation
1. Each engine must snapshot its own SQLite database using SQLite online backup API while rounds may be active; **do not copy live .sqlite files directly** because WAL frames may be missing.
2. Encrypt snapshot with a per-engine secret and authenticated cipher, include SHA-256 manifest, engine version, round watermark and timestamp; do not upload unencrypted snapshots.
3. Use Railway bucket references for S3 endpoint, bucket, region, access key and secret; never copy credentials into source code or logs.
4. Keep independent object prefixes for UNO, Mahjong and Skygate; define retention, failure alerts and restoration runbook.
5. Restore to an **isolated** test volume, validate SQLite integrity and round/ledger watermark, compare with Provider Core reconciliation; do not restore over the live volume.
6. Only after a successful isolated restore for each engine may `engine_volume_recovery` be marked true. Until then production and preproduction activation stay locked.

## Operator certification
Reference integration must test signed launch, wallet balance/debit/credit/status/reversal, lost responses, retry and idempotency, settlement after service restart, tenant isolation and reconciliation. Playground and Genesis are explicitly out of scope.
