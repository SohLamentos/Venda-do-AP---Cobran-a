-- Migration 0001: Initial schema for generic real estate contracts and transactions

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'client',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Generic Contracts table (no hardcoded apartments or fixed financial values)
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  property_description TEXT,
  financed_amount REAL NOT NULL DEFAULT 0,
  fixed_installment REAL NOT NULL DEFAULT 0,
  annual_interest_rate REAL NOT NULL DEFAULT 0,
  term_months INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  fine_percent REAL NOT NULL DEFAULT 0,
  tr_mode TEXT NOT NULL DEFAULT 'ANNUAL',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 3. Transactions table (supports PAYMENT and LANCE with receipt_key for R2)
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  date TEXT NOT NULL,
  installment_number INTEGER NOT NULL,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PAYMENT', 'LANCE')),
  method TEXT NOT NULL DEFAULT 'PIX',
  observation TEXT,
  status TEXT NOT NULL DEFAULT 'PAGO' CHECK (status IN ('PAGO', 'EM_ABERTO')),
  receipt_key TEXT,
  receipt_file_name TEXT,
  receipt_mime_type TEXT,
  created_by TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);

-- 4. Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  contract_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_contracts_user_id ON contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_contract_id ON transactions(contract_id);
CREATE INDEX IF NOT EXISTS idx_transactions_installment ON transactions(contract_id, installment_number);
CREATE INDEX IF NOT EXISTS idx_audit_logs_contract ON audit_logs(contract_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
