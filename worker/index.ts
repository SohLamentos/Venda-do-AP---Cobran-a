/**
 * ============================================================================
 * ETN / VENDA DE APARTAMENTOS — CLOUDFLARE WORKER API
 * ============================================================================
 * ETAPA 3B: AUTENTICAÇÃO NATIVA CLOUDFLARE + D1 (ADMIN + CLIENTES)
 * 
 * NOTAS DE SEGURANÇA E ARQUITETURA:
 * 1. AUTENTICAÇÃO DEFINITIVA: NATIVA CLOUDFLARE + D1.
 * 2. HASH DE SENHA: PBKDF2-HMAC-SHA256 (100.000 iterações, salt 16 bytes, chave 32 bytes)
 *    via Web Crypto API. Formato: pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>.
 *    Compatível com o limite máximo do runtime Cloudflare Workers (máx 100.000 iterações).
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
  ENABLE_D1_PERSISTENCE?: string;
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
  login: string;
  email: string | null;
  name: string | null;
  role: 'ADMIN' | 'SELLER' | 'BUYER';
  status?: 'ACTIVE' | 'DISABLED';
  sessionId?: string;
  tokenHash?: string;
}

export interface DbUser {
  id: string;
  login: string;
  email: string | null;
  name: string;
  role: 'ADMIN' | 'SELLER' | 'BUYER';
  status: 'ACTIVE' | 'DISABLED';
  password_hash: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
}

const SESSION_COOKIE_NAME = 'venda_ap_session';
const SESSION_DURATION_SECONDS = 7 * 24 * 3600; // 7 dias
export const PBKDF2_ITERATIONS = 100000;
export const MAX_PBKDF2_ITERATIONS = 100000;
const DUMMY_HASH = 'pbkdf2_sha256$100000$c2FsdHNhbHRzYWx0MTY=$dGVzdGR1bW15aGFzaHZhbHVlZm9ydGltaW5nMTIzNDU2Nw==';

// ============================================================================
// HELPERS CRIPTOGRÁFICOS (PBKDF2, SHA-256, TOKENS, VALIDAÇÃO)
// ============================================================================

export function validateLoginFormat(login: string): { valid: boolean; error?: string } {
  if (!login || typeof login !== 'string') {
    return { valid: false, error: 'Login é obrigatório.' };
  }
  const trimmed = login.trim().toLowerCase();
  if (trimmed.length < 3) {
    return { valid: false, error: 'O login deve ter no mínimo 3 caracteres.' };
  }
  if (trimmed.length > 50) {
    return { valid: false, error: 'O login não pode exceder 50 caracteres.' };
  }
  if (/\s/.test(login)) {
    return { valid: false, error: 'O login não pode conter espaços.' };
  }
  if (!/^[a-z0-9._-]+$/.test(trimmed)) {
    return { valid: false, error: 'O login só pode conter letras minúsculas, números, ponto, traço e underscore.' };
  }
  return { valid: true };
}

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
 * Utiliza 100.000 iterações (limite máximo estritamente suportado pelo Cloudflare Workers),
 * salt criptograficamente aleatório de 16 bytes e chave derivada de 32 bytes (256 bits).
 * Formato: pbkdf2_sha256$100000$<saltBase64>$<hashBase64>
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
 * Suporta contagens de iterações armazenadas no próprio hash até o limite do runtime (100.000 iterações).
 * Para hashes legados ou que excedam o limite suportado pelo runtime Cloudflare (>100.000):
 * Rejeita com fail-closed seguro (retorna false) e log sanitizado, evitando NotSupportedError e HTTP 500.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
      return false;
    }

    const iterations = parseInt(parts[1], 10);
    if (isNaN(iterations) || iterations <= 0) {
      return false;
    }

    // Se o hash armazenado solicitar mais iterações do que o runtime Cloudflare suporta (>100.000):
    // Falha de maneira controlada e segura sem estourar exceção no runtime nem gerar HTTP 500.
    if (iterations > MAX_PBKDF2_ITERATIONS) {
      console.warn('[PBKDF2] Hash legado ou não suportado requer mais iterações do que o runtime suporta:', {
        requestedIterations: iterations,
        maxSupported: MAX_PBKDF2_ITERATIONS,
      });
      return false;
    }

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
      256 // 32 bytes
    );

    return constantTimeCompare(new Uint8Array(derivedBits), expectedHashBytes);
  } catch (err: any) {
    console.error('[PBKDF2] Falha na verificação de senha:', {
      errorName: err?.name,
      errorMessage: err?.message,
    });
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
        INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, ?, ?, 'USER', ?, ?, ?, datetime('now'))
      `)
      .bind(id, userId, action, userId || 'SYSTEM', details ?? null, ipAddress ?? null)
      .run();
  } catch (err: any) {
    console.error('[AuditLog] Erro ao gravar log:', {
      errorName: err?.name,
      errorMessage: err?.message,
    });
  }
}

export async function checkRateLimit(
  db: D1Database,
  login: string,
  ip: string
): Promise<{ allowed: boolean; count: number }> {
  try {
    const result = await db
      .prepare(`
        SELECT COUNT(*) as failed_count FROM auth_login_attempts
        WHERE (login = ? OR ip_address = ?)
          AND success = 0
          AND attempted_at > datetime('now', '-15 minutes')
      `)
      .bind(login, ip)
      .first<{ failed_count: number }>();

    const count = Number(result?.failed_count ?? 0);
    return { allowed: count < 5, count };
  } catch (_err) {
    return { allowed: true, count: 0 };
  }
}

export async function recordLoginAttempt(
  db: D1Database,
  login: string,
  ip: string,
  success: boolean
): Promise<void> {
  try {
    const id = crypto.randomUUID();
    try {
      await db
        .prepare(`
          INSERT INTO auth_login_attempts (id, login, email, ip_address, attempted_at, success)
          VALUES (?, ?, ?, ?, datetime('now'), ?)
        `)
        .bind(id, login, login, ip, success ? 1 : 0)
        .run();
    } catch (_err) {
      await db
        .prepare(`
          INSERT INTO auth_login_attempts (id, login, ip_address, attempted_at, success)
          VALUES (?, ?, ?, datetime('now'), ?)
        `)
        .bind(id, login, ip, success ? 1 : 0)
        .run();
    }

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
        u.login,
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
      login: string;
      email: string | null;
      name: string | null;
      role: 'ADMIN' | 'SELLER' | 'BUYER';
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
    login: sessionRow.login,
    email: sessionRow.email,
    name: sessionRow.name,
    role: sessionRow.role,
    status: sessionRow.status,
    sessionId: sessionRow.session_id,
    tokenHash: sessionRow.token_hash,
  };
}

export function requireRole(user: SessionUser, allowedRoles: ('ADMIN' | 'SELLER' | 'BUYER')[]): void {
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

  await ensureDatabaseSchema(env.DB);

  const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '127.0.0.1';

  let body: any;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, code: 'INVALID_REQUEST', message: 'JSON inválido' }, 400, request, env);
  }

  const loginRaw = body?.login ?? body?.username ?? body?.email;
  const password = body?.password;

  if (!loginRaw || typeof loginRaw !== 'string' || !password || typeof password !== 'string') {
    return jsonResponse({ ok: false, code: 'INVALID_CREDENTIALS' }, 401, request, env);
  }

  const login = loginRaw.trim().toLowerCase();

  // 1. Verificação de rate limiting / brute force
  const rateLimit = await checkRateLimit(env.DB, login, clientIp);
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

  // 2. Busca do usuário por login ou email
  const user = await env.DB
    .prepare('SELECT id, login, email, name, role, status, password_hash FROM users WHERE login = ? OR email = ?')
    .bind(login, login)
    .first<DbUser>();

  const storedHashParts = user?.password_hash ? user.password_hash.split('$').length : 0;
  const storedHashPrefix = user?.password_hash ? user.password_hash.split('$')[0] : '';
  console.log('[LoginDiag]', {
    userFound: !!user,
    role: user?.role,
    status: user?.status,
    storedHashPresent: !!user?.password_hash,
    storedHashPrefix,
    storedHashParts,
    passwordLength: password ? password.length : 0,
  });

  // 3. Timing attack protection & anti-enumeração:
  // Se usuário não existe ou está desativado (DISABLED), executa PBKDF2 equiparável e retorna sempre 401 INVALID_CREDENTIALS
  if (!user || user.status === 'DISABLED') {
    const hashToVerify = user?.password_hash || DUMMY_HASH;
    await verifyPassword(password, hashToVerify);
    await recordLoginAttempt(env.DB, login, clientIp, false);
    if (user && user.status === 'DISABLED') {
      await logAuditEvent(env.DB, user.id, 'LOGIN_FAILED', `Tentativa de login em conta desativada: ${login}`, clientIp);
    } else {
      await logAuditEvent(env.DB, null, 'LOGIN_FAILED', `Falha de login (usuário inexistente): ${login}`, clientIp);
    }
    return jsonResponse({ ok: false, code: 'INVALID_CREDENTIALS' }, 401, request, env);
  }

  // 4. Verificação da senha real
  const passwordValid = await verifyPassword(password, user.password_hash);
  console.log('[LoginDiag] verifyResult:', passwordValid);
  if (!passwordValid) {
    await recordLoginAttempt(env.DB, login, clientIp, false);
    await logAuditEvent(env.DB, user.id, 'LOGIN_FAILED', `Senha incorreta para usuário ${login}`, clientIp);
    return jsonResponse({ ok: false, code: 'INVALID_CREDENTIALS' }, 401, request, env);
  }

  // 5. Sucesso: registra tentativa bem-sucedida e cria nova sessão
  await recordLoginAttempt(env.DB, login, clientIp, true);

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

  await logAuditEvent(env.DB, user.id, 'LOGIN_SUCCESS', `Login efetuado com sucesso para ${login}`, clientIp);

  const cookieHeader = buildSessionCookie(rawToken, request);

  return jsonResponse(
    {
      ok: true,
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
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
          login: user.login,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
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
 * Assegura que o esquema do D1 esteja compatível com login e papéis (ADMIN, SELLER, BUYER)
 */
let schemaChecked = false;
async function ensureDatabaseSchema(db: D1Database): Promise<void> {
  if (schemaChecked) return;
  try {
    const tableInfo = await db.prepare("PRAGMA table_info(users)").all();
    const columns = (tableInfo.results || []).map((r: any) => r.name);
    if (columns.length > 0 && !columns.includes('login')) {
      console.log('[AutoMigration] Migrando tabela users para login e novos papéis...');
      const migrationStmts = [
        db.prepare(`
          CREATE TABLE IF NOT EXISTS users_new (
            id TEXT PRIMARY KEY,
            login TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SELLER', 'BUYER')),
            status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_login_at TEXT
          );
        `),
        db.prepare(`
          INSERT OR IGNORE INTO users_new (id, login, name, email, role, status, password_hash, created_at, updated_at, last_login_at)
          SELECT 
            id,
            LOWER(SUBSTR(email, 1, CASE WHEN INSTR(email, '@') > 0 THEN INSTR(email, '@') - 1 ELSE LENGTH(email) END)),
            COALESCE(name, 'Administrador'),
            email,
            CASE WHEN UPPER(role) = 'ADMIN' THEN 'ADMIN' ELSE 'BUYER' END,
            COALESCE(status, 'ACTIVE'),
            password_hash,
            created_at,
            updated_at,
            last_login_at
          FROM users;
        `),
        db.prepare("DROP TABLE users;"),
        db.prepare("ALTER TABLE users_new RENAME TO users;"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);")
      ];

      if (typeof (db as any).batch === 'function') {
        await (db as any).batch(migrationStmts);
      } else {
        for (const s of migrationStmts) {
          await s.run();
        }
      }
      console.log('[AutoMigration] Migração da tabela users concluída com sucesso.');
    }

    // Checagem auth_login_attempts
    const attemptsInfo = await db.prepare("PRAGMA table_info(auth_login_attempts)").all();
    const attemptCols = (attemptsInfo.results || []).map((r: any) => r.name);
    if (attemptCols.length > 0 && !attemptCols.includes('login')) {
      try {
        await db.prepare("ALTER TABLE auth_login_attempts ADD COLUMN login TEXT").run();
        await db.prepare("CREATE INDEX IF NOT EXISTS idx_auth_attempts_login ON auth_login_attempts(login, attempted_at)").run();
      } catch (_e) {}
    }

    // Checagem contracts (status, activated_at, activated_by)
    const contractsInfo = await db.prepare("PRAGMA table_info(contracts)").all();
    const contractCols = (contractsInfo.results || []).map((r: any) => r.name);
    if (contractCols.length > 0) {
      if (!contractCols.includes('status')) {
        try {
          await db.prepare("ALTER TABLE contracts ADD COLUMN status TEXT NOT NULL DEFAULT 'DRAFT'").run();
          await db.prepare("CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status)").run();
        } catch (_e) {}
      }
      if (!contractCols.includes('activated_at')) {
        try {
          await db.prepare("ALTER TABLE contracts ADD COLUMN activated_at TEXT").run();
        } catch (_e) {}
      }
      if (!contractCols.includes('activated_by')) {
        try {
          await db.prepare("ALTER TABLE contracts ADD COLUMN activated_by TEXT").run();
        } catch (_e) {}
      }
    }
    schemaChecked = true;
  } catch (err) {
    console.warn('[AutoMigration] Schema check aviso:', err);
  }
}

/**
 * POST /api/v1/admin/bootstrap
 */
async function handleAdminBootstrap(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.DB) {
      return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
    }

    await ensureDatabaseSchema(env.DB);

    // 1. Validação estrita do token de bootstrap configurado em Cloudflare secrets
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ ok: false, code: 'UNAUTHORIZED', message: 'Token de bootstrap ausente.' }, 401, request, env);
    }

    const token = authHeader.substring(7).trim();
    const expectedToken = env.ADMIN_BOOTSTRAP_TOKEN ? env.ADMIN_BOOTSTRAP_TOKEN.trim() : '';
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

    const { login, username, name, email, password } = body || {};
    const candidateLogin =
      login ??
      username ??
      (email && typeof email === 'string' && email.includes('@')
        ? email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '')
        : '');

    const loginValidation = validateLoginFormat(candidateLogin);
    if (!loginValidation.valid) {
      return jsonResponse({ ok: false, code: 'INVALID_LOGIN', message: loginValidation.error }, 400, request, env);
    }

    const policy = validatePasswordPolicy(password);
    if (!policy.valid) {
      return jsonResponse({ ok: false, code: 'INVALID_PASSWORD', message: policy.error }, 400, request, env);
    }

    const normalizedLogin = candidateLogin.trim().toLowerCase();
    const normalizedEmail = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;

    if (normalizedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        return jsonResponse({ ok: false, code: 'INVALID_EMAIL', message: 'E-mail inválido.' }, 400, request, env);
      }
      const existingEmail = await env.DB
        .prepare('SELECT id FROM users WHERE email = ?')
        .bind(normalizedEmail)
        .first<{ id: string }>();

      if (existingEmail) {
        return jsonResponse({ ok: false, code: 'EMAIL_ALREADY_EXISTS', message: 'E-mail já cadastrado.' }, 409, request, env);
      }
    }

    // Checagem de login duplicado
    const existingLogin = await env.DB
      .prepare('SELECT id FROM users WHERE login = ?')
      .bind(normalizedLogin)
      .first<{ id: string }>();

    if (existingLogin) {
      return jsonResponse({ ok: false, code: 'LOGIN_ALREADY_EXISTS', message: 'Login já cadastrado.' }, 409, request, env);
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const adminName = name && typeof name === 'string' && name.trim() ? name.trim() : 'Administrador';

    // 4. Criação do primeiro ADMIN
    await env.DB
      .prepare(`
        INSERT INTO users (id, login, name, email, role, status, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'ADMIN', 'ACTIVE', ?, datetime('now'), datetime('now'))
      `)
      .bind(userId, normalizedLogin, adminName, normalizedEmail, passwordHash)
      .run();

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    await logAuditEvent(env.DB, userId, 'USER_CREATED', `Primeiro ADMIN criado via bootstrap: ${normalizedLogin}`, clientIp);

    return jsonResponse(
      {
        ok: true,
        message: 'Primeiro administrador criado com sucesso.',
        user: {
          id: userId,
          login: normalizedLogin,
          name: adminName,
          email: normalizedEmail,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      },
      201,
      request,
      env
    );
  } catch (err: any) {
    console.error('[AdminBootstrap] Erro:', err);
    const errorMessage = err instanceof Error ? err.message : String(err || 'Erro interno');
    return jsonResponse(
      { 
        ok: false, 
        code: 'INTERNAL_ERROR', 
        message: 'Erro ao processar criação do administrador.',
        details: errorMessage 
      },
      500,
      request,
      env
    );
  }
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
        SELECT id, login, name, email, role, status, created_at, updated_at, last_login_at
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
 * POST /api/v1/admin/users (Criação de Usuário com Role)
 */
async function handleAdminUsersPost(request: Request, env: Env): Promise<Response> {
  try {
    const user = await requireSessionUser(request, env);
    requireRole(user, ['ADMIN']);

    if (!env.DB) {
      return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
    }

    const body = (await request.json()) as any;
    const { login, name, email, password, role } = body || {};

    const rawRole = role ? String(role).toUpperCase() : 'BUYER';
    const targetRole = rawRole === 'CLIENT' ? 'BUYER' : rawRole;
    if (!['ADMIN', 'SELLER', 'BUYER'].includes(targetRole)) {
      return jsonResponse(
        { ok: false, code: 'BAD_REQUEST', message: 'Perfil inválido. Deve ser ADMIN, SELLER ou BUYER.' },
        400,
        request,
        env
      );
    }

    const candidateLogin =
      login ??
      (email && typeof email === 'string' && email.includes('@')
        ? email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '')
        : '');

    const loginValidation = validateLoginFormat(candidateLogin);
    if (!loginValidation.valid) {
      return jsonResponse({ ok: false, code: 'INVALID_LOGIN', message: loginValidation.error }, 400, request, env);
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return jsonResponse({ ok: false, code: 'INVALID_NAME', message: 'Nome é obrigatório.' }, 400, request, env);
    }

    const policy = validatePasswordPolicy(password);
    if (!policy.valid) {
      return jsonResponse({ ok: false, code: 'INVALID_PASSWORD', message: policy.error }, 400, request, env);
    }

    const normalizedLogin = candidateLogin.trim().toLowerCase();
    const normalizedEmail = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;

    if (normalizedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        return jsonResponse({ ok: false, code: 'INVALID_EMAIL', message: 'E-mail inválido.' }, 400, request, env);
      }
      const existingEmail = await env.DB
        .prepare('SELECT id FROM users WHERE email = ?')
        .bind(normalizedEmail)
        .first<{ id: string }>();

      if (existingEmail) {
        return jsonResponse({ ok: false, code: 'EMAIL_ALREADY_EXISTS', message: 'E-mail já cadastrado.' }, 409, request, env);
      }
    }

    // Checagem de login duplicado
    const existingLogin = await env.DB
      .prepare('SELECT id FROM users WHERE login = ?')
      .bind(normalizedLogin)
      .first<{ id: string }>();

    if (existingLogin) {
      return jsonResponse(
        { ok: false, code: 'LOGIN_ALREADY_EXISTS', message: 'Login já cadastrado no sistema.' },
        409,
        request,
        env
      );
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    await env.DB
      .prepare(`
        INSERT INTO users (id, login, name, email, role, status, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, datetime('now'), datetime('now'))
      `)
      .bind(userId, normalizedLogin, name.trim(), normalizedEmail, targetRole, passwordHash)
      .run();

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    await logAuditEvent(env.DB, userId, 'USER_CREATED', `Usuário ${targetRole} (${normalizedLogin}) criado pelo admin ${user.login}`, clientIp);

    return jsonResponse(
      {
        ok: true,
        user: {
          id: userId,
          login: normalizedLogin,
          name: name.trim(),
          email: normalizedEmail,
          role: targetRole,
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
 * PATCH /api/v1/admin/users/:id/role
 */
async function handleAdminUserRolePatch(request: Request, env: Env, targetUserId: string): Promise<Response> {
  try {
    const user = await requireSessionUser(request, env);
    requireRole(user, ['ADMIN']);

    if (!env.DB) {
      return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
    }

    const body = (await request.json()) as any;
    const { role } = body || {};

    const targetRole = role ? String(role).toUpperCase() : '';
    if (!['ADMIN', 'SELLER', 'BUYER'].includes(targetRole)) {
      return jsonResponse(
        { ok: false, code: 'BAD_REQUEST', message: 'Perfil inválido. Deve ser ADMIN, SELLER ou BUYER.' },
        400,
        request,
        env
      );
    }

    const existing = await env.DB
      .prepare('SELECT id, login, role, status FROM users WHERE id = ?')
      .bind(targetUserId)
      .first<{ id: string; login: string; role: string; status: string }>();

    if (!existing) {
      return jsonResponse({ ok: false, code: 'NOT_FOUND', message: 'Usuário não encontrado.' }, 404, request, env);
    }

    // Proteção do Último ADMIN
    if (existing.role === 'ADMIN' && targetRole !== 'ADMIN') {
      const adminCountRow = await env.DB
        .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id != ?")
        .bind(targetUserId)
        .first<{ count: number }>();

      const activeAdminsRemaining = Number(adminCountRow?.count ?? 0);
      if (activeAdminsRemaining < 1) {
        return jsonResponse(
          {
            ok: false,
            code: 'LAST_ADMIN_PROTECTION',
            message: 'Não é permitido alterar o perfil do único administrador ativo do sistema.',
          },
          409,
          request,
          env
        );
      }
    }

    await env.DB
      .prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(targetRole, targetUserId)
      .run();

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    await logAuditEvent(
      env.DB,
      targetUserId,
      'USER_ROLE_CHANGED',
      `Perfil do usuário ${existing.login} alterado de ${existing.role} para ${targetRole} pelo admin ${user.login}`,
      clientIp
    );

    return jsonResponse(
      {
        ok: true,
        message: 'Perfil atualizado com sucesso.',
        user: {
          id: targetUserId,
          login: existing.login,
          role: targetRole,
        },
      },
      200,
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
      .prepare('SELECT id, login, role, status FROM users WHERE id = ?')
      .bind(targetUserId)
      .first<{ id: string; login: string; role: string; status: string }>();

    if (!existing) {
      return jsonResponse({ ok: false, code: 'NOT_FOUND', message: 'Usuário não encontrado.' }, 404, request, env);
    }

    // Proteção do Último ADMIN
    if (existing.role === 'ADMIN' && status === 'DISABLED') {
      const adminCountRow = await env.DB
        .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id != ?")
        .bind(targetUserId)
        .first<{ count: number }>();

      const activeAdminsRemaining = Number(adminCountRow?.count ?? 0);
      if (activeAdminsRemaining < 1) {
        return jsonResponse(
          {
            ok: false,
            code: 'LAST_ADMIN_PROTECTION',
            message: 'Não é permitido desativar o único administrador ativo do sistema.',
          },
          409,
          request,
          env
        );
      }
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
      `Status do usuário ${existing.login} alterado para ${status} pelo admin ${user.login}`,
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
 * PATCH /api/v1/admin/users/:id (Edição de dados do usuário)
 */
async function handleAdminUserEditPatch(request: Request, env: Env, targetUserId: string): Promise<Response> {
  try {
    const user = await requireSessionUser(request, env);
    requireRole(user, ['ADMIN']);

    if (!env.DB) {
      return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
    }

    const body = (await request.json()) as any;
    const { name, login, email } = body || {};

    const existing = await env.DB
      .prepare('SELECT id, login, name, email FROM users WHERE id = ?')
      .bind(targetUserId)
      .first<{ id: string; login: string; name: string; email: string | null }>();

    if (!existing) {
      return jsonResponse({ ok: false, code: 'NOT_FOUND', message: 'Usuário não encontrado.' }, 404, request, env);
    }

    let updatedLogin = existing.login;
    if (login !== undefined && login !== null) {
      const loginValidation = validateLoginFormat(login);
      if (!loginValidation.valid) {
        return jsonResponse({ ok: false, code: 'INVALID_LOGIN', message: loginValidation.error }, 400, request, env);
      }
      const normalizedLogin = login.trim().toLowerCase();
      if (normalizedLogin !== existing.login) {
        const duplicateLogin = await env.DB
          .prepare('SELECT id FROM users WHERE login = ? AND id != ?')
          .bind(normalizedLogin, targetUserId)
          .first<{ id: string }>();

        if (duplicateLogin) {
          return jsonResponse({ ok: false, code: 'LOGIN_ALREADY_EXISTS', message: 'Login já cadastrado.' }, 409, request, env);
        }
        updatedLogin = normalizedLogin;
      }
    }

    let updatedEmail = existing.email;
    if (email !== undefined) {
      const trimmed = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
      if (trimmed) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmed)) {
          return jsonResponse({ ok: false, code: 'INVALID_EMAIL', message: 'E-mail inválido.' }, 400, request, env);
        }
        const duplicateEmail = await env.DB
          .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
          .bind(trimmed, targetUserId)
          .first<{ id: string }>();

        if (duplicateEmail) {
          return jsonResponse({ ok: false, code: 'EMAIL_ALREADY_EXISTS', message: 'E-mail já cadastrado.' }, 409, request, env);
        }
        updatedEmail = trimmed;
      } else {
        updatedEmail = null;
      }
    }

    const updatedName = name && typeof name === 'string' && name.trim() ? name.trim() : existing.name;

    await env.DB
      .prepare("UPDATE users SET name = ?, login = ?, email = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(updatedName, updatedLogin, updatedEmail, targetUserId)
      .run();

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    await logAuditEvent(
      env.DB,
      targetUserId,
      'USER_UPDATED',
      `Dados do usuário ${existing.login} atualizados pelo admin ${user.login}`,
      clientIp
    );

    return jsonResponse(
      {
        ok: true,
        message: 'Dados atualizados com sucesso.',
        user: {
          id: targetUserId,
          login: updatedLogin,
          name: updatedName,
          email: updatedEmail,
        },
      },
      200,
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
    const newPassword = body?.newPassword ?? body?.new_password;

    const policy = validatePasswordPolicy(newPassword);
    if (!policy.valid) {
      return jsonResponse({ ok: false, code: 'INVALID_PASSWORD', message: policy.error }, 400, request, env);
    }

    const existing = await env.DB
      .prepare('SELECT id, login FROM users WHERE id = ?')
      .bind(targetUserId)
      .first<{ id: string; login: string }>();

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
      `Senha redefinida pelo admin ${user.login}`,
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
 * Helper to format contract row from database
 */
function formatContractDbRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    propertyDescription: row.property_description || '',
    financedAmount: Number(row.financed_amount || 0),
    fixedInstallment: Number(row.fixed_installment || 0),
    annualInterestRate: Number(row.annual_interest_rate || 0),
    termMonths: Number(row.term_months || 0),
    startDate: row.start_date || '',
    finePercent: Number(row.fine_percent || 0),
    trMode: row.tr_mode || 'ANNUAL',
    status: row.status || 'DRAFT',
    activatedAt: row.activated_at || null,
    activatedBy: row.activated_by || null,
    ownerId: row.user_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Helper to format transaction row from database
 */
function formatTransactionDbRow(row: any) {
  return {
    id: row.id,
    contractId: row.contract_id,
    date: row.date,
    installmentNumber: row.installment_number,
    amount: Number(row.amount || 0),
    type: row.type as 'PAYMENT' | 'LANCE',
    method: row.method || 'PIX',
    observation: row.observation || '',
    status: row.status || 'PAGO',
    receiptKey: row.receipt_key || undefined,
    receiptFileName: row.receipt_file_name || undefined,
    receiptMimeType: row.receipt_mime_type || undefined,
    receiptBase64: row.receipt_key && row.receipt_key.startsWith('data:') ? row.receipt_key : undefined,
    createdBy: row.created_by || undefined,
    createdByEmail: row.created_by_email || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Handle contracts endpoints
 * Default: FAIL-CLOSED (503) unless ENABLE_D1_PERSISTENCE === 'true'
 */
async function handleContracts(request: Request, env: Env, url: URL): Promise<Response> {
  const isPersistenceEnabled = env.ENABLE_D1_PERSISTENCE === 'true';
  if (!isPersistenceEnabled) {
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
    return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
  }

  await ensureDatabaseSchema(env.DB);

  let user: SessionUser;
  try {
    user = await requireSessionUser(request, env);
  } catch (_e) {
    return jsonResponse({ ok: false, code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' }, 401, request, env);
  }

  const pathname = url.pathname;
  const pathParts = pathname.split('/').filter(Boolean); // ['api', 'v1', 'contracts', ...]
  const contractId = pathParts[3];
  const subAction = pathParts[4]; // e.g. 'activate'

  // 1. GET /api/v1/contracts -> List contracts
  if (!contractId && request.method === 'GET') {
    let query = 'SELECT * FROM contracts ORDER BY created_at DESC';
    let params: any[] = [];
    if (user.role === 'BUYER') {
      query = 'SELECT * FROM contracts WHERE user_id = ? OR status = "ACTIVE" ORDER BY created_at DESC';
      params = [user.id];
    }
    const { results } = await env.DB.prepare(query).bind(...params).all<any>();
    const contracts = (results || []).map(formatContractDbRow);
    return jsonResponse({ ok: true, contracts }, 200, request, env);
  }

  // 2. POST /api/v1/contracts -> Create new contract in DRAFT
  if (!contractId && request.method === 'POST') {
    if (user.role !== 'ADMIN' && user.role !== 'SELLER') {
      return jsonResponse({ ok: false, code: 'FORBIDDEN', message: 'Apenas Vendedor ou Administrador pode criar contratos.' }, 403, request, env);
    }

    const body = (await request.json().catch(() => ({}))) as any;
    const {
      name,
      propertyDescription,
      financedAmount,
      fixedInstallment,
      annualInterestRate,
      termMonths,
      startDate,
      finePercent,
      trMode,
    } = body || {};

    const newId = body.id && typeof body.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID();
    const contractName = name && typeof name === 'string' && name.trim() ? name.trim() : 'Contrato Principal';
    const propDesc = propertyDescription && typeof propertyDescription === 'string' ? propertyDescription.trim() : '';
    const financed = Number(financedAmount) || 0;
    const installment = Number(fixedInstallment) || 0;
    const interest = Number(annualInterestRate) || 0;
    const term = Number(termMonths) || 0;
    const start = startDate && typeof startDate === 'string' ? startDate.trim() : '';
    const fine = Number(finePercent) || 0;
    const tr = trMode === 'MONTHLY' ? 'MONTHLY' : 'ANNUAL';

    await env.DB.prepare(`
      INSERT INTO contracts (
        id, user_id, name, property_description, financed_amount, fixed_installment,
        annual_interest_rate, term_months, start_date, fine_percent, tr_mode, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', datetime('now'), datetime('now'))
    `).bind(
      newId,
      user.id,
      contractName,
      propDesc,
      financed,
      installment,
      interest,
      term,
      start,
      fine,
      tr
    ).run();

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    await logAuditEvent(env.DB, newId, 'CONTRACT_CREATED', `Contrato rascunho criado por @${user.login}`, clientIp);

    const created = await env.DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(newId).first<any>();
    return jsonResponse({ ok: true, contract: formatContractDbRow(created) }, 201, request, env);
  }

  // Contract specific routes: /api/v1/contracts/:id
  if (contractId) {
    const existing = await env.DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(contractId).first<any>();
    if (!existing) {
      return jsonResponse({ ok: false, code: 'NOT_FOUND', message: 'Contrato não encontrado.' }, 404, request, env);
    }

    // GET /api/v1/contracts/:id
    if (!subAction && request.method === 'GET') {
      if (user.role === 'BUYER' && existing.status !== 'ACTIVE' && existing.user_id && existing.user_id !== user.id) {
        return jsonResponse({ ok: false, code: 'FORBIDDEN', message: 'Acesso não autorizado a este contrato.' }, 403, request, env);
      }
      return jsonResponse({ ok: true, contract: formatContractDbRow(existing) }, 200, request, env);
    }

    // POST /api/v1/contracts/:id/activate -> ATIVAÇÃO ATÔMICA
    if (subAction === 'activate' && request.method === 'POST') {
      if (user.role !== 'ADMIN' && user.role !== 'SELLER') {
        return jsonResponse({ ok: false, code: 'FORBIDDEN', message: 'Apenas Vendedor ou Administrador pode ativar contratos.' }, 403, request, env);
      }

      if (existing.status === 'ACTIVE') {
        return jsonResponse({ ok: false, code: 'CONTRACT_ALREADY_ACTIVE', message: 'Contrato já se encontra ativo.' }, 409, request, env);
      }

      // Validação estrita dos parâmetros estruturais antes da ativação
      const financed = Number(existing.financed_amount || 0);
      const installment = Number(existing.fixed_installment || 0);
      const term = Number(existing.term_months || 0);
      const interest = Number(existing.annual_interest_rate || 0);
      const fine = Number(existing.fine_percent || 0);
      const start = existing.start_date;
      const nameVal = existing.name;

      if (!nameVal || typeof nameVal !== 'string' || !nameVal.trim()) {
        return jsonResponse({ ok: false, code: 'INVALID_CONTRACT_PARAMETERS', message: 'Nome ou identificação do contrato é obrigatório.' }, 400, request, env);
      }
      if (isNaN(financed) || financed <= 0) {
        return jsonResponse({ ok: false, code: 'INVALID_CONTRACT_PARAMETERS', message: 'Valor financiado deve ser maior que zero.' }, 400, request, env);
      }
      if (isNaN(installment) || installment <= 0) {
        return jsonResponse({ ok: false, code: 'INVALID_CONTRACT_PARAMETERS', message: 'Parcela base deve ser maior que zero.' }, 400, request, env);
      }
      if (isNaN(term) || term <= 0 || !Number.isInteger(term)) {
        return jsonResponse({ ok: false, code: 'INVALID_CONTRACT_PARAMETERS', message: 'Prazo contratual deve ser de no mínimo 1 mês.' }, 400, request, env);
      }
      if (!start || typeof start !== 'string' || !start.trim()) {
        return jsonResponse({ ok: false, code: 'INVALID_CONTRACT_PARAMETERS', message: 'Data inicial do contrato é obrigatória.' }, 400, request, env);
      }
      if (isNaN(interest) || interest < 0) {
        return jsonResponse({ ok: false, code: 'INVALID_CONTRACT_PARAMETERS', message: 'Taxa de juros anual não pode ser negativa.' }, 400, request, env);
      }
      if (isNaN(fine) || fine < 0) {
        return jsonResponse({ ok: false, code: 'INVALID_CONTRACT_PARAMETERS', message: 'Multa não pode ser negativa.' }, 400, request, env);
      }

      // Ativação atômica
      await env.DB.prepare(`
        UPDATE contracts
        SET status = 'ACTIVE',
            activated_at = datetime('now'),
            activated_by = ?,
            updated_at = datetime('now')
        WHERE id = ? AND status = 'DRAFT'
      `).bind(user.login, contractId).run();

      const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
      await logAuditEvent(env.DB, contractId, 'CONTRACT_ACTIVATED', `Contrato ativado com parâmetros bloqueados por @${user.login}`, clientIp);

      const updated = await env.DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(contractId).first<any>();
      return jsonResponse(
        {
          ok: true,
          message: 'Contrato ativado com sucesso. Parâmetros contratuais bloqueados.',
          contract: formatContractDbRow(updated),
        },
        200,
        request,
        env
      );
    }

    // PUT ou PATCH /api/v1/contracts/:id -> Edição de parâmetros estruturais
    if (!subAction && (request.method === 'PUT' || request.method === 'PATCH')) {
      if (user.role !== 'ADMIN' && user.role !== 'SELLER') {
        return jsonResponse({ ok: false, code: 'FORBIDDEN', message: 'Apenas Vendedor ou Administrador pode alterar contratos.' }, 403, request, env);
      }

      // IMUTABILIDADE DO CONTRATO ACTIVE (HTTP 409 CONTRACT_LOCKED)
      // Sem exceção, sem bypass de ADMIN, sem force=true
      if (existing.status === 'ACTIVE') {
        return jsonResponse(
          {
            ok: false,
            code: 'CONTRACT_LOCKED',
            message: 'Contrato ativo. Parâmetros contratuais estão bloqueados e não podem ser alterados.',
          },
          409,
          request,
          env
        );
      }

      // Edição de contrato DRAFT
      const body = (await request.json().catch(() => ({}))) as any;
      const newName = body.name !== undefined ? String(body.name).trim() : existing.name;
      const newProp = body.propertyDescription !== undefined ? String(body.propertyDescription).trim() : existing.property_description;
      const newFinanced = body.financedAmount !== undefined ? Number(body.financedAmount) : existing.financed_amount;
      const newInstallment = body.fixedInstallment !== undefined ? Number(body.fixedInstallment) : existing.fixed_installment;
      const newInterest = body.annualInterestRate !== undefined ? Number(body.annualInterestRate) : existing.annual_interest_rate;
      const newTerm = body.termMonths !== undefined ? Number(body.termMonths) : existing.term_months;
      const newStart = body.startDate !== undefined ? String(body.startDate).trim() : existing.start_date;
      const newFine = body.finePercent !== undefined ? Number(body.finePercent) : existing.fine_percent;
      const newTr = body.trMode !== undefined ? (body.trMode === 'MONTHLY' ? 'MONTHLY' : 'ANNUAL') : existing.tr_mode;

      await env.DB.prepare(`
        UPDATE contracts SET
          name = ?,
          property_description = ?,
          financed_amount = ?,
          fixed_installment = ?,
          annual_interest_rate = ?,
          term_months = ?,
          start_date = ?,
          fine_percent = ?,
          tr_mode = ?,
          updated_at = datetime('now')
        WHERE id = ? AND status = 'DRAFT'
      `).bind(
        newName,
        newProp,
        newFinanced,
        newInstallment,
        newInterest,
        newTerm,
        newStart,
        newFine,
        newTr,
        contractId
      ).run();

      const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
      await logAuditEvent(env.DB, contractId, 'CONTRACT_DRAFT_UPDATED', `Rascunho de contrato atualizado por @${user.login}`, clientIp);

      const updated = await env.DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(contractId).first<any>();
      return jsonResponse({ ok: true, contract: formatContractDbRow(updated) }, 200, request, env);
    }
  }

  return jsonResponse({ ok: false, code: 'NOT_FOUND', message: 'Endpoint de contratos não encontrado.' }, 404, request, env);
}

/**
 * Handle transactions endpoints
 * Default: FAIL-CLOSED (503) unless ENABLE_D1_PERSISTENCE === 'true'
 */
async function handleTransactions(request: Request, env: Env, url: URL): Promise<Response> {
  const isPersistenceEnabled = env.ENABLE_D1_PERSISTENCE === 'true';
  if (!isPersistenceEnabled) {
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
    return jsonResponse({ ok: false, error: 'Database not available' }, 503, request, env);
  }

  await ensureDatabaseSchema(env.DB);

  let user: SessionUser;
  try {
    user = await requireSessionUser(request, env);
  } catch (_e) {
    return jsonResponse({ ok: false, code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' }, 401, request, env);
  }

  // GET /api/v1/transactions?contractId=...
  if (request.method === 'GET') {
    const contractId = url.searchParams.get('contractId');
    if (!contractId) {
      return jsonResponse({ ok: false, code: 'INVALID_REQUEST', message: 'contractId é obrigatório.' }, 400, request, env);
    }
    if (user.role === 'BUYER') {
      const contract = await env.DB.prepare('SELECT user_id, status FROM contracts WHERE id = ?').bind(contractId).first<any>();
      if (contract && contract.status !== 'ACTIVE' && contract.user_id && contract.user_id !== user.id) {
        return jsonResponse({ ok: false, code: 'FORBIDDEN', message: 'Acesso não autorizado aos lançamentos deste contrato.' }, 403, request, env);
      }
    }
    const { results } = await env.DB.prepare(
      'SELECT * FROM transactions WHERE contract_id = ? ORDER BY date ASC, installment_number ASC'
    ).bind(contractId).all<any>();
    return jsonResponse({ ok: true, transactions: (results || []).map(formatTransactionDbRow) }, 200, request, env);
  }

  // POST /api/v1/transactions -> Criar novo lançamento (exige contrato ACTIVE)
  if (request.method === 'POST') {
    if (user.role !== 'ADMIN' && user.role !== 'SELLER') {
      return jsonResponse({ ok: false, code: 'FORBIDDEN', message: 'Apenas Vendedor ou Administrador pode registrar lançamentos.' }, 403, request, env);
    }

    const body = (await request.json().catch(() => ({}))) as any;
    const {
      contractId,
      date,
      installmentNumber,
      amount,
      type,
      method,
      observation,
      status,
      receiptKey,
      receiptFileName,
      receiptMimeType,
      receiptBase64,
    } = body || {};

    if (!contractId || !date || amount === undefined || !installmentNumber || !type) {
      return jsonResponse({ ok: false, code: 'INVALID_PARAMETERS', message: 'Parâmetros de lançamento incompletos.' }, 400, request, env);
    }

    const contract = await env.DB.prepare('SELECT id, status FROM contracts WHERE id = ?').bind(contractId).first<any>();
    if (!contract) {
      return jsonResponse({ ok: false, code: 'NOT_FOUND', message: 'Contrato não encontrado.' }, 404, request, env);
    }

    // Regra Obrigatória J: Novo Lançamento em DRAFT é rejeitado
    if (contract.status !== 'ACTIVE') {
      return jsonResponse({
        ok: false,
        code: 'CONTRACT_NOT_ACTIVE',
        message: 'Lançamentos financeiros só são permitidos após a ativação do contrato.',
      }, 400, request, env);
    }

    const newTxId = body.id || crypto.randomUUID();
    const txAmount = Number(amount);
    const txInstallment = Number(installmentNumber);
    const txType = type === 'LANCE' ? 'LANCE' : 'PAYMENT';
    const txMethod = method || 'PIX';
    const txStatus = status === 'EM_ABERTO' ? 'EM_ABERTO' : 'PAGO';
    const finalReceiptKey = receiptKey || (receiptBase64 ? String(receiptBase64) : null);

    // Insere transação (NÃO modifica nenhum parâmetro estrutural da tabela contracts!)
    await env.DB.prepare(`
      INSERT INTO transactions (
        id, contract_id, date, installment_number, amount, type, method, observation,
        status, receipt_key, receipt_file_name, receipt_mime_type, created_by, created_by_email,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      newTxId,
      contractId,
      date,
      txInstallment,
      txAmount,
      txType,
      txMethod,
      observation || null,
      txStatus,
      finalReceiptKey,
      receiptFileName || null,
      receiptMimeType || null,
      user.login,
      user.email || null
    ).run();

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    await logAuditEvent(env.DB, contractId, 'TRANSACTION_CREATED', `Lançamento ${txType} R$ ${txAmount} registrado por @${user.login}`, clientIp);

    const created = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(newTxId).first<any>();
    return jsonResponse({ ok: true, transaction: formatTransactionDbRow(created) }, 201, request, env);
  }

  // DELETE /api/v1/transactions
  if (request.method === 'DELETE') {
    if (user.role !== 'ADMIN' && user.role !== 'SELLER') {
      return jsonResponse({ ok: false, code: 'FORBIDDEN', message: 'Permissão negada.' }, 403, request, env);
    }
    const pathParts = url.pathname.split('/').filter(Boolean);
    const pathTxId = pathParts[3];
    const txId = url.searchParams.get('id') || pathTxId;
    if (!txId) {
      return jsonResponse({ ok: false, code: 'INVALID_REQUEST', message: 'id da transação é obrigatório.' }, 400, request, env);
    }
    await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(txId).run();
    return jsonResponse({ ok: true, message: 'Lançamento excluído com sucesso.' }, 200, request, env);
  }

  return jsonResponse({ ok: false, code: 'NOT_FOUND', message: 'Endpoint não encontrado.' }, 404, request, env);
}

// ============================================================================
// MAIN WORKER FETCH DISPATCHER
// ============================================================================

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
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

        if (targetUserId && subAction === 'role' && request.method === 'PATCH') {
          return handleAdminUserRolePatch(request, env, targetUserId);
        }

        if (targetUserId && subAction === 'reset-password' && request.method === 'POST') {
          return handleAdminUserResetPasswordPost(request, env, targetUserId);
        }

        if (targetUserId && !subAction && (request.method === 'PATCH' || request.method === 'PUT')) {
          return handleAdminUserEditPatch(request, env, targetUserId);
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

      // 7. API routes 404 fallback (garante HTTP 404 para rotas de API inexistentes ou revogadas)
      if (pathname.startsWith('/api/')) {
        return jsonResponse({ ok: false, code: 'NOT_FOUND', message: 'Endpoint não encontrado.' }, 404, request, env);
      }

      // 8. Static assets handling
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response('Not Found', { status: 404 });
    } catch (err: any) {
      console.error('[Worker] Fatal error:', err);
      return jsonResponse(
        { ok: false, code: 'INTERNAL_ERROR', message: 'Erro interno no servidor' },
        500,
        request,
        env
      );
    }
  },
};

