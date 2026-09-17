-- Migration 0004: Status DRAFT/ACTIVE e dados de ativação na tabela contracts
-- Versão local para ciclo de vida do contrato: DRAFT -> ACTIVE

ALTER TABLE contracts ADD COLUMN status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE'));
ALTER TABLE contracts ADD COLUMN activated_at TEXT;
ALTER TABLE contracts ADD COLUMN activated_by TEXT;

CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
