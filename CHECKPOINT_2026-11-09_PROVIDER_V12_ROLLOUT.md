# Soft Tech v1.2 rollout checkpoint (2026-11-09)

## Phase 1: Environment isolation
Status: **NOT COMPLETE**. Current production deployment of Provider Core is a sandbox-only service. Operator and game mode policies are persisted separately, but sandbox and preproduction still use the same virtual-credit wallet and SQLite ledger. No production wallet, production API keys, production session namespace or production ledger exists. The production option is intentionally blocked. A future live environment requires separate Railway environment/services, separate storage volumes and secrets, environment-bound signed credentials, immutable ledger reconciliation, migration and recovery drills. Never re-label a sandbox database as production.

## Phase 2: Release approvals
Status: **Implemented request/validation/approval; preproduction activation blocked pending isolated wallet/ledger**. Admin-only POST /api/release-requests with {operator_id,game_id,mode:'preproduction'|'sandbox'}, then POST /api/release-requests/:id/validate, /approve, /activate. State transitions are sequential and audited. Preproduction validation requires global preproduction mode. Activation and launch are now fail-closed with PREPRODUCTION_ISOLATION_PENDING until separate wallet/ledger storage is provisioned and verified; production requests are rejected. Operator page still permits immediate sandbox and disabled controls, but preproduction direct selector is blocked. The workflow uses one admin role, not distinct human approvers: **separation of duties and MFA are still outstanding**.

## Phase 3: External operator conformance
Status: **Partial**. Signed HTTP tests cover two independently created operators, nonce replay, idempotent launch, forbidden cross-operator session read, disabled game launch, global production lock and approval gate. External wallet integration and a third-party operator's own callbacks are **not certified**. Never claim external operator end-to-end success from local reference tests.

## Phase 4: Security, backup, disaster recovery
Status: **Partial**. Provider Core encrypted remote backup/restore QA exists. Independent native engine volumes, engine round restore, incident alerts, named identities and MFA are still outstanding. Never enable production based on Provider Core backup alone.

## Phase 5: Capacity and acceptance
Status: **Partial**. Automated test now exercises 100 concurrent signed game-catalog requests across two operator credentials on a local isolated HTTP server; this is not 100 live game rounds or a 1000-session capacity certification. Load tests of 500 and 1000 real game sessions, browser-to-engine-to-ledger E2E, Safari physical-device testing, fault injection and long-duration soak remain open.

## Release gates
1. No production credits or redeemable balance.
2. No real-money callbacks or settlement.
3. No cross-environment wallet reuse.
4. Require legal/compliance review and independent security verification before any production activation.
5. Do not connect Playground or Genesis; they are separate operator systems.
