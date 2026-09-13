/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB?: D1Database;
  RECEIPTS?: R2Bucket;
  ASSETS?: Fetcher;
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

    // 2. Contracts endpoints (/api/v1/contracts)
    if (pathname.startsWith('/api/v1/contracts')) {
      return handleContracts(request, env, url);
    }

    // 3. Transactions endpoints (/api/v1/transactions)
    if (pathname.startsWith('/api/v1/transactions')) {
      return handleTransactions(request, env, url);
    }

    // 4. Static assets handling (SPA fallback handled via Workers Static Assets)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * Handle contracts endpoints
 */
async function handleContracts(request: Request, env: Env, url: URL): Promise<Response> {
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
        return jsonResponse({ ok: true, data: contract });
      } else {
        const stmt = env.DB.prepare('SELECT * FROM contracts ORDER BY created_at DESC');
        const { results } = await stmt.all();
        return jsonResponse({ ok: true, data: results || [] });
      }
    }

    if (request.method === 'POST') {
      const body = await request.json() as Record<string, any>;
      const id = body.id || crypto.randomUUID();
      const now = new Date().toISOString();

      await env.DB.prepare(`
        INSERT INTO contracts (
          id, user_id, name, property_description, financed_amount, 
          fixed_installment, annual_interest_rate, term_months, 
          start_date, fine_percent, tr_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        body.userId || body.user_id || null,
        body.name || 'Novo Contrato',
        body.propertyDescription || body.property_description || '',
        Number(body.financedAmount ?? body.financed_amount ?? 0),
        Number(body.fixedInstallment ?? body.fixed_installment ?? 0),
        Number(body.annualInterestRate ?? body.annual_interest_rate ?? 0),
        Number(body.termMonths ?? body.term_months ?? 0),
        body.startDate || body.start_date || now.split('T')[0],
        Number(body.finePercent ?? body.fine_percent ?? 0),
        body.trMode || body.tr_mode || 'ANNUAL',
        now,
        now
      ).run();

      return jsonResponse({ ok: true, id, message: 'Contract created successfully' }, 201);
    }

    if (request.method === 'PUT') {
      const body = await request.json() as Record<string, any>;
      const targetId = contractId || body.id;
      if (!targetId) {
        return jsonResponse({ ok: false, error: 'Contract ID is required' }, 400);
      }

      const now = new Date().toISOString();
      await env.DB.prepare(`
        UPDATE contracts SET
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
        body.name ?? null,
        body.propertyDescription ?? body.property_description ?? null,
        body.financedAmount !== undefined ? Number(body.financedAmount) : null,
        body.fixedInstallment !== undefined ? Number(body.fixedInstallment) : null,
        body.annualInterestRate !== undefined ? Number(body.annualInterestRate) : null,
        body.termMonths !== undefined ? Number(body.termMonths) : null,
        body.startDate ?? body.start_date ?? null,
        body.finePercent !== undefined ? Number(body.finePercent) : null,
        body.trMode ?? body.tr_mode ?? null,
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

      // Transform snake_case columns back to frontend camelCase if needed
      const mapped = (results || []).map((row: any) => ({
        id: row.id,
        contractId: row.contract_id,
        date: row.date,
        installmentNumber: row.installment_number,
        amount: row.amount,
        type: row.type,
        method: row.method,
        observation: row.observation,
        status: row.status,
        receiptKey: row.receipt_key,
        receiptFileName: row.receipt_file_name,
        receiptMimeType: row.receipt_mime_type,
        createdBy: row.created_by,
        createdByEmail: row.created_by_email,
        createdAt: row.created_at,
      }));

      return jsonResponse({ ok: true, data: mapped });
    }

    if (request.method === 'POST') {
      const body = await request.json() as Record<string, any>;
      const id = body.id || crypto.randomUUID();
      const targetContractId = body.contractId || body.contract_id || contractId;

      if (!targetContractId) {
        return jsonResponse({ ok: false, error: 'contractId is required' }, 400);
      }

      const now = new Date().toISOString();
      await env.DB.prepare(`
        INSERT INTO transactions (
          id, contract_id, date, installment_number, amount,
          type, method, observation, status, receipt_key,
          receipt_file_name, receipt_mime_type, created_by,
          created_by_email, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        targetContractId,
        body.date || now.split('T')[0],
        Number(body.installmentNumber ?? body.installment_number ?? 1),
        Number(body.amount ?? 0),
        body.type === 'LANCE' ? 'LANCE' : 'PAYMENT',
        body.method || 'PIX',
        body.observation || null,
        body.status || 'PAGO',
        body.receiptKey || body.receipt_key || null,
        body.receiptFileName || body.receipt_file_name || null,
        body.receiptMimeType || body.receipt_mime_type || null,
        body.createdBy || body.created_by || null,
        body.createdByEmail || body.created_by_email || null,
        now,
        now
      ).run();

      return jsonResponse({ ok: true, id, message: 'Transaction created successfully' }, 201);
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
