-- Migration 0003: Login + Roles (ADMIN, SELLER, BUYER) e Email Opcional
-- 1. Criação da nova tabela de usuários com login TEXT UNIQUE NOT NULL
-- 2. Migração de perfis: CLIENT -> BUYER, preserva ADMIN, permite SELLER
-- 3. Email opcional com índice UNIQUE quando informado
-- 4. Atualização da tabela auth_login_attempts para registrar login TEXT

PRAGMA defer_foreign_keys = ON;

-- 1. Nova estrutura da tabela users
CREATE TABLE IF NOT EXISTS users_new (
  id TEXT PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SELLER', 'BUYER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Copiar dados preservando IDs, senhas, datas e convertendo CLIENT -> BUYER
-- Caso existam usuários legados sem login, gera identificador técnico temporário único 'user_' || id
INSERT INTO users_new (id, login, name, email, role, status, password_hash, created_at, updated_at, last_login_at)
SELECT 
  id,
  'user_' || substr(replace(id, '-', ''), 1, 12),
  COALESCE(name, 'Usuário'),
  email,
  CASE 
    WHEN UPPER(role) = 'ADMIN' THEN 'ADMIN'
    WHEN UPPER(role) = 'SELLER' THEN 'SELLER'
    ELSE 'BUYER'
  END,
  status,
  password_hash,
  created_at,
  updated_at,
  last_login_at
FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

-- Índices de performance e unicidade
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login ON users(login);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 2. Atualizar tabela auth_login_attempts para login
CREATE TABLE IF NOT EXISTS auth_login_attempts_new (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  ip_address TEXT,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
  success INTEGER NOT NULL DEFAULT 0
);

INSERT INTO auth_login_attempts_new (id, login, ip_address, attempted_at, success)
SELECT 
  id, 
  COALESCE(email, 'legacy'), 
  ip_address, 
  attempted_at, 
  success 
FROM auth_login_attempts;

DROP TABLE auth_login_attempts;

ALTER TABLE auth_login_attempts_new RENAME TO auth_login_attempts;

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_login_time ON auth_login_attempts(login, attempted_at);
CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_ip_time ON auth_login_attempts(ip_address, attempted_at);

PRAGMA defer_foreign_keys = OFF;
