-- Migration 0002: Cloudflare Native Auth (users upgrade, auth_sessions, auth_login_attempts)

PRAGMA defer_foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'CLIENT' CHECK (role IN ('ADMIN', 'CLIENT')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  password_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

INSERT INTO users_new (id, email, name, role, status, password_hash, created_at, updated_at)
SELECT id, email, name, UPPER(role), 'ACTIVE', '', created_at, updated_at FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

-- 2. Auth Sessions table (server-side opaque session token hash)
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

-- 3. Auth Login Attempts table (Rate Limiting / Brute Force protection)
CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address TEXT,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
  success INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_email_time ON auth_login_attempts(email, attempted_at);
CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_ip_time ON auth_login_attempts(ip_address, attempted_at);

PRAGMA defer_foreign_keys = OFF;
