PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=10000;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY,name TEXT NOT NULL,origin TEXT NOT NULL,original_origin TEXT NOT NULL,play_path TEXT NOT NULL,cover TEXT NOT NULL,source TEXT NOT NULL,source_commit TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),maintenance INTEGER NOT NULL DEFAULT 0 CHECK(maintenance IN(0,1)),health TEXT NOT NULL DEFAULT 'unknown',health_json TEXT,checked_at INTEGER,signed_seen_at INTEGER,version TEXT NOT NULL DEFAULT 'unverified');
CREATE TABLE IF NOT EXISTS operators(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('enabled','disabled')),environment TEXT NOT NULL DEFAULT 'sandbox' CHECK(environment IN('sandbox','preproduction','production')),games_json TEXT NOT NULL,currency TEXT NOT NULL,scale INTEGER NOT NULL CHECK(scale BETWEEN 0 AND 8),wallet_mode TEXT NOT NULL CHECK(wallet_mode IN('sandbox','seamless')),wallet_url TEXT NOT NULL DEFAULT '',wallet_secret TEXT,return_origins_json TEXT NOT NULL,initial_minor TEXT NOT NULL,max_stake_minor TEXT NOT NULL,max_payout_minor TEXT NOT NULL,internal INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS api_keys(id TEXT PRIMARY KEY,operator_id TEXT NOT NULL REFERENCES operators(id),secret_box TEXT NOT NULL,scopes_json TEXT NOT NULL,revoked_at INTEGER,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS api_key_protocol(key_id TEXT PRIMARY KEY REFERENCES api_keys(id),version INTEGER NOT NULL CHECK(version IN(1,2)));
CREATE TABLE IF NOT EXISTS operator_wallet_protocol(operator_id TEXT PRIMARY KEY REFERENCES operators(id),version INTEGER NOT NULL CHECK(version IN(1,2)));
CREATE TABLE IF NOT EXISTS replay_nonces(key_id TEXT NOT NULL,nonce TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(key_id,nonce));
CREATE TABLE IF NOT EXISTS panel_sessions(id_hash TEXT PRIMARY KEY,role TEXT NOT NULL,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,operator_id TEXT NOT NULL REFERENCES operators(id),player_ref TEXT NOT NULL,currency TEXT NOT NULL,scale INTEGER NOT NULL,balance_minor TEXT NOT NULL DEFAULT '0',created_at INTEGER NOT NULL,UNIQUE(operator_id,player_ref,currency));
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,operator_id TEXT NOT NULL REFERENCES operators(id),player_id TEXT NOT NULL REFERENCES players(id),game_id TEXT NOT NULL REFERENCES games(id),currency TEXT NOT NULL,scale INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('created','active','revoked','expired')),launch_hash TEXT NOT NULL UNIQUE,launch_box TEXT NOT NULL,launch_expires_at INTEGER NOT NULL,redeem_request TEXT,return_url TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,release TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_scope ON sessions(operator_id,game_id,status,created_at);
CREATE TABLE IF NOT EXISTS idempotency(operator_id TEXT NOT NULL,route TEXT NOT NULL,key TEXT NOT NULL,payload_hash TEXT NOT NULL,response_box TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(operator_id,route,key));
CREATE TABLE IF NOT EXISTS rounds(id TEXT PRIMARY KEY,operator_id TEXT NOT NULL REFERENCES operators(id),player_id TEXT NOT NULL REFERENCES players(id),session_id TEXT NOT NULL REFERENCES sessions(id),game_id TEXT NOT NULL REFERENCES games(id),round_ref TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('intent','reserved','settled','voided','rejected')),currency TEXT NOT NULL,scale INTEGER NOT NULL,stake_minor TEXT NOT NULL,max_payout_minor TEXT NOT NULL,payout_minor TEXT,evidence TEXT,reversal_requested INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,finished_at INTEGER,UNIQUE(operator_id,game_id,round_ref));
CREATE INDEX IF NOT EXISTS rounds_scope ON rounds(operator_id,created_at,status);
CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,operator_id TEXT NOT NULL REFERENCES operators(id),player_id TEXT NOT NULL REFERENCES players(id),session_id TEXT,round_id TEXT,game_id TEXT,kind TEXT NOT NULL,amount_minor TEXT NOT NULL,currency TEXT NOT NULL,scale INTEGER NOT NULL,balance_minor TEXT,reference TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(operator_id,reference,kind));
CREATE TRIGGER IF NOT EXISTS ledger_immutable_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'ledger is immutable'); END;
CREATE TRIGGER IF NOT EXISTS ledger_immutable_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'ledger is immutable'); END;
CREATE INDEX IF NOT EXISTS ledger_round ON ledger(round_id);
CREATE INDEX IF NOT EXISTS ledger_player ON ledger(player_id);
CREATE INDEX IF NOT EXISTS ledger_operator_time ON ledger(operator_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS rounds_operator_time ON rounds(operator_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS sessions_operator_time ON sessions(operator_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS wallet_ops(id TEXT PRIMARY KEY,operator_id TEXT NOT NULL REFERENCES operators(id),round_id TEXT NOT NULL,action TEXT NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','unknown','ok','rejected')),response_json TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,event TEXT NOT NULL,scope TEXT NOT NULL,detail_json TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS checks(id TEXT PRIMARY KEY,operator_id TEXT,result_json TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS selftests(id TEXT PRIMARY KEY,status TEXT NOT NULL,result_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);

CREATE TRIGGER IF NOT EXISTS audit_immutable_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_immutable_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit is immutable'); END;

CREATE TABLE IF NOT EXISTS operator_game_modes(
 operator_id TEXT NOT NULL REFERENCES operators(id),
 game_id TEXT NOT NULL REFERENCES games(id),
 mode TEXT NOT NULL CHECK(mode IN('sandbox','preproduction','disabled')),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(operator_id,game_id)
);

CREATE TABLE IF NOT EXISTS release_requests(
 id TEXT PRIMARY KEY,
 operator_id TEXT NOT NULL REFERENCES operators(id),
 game_id TEXT NOT NULL REFERENCES games(id),
 requested_mode TEXT NOT NULL CHECK(requested_mode IN('sandbox','preproduction')),
 status TEXT NOT NULL CHECK(status IN('requested','validated','approved','activated','rejected','cancelled')),
 requested_by TEXT NOT NULL,
 validated_by TEXT,
 approved_by TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS release_requests_scope ON release_requests(operator_id,game_id,status,created_at);

-- Individual staff identities are separate from legacy shared sandbox sessions.
CREATE TABLE IF NOT EXISTS staff_users(
 id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,
 person_ref TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role IN('owner','operator','approver','auditor')),
 status TEXT NOT NULL CHECK(status IN('invited','pending_mfa','active','disabled')),
 password_hash TEXT,totp_secret_box TEXT,totp_last_step INTEGER NOT NULL DEFAULT -1,
 auth_version INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,mfa_enrolled_at INTEGER
);
CREATE TABLE IF NOT EXISTS staff_invitations(
 token_hash TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES staff_users(id),
 expires_at INTEGER NOT NULL,used_at INTEGER,created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_enrollments(
 token_hash TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES staff_users(id),
 secret_box TEXT NOT NULL,auth_version INTEGER NOT NULL,expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_auth_challenges(
 token_hash TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES staff_users(id),
 auth_version INTEGER NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
 account_rate_key TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_recovery_codes(
 code_hash TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES staff_users(id),
 used_at INTEGER,created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_sessions(
 id_hash TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES staff_users(id),csrf TEXT NOT NULL,
 auth_version INTEGER NOT NULL,mfa_method TEXT NOT NULL CHECK(mfa_method IN('totp','recovery')),
 mfa_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS staff_sessions_user ON staff_sessions(staff_id,expires_at);
CREATE TABLE IF NOT EXISTS staff_auth_limits(
 key_hash TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_release_signoffs(
 release_id TEXT NOT NULL REFERENCES release_requests(id),action TEXT NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff_users(id),person_ref TEXT NOT NULL,
 auth_version INTEGER NOT NULL,mfa_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(release_id,action)
);
CREATE TRIGGER IF NOT EXISTS staff_signoffs_immutable_update BEFORE UPDATE ON staff_release_signoffs BEGIN SELECT RAISE(ABORT,'staff signoffs are immutable'); END;
CREATE TRIGGER IF NOT EXISTS staff_signoffs_immutable_delete BEFORE DELETE ON staff_release_signoffs BEGIN SELECT RAISE(ABORT,'staff signoffs are immutable'); END;
