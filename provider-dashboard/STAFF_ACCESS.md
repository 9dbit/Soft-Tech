# Individual staff access and independent release approval

This change implements the staff control, enrollment and approval mechanism. It does not create production staff, establish the real identity of any person, certify an external wallet or provide a human go-live decision. Test accounts exist only in temporary local test databases.

## First-owner migration

1. Open the existing panel and choose **Shared Sandbox Administrator**. The current sandbox credentials continue to support existing sandbox operations.
2. Open **Staff & MFA → Enroll first owner**. The actual owner supplies their own username, full name, unique personnel reference or work email, and a new individual password. Re-entering the existing administrator password is required. Bootstrap reauthentication has a persistent attempt limit.
3. Register the displayed setup key in that owner's authenticator and enter its code. The account remains `pending_mfa` and has no staff session until confirmation succeeds. The enrollment secret is encrypted at rest and is not logged.
4. Save the eight one-use recovery codes. They are displayed once; the database stores only hashes. Closing the dialog removes its contents. A lost or unfinished enrollment is restarted by signing in with the individual's chosen username and password.
5. Use **Invite staff** for each other real staff member. Their personnel reference is unique and cannot be edited into an alias. The owner receives a one-time activation token; the recipient chooses their own password and enrolls their own authenticator. No email or other message is sent by this application.
6. Assign a different person as an eligible release approver. Review the people's identities through the organization's normal identity process. Registering distinct account records does not itself prove that two different humans control them.

The first registration closes shared-admin bootstrap. Losing the first owner's password and authenticator does not silently reopen it. The shared password cannot reset a registered person's MFA, create further staff, or approve a release. Existing shared sessions are retained for sandbox compatibility. Shared sessions cannot mutate application operations in a non-sandbox deployment.

## Roles within one provider deployment

| Role | View provider reports | Self-service credentials | Manage staff | Sandbox operations | Request / validate / activate release | Approve / reject release |
| --- | --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Yes | Yes, for another person's request |
| Operator | Yes | Yes | No | Yes | Yes | No |
| Approver | Yes | Yes | No | No | No | Yes, for another person's request |
| Auditor | Yes | Yes | No | No | No | No |

These are provider staff roles. They do not replace the separately scoped operator API credentials or their tenant isolation. Role and status changes revoke existing staff sessions. The last active owner cannot be disabled or demoted.

## Authentication behavior

- Passwords are normalized to NFC, accept 16–128 characters, and are salted with independent 16-byte random salts. Native asynchronous scrypt uses `N=131072`, `r=8`, `p=1`, and a 64-byte derived key. At most **two** password hashes run concurrently; excess requests receive `AUTH_BUSY`. Durable per-account and network-peer attempt budgets run before password verification. Forwarding headers cannot choose the peer bucket.
- TOTP follows RFC 6238 with SHA-1, six digits, a 30-second period, a 160-bit secret, and a window of one step in each direction. A persisted last-accepted step prevents reuse across challenges, browser sessions and process restarts. Enrollment and login challenges expire and have attempt limits; requesting a fresh challenge does not reset the account's attempt budget.
- Password verification alone returns an expiring MFA challenge, never an authenticated session. Successful TOTP confirmation issues a random, hashed-at-rest session token in an HttpOnly, SameSite=Strict cookie, with Secure in production runtime mode. Staff sessions have an eight-hour absolute life and a 30-minute idle limit.
- Sensitive staff management and every release action require TOTP verified within ten minutes. **Verify new MFA code** performs step-up authentication. Reusing the same code is rejected; wait for the next authenticator value.
- A password plus one recovery code gives a 15-minute recovery session. It cannot mutate operators, manage staff, or participate in releases. The user must replace their authenticator, confirm a new code, and save newly issued recovery codes before those actions are available again.
- Password changes, MFA replacement, account disablement, role changes and explicit session revocation invalidate persisted session authority. Credentials, enrollment secrets, activation tokens, recovery values and session tokens are omitted from staff lists, ordinary bootstrap responses and audit details.

TOTP is not phishing-resistant authentication. This mechanism should not be described as a WebAuthn implementation or an independent security certification.

## Release enforcement

The HTTP route passes its authenticated session to `Core.requestRelease` and `Core.advanceRelease`. The Core rechecks the persisted staff session, current account status, current role, authentication version and fresh TOTP; changing only the HTTP route cannot authorize a shared role string.

The requester and approver must have different immutable staff IDs and different unique personnel references. A requester cannot approve their own request. Permission denials and attempted self-approval are audited. Every successful request and state transition records an immutable staff signoff with the person reference, credential version and MFA time. Validation never creates an approval.

Before activation, the original requester and recorded approver must still be active and appropriately authorized. Revoking either person's authority invalidates the pending decision; it must be rejected or cancelled and recreated with current credentials. Legacy release requests made by a shared account cannot be approved or activated as named approvals. Staff approval does not bypass environment isolation, backup, wallet, recovery, mathematical review or other project gates. Production remains unavailable on this baseline.

`staff.readiness().distinct_approvers_available` reports whether the database contains appropriately enrolled accounts for distinct requester and approver identities. `human_identity_review_required` remains true: readiness is not a substitute for real identity verification or required project signatories.

## Storage and integration notes

The schema is additive. The legacy five-column `panel_sessions` table is unchanged. Individual sessions use `staff_sessions`; user identities, password hashes, MFA counters, challenges, invitations, recovery hashes, durable rate budgets and immutable release signoffs have dedicated tables in the same deployment-bound SQLite database. Existing full-database encrypted snapshots include them.

Two additional ciphertext columns use the existing Core vault master key:

- `staff_users.totp_secret_box`
- `staff_enrollments.secret_box`

Master-key rotation must rewrap active MFA secrets in addition to the existing operator, launch and idempotency ciphertexts. Pending enrollments may instead be explicitly revoked. Do not rotate the master key by simply changing the environment value. A restored database must retain its original vault key or complete a verified rewrap operation. Each physical environment must use its own database, session store and secrets.

The server exposes enrollment/login routes under `/api/staff/`. Mutating authenticated routes retain the existing same-origin and CSRF checks. Invitation and enrollment tokens are sent in JSON bodies, never URL query parameters. The UI additions are `/public/staff.js`, the staff navigation item, individual-login fields, and capability-aware release controls. Add `/staff.js` to the static-file allowlist when merging server changes.

## Verification

At the integration handoff, `npm run check` and the complete `npm test` passed: **59 unit/integration tests and 2 spawned HTTP scenarios, 61 total, no failures or skips**. Seven unit tests specifically cover staff cryptography, bootstrap migration, recovery, freshness, revocation and independent approvals. The staff HTTP scenario exercises actual server cookies, CSRF, invalid MFA, replay across restart, RBAC, same-person denial, distinct account approval, disablement, password rotation, limited recovery and durable lockout.

`node test/staff-browser.mjs` exercises the real panel with temporary named test fixtures. Its six checks cover first-owner enrollment and one-time recovery display, mobile and desktop layout, clearing invitation secrets on Escape, recipient activation, independent approval through the panel, and two-step login including a rejected wrong TOTP. It produces four screenshots and a sanitized JSON report. `CHROMIUM_PATH` may specify an installed Chromium executable; Playwright can come from the runtime's `CODEX_PRIMARY_RUNTIME_NODE_MODULES` or the normal module path.

## Primary references

- RFC 6238, algorithm and one-time acceptance requirements: https://www.rfc-editor.org/rfc/rfc6238.html
- OWASP Password Storage Cheat Sheet, scrypt work factors: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- NIST SP 800-63B-4, OTP replay resistance and rate limiting: https://pages.nist.gov/800-63-4/sp800-63b.html
