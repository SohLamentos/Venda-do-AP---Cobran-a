/**
 * ============================================================================
 * ETN / VENDA DE APARTAMENTOS — CLOUDFLARE WORKER API
 * ============================================================================
 * ETAPA 3B: AUTENTICAÇÃO NATIVA CLOUDFLARE + D1 (ADMIN + CLIENTES)
 * 
 * NOTAS DE SEGURANÇA E ARQUITETURA:
 * 1. AUTENTICAÇÃO DEFINITIVA: NATIVA CLOUDFLARE + D1.
 * 2. HASH DE SENHA: PBKDF2-HMAC-SHA256 (310.000 iterações, salt 16 bytes, chave 32 bytes)
 *    via Web Crypto API. Formato: pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>.
 * 3. SESSÕES: Servidor com token opaco (32 bytes aleatórios). Somente o hash SHA-256
 *    do token é salvo na tabela `auth_sessions`. Cookie HttpOnly, SameSite=Lax, Secure.
 * 4. BOOTSTRAP DO PRIMEIRO ADMIN: POST /api/v1/admin/bootstrap protegido por secret
 *    ADMIN_BOOTSTRAP_TOKEN. Bloqueia após primeiro ADMIN ser criado.
 * 5. RATE LIMITING: Proteção brute force via `auth_login_attempts` (máx 5 falhas / 15 min).
 * 6. TIMING ATTACKS: Dummy hash executado em emails inexistentes para equiparar tempo.
 * 7. AUDITORIA: Registro de eventos de autenticação e gestão na tabela `audit_logs`.
 * 8. FAIL-CLOSED: /api/v1/contracts e /api/v1/transactions PERMANECEM
 *    bloqueados retornando HTTP 503 com D1_PERSISTENCE_NOT_ENABLED.
 * ============================================================================
 */

/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB?: D1Database;
  RECEIPTS?: R2Bucket;
  ASSETS?: Fetcher;
  ADMIN_BOOTSTRAP_TOKEN?: string;
  // Mantidos temporariamente para fallback / rollback se necessário
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_JWKS_URL?: string;
}

export class AuthError extends Error {
  code: string;
  status: number;
  constructor(code = 'UNAUTHORIZED', message = 'Não autorizado', status = 401) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'AuthError';
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: 'ADMIN' | 'CLIENT';
  sessionId?: string;
  tokenHash?: string;
}

export interface DbUser {
  id: string;
  email: string;
  name: string | null;
  role: 'ADMIN' | 'CLIENT';
  status: 'ACTIVE' | 'DISABLED';
  password_hash: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
}

const SESSION_COOKIE_NAME = 'venda_ap_session';
const SESSION_DURATION_SECONDS = 7 * 24 * 3600; // 7 dias
const PBKDF2_ITERATIONS = 310000;
const DUMMY_HASH = 'pbkdf2_sha256$310000$c2FsdHNhbHRzYWx0MTY=$dGVzdGR1bW15aGFzaHZhbHVlZm9ydGltaW5n';

// ============================================================================
// HELPERS CRIPTOGRÁFICOS (PBKDF2, SHA-256, TOKENS)
// ============================================================================

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return toHex(new Uint8Array(hashBuffer));
}

export function generateRandomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toHex(bytes);
}

export function validatePasswordPolicy(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Senha é obrigatória.' };
  }
  if (password.length < 10) {
    return { valid: false, error: 'A senha deve ter no mínimo 10 caracteres.' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'A senha deve ter no máximo 128 caracteres.' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: 'A senha deve conter pelo menos uma letra.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'A senha deve conter pelo menos um número.' };
  }
  return { valid: true };
}

export function constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Cria hash de senha seguro usando PBKDF2-HMAC-SHA256 via Web Crypto.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 bytes
  );

  const saltB64 = base64Encode(salt);
  const hashB64 = base64Encode(new Uint8Array(derivedBits));

  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

/**
 * Verifica senha contra hash armazenado com comparação em tempo constante.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
      return false;
    }

    const iterations = parseInt(parts[1], 10);
    const salt = base64Decode(parts[2]);
    const expectedHashBytes = base64Decode(parts[3]);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );

    return constantTimeCompare(new Uint8Array(derivedBits), expectedHashBytes);
  } catch (_e) {
    return false;
  }
}

// ============================================================================
// COOKIE & CORS HELPERS
// ============================================================================

export function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return {};

  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [name, ...valueParts] = pair.trim().split('=');
    if (name) {
      cookies[name] = decodeURIComponent(valueParts.join('='));
    }
  }
  return cookies;
}

export function isRequestSecure(request: Request): boolean {
  return request.url.startsWith('https://') || request.headers.get('x-forwarded-proto') === 'https';
}

export function buildSessionCookie(token: string, request: Request, maxAge = SESSION_DURATION_SECONDS): string {
  const secureFlag = isRequestSecure(request) ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=${maxAge}`;
}

export function buildClearCookie(request: Request): string {
  const secureFlag = isRequestSecure(request) ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=0`;
}

export function isAllowedOrigin(origin: string | null, requestUrl: string): boolean {
  if (!origin) return true; // Requisições locais/sem origin (como mobile ou curl direto)

  try {
    const reqUrl = new URL(requestUrl);
    if (origin === reqUrl.origin) return true;
  } catch (_e) {}

  // Origens oficiais e seguras
  if (origin === 'https://venda-apartamentos.persistentesoficial365.workers.dev') return true;
  if (origin.endsWith('.workers.dev') || origin.endsWith('.pages.dev')) return true;
  if (origin.endsWith('.run.app')) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin)) return true;

  return false;
}

export function getCorsHeaders(request: Request, _env?: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowed = isAllowedOrigin(origin, request.url);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (origin && allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else if (!origin) {
    headers['Access-Control-Allow-Origin'] = '*';
  }

  return headers;
}

export function validateCsrf(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }

  const origin = request.headers.get('Origin');
  if (origin) {
    return isAllowedOrigin(origin, request.url);
  }

  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  if (secFetchSite && secFetchSite === 'cross-site') {
    return false;
  }

  return true;
}

function jsonResponse(
  data: unknown,
  status = 200,
  request?: Request,
  env?: Env,
  extraHeaders?: Record<string, string>
): Response {
  const baseHeaders = request ? getCorsHeaders(request, env) : {
    'Content-Type': 'application/json',
  };

  const finalHeaders = {
    ...baseHeaders,
    ...(extraHeaders || {}),
  };

  return new Response(JSON.stringify(data), {
    status,
    headers: finalHeaders,
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

// ============================================================================
// AUDIT LOGS & RATE LIMITING
// ============================================================================

export async function logAuditEvent(
  db: D1Database | undefined,
  userId: string | null,
  action: string,
  details?: string,
  ipAddress?: string
): Promise<void> {
  if (!db) return;
  try {
    const id = crypto.randomUUID();
    await db
      .prepare(`
        INSERT INTO audit_logs (id, contract_id, user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, NULL, ?, ?, 'USER', ?, ?, ?, datetime('now'))
      `)
      .bind(id, userId, action, userId || 'SYSTEM', details ?? null, ipAddress ?? null)
      .run();
  } catch (err) {
    console.error('[AuditLog] Erro ao gravar log:', err);
  }
}

export async function checkRateLimit(
  db: D1Database,
  email: string,
  ip: string
): Promise<{ allowed: boolean; count: number }> {
  try {
    const result = await db
      .prepare(`
        SELECT COUNT(*) as failed_count FROM auth_login_attempts
        WHERE (email = ? OR ip_address = ?)
          AND success = 0
          AND attempted_at > datetime('now', '-15 minutes')
      `)
      .bind(email, ip)
      .first<{ failed_count: number }>();

    const count = Number(result?.failed_count ?? 0);
    return { allowed: count < 5, count };
  } catch (_err) {
    return { allowed: true, count: 0 };
  }
}

export async function recordLoginAttempt(
  db: D1Database,
  email: string,
  ip: string,
  success: boolean
): Promise<void> {
  try {
    const id = crypto.randomUUID();
    await db
      .prepare(`
        INSERT INTO auth_login_attempts (id, email, ip_address, attempted_at, success)
        VALUES (?, ?, ?, datetime('now'), ?)
      `)
      .bind(id, email, ip, success ? 1 : 0)
      .run();

    // Limpeza de tentativas com mais de 24h
    await db.prepare("DELETE FROM auth_login_attempts WHERE attempted_at < datetime('now', '-1 day')").run();
  } catch (err) {
    console.warn('[RateLimit] Erro ao registrar tentativa:', err);
  }
}

// ============================================================================
// AUTENTICAÇÃO CENTRAL & RBAC
// ============================================================================

export async function requireSessionUser(request: Request, env: Env): Promise<SessionUser> {
  if (!env.DB) {
    throw new AuthError('DATABASE_UNAVAILABLE', 'Banco de dados não disponível', 503);
  }

  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token || typeof token !== 'string' || !token.trim()) {
    throw new AuthError('UNAUTHORIZED', 'Sessão não encontrada', 401);
  }

  const tokenHash = await sha256Hex(token.trim());

  const sessionRow = await env.DB
    .prepare(`
      SELECT 
        s.id as session_id,
        s.expires_at,
        s.revoked_at,
        s.token_hash,
        u.id as user_id,
        u.email,
        u.name,
        u.role,
        u.status
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `)
    .bind(tokenHash)
    .first<{
      session_id: string;
      expires_at: string;
      revoked_at: string | null;
      token_hash: string;
      user_id: string;
      email: string;
      name: string | null;
      role: 'ADMIN' | 'CLIENT';
      status: 'ACTIVE' | 'DISABLED';
    }>();

  if (!sessionRow) {
    throw new AuthError('UNAUTHORIZED', 'Sessão inválida', 401);
  }

  if (sessionRow.revoked_at !== null) {
    throw new AuthError('UNAUTHORIZED', 'Sessão revogada', 401);
  }

  const now = new Date().toISOString();
  if (sessionRow.expires_at <= now) {
    throw new AuthError('UNAUTHORIZED', 'Sessão expirada', 401);
  }

  if (sessionRow.status !== 'ACTIVE') {
    throw new AuthError('UNAUTHORIZED', 'Usuário desativado', 401);
  }

  // Atualização assíncrona do last_seen_at
  env.DB.prepare("UPDATE auth_sessions SET last_seen_at = datetime('now') WHERE id = ?")
    .bind(sessionRow.session_id)
    .run()
    .catch(() => {});

  return {
    id: sessionRow.user_id,
    email: sessionRow.email,
    name: sessionRow.name,
    role: sessionRow.role,
    sessionId: sessionRow.session_id,
    tokenHash: sessionRow.token_hash,
  };
}

export function requireRole(user: SessionUser, allowedRoles: ('ADMIN' | 'CLIENT')[]): void {
  if (!allowedRoles.includes(user.role)) {
    throw new AuthError('FORBIDDEN', 'Acesso negado para o seu perfil.', 403);
  }
}

// ============================================================================
// OWNERSHIP HELPERS (Preparados para futuras etapas)
// ============================================================================

export async function getOwnedContract(db: D1Database, contractId: string, uid: string) {
  const row = await db
    .prepare('SELECT * FROM contracts WHERE id = ? AND user_id = ?')
    .bind(contractId, uid)
    .first<Record<string, any>>();
  return row || null;
}

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

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * POST /api/v1/auth/login
 */
async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
  }

  const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '127.0.0.1';

  let body: any;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, code: 'INVALID_REQUEST', message: 'JSON inválido' }, 400, request, env);
  }

  const emailRaw = body?.email;
  const password = body?.password;

  if (!emailRaw || typeof emailRaw !== 'string' || !password || typeof password !== 'string') {
    return jsonResponse({ ok: false, code: 'INVALID_CREDENTIALS' }, 401, request, env);
  }

  const email = emailRaw.trim().toLowerCase();

  // 1. Verificação de rate limiting / brute force
  const rateLimit = await checkRateLimit(env.DB, email, clientIp);
  if (!rateLimit.allowed) {
    return jsonResponse(
      {
        ok: false,
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Muitas tentativas de login. Tente novamente mais tarde.',
      },
      429,
      request,
      env
    );
  }

  // 2. Busca do usuário
  const user = await env.DB
    .prepare('SELECT id, email, name, role, status, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<DbUser>();

  // 3. Timing attack protection: se usuário não existe ou está desativado, roda verificação dummy
  if (!user || user.status !== 'ACTIVE') {
    await verifyPassword(password, DUMMY_HASH);
    await recordLoginAttempt(env.DB, email, clientIp, false);
    await logAuditEvent(env.DB, null, 'LOGIN_FAILED', `Falha de login (usuário inexistente ou inativo): ${email}`, clientIp);
    return jsonResponse({ ok: false, code: 'INVALID_CREDENTIALS' }, 401, request, env);
  }

  // 4. Verificação da senha real
  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    await recordLoginAttempt(env.DB, email, clientIp, false);
    await logAuditEvent(env.DB, user.id, 'LOGIN_FAILED', `Senha incorreta para usuário ${email}`, clientIp);
    return jsonResponse({ ok: false, code: 'INVALID_CREDENTIALS' }, 401, request, env);
  }

  // 5. Sucesso: registra tentativa bem-sucedida e cria nova sessão
  await recordLoginAttempt(env.DB, email, clientIp, true);

  const rawToken = generateRandomToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000).toISOString();
  const userAgent = request.headers.get('User-Agent') || null;

  await env.DB
    .prepare(`
      INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, ip_address, user_agent)
      VALUES (?, ?, ?, datetime('now'), ?, datetime('now'), ?, ?)
    `)
    .bind(sessionId, user.id, tokenHash, expiresAt, clientIp, userAgent)
    .run();

  await env.DB
    .prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?")
    .bind(user.id)
    .run();

  await logAuditEvent(env.DB, user.id, 'LOGIN_SUCCESS', `Login efetuado com sucesso para ${email}`, clientIp);

  const cookieHeader = buildSessionCookie(rawToken, request);

  return jsonResponse(
    {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
    200,
    request,
    env,
    { 'Set-Cookie': cookieHeader }
  );
}

/**
 * POST /api/v1/auth/logout
 */
async function handleLogout(request: Request, env: Env): Promise<Response> {
  const clearCookie = buildClearCookie(request);

  if (!env.DB) {
    return jsonResponse({ ok: true }, 200, request, env, { 'Set-Cookie': clearCookie });
  }

  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    try {
      const tokenHash = await sha256Hex(token.trim());
      const session = await env.DB
        .prepare('SELECT id, user_id FROM auth_sessions WHERE token_hash = ?')
        .bind(tokenHash)
        .first<{ id: string; user_id: string }>();

      if (session) {
        await env.DB
          .prepare("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE id = ?")
          .bind(session.id)
          .run();

        const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
        await logAuditEvent(env.DB, session.user_id, 'LOGOUT', 'Usuário efetuou logout', clientIp);
      }
    } catch (_e) {}
  }

  return jsonResponse({ ok: true, message: 'Logout realizado com sucesso.' }, 200, request, env, {
    'Set-Cookie': clearCookie,
  });
}

/**
 * GET /api/v1/auth/me
 */
async function handleAuthMe(request: Request, env: Env): Promise<Response> {
  try {
    const user = await requireSessionUser(request, env);
    return jsonResponse(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
      200,
      request,
      env
    );
  } catch (err: any) {
    return jsonResponse({ ok: false, code: 'UNAUTHORIZED' }, 401, request, env);
  }
}

/**
 * POST /api/v1/auth/change-password
 */
async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  try {
    const user = await requireSessionUser(request, env);
    if (!env.DB) {
      return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
    }

    const body = (await request.json()) as any;
    const { currentPassword, newPassword } = body || {};

    if (!currentPassword || !newPassword) {
      return jsonResponse({ ok: false, code: 'INVALID_REQUEST', message: 'Senha atual e nova senha são obrigatórias.' }, 400, request, env);
    }

    const dbUser = await env.DB
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ password_hash: string }>();

    if (!dbUser) {
      return jsonResponse({ ok: false, code: 'UNAUTHORIZED' }, 401, request, env);
    }

    const validCurrent = await verifyPassword(currentPassword, dbUser.password_hash);
    if (!validCurrent) {
      return jsonResponse({ ok: false, code: 'INVALID_CREDENTIALS', message: 'Senha atual incorreta.' }, 401, request, env);
    }

    const policy = validatePasswordPolicy(newPassword);
    if (!policy.valid) {
      return jsonResponse({ ok: false, code: 'INVALID_PASSWORD', message: policy.error }, 400, request, env);
    }

    const newHash = await hashPassword(newPassword);
    await env.DB
      .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(newHash, user.id)
      .run();

    // Revoga todas as outras sessões do usuário, preservando a atual
    if (user.tokenHash) {
      await env.DB
        .prepare("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND token_hash != ? AND revoked_at IS NULL")
        .bind(user.id, user.tokenHash)
        .run();
    } else {
      await env.DB
        .prepare("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL")
        .bind(user.id)
        .run();
    }

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    await logAuditEvent(env.DB, user.id, 'PASSWORD_CHANGED', 'Senha alterada pelo próprio usuário', clientIp);

    return jsonResponse({ ok: true, message: 'Senha alterada com sucesso.' }, 200, request, env);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, code: err.code, message: err.message }, err.status, request, env);
    }
    return jsonResponse({ ok: false, code: 'INTERNAL_ERROR', message: err?.message || 'Erro interno' }, 500, request, env);
  }
}

/**
 * POST /api/v1/admin/bootstrap
 */
async function handleAdminBootstrap(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
  }

  // 1. Validação estrita do token de bootstrap configurado em Cloudflare secrets
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, code: 'UNAUTHORIZED', message: 'Token de bootstrap ausente.' }, 401, request, env);
  }

  const token = authHeader.substring(7).trim();
  const expectedToken = env.ADMIN_BOOTSTRAP_TOKEN;
  if (!expectedToken || token !== expectedToken) {
    return jsonResponse({ ok: false, code: 'FORBIDDEN', message: 'Token de bootstrap inválido ou não configurado.' }, 403, request, env);
  }

  // 2. Verificar se já existe algum ADMIN ativo
  const adminCheck = await env.DB
    .prepare("SELECT COUNT(*) as admin_count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'")
    .first<{ admin_count: number }>();

  if (adminCheck && Number(adminCheck.admin_count) > 0) {
    return jsonResponse(
      {
        ok: false,
        code: 'ADMIN_ALREADY_EXISTS',
        message: 'Primeiro administrador já existe no sistema.',
      },
      409,
      request,
      env
    );
  }

  // 3. Validação do payload
  let body: any;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, code: 'INVALID_REQUEST', message: 'JSON inválido' }, 400, request, env);
  }

  const { email, name, password } = body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return jsonResponse({ ok: false, code: 'INVALID_EMAIL', message: 'E-mail inválido.' }, 400, request, env);
  }

  const policy = validatePasswordPolicy(password);
  if (!policy.valid) {
    return jsonResponse({ ok: false, code: 'INVALID_PASSWORD', message: policy.error }, 400, request, env);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();

  // 4. Criação do primeiro ADMIN
  await env.DB
    .prepare(`
      INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, 'ADMIN', 'ACTIVE', ?, datetime('now'), datetime('now'))
    `)
    .bind(userId, normalizedEmail, name?.trim() || null, passwordHash)
    .run();

  const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  await logAuditEvent(env.DB, userId, 'USER_CREATED', `Primeiro ADMIN criado via bootstrap: ${normalizedEmail}`, clientIp);

  return jsonResponse(
    {
      ok: true,
      message: 'Primeiro administrador criado com sucesso.',
      user: {
        id: userId,
        email: normalizedEmail,
        name: name?.trim() || null,
        role: 'ADMIN',
      },
    },
    201,
    request,
    env
  );
}

/**
 * GET /api/v1/admin/users
 */
async function handleAdminUsersGet(request: Request, env: Env): Promise<Response> {
  try {
    const user = await requireSessionUser(request, env);
    requireRole(user, ['ADMIN']);

    if (!env.DB) {
      return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
    }

    const { results } = await env.DB
      .prepare(`
        SELECT id, email, name, role, status, created_at, updated_at, last_login_at
        FROM users
        ORDER BY created_at DESC
      `)
      .all();

    return jsonResponse({ ok: true, users: results || [] }, 200, request, env);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, code: err.code, message: err.message }, err.status, request, env);
    }
    return jsonResponse({ ok: false, code: 'INTERNAL_ERROR', message: err?.message || 'Erro interno' }, 500, request, env);
  }
}

/**
 * POST /api/v1/admin/users (Criação de CLIENT)
 */
async function handleAdminUsersPost(request: Request, env: Env): Promise<Response> {
  try {
    const user = await requireSessionUser(request, env);
    requireRole(user, ['ADMIN']);

    if (!env.DB) {
      return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
    }

    const body = (await request.json()) as any;
    const { email, name, password, role } = body || {};

    // Nesta etapa: permitir somente role CLIENT por esta rota
    if (role && role !== 'CLIENT') {
      return jsonResponse(
        { ok: false, code: 'BAD_REQUEST', message: 'Nesta etapa, somente usuários com perfil CLIENT podem ser criados.' },
        400,
        request,
        env
      );
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return jsonResponse({ ok: false, code: 'INVALID_EMAIL', message: 'E-mail inválido.' }, 400, request, env);
    }

    const policy = validatePasswordPolicy(password);
    if (!policy.valid) {
      return jsonResponse({ ok: false, code: 'INVALID_PASSWORD', message: policy.error }, 400, request, env);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Checagem de e-mail duplicado
    const existing = await env.DB
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(normalizedEmail)
      .first<{ id: string }>();

    if (existing) {
      return jsonResponse(
        { ok: false, code: 'EMAIL_ALREADY_EXISTS', message: 'E-mail já cadastrado no sistema.' },
        409,
        request,
        env
      );
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    await env.DB
      .prepare(`
        INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, 'CLIENT', 'ACTIVE', ?, datetime('now'), datetime('now'))
      `)
      .bind(userId, normalizedEmail, name?.trim() || null, passwordHash)
      .run();

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    await logAuditEvent(env.DB, userId, 'USER_CREATED', `Usuário CLIENT criado pelo admin ${user.email}`, clientIp);

    return jsonResponse(
      {
        ok: true,
        user: {
          id: userId,
          email: normalizedEmail,
          name: name?.trim() || null,
          role: 'CLIENT',
          status: 'ACTIVE',
        },
      },
      201,
      request,
      env
    );
  } catch (err: any) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, code: err.code, message: err.message }, err.status, request, env);
    }
    return jsonResponse({ ok: false, code: 'INTERNAL_ERROR', message: err?.message || 'Erro interno' }, 500, request, env);
  }
}

/**
 * PATCH /api/v1/admin/users/:id/status
 */
async function handleAdminUserStatusPatch(request: Request, env: Env, targetUserId: string): Promise<Response> {
  try {
    const user = await requireSessionUser(request, env);
    requireRole(user, ['ADMIN']);

    if (!env.DB) {
      return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
    }

    const body = (await request.json()) as any;
    const { status } = body || {};

    if (status !== 'ACTIVE' && status !== 'DISABLED') {
      return jsonResponse({ ok: false, code: 'BAD_REQUEST', message: 'Status deve ser ACTIVE ou DISABLED.' }, 400, request, env);
    }

    const existing = await env.DB
      .prepare('SELECT id, email, status FROM users WHERE id = ?')
      .bind(targetUserId)
      .first<{ id: string; email: string; status: string }>();

    if (!existing) {
      return jsonResponse({ ok: false, code: 'NOT_FOUND', message: 'Usuário não encontrado.' }, 404, request, env);
    }

    await env.DB
      .prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(status, targetUserId)
      .run();

    // Se desabilitado, revoga todas as sessões ativas
    if (status === 'DISABLED') {
      await env.DB
        .prepare("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL")
        .bind(targetUserId)
        .run();
    }

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    await logAuditEvent(
      env.DB,
      targetUserId,
      status === 'DISABLED' ? 'USER_DISABLED' : 'USER_ENABLED',
      `Status do usuário ${existing.email} alterado para ${status} pelo admin ${user.email}`,
      clientIp
    );

    return jsonResponse({ ok: true, message: 'Status atualizado com sucesso.' }, 200, request, env);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, code: err.code, message: err.message }, err.status, request, env);
    }
    return jsonResponse({ ok: false, code: 'INTERNAL_ERROR', message: err?.message || 'Erro interno' }, 500, request, env);
  }
}

/**
 * POST /api/v1/admin/users/:id/reset-password
 */
async function handleAdminUserResetPasswordPost(request: Request, env: Env, targetUserId: string): Promise<Response> {
  try {
    const user = await requireSessionUser(request, env);
    requireRole(user, ['ADMIN']);

    if (!env.DB) {
      return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
    }

    const body = (await request.json()) as any;
    const { newPassword } = body || {};

    const policy = validatePasswordPolicy(newPassword);
    if (!policy.valid) {
      return jsonResponse({ ok: false, code: 'INVALID_PASSWORD', message: policy.error }, 400, request, env);
    }

    const existing = await env.DB
      .prepare('SELECT id, email FROM users WHERE id = ?')
      .bind(targetUserId)
      .first<{ id: string; email: string }>();

    if (!existing) {
      return jsonResponse({ ok: false, code: 'NOT_FOUND', message: 'Usuário não encontrado.' }, 404, request, env);
    }

    const newHash = await hashPassword(newPassword);

    await env.DB
      .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(newHash, targetUserId)
      .run();

    // Revoga todas as sessões existentes daquele usuário
    await env.DB
      .prepare("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL")
      .bind(targetUserId)
      .run();

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    await logAuditEvent(
      env.DB,
      targetUserId,
      'ADMIN_PASSWORD_RESET',
      `Senha redefinida pelo admin ${user.email}`,
      clientIp
    );

    return jsonResponse({ ok: true, message: 'Senha redefinida com sucesso.' }, 200, request, env);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, code: err.code, message: err.message }, err.status, request, env);
    }
    return jsonResponse({ ok: false, code: 'INTERNAL_ERROR', message: err?.message || 'Erro interno' }, 500, request, env);
  }
}

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

    const requiredTables = ['users', 'contracts', 'transactions', 'audit_logs', 'auth_sessions', 'auth_login_attempts'];
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'contracts', 'transactions', 'audit_logs', 'auth_sessions', 'auth_login_attempts')"
    ).all();

    const foundTables = (results || []).map((row: any) => row.name);
    const schemaReady = requiredTables.every((t) => foundTables.includes(t));

    return jsonResponse(
      {
        ok: true,
        database: databaseName,
        connected: true,
        schemaReady,
      },
      200,
      request,
      env
    );
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
 * Handle contracts endpoints (FAIL-CLOSED: 503)
 */
async function handleContracts(request: Request, env: Env, _url: URL): Promise<Response> {
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

  return jsonResponse({ ok: false, error: 'Unavailable' }, 503, request, env);
}

/**
 * Handle transactions endpoints (FAIL-CLOSED: 503)
 */
async function handleTransactions(request: Request, env: Env, _url: URL): Promise<Response> {
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

  return jsonResponse({ ok: false, error: 'Unavailable' }, 503, request, env);
}

// ============================================================================
// MAIN WORKER FETCH DISPATCHER
// ============================================================================

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const cors = handleCors(request, env);
    if (cors) return cors;

    // Proteção CSRF para requisições com mutação de estado
    if (!validateCsrf(request)) {
      return jsonResponse({ ok: false, code: 'CSRF_FORBIDDEN', message: 'Origem não autorizada.' }, 403, request, env);
    }

    const url = new URL(request.url);
    const { pathname } = url;

    // 1. Health checks
    if (pathname === '/api/v1/health' && request.method === 'GET') {
      return jsonResponse({
        ok: true,
        service: 'venda-apartamentos',
        runtime: 'cloudflare-workers',
      }, 200, request, env);
    }

    if (pathname === '/api/v1/db/health' && request.method === 'GET') {
      return handleDbHealth(request, env);
    }

    // 2. Auth endpoints
    if (pathname === '/api/v1/auth/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    if (pathname === '/api/v1/auth/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }

    if (pathname === '/api/v1/auth/me' && request.method === 'GET') {
      return handleAuthMe(request, env);
    }

    if (pathname === '/api/v1/auth/change-password' && request.method === 'POST') {
      return handleChangePassword(request, env);
    }

    // 3. Admin Bootstrap (Temporário para criação do 1º ADMIN)
    if (pathname === '/api/v1/admin/bootstrap' && request.method === 'POST') {
      return handleAdminBootstrap(request, env);
    }

    // 4. Admin Users Management
    if (pathname === '/api/v1/admin/users') {
      if (request.method === 'GET') {
        return handleAdminUsersGet(request, env);
      }
      if (request.method === 'POST') {
        return handleAdminUsersPost(request, env);
      }
      return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request, env);
    }

    if (pathname.startsWith('/api/v1/admin/users/')) {
      const parts = pathname.replace('/api/v1/admin/users/', '').split('/');
      const targetUserId = parts[0];
      const subAction = parts[1];

      if (targetUserId && subAction === 'status' && request.method === 'PATCH') {
        return handleAdminUserStatusPatch(request, env, targetUserId);
      }

      if (targetUserId && subAction === 'reset-password' && request.method === 'POST') {
        return handleAdminUserResetPasswordPost(request, env, targetUserId);
      }
    }

    // 5. Contracts endpoints (FAIL-CLOSED)
    if (pathname.startsWith('/api/v1/contracts')) {
      return handleContracts(request, env, url);
    }

    // 6. Transactions endpoints (FAIL-CLOSED)
    if (pathname.startsWith('/api/v1/transactions')) {
      return handleTransactions(request, env, url);
    }

    // 7. Static assets handling
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
