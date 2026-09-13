/**
 * ============================================================================
 * ETN / VENDA DE APARTAMENTOS — CLOUDFLARE WORKER API
 * ============================================================================
 * ETAPA 3: AUTENTICAÇÃO DO WORKER + USERS D1 + OWNERSHIP
 * 
 * NOTAS DE SEGURANÇA E ARQUITETURA:
 * 1. AUTENTICAÇÃO: Validação criptográfica do Firebase ID Token (RS256) via
 *    chaves públicas oficiais do Google (com cache de Cache-Control / max-age).
 * 2. IDENTIDADE E USERS: users.id = Firebase UID. Sincronização idempotente
 *    em syncAuthenticatedUser(). Role padrão 'client', imutável pelo frontend.
 * 3. OWNERSHIP: Helpers getOwnedContract() e getOwnedContractTransactions()
 *    implementados para blindagem contra IDOR.
 * 4. FAIL-CLOSED: /api/v1/contracts e /api/v1/transactions PERMANECEM
 *    bloqueados retornando HTTP 503 com D1_PERSISTENCE_NOT_ENABLED.
 * 5. FONTE DA VERDADE ATIVA: Firebase Firestore continua sendo a persistência
 *    ativa no frontend.
 * ============================================================================
 */

/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB?: D1Database;
  RECEIPTS?: R2Bucket;
  ASSETS?: Fetcher;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_JWKS_URL?: string;
}

export class AuthError extends Error {
  code: string;
  constructor(code = 'UNAUTHORIZED', message = 'Unauthorized') {
    super(message);
    this.code = code;
    this.name = 'AuthError';
  }
}

export interface AuthUser {
  uid: string;
  email?: string;
  name?: string;
}

export interface DbUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at?: string;
  updated_at?: string;
}

export function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function decodeJwtPart<T = any>(str: string): T {
  const bytes = base64UrlDecode(str);
  const decoded = new TextDecoder().decode(bytes);
  return JSON.parse(decoded);
}

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export interface JwkKey {
  kty: string;
  alg?: string;
  use?: string;
  e: string;
  n: string;
  kid: string;
}

let jwkCache: {
  keys: Record<string, JwkKey>;
  cryptoKeys: Record<string, CryptoKey>;
  expiresAt: number;
} | null = null;

export async function getGooglePublicKeys(customUrl?: string): Promise<Record<string, JwkKey>> {
  const url = customUrl || GOOGLE_JWKS_URL;
  const now = Date.now();
  if (jwkCache && !customUrl && now < jwkCache.expiresAt) {
    return jwkCache.keys;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new AuthError('UNAUTHORIZED', `Failed to fetch public keys: status ${res.status}`);
  }

  let maxAge = 3600;
  const cacheControl = res.headers.get('cache-control');
  if (cacheControl) {
    const match = cacheControl.match(/max-age=(\d+)/i);
    if (match && match[1]) {
      maxAge = parseInt(match[1], 10);
    }
  }

  const data = (await res.json()) as { keys?: JwkKey[] };
  const keysMap: Record<string, JwkKey> = {};
  if (Array.isArray(data.keys)) {
    for (const key of data.keys) {
      if (key.kid) {
        keysMap[key.kid] = key;
      }
    }
  }

  jwkCache = {
    keys: keysMap,
    cryptoKeys: {},
    expiresAt: now + maxAge * 1000,
  };

  return keysMap;
}

export function clearJwksCache(): void {
  jwkCache = null;
}

/**
 * Validates a Firebase ID token cryptographically using RS256 and Google public keys.
 */
export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  customJwksUrl?: string
): Promise<AuthUser> {
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    throw new AuthError('UNAUTHORIZED', 'Missing Firebase project ID configuration');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AuthError('UNAUTHORIZED', 'Invalid JWT structure');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: any;
  let payload: any;
  try {
    header = decodeJwtPart(headerB64);
    payload = decodeJwtPart(payloadB64);
  } catch (_e) {
    throw new AuthError('UNAUTHORIZED', 'Invalid token encoding');
  }

  // 1. Algoritmo esperado: RS256 e presença de kid
  if (header.alg !== 'RS256') {
    throw new AuthError('UNAUTHORIZED', 'Invalid algorithm: expected RS256');
  }
  if (!header.kid || typeof header.kid !== 'string') {
    throw new AuthError('UNAUTHORIZED', 'Missing key ID (kid) in header');
  }

  // 2. Validações de claims
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new AuthError('UNAUTHORIZED', 'Token has expired');
  }
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) {
    throw new AuthError('UNAUTHORIZED', 'Token iat is in the future');
  }
  if (payload.aud !== projectId) {
    throw new AuthError('UNAUTHORIZED', 'Token audience does not match project ID');
  }
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIssuer) {
    throw new AuthError('UNAUTHORIZED', 'Token issuer does not match expected URL');
  }
  const uid = payload.sub || payload.user_id;
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    throw new AuthError('UNAUTHORIZED', 'Token subject/UID is missing or empty');
  }

  // 3. Obtenção da chave pública correspondente ao kid
  let keys = await getGooglePublicKeys(customJwksUrl);
  let jwk = keys[header.kid];
  if (!jwk) {
    clearJwksCache();
    keys = await getGooglePublicKeys(customJwksUrl);
    jwk = keys[header.kid];
    if (!jwk) {
      throw new AuthError('UNAUTHORIZED', 'Unknown key ID');
    }
  }

  // 4. Verificação criptográfica da assinatura RS256
  let cryptoKey = jwkCache?.cryptoKeys[header.kid];
  if (!cryptoKey) {
    try {
      cryptoKey = await crypto.subtle.importKey(
        'jwk',
        {
          kty: 'RSA',
          e: jwk.e,
          n: jwk.n,
          alg: 'RS256',
          ext: true,
        },
        {
          name: 'RSASSA-PKCS1-v1_5',
          hash: { name: 'SHA-256' },
        },
        false,
        ['verify']
      );
      if (jwkCache) {
        jwkCache.cryptoKeys[header.kid] = cryptoKey;
      }
    } catch (_e) {
      throw new AuthError('UNAUTHORIZED', 'Failed to import public key');
    }
  }

  const dataToVerify = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(signatureB64);
  } catch (_e) {
    throw new AuthError('UNAUTHORIZED', 'Malformed signature');
  }

  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signatureBytes,
    dataToVerify
  );

  if (!isValid) {
    throw new AuthError('UNAUTHORIZED', 'Invalid cryptographic signature');
  }

  return {
    uid,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
  };
}

/**
 * Central auth helper for all protected endpoints.
 */
export async function requireAuth(request: Request, env: Env): Promise<AuthUser> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('UNAUTHORIZED', 'Missing or invalid Authorization header');
  }
  const token = authHeader.substring(7).trim();
  if (!token) {
    throw new AuthError('UNAUTHORIZED', 'Empty bearer token');
  }

  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('[Worker Auth] FIREBASE_PROJECT_ID is not configured in Worker environment');
    throw new AuthError('UNAUTHORIZED', 'Authentication provider not configured');
  }

  return verifyFirebaseIdToken(token, projectId, env.FIREBASE_JWKS_URL);
}

/**
 * Synchronizes the authenticated Firebase user with the D1 users table.
 * Idempotent, safe, and protects role from client manipulation.
 */
export async function syncAuthenticatedUser(db: D1Database, user: AuthUser): Promise<DbUser> {
  const existing = await db
    .prepare('SELECT id, email, name, role FROM users WHERE id = ?')
    .bind(user.uid)
    .first<DbUser>();

  const email = user.email || '';
  const name = user.name || null;

  if (!existing) {
    await db
      .prepare(
        "INSERT INTO users (id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, 'client', datetime('now'), datetime('now'))"
      )
      .bind(user.uid, email, name)
      .run();

    return {
      id: user.uid,
      email,
      name,
      role: 'client',
    };
  }

  // Update existing user: update email, name, and updated_at. NEVER alter role!
  await db
    .prepare(
      "UPDATE users SET email = COALESCE(NULLIF(?, ''), email), name = COALESCE(?, name), updated_at = datetime('now') WHERE id = ?"
    )
    .bind(email, name, user.uid)
    .run();

  return {
    id: existing.id,
    email: email || existing.email,
    name: name ?? existing.name,
    role: existing.role,
  };
}

/**
 * Helper to fetch a contract verifying ownership (IDOR protection).
 * Returns null if contract does not exist OR belongs to another user.
 */
export async function getOwnedContract(db: D1Database, contractId: string, uid: string) {
  const row = await db
    .prepare('SELECT * FROM contracts WHERE id = ? AND user_id = ?')
    .bind(contractId, uid)
    .first<Record<string, any>>();
  return row || null;
}

/**
 * Helper to query transactions verifying ownership through the parent contract.
 */
export async function getOwnedContractTransactions(db: D1Database, contractId: string, uid: string) {
  const { results } = await db
    .prepare(`
      SELECT t.* FROM transactions t
      JOIN contracts c ON c.id = t.contract_id
      WHERE t.contract_id = ? AND c.user_id = ?
      ORDER BY t.installment_number ASC, t.date ASC
    `)
    .bind(contractId, uid)
    .all<Record<string, any>>();
  return results || [];
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

export function mapContractFrontendToDb(payload: Record<string, any>, defaultId?: string) {
  const now = new Date().toISOString();
  return {
    id: payload.id || defaultId || crypto.randomUUID(),
    user_id: payload.ownerId ?? payload.userId ?? payload.user_id ?? null,
    name: payload.name || '',
    property_description: payload.propertyDescription ?? payload.property_description ?? null,
    financed_amount: moneyToCents(payload.financedAmount ?? payload.financed_amount ?? 0),
    fixed_installment: moneyToCents(payload.fixedInstallment ?? payload.fixed_installment ?? 0),
    annual_interest_rate: Number(payload.annualInterestRate ?? payload.annual_interest_rate ?? 0),
    term_months: Number(payload.termMonths ?? payload.term_months ?? 0),
    start_date: payload.startDate || payload.start_date || now.split('T')[0],
    fine_percent: Number(payload.finePercent ?? payload.fine_percent ?? 0),
    tr_mode: payload.trMode || payload.tr_mode || 'ANNUAL',
    created_at: payload.createdAt || payload.created_at || now,
    updated_at: now,
  };
}

export interface FrontendTransaction {
  id?: string;
  contractId: string;
  date: string;
  installmentNumber: number;
  amount: number;
  type: 'PAYMENT' | 'LANCE';
  method?: string;
  observation?: string;
  status?: string;
  receiptKey?: string;
  receiptFileName?: string;
  receiptMimeType?: string;
  createdBy?: string;
  createdByEmail?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function mapTransactionDbToFrontend(row: Record<string, any>): FrontendTransaction {
  return {
    id: row.id,
    contractId: row.contract_id || row.contractId || '',
    date: row.date || '',
    installmentNumber: Number(row.installment_number ?? row.installmentNumber ?? 1),
    amount: centsToMoney(row.amount ?? 0),
    type: (row.type || 'PAYMENT') as 'PAYMENT' | 'LANCE',
    method: row.method || 'PIX',
    observation: row.observation ?? undefined,
    status: row.status || 'PAGO',
    receiptKey: row.receipt_key ?? row.receiptKey ?? undefined,
    receiptFileName: row.receipt_file_name ?? row.receiptFileName ?? undefined,
    receiptMimeType: row.receipt_mime_type ?? row.receiptMimeType ?? undefined,
    createdBy: row.created_by ?? row.createdBy ?? undefined,
    createdByEmail: row.created_by_email ?? row.createdByEmail ?? undefined,
    createdAt: row.created_at || row.createdAt || undefined,
    updatedAt: row.updated_at || row.updatedAt || undefined,
  };
}

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

export function getCorsHeaders(request: Request, _env?: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  let allowedOrigin = '*';

  if (origin) {
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin);
    const isCloudflare = origin.endsWith('.workers.dev') || origin.endsWith('.pages.dev');
    const isGoogleCloud = origin.endsWith('.run.app');

    if (isLocal || isCloudflare || isGoogleCloud) {
      allowedOrigin = origin;
    }
  }

  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data: unknown, status = 200, request?: Request, env?: Env): Response {
  const headers = request ? getCorsHeaders(request, env) : {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function handleCors(request: Request, env: Env): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request, env),
    });
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const cors = handleCors(request, env);
    if (cors) return cors;

    const url = new URL(request.url);
    const { pathname } = url;

    // 1. Health check endpoint
    if (pathname === '/api/v1/health' && request.method === 'GET') {
      return jsonResponse({
        ok: true,
        service: 'venda-apartamentos',
        runtime: 'cloudflare-workers',
      }, 200, request, env);
    }

    // 2. Database Health check endpoint (read-only D1 connectivity & schema check)
    if (pathname === '/api/v1/db/health' && request.method === 'GET') {
      return handleDbHealth(request, env);
    }

    // 3. Auth Me endpoint (/api/v1/auth/me)
    if (pathname === '/api/v1/auth/me') {
      if (request.method === 'GET') {
        return handleAuthMe(request, env);
      }
      return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request, env);
    }

    // 4. Contracts endpoints (/api/v1/contracts)
    if (pathname.startsWith('/api/v1/contracts')) {
      return handleContracts(request, env, url);
    }

    // 5. Transactions endpoints (/api/v1/transactions)
    if (pathname.startsWith('/api/v1/transactions')) {
      return handleTransactions(request, env, url);
    }

    // 6. Static assets handling
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * Handle database health check: strictly read-only, does not expose data.
 */
async function handleDbHealth(request: Request, env: Env): Promise<Response> {
  const databaseName = 'venda-apartamentos-db';
  if (!env.DB) {
    return jsonResponse(
      {
        ok: false,
        database: databaseName,
        connected: false,
      },
      503,
      request,
      env
    );
  }

  try {
    await env.DB.prepare('SELECT 1').run();

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
    }, 200, request, env);
  } catch (_err) {
    return jsonResponse(
      {
        ok: false,
        database: databaseName,
        connected: false,
      },
      503,
      request,
      env
    );
  }
}

/**
 * Handle /api/v1/auth/me:
 * 1. Validate Firebase ID token cryptographically
 * 2. Idempotently sync authenticated user into users D1
 * 3. Return user profile from D1
 */
async function handleAuthMe(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await requireAuth(request, env);
    if (!env.DB) {
      return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
    }
    const syncedUser = await syncAuthenticatedUser(env.DB, authUser);
    return jsonResponse({
      ok: true,
      user: {
        id: syncedUser.id,
        email: syncedUser.email,
        name: syncedUser.name,
        role: syncedUser.role,
      },
    }, 200, request, env);
  } catch (err: any) {
    return jsonResponse({ ok: false, code: 'UNAUTHORIZED' }, 401, request, env);
  }
}

/**
 * Handle contracts endpoints
 */
async function handleContracts(request: Request, env: Env, url: URL): Promise<Response> {
  // =========================================================================
  // BARREIRA DE SEGURANÇA (FAIL-CLOSED)
  // Contratos permanecem bloqueados nesta etapa (sem migração financeira ainda).
  // =========================================================================
  const D1_PERSISTENCE_ENABLED = false;
  if (!D1_PERSISTENCE_ENABLED) {
    return jsonResponse(
      {
        ok: false,
        code: 'D1_PERSISTENCE_NOT_ENABLED',
        message: 'Persistência D1 ainda não habilitada para produção.',
      },
      503,
      request,
      env
    );
  }

  if (!env.DB) {
    return jsonResponse(
      {
        ok: false,
        error: 'Cloudflare D1 binding "DB" is not configured yet.',
      },
      503,
      request,
      env
    );
  }

  try {
    const authUser = await requireAuth(request, env);
    const parts = url.pathname.replace('/api/v1/contracts', '').split('/').filter(Boolean);
    const contractId = parts[0] || url.searchParams.get('id');

    if (request.method === 'GET') {
      if (contractId) {
        const contract = await getOwnedContract(env.DB, contractId, authUser.uid);
        if (!contract) {
          return jsonResponse({ ok: false, error: 'Contract not found' }, 404, request, env);
        }
        return jsonResponse({ ok: true, data: mapContractDbToFrontend(contract) }, 200, request, env);
      } else {
        const stmt = env.DB.prepare('SELECT * FROM contracts WHERE user_id = ? ORDER BY created_at DESC');
        const { results } = await stmt.bind(authUser.uid).all();
        return jsonResponse({ ok: true, data: (results || []).map(mapContractDbToFrontend) }, 200, request, env);
      }
    }

    if (request.method === 'POST') {
      const body = (await request.json()) as Record<string, any>;
      const record = mapContractFrontendToDb(body);
      record.user_id = authUser.uid; // Enforce authenticated owner

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

      return jsonResponse({ ok: true, id: record.id, message: 'Contract created successfully' }, 201, request, env);
    }

    if (request.method === 'PUT') {
      const body = (await request.json()) as Record<string, any>;
      const targetId = contractId || body.id;
      if (!targetId) {
        return jsonResponse({ ok: false, error: 'Contract ID is required' }, 400, request, env);
      }

      const existing = await getOwnedContract(env.DB, targetId, authUser.uid);
      if (!existing) {
        return jsonResponse({ ok: false, error: 'Contract not found' }, 404, request, env);
      }

      const now = new Date().toISOString();
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
        WHERE id = ? AND user_id = ?
      `).bind(
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
        targetId,
        authUser.uid
      ).run();

      return jsonResponse({ ok: true, message: 'Contract updated successfully' }, 200, request, env);
    }

    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request, env);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, code: 'UNAUTHORIZED' }, 401, request, env);
    }
    return jsonResponse({ ok: false, error: err?.message || 'Internal server error' }, 500, request, env);
  }
}

/**
 * Handle transactions endpoints
 */
async function handleTransactions(request: Request, env: Env, url: URL): Promise<Response> {
  // =========================================================================
  // BARREIRA DE SEGURANÇA (FAIL-CLOSED)
  // Transações permanecem bloqueadas nesta etapa (sem migração financeira ainda).
  // =========================================================================
  const D1_PERSISTENCE_ENABLED = false;
  if (!D1_PERSISTENCE_ENABLED) {
    return jsonResponse(
      {
        ok: false,
        code: 'D1_PERSISTENCE_NOT_ENABLED',
        message: 'Persistência D1 ainda não habilitada para produção.',
      },
      503,
      request,
      env
    );
  }

  if (!env.DB) {
    return jsonResponse(
      {
        ok: false,
        error: 'Cloudflare D1 binding "DB" is not configured yet.',
      },
      503,
      request,
      env
    );
  }

  try {
    const authUser = await requireAuth(request, env);
    const contractId = url.searchParams.get('contractId') || url.searchParams.get('contract_id');

    if (request.method === 'GET') {
      if (!contractId) {
        return jsonResponse({ ok: false, error: 'contractId query param is required' }, 400, request, env);
      }

      const owned = await getOwnedContract(env.DB, contractId, authUser.uid);
      if (!owned) {
        return jsonResponse({ ok: false, error: 'Contract not found' }, 404, request, env);
      }

      const results = await getOwnedContractTransactions(env.DB, contractId, authUser.uid);
      const mapped = (results || []).map(mapTransactionDbToFrontend);
      return jsonResponse({ ok: true, data: mapped }, 200, request, env);
    }

    if (request.method === 'POST') {
      const body = (await request.json()) as Record<string, any>;
      const targetContractId = body.contractId || body.contract_id || contractId;

      if (!targetContractId) {
        return jsonResponse({ ok: false, error: 'contractId is required' }, 400, request, env);
      }

      const owned = await getOwnedContract(env.DB, targetContractId, authUser.uid);
      if (!owned) {
        return jsonResponse({ ok: false, error: 'Contract not found' }, 404, request, env);
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
        authUser.uid,
        authUser.email || record.created_by_email,
        record.created_at,
        record.updated_at
      ).run();

      return jsonResponse({ ok: true, id: record.id, message: 'Transaction created successfully' }, 201, request, env);
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) {
        return jsonResponse({ ok: false, error: 'Transaction id query parameter is required' }, 400, request, env);
      }

      const res = await env.DB.prepare(`
        DELETE FROM transactions 
        WHERE id = ? AND contract_id IN (
          SELECT id FROM contracts WHERE user_id = ?
        )
      `).bind(id, authUser.uid).run();

      if (res.meta && res.meta.changes === 0) {
        return jsonResponse({ ok: false, error: 'Transaction not found' }, 404, request, env);
      }

      return jsonResponse({ ok: true, message: 'Transaction deleted successfully' }, 200, request, env);
    }

    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request, env);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, code: 'UNAUTHORIZED' }, 401, request, env);
    }
    return jsonResponse({ ok: false, error: err?.message || 'Internal server error' }, 500, request, env);
  }
}
