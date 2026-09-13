/**
 * ============================================================================
 * ETN / VENDA DE APARTAMENTOS — CLOUDFLARE WORKER API
 * ============================================================================
 * NOTAS DE SEGURANÇA E ARQUITETURA:
 * 1. SEGURANÇA: Os endpoints /api/v1/contracts e /api/v1/transactions NÃO possuem
 *    autenticação real implementada no Worker nesta etapa. Portanto, NÃO estão
 *    liberados para persistência financeira de produção até a etapa dedicada de
 *    autenticação/autorização (RBAC/JWT).
 * 2. FONTE DA VERDADE ATIVA: O Firebase continua temporariamente como a persistência
 *    ativa de dados do frontend (App.tsx).
 * 3. USERS / FOREIGN KEY: contracts.user_id possui chave estrangeira para users(id).
 *    A sincronização da tabela users é uma pendência obrigatória da futura migração
 *    antes de permitir a criação de contratos D1 em produção.
 * 4. VALORES MONETÁRIOS: Campos monetários no D1 estão atualmente como REAL.
 *    Decisão pendente antes da carga de dados reais: avaliar armazenamento em
 *    centavos usando INTEGER para prevenir imprecisões de ponto flutuante.
 * ============================================================================
 */

/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB?: D1Database;
  RECEIPTS?: R2Bucket;
  ASSETS?: Fetcher;
}

/**
 * Monetary conversion helpers:
 * - Frontend operates in Reais (floating point, e.g. 1965.63)
 * - Database stores in Centavos (INTEGER, e.g. 196563)
 */
export function moneyToCents(value: number | null | undefined): number {
  if (value === null || value === undefined || isNaN(Number(value))) return 0;
  return Math.round(Number(value) * 100);
}

export function centsToMoney(cents: number | null | undefined): number {
  if (cents === null || cents === undefined || isNaN(Number(cents))) return 0;
  return Number(cents) / 100;
}

/**
 * Frontend ContractConfig interface (camelCase)
 */
export interface FrontendContractConfig {
  id?: string;
  name?: string;
  propertyDescription?: string;
  financedAmount: number;
  fixedInstallment: number;
  annualInterestRate: number;
  termMonths: number;
  startDate: string;
  finePercent: number;
  trMode: 'MONTHLY' | 'ANNUAL';
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Maps a D1 database contract row (snake_case) to Frontend ContractConfig (camelCase).
 * Explicit mapping:
 *   user_id <-> ownerId
 *   property_description <-> propertyDescription
 *   financed_amount <-> financedAmount (cents to reais)
 *   fixed_installment <-> fixedInstallment (cents to reais)
 *   annual_interest_rate <-> annualInterestRate
 *   term_months <-> termMonths
 *   start_date <-> startDate
 *   fine_percent <-> finePercent
 *   tr_mode <-> trMode
 *   created_at <-> createdAt
 *   updated_at <-> updatedAt
 */
export function mapContractDbToFrontend(row: Record<string, any>): FrontendContractConfig {
  return {
    id: row.id,
    name: row.name || '',
    propertyDescription: row.property_description ?? row.propertyDescription ?? '',
    financedAmount: centsToMoney(row.financed_amount ?? row.financedAmount ?? 0),
    fixedInstallment: centsToMoney(row.fixed_installment ?? row.fixedInstallment ?? 0),
    annualInterestRate: Number(row.annual_interest_rate ?? row.annualInterestRate ?? 0),
    termMonths: Number(row.term_months ?? row.termMonths ?? 0),
    startDate: row.start_date || row.startDate || '',
    finePercent: Number(row.fine_percent ?? row.finePercent ?? 0),
    trMode: (row.tr_mode || row.trMode || 'ANNUAL') as 'MONTHLY' | 'ANNUAL',
    ownerId: row.user_id ?? row.ownerId ?? row.userId ?? undefined,
    createdAt: row.created_at || row.createdAt || undefined,
    updatedAt: row.updated_at || row.updatedAt || undefined,
  };
}

/**
 * Maps incoming ContractConfig payload (camelCase, with snake_case fallback) to D1 fields (snake_case).
 * Converts monetary values (financedAmount, fixedInstallment) to centavos (INTEGER).
 */
export function mapContractFrontendToDb(payload: Record<string, any>, defaultId?: string) {
  const now = new Date().toISOString();
  return {
    id: payload.id || defaultId || crypto.randomUUID(),
    user_id: payload.ownerId ?? payload.userId ?? payload.user_id ?? null,
    name: payload.name || 'Novo Contrato',
    property_description: payload.propertyDescription ?? payload.property_description ?? '',
    financed_amount: moneyToCents(payload.financedAmount ?? payload.financed_amount ?? 0),
    fixed_installment: moneyToCents(payload.fixedInstallment ?? payload.fixed_installment ?? 0),
    annual_interest_rate: Number(payload.annualInterestRate ?? payload.annual_interest_rate ?? 0),
    term_months: Number(payload.termMonths ?? payload.term_months ?? 0),
    start_date: payload.startDate || payload.start_date || now.split('T')[0],
    fine_percent: Number(payload.finePercent ?? payload.fine_percent ?? 0),
    tr_mode: (payload.trMode || payload.tr_mode || 'ANNUAL') as 'MONTHLY' | 'ANNUAL',
    created_at: payload.createdAt || payload.created_at || now,
    updated_at: now,
  };
}

/**
 * Maps a D1 transaction row (snake_case) to Frontend Transaction (camelCase).
 * Converts amount from centavos (INTEGER) to reais.
 */
export function mapTransactionDbToFrontend(row: Record<string, any>) {
  return {
    id: row.id,
    contractId: row.contract_id ?? row.contractId,
    date: row.date,
    installmentNumber: Number(row.installment_number ?? row.installmentNumber ?? 1),
    amount: centsToMoney(row.amount ?? 0),
    type: (row.type === 'LANCE' ? 'LANCE' : 'PAYMENT') as 'PAYMENT' | 'LANCE',
    method: row.method || 'PIX',
    observation: row.observation ?? undefined,
    status: (row.status === 'EM_ABERTO' ? 'EM_ABERTO' : 'PAGO') as 'PAGO' | 'EM_ABERTO',
    receiptKey: row.receipt_key ?? row.receiptKey ?? undefined,
    receiptFileName: row.receipt_file_name ?? row.receiptFileName ?? undefined,
    receiptMimeType: row.receipt_mime_type ?? row.receiptMimeType ?? undefined,
    createdBy: row.created_by ?? row.createdBy ?? undefined,
    createdByEmail: row.created_by_email ?? row.createdByEmail ?? undefined,
    createdAt: row.created_at ?? row.createdAt ?? undefined,
  };
}

/**
 * Maps incoming Transaction payload (camelCase, with snake_case fallback) to D1 fields (snake_case).
 * Converts amount to centavos (INTEGER).
 */
export function mapTransactionFrontendToDb(payload: Record<string, any>, defaultId?: string) {
  const now = new Date().toISOString();
  return {
    id: payload.id || defaultId || crypto.randomUUID(),
    contract_id: payload.contractId ?? payload.contract_id ?? '',
    date: payload.date || now.split('T')[0],
    installment_number: Number(payload.installmentNumber ?? payload.installment_number ?? 1),
    amount: moneyToCents(payload.amount ?? 0),
    type: payload.type === 'LANCE' ? 'LANCE' : 'PAYMENT',
    method: payload.method || 'PIX',
    observation: payload.observation ?? null,
    status: payload.status || 'PAGO',
    receipt_key: payload.receiptKey ?? payload.receipt_key ?? null,
    receipt_file_name: payload.receiptFileName ?? payload.receipt_file_name ?? null,
    receipt_mime_type: payload.receiptMimeType ?? payload.receipt_mime_type ?? null,
    created_by: payload.createdBy ?? payload.created_by ?? null,
    created_by_email: payload.createdByEmail ?? payload.created_by_email ?? null,
    created_at: payload.createdAt ?? payload.created_at ?? now,
    updated_at: now,
  };
}

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: jsonHeaders,
  });
}

function handleCors(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: jsonHeaders,
    });
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = handleCors(request);
    if (cors) return cors;

    const url = new URL(request.url);
    const { pathname } = url;

    // 1. Health check endpoint (mandatory specification)
    if (pathname === '/api/v1/health' && request.method === 'GET') {
      return jsonResponse({
        ok: true,
        service: 'venda-apartamentos',
        runtime: 'cloudflare-workers',
      });
    }

    // 2. Database Health check endpoint (read-only D1 connectivity & schema check)
    if (pathname === '/api/v1/db/health' && request.method === 'GET') {
      return handleDbHealth(env);
    }

    // 3. Contracts endpoints (/api/v1/contracts)
    if (pathname.startsWith('/api/v1/contracts')) {
      return handleContracts(request, env, url);
    }

    // 4. Transactions endpoints (/api/v1/transactions)
    if (pathname.startsWith('/api/v1/transactions')) {
      return handleTransactions(request, env, url);
    }

    // 5. Static assets handling (SPA fallback handled via Workers Static Assets)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * Handle database health check: strictly read-only, does not expose data.
 */
async function handleDbHealth(env: Env): Promise<Response> {
  const databaseName = 'venda-apartamentos-db';
  if (!env.DB) {
    return jsonResponse(
      {
        ok: false,
        database: databaseName,
        connected: false,
      },
      503
    );
  }

  try {
    // 1. Connectivity test
    await env.DB.prepare('SELECT 1').run();

    // 2. Verify existence of required tables in sqlite_master
    const requiredTables = ['users', 'contracts', 'transactions', 'audit_logs'];
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'contracts', 'transactions', 'audit_logs')"
    ).all();

    const foundTables = (results || []).map((row: any) => row.name);
    const schemaReady = requiredTables.every((t) => foundTables.includes(t));

    return jsonResponse({
      ok: true,
      database: databaseName,
      connected: true,
      schemaReady,
    });
  } catch (_err) {
    return jsonResponse(
      {
        ok: false,
        database: databaseName,
        connected: false,
      },
      503
    );
  }
}

/**
 * Handle contracts endpoints
 */
async function handleContracts(request: Request, env: Env, url: URL): Promise<Response> {
  // =========================================================================
  // BARREIRA TEMPORÁRIA DE SEGURANÇA (FAIL-CLOSED)
  // Até a etapa específica de autenticação/autorização (RBAC/JWT), os endpoints
  // de contratos estão bloqueados para persistência em produção.
  // =========================================================================
  const D1_PERSISTENCE_ENABLED = false;
  if (!D1_PERSISTENCE_ENABLED) {
    return jsonResponse(
      {
        ok: false,
        code: 'D1_PERSISTENCE_NOT_ENABLED',
        message: 'Persistência D1 ainda não habilitada para produção.',
      },
      503
    );
  }

  if (!env.DB) {
    return jsonResponse(
      {
        ok: false,
        error: 'Cloudflare D1 binding "DB" is not configured yet. Run migrations or configure D1 in wrangler.jsonc.',
      },
      503
    );
  }

  try {
    const parts = url.pathname.replace('/api/v1/contracts', '').split('/').filter(Boolean);
    const contractId = parts[0] || url.searchParams.get('id');

    if (request.method === 'GET') {
      if (contractId) {
        const stmt = env.DB.prepare('SELECT * FROM contracts WHERE id = ?');
        const contract = await stmt.bind(contractId).first();
        if (!contract) {
          return jsonResponse({ ok: false, error: 'Contract not found' }, 404);
        }
        return jsonResponse({ ok: true, data: mapContractDbToFrontend(contract) });
      } else {
        const stmt = env.DB.prepare('SELECT * FROM contracts ORDER BY created_at DESC');
        const { results } = await stmt.all();
        return jsonResponse({ ok: true, data: (results || []).map(mapContractDbToFrontend) });
      }
    }

    if (request.method === 'POST') {
      const body = await request.json() as Record<string, any>;
      const record = mapContractFrontendToDb(body);

      await env.DB.prepare(`
        INSERT INTO contracts (
          id, user_id, name, property_description, financed_amount, 
          fixed_installment, annual_interest_rate, term_months, 
          start_date, fine_percent, tr_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.id,
        record.user_id,
        record.name,
        record.property_description,
        record.financed_amount,
        record.fixed_installment,
        record.annual_interest_rate,
        record.term_months,
        record.start_date,
        record.fine_percent,
        record.tr_mode,
        record.created_at,
        record.updated_at
      ).run();

      return jsonResponse({ ok: true, id: record.id, message: 'Contract created successfully' }, 201);
    }

    if (request.method === 'PUT') {
      const body = await request.json() as Record<string, any>;
      const targetId = contractId || body.id;
      if (!targetId) {
        return jsonResponse({ ok: false, error: 'Contract ID is required' }, 400);
      }

      const now = new Date().toISOString();
      const userId = body.ownerId ?? body.userId ?? body.user_id ?? null;
      const propDesc = body.propertyDescription ?? body.property_description ?? null;
      const financedAmount = body.financedAmount !== undefined ? moneyToCents(body.financedAmount) : (body.financed_amount !== undefined ? Number(body.financed_amount) : null);
      const fixedInstallment = body.fixedInstallment !== undefined ? moneyToCents(body.fixedInstallment) : (body.fixed_installment !== undefined ? Number(body.fixed_installment) : null);
      const annualRate = body.annualInterestRate !== undefined ? Number(body.annualInterestRate) : (body.annual_interest_rate !== undefined ? Number(body.annual_interest_rate) : null);
      const termMonths = body.termMonths !== undefined ? Number(body.termMonths) : (body.term_months !== undefined ? Number(body.term_months) : null);
      const startDate = body.startDate ?? body.start_date ?? null;
      const finePercent = body.finePercent !== undefined ? Number(body.finePercent) : (body.fine_percent !== undefined ? Number(body.fine_percent) : null);
      const trMode = body.trMode ?? body.tr_mode ?? null;

      await env.DB.prepare(`
        UPDATE contracts SET
          user_id = COALESCE(?, user_id),
          name = COALESCE(?, name),
          property_description = COALESCE(?, property_description),
          financed_amount = COALESCE(?, financed_amount),
          fixed_installment = COALESCE(?, fixed_installment),
          annual_interest_rate = COALESCE(?, annual_interest_rate),
          term_months = COALESCE(?, term_months),
          start_date = COALESCE(?, start_date),
          fine_percent = COALESCE(?, fine_percent),
          tr_mode = COALESCE(?, tr_mode),
          updated_at = ?
        WHERE id = ?
      `).bind(
        userId,
        body.name ?? null,
        propDesc,
        financedAmount,
        fixedInstallment,
        annualRate,
        termMonths,
        startDate,
        finePercent,
        trMode,
        now,
        targetId
      ).run();

      return jsonResponse({ ok: true, message: 'Contract updated successfully' });
    }

    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  } catch (err: any) {
    return jsonResponse({ ok: false, error: err?.message || 'Internal server error' }, 500);
  }
}

/**
 * Handle transactions endpoints
 */
async function handleTransactions(request: Request, env: Env, url: URL): Promise<Response> {
  // =========================================================================
  // BARREIRA TEMPORÁRIA DE SEGURANÇA (FAIL-CLOSED)
  // Até a etapa específica de autenticação/autorização (RBAC/JWT), os endpoints
  // de transações estão bloqueados para persistência em produção.
  // =========================================================================
  const D1_PERSISTENCE_ENABLED = false;
  if (!D1_PERSISTENCE_ENABLED) {
    return jsonResponse(
      {
        ok: false,
        code: 'D1_PERSISTENCE_NOT_ENABLED',
        message: 'Persistência D1 ainda não habilitada para produção.',
      },
      503
    );
  }

  if (!env.DB) {
    return jsonResponse(
      {
        ok: false,
        error: 'Cloudflare D1 binding "DB" is not configured yet.',
      },
      503
    );
  }

  try {
    const contractId = url.searchParams.get('contractId') || url.searchParams.get('contract_id');

    if (request.method === 'GET') {
      if (!contractId) {
        return jsonResponse({ ok: false, error: 'contractId query param is required' }, 400);
      }

      const stmt = env.DB.prepare(`
        SELECT * FROM transactions 
        WHERE contract_id = ? 
        ORDER BY installment_number ASC, date ASC
      `);
      const { results } = await stmt.bind(contractId).all();

      const mapped = (results || []).map(mapTransactionDbToFrontend);
      return jsonResponse({ ok: true, data: mapped });
    }

    if (request.method === 'POST') {
      const body = await request.json() as Record<string, any>;
      const targetContractId = body.contractId || body.contract_id || contractId;

      if (!targetContractId) {
        return jsonResponse({ ok: false, error: 'contractId is required' }, 400);
      }

      const record = mapTransactionFrontendToDb({ ...body, contractId: targetContractId });

      await env.DB.prepare(`
        INSERT INTO transactions (
          id, contract_id, date, installment_number, amount,
          type, method, observation, status, receipt_key,
          receipt_file_name, receipt_mime_type, created_by,
          created_by_email, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.id,
        record.contract_id,
        record.date,
        record.installment_number,
        record.amount,
        record.type,
        record.method,
        record.observation,
        record.status,
        record.receipt_key,
        record.receipt_file_name,
        record.receipt_mime_type,
        record.created_by,
        record.created_by_email,
        record.created_at,
        record.updated_at
      ).run();

      return jsonResponse({ ok: true, id: record.id, message: 'Transaction created successfully' }, 201);
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) {
        return jsonResponse({ ok: false, error: 'Transaction id query parameter is required' }, 400);
      }

      await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
      return jsonResponse({ ok: true, message: 'Transaction deleted successfully' });
    }

    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  } catch (err: any) {
    return jsonResponse({ ok: false, error: err?.message || 'Internal server error' }, 500);
  }
}

