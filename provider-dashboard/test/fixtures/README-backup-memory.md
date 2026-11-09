# Core backup memory fixture

Run each size in its own Node 24 process from `provider-dashboard`:

```sh
node test/fixtures/backup-memory.mjs --size-mib 64
node test/fixtures/backup-memory.mjs --size-mib 128
```

To compare an unchanged older checkout, add `--module /absolute/path/to/provider-dashboard/lib/offsite-backup.mjs`. The fixture imports that exact module and exercises its actual archive, upload, download, restore, and retention functions.

The fixture creates an actual SQLite WAL database containing 64 or 128 MiB of random payloads, so the snapshot is slightly larger because of SQLite pages and schema. An HTTP server streams objects to and from private temporary disk files. It validates the signed upload digest and implements exact ETag conditional deletion. The run includes local SQLite integrity verification, remote restore, retention archive verification, and the stale-ETag/replacement canary. No external service, real credential, or platform setting is used.

The JSON result records baseline RSS, process high-water RSS from `process.resourceUsage().maxRSS`, actual snapshot and archive sizes, elapsed time, transport counters, and verified outcomes. Measurements include the local server and SQLite fixture in the same process; they are not live Railway memory metrics. Run sizes separately and record the exact source revision with the output. A file-backed implementation should not retain an archive-sized Buffer at any production stage. RSS can still exceed the 64 KiB I/O chunk size because V8, native crypto, SQLite, HTTP, allocator arenas, and garbage collection retain working memory.

## Compatibility and failure boundaries

STBK01 and STBK02 formats are unchanged; neither format uses compression. STBK02's authenticated JSON header and leading GCM tag retain their existing offsets. Encryption patches the tag only in a private file, then fsyncs and publishes it with an atomic no-overwrite hard link. Restore authenticates the complete ciphertext, verifies the plaintext size/hash and SQLite identity/integrity, and only then publishes the destination. A failed or interrupted operation removes its private partial output.

Production offsite backup and retention use `putEncryptedObjectFile`, `readEncryptedObjectFile`, and `inspectEncryptedBackupFile`. Small byte APIs remain for existing fixtures and the conditional-delete canary; `readEncryptedObjectReceipt` has a default 1 MiB explicit limit, and callers requiring a large object must use the file API. The streaming archive path has no maximum snapshot size or skipped-large-file fallback. The existing 90-second S3 request timeout and all retention scope, freshness, inventory, conditional-delete, and verification gates remain in force.

The normal `npm test` command includes `test/backup-streaming.test.mjs`. The large memory fixture is an explicit measurement command rather than a per-commit load test.
