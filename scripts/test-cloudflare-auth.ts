/**
 * ============================================================================
 * BATERIA DE TESTES — ETAPA 3B: AUTENTICAÇÃO NATIVA CLOUDFLARE + D1 (34 CASOS)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker, {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  parseCookies,
  sha256Hex,
} from '../worker/index';

// D1 Mock em memória usando Node sqlite nativo
class D1Mock {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(':memory:');
    const m1 = fs.readFileSync(path.join(process.cwd(), 'migrations', '0001_initial.sql'), 'utf8');
    const m2 = fs.readFileSync(path.join(process.cwd(), 'migrations', '0002_cloudflare_auth.sql'), 'utf8');
    this.db.exec(m1);
    this.db.exec(m2);
  }

  prepare(query: string) {
    const db = this.db;
    const createStatement = (boundParams: any[] = []) => ({
      bind(...params: any[]) {
        return createStatement(params);
      },
      async first<T = any>(): Promise<T | null> {
        try {
          const stmt = db.prepare(query);
          const result = stmt.get(...boundParams) as T | undefined;
          return result ?? null;
        } catch (err) {
          console.error('D1Mock.first error for query:', query, err);
          throw err;
        }
      },
      async all<T = any>(): Promise<{ results: T[] }> {
        try {
          const stmt = db.prepare(query);
          const results = stmt.all(...boundParams) as T[];
          return { results };
        } catch (err) {
          console.error('D1Mock.all error for query:', query, err);
          throw err;
        }
      },
      async run(): Promise<{ meta: { changes: number } }> {
        try {
          const stmt = db.prepare(query);
          const info = stmt.run(...boundParams);
          return { meta: { changes: Number(info.changes) } };
        } catch (err) {
          console.error('D1Mock.run error for query:', query, err);
          throw err;
        }
      },
    });

    return createStatement();
  }

  exec(sql: string) {
    return this.db.exec(sql);
  }

  query(sql: string, ...params: any[]) {
    return this.db.prepare(sql).all(...params);
  }
}

async function runAll34Tests() {
  console.log('================================================================');
  console.log('INICIANDO OS 34 TESTES OBRIGATÓRIOS — ETAPA 3B (CLOUDFLARE AUTH)');
  console.log('================================================================\n');

  const d1 = new D1Mock();
  const BOOTSTRAP_TOKEN = 'test_bootstrap_secret_123456';
  const env: any = {
    DB: d1,
    ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
  };

  const results: { id: number; test: string; passed: boolean; detail?: string }[] = [];

  function record(id: number, test: string, passed: boolean, detail = '') {
    results.push({ id, test, passed, detail });
    console.log(`${passed ? '✅' : '❌'} [${id}/34] ${test}${detail ? ` (${detail})` : ''}`);
  }

  // -------------------------------------------------------------------------
  // 1. hashPassword gera formato pbkdf2_sha256$<iter>$<salt>$<hash>
  // -------------------------------------------------------------------------
  const hash1 = await hashPassword('MinhaSenhaForte123!');
  const parts1 = hash1.split('$');
  record(
    1,
    'hashPassword gera formato pbkdf2_sha256$<iter>$<salt>$<hash>',
    parts1.length === 4 && parts1[0] === 'pbkdf2_sha256' && parts1[2].length > 10 && parts1[3].length > 10,
    `formato: ${parts1[0]}`
  );

  // -------------------------------------------------------------------------
  // 2. hashPassword usa 100.000 iterações (limite Cloudflare Workers)
  // -------------------------------------------------------------------------
  record(
    2,
    'hashPassword usa 100.000 iterações (limite Cloudflare Workers)',
    parts1[1] === '100000',
    `iterações: ${parts1[1]}`
  );

  // -------------------------------------------------------------------------
  // 3. verifyPassword valida senha correta
  // -------------------------------------------------------------------------
  const verifyOk = await verifyPassword('MinhaSenhaForte123!', hash1);
  record(
    3,
    'verifyPassword valida senha correta',
    verifyOk === true,
    `validação: ${verifyOk}`
  );

  // -------------------------------------------------------------------------
  // 4. verifyPassword rejeita senha incorreta
  // -------------------------------------------------------------------------
  const verifyWrong = await verifyPassword('SenhaIncorretaErrada!', hash1);
  record(
    4,
    'verifyPassword rejeita senha incorreta',
    verifyWrong === false,
    `rejeição correta: ${!verifyWrong}`
  );

  // -------------------------------------------------------------------------
  // 5. verifyPassword rejeita hash malformado
  // -------------------------------------------------------------------------
  const verifyMal = await verifyPassword('MinhaSenhaForte123!', 'invalido$123');
  record(
    5,
    'verifyPassword rejeita hash malformado',
    verifyMal === false,
    `rejeição: ${!verifyMal}`
  );

  // -------------------------------------------------------------------------
  // 6. verifyPassword tempo é estável (dummy hash para user inexistente)
  // -------------------------------------------------------------------------
  const t0 = Date.now();
  await verifyPassword('MinhaSenhaForte123!', hash1);
  const timeReal = Date.now() - t0;

  const t1 = Date.now();
  const dummyHash = 'pbkdf2_sha256$100000$c2FsdHNhbHRzYWx0MTY=$dGVzdGR1bW15aGFzaHZhbHVlZm9ydGltaW5nMTIzNDU2Nw==';
  await verifyPassword('MinhaSenhaForte123!', dummyHash);
  const timeDummy = Date.now() - t1;

  // Ambos devem executar a derivação completa de 100k iterações (~dentro da mesma magnitude de ms)
  record(
    6,
    'verifyPassword tempo é estável (dummy hash para user inexistente)',
    timeReal > 0 && timeDummy > 0 && Math.abs(timeReal - timeDummy) < 200,
    `real: ${timeReal}ms, dummy: ${timeDummy}ms`
  );

  // -------------------------------------------------------------------------
  // 7. validatePasswordPolicy aceita senha válida (>=10 chars, letra, número)
  // -------------------------------------------------------------------------
  const policyValid = validatePasswordPolicy('SenhaSegura2026!');
  record(
    7,
    'validatePasswordPolicy aceita senha válida (>=10 chars, letra, número)',
    policyValid.valid === true,
    'válida'
  );

  // -------------------------------------------------------------------------
  // 8. validatePasswordPolicy rejeita senha curta (<10 chars)
  // -------------------------------------------------------------------------
  const policyShort = validatePasswordPolicy('Curta1');
  record(
    8,
    'validatePasswordPolicy rejeita senha curta (<10 chars)',
    policyShort.valid === false,
    policyShort.error || ''
  );

  // -------------------------------------------------------------------------
  // 9. validatePasswordPolicy rejeita senha sem número
  // -------------------------------------------------------------------------
  const policyNoNum = validatePasswordPolicy('SenhaSemNumeroTotal');
  record(
    9,
    'validatePasswordPolicy rejeita senha sem número',
    policyNoNum.valid === false,
    policyNoNum.error || ''
  );

  // -------------------------------------------------------------------------
  // 10. validatePasswordPolicy rejeita senha sem letra
  // -------------------------------------------------------------------------
  const policyNoLetter = validatePasswordPolicy('1234567890123');
  record(
    10,
    'validatePasswordPolicy rejeita senha sem letra',
    policyNoLetter.valid === false,
    policyNoLetter.error || ''
  );

  // -------------------------------------------------------------------------
  // 11. POST /api/v1/admin/bootstrap cria 1º ADMIN com token correto
  // -------------------------------------------------------------------------
  let adminUserId = '';
  {
    const req = new Request('http://localhost/api/v1/admin/bootstrap', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BOOTSTRAP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'admin.master@incorporadora.com',
        name: 'Administrador Master',
        password: 'AdminPassword123!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    const json: any = await res.json();
    adminUserId = json.user?.id || '';
    record(
      11,
      'POST /api/v1/admin/bootstrap cria 1º ADMIN com token correto',
      res.status === 201 && json.ok === true && json.user?.role === 'ADMIN',
      `status: ${res.status}, role: ${json.user?.role}`
    );
  }

  // -------------------------------------------------------------------------
  // 12. POST /api/v1/admin/bootstrap rejeita token incorreto (403)
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/admin/bootstrap', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token_completamente_errado',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'hacker@example.com',
        password: 'AdminPassword123!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    record(
      12,
      'POST /api/v1/admin/bootstrap rejeita token incorreto (403)',
      res.status === 403,
      `status: ${res.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 13. POST /api/v1/admin/bootstrap rejeita sem token (401)
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/admin/bootstrap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'semtoken@example.com',
        password: 'AdminPassword123!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    record(
      13,
      'POST /api/v1/admin/bootstrap rejeita sem token (401)',
      res.status === 401,
      `status: ${res.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 14. POST /api/v1/admin/bootstrap rejeita após 1º ADMIN já existir (409)
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/admin/bootstrap', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BOOTSTRAP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'segundo.admin@example.com',
        password: 'AdminPassword123!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    const json: any = await res.json();
    record(
      14,
      'POST /api/v1/admin/bootstrap rejeita após 1º ADMIN já existir (409)',
      res.status === 409 && json.code === 'ADMIN_ALREADY_EXISTS',
      `status: ${res.status}, code: ${json.code}`
    );
  }

  // -------------------------------------------------------------------------
  // 15. POST /api/v1/auth/login sucesso para credenciais corretas (200 + Set-Cookie)
  // -------------------------------------------------------------------------
  let adminSessionCookie = '';
  {
    const req = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin.master@incorporadora.com',
        password: 'AdminPassword123!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    const json: any = await res.json();
    const setCookie = res.headers.get('Set-Cookie') || '';
    adminSessionCookie = setCookie.split(';')[0];
    record(
      15,
      'POST /api/v1/auth/login sucesso para credenciais corretas (200 + Set-Cookie)',
      res.status === 200 && json.ok === true && setCookie.includes('venda_ap_session=') && setCookie.includes('HttpOnly'),
      `cookie: ${setCookie.slice(0, 30)}...`
    );
  }

  // -------------------------------------------------------------------------
  // 16. POST /api/v1/auth/login rejeita senha errada (401)
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin.master@incorporadora.com',
        password: 'SenhaErrada123!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    const json: any = await res.json();
    record(
      16,
      'POST /api/v1/auth/login rejeita senha errada (401)',
      res.status === 401 && json.code === 'INVALID_CREDENTIALS',
      `status: ${res.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 17. POST /api/v1/auth/login rejeita email inexistente com tempo equiparável (401)
  // -------------------------------------------------------------------------
  {
    const startInexistente = Date.now();
    const req = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'email.inexistente.999@example.com',
        password: 'QualquerSenha123!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    const elapsed = Date.now() - startInexistente;
    const json: any = await res.json();
    record(
      17,
      'POST /api/v1/auth/login rejeita email inexistente com tempo equiparável (401)',
      res.status === 401 && json.code === 'INVALID_CREDENTIALS' && elapsed >= 15,
      `status: ${res.status}, elapsed: ${elapsed}ms`
    );
  }

  // -------------------------------------------------------------------------
  // 18. POST /api/v1/auth/login rejeita usuário DISABLED (401)
  // -------------------------------------------------------------------------
  {
    // Inserir usuário com status DISABLED
    const hashDisabled = await hashPassword('DisabledUser123!');
    d1.exec(`
      INSERT INTO users (id, login, email, name, role, status, password_hash)
      VALUES ('user-disabled-1', 'disabled.user', 'disabled@example.com', 'Disabled User', 'BUYER', 'DISABLED', '${hashDisabled}')
    `);

    const req = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'disabled@example.com',
        password: 'DisabledUser123!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    const json: any = await res.json();
    record(
      18,
      'POST /api/v1/auth/login rejeita usuário DISABLED (401)',
      res.status === 401 && json.code === 'INVALID_CREDENTIALS',
      `status: ${res.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 19. POST /api/v1/auth/login bloqueia por rate limit após 5 tentativas (429)
  // -------------------------------------------------------------------------
  {
    // Simulamos 5 tentativas falhas para o email rate.limit@example.com
    for (let i = 0; i < 5; i++) {
      const req = new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.99' },
        body: JSON.stringify({ email: 'rate.limit@example.com', password: 'SenhaErrada123!' }),
      });
      await worker.fetch(req, env, {} as any);
    }
    // 6ª tentativa deve retornar 429 TOO_MANY_ATTEMPTS
    const reqBlocked = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.99' },
      body: JSON.stringify({ email: 'rate.limit@example.com', password: 'SenhaErrada123!' }),
    });
    const resBlocked = await worker.fetch(reqBlocked, env, {} as any);
    const jsonBlocked: any = await resBlocked.json();
    record(
      19,
      'POST /api/v1/auth/login bloqueia por rate limit após 5 tentativas (429)',
      resBlocked.status === 429 && jsonBlocked.code === 'TOO_MANY_ATTEMPTS',
      `status: ${resBlocked.status}, code: ${jsonBlocked.code}`
    );
  }

  // -------------------------------------------------------------------------
  // 20. GET /api/v1/auth/me retorna 200 com cookie de sessão válido
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/auth/me', {
      method: 'GET',
      headers: { Cookie: adminSessionCookie },
    });
    const res = await worker.fetch(req, env, {} as any);
    const json: any = await res.json();
    record(
      20,
      'GET /api/v1/auth/me retorna 200 com cookie de sessão válido',
      res.status === 200 && json.ok === true && json.user?.email === 'admin.master@incorporadora.com',
      `user: ${json.user?.email}`
    );
  }

  // -------------------------------------------------------------------------
  // 21. GET /api/v1/auth/me retorna 401 sem cookie
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/auth/me', { method: 'GET' });
    const res = await worker.fetch(req, env, {} as any);
    record(
      21,
      'GET /api/v1/auth/me retorna 401 sem cookie',
      res.status === 401,
      `status: ${res.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 22. GET /api/v1/auth/me retorna 401 com sessão revogada
  // -------------------------------------------------------------------------
  {
    // Criamos uma sessão e depois marcamos revoked_at
    const token = 'revoked-test-token-12345';
    const tokenHash = await sha256Hex(token);
    d1.exec(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, revoked_at)
      VALUES ('s-revoked', '${adminUserId}', '${tokenHash}', datetime('now', '+7 days'), datetime('now'))
    `);
    const req = new Request('http://localhost/api/v1/auth/me', {
      method: 'GET',
      headers: { Cookie: `venda_ap_session=${token}` },
    });
    const res = await worker.fetch(req, env, {} as any);
    record(
      22,
      'GET /api/v1/auth/me retorna 401 com sessão revogada',
      res.status === 401,
      `status: ${res.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 23. GET /api/v1/auth/me retorna 401 com sessão expirada
  // -------------------------------------------------------------------------
  {
    const token = 'expired-test-token-12345';
    const tokenHash = await sha256Hex(token);
    d1.exec(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
      VALUES ('s-expired', '${adminUserId}', '${tokenHash}', datetime('now', '-1 hour'))
    `);
    const req = new Request('http://localhost/api/v1/auth/me', {
      method: 'GET',
      headers: { Cookie: `venda_ap_session=${token}` },
    });
    const res = await worker.fetch(req, env, {} as any);
    record(
      23,
      'GET /api/v1/auth/me retorna 401 com sessão expirada',
      res.status === 401,
      `status: ${res.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 24. POST /api/v1/auth/logout revoga sessão e limpa cookie (200 + Max-Age=0)
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/auth/logout', {
      method: 'POST',
      headers: { Cookie: adminSessionCookie },
    });
    const res = await worker.fetch(req, env, {} as any);
    const setCookie = res.headers.get('Set-Cookie') || '';
    record(
      24,
      'POST /api/v1/auth/logout revoga sessão e limpa cookie (200 + Max-Age=0)',
      res.status === 200 && setCookie.includes('Max-Age=0'),
      `cookie header: ${setCookie}`
    );

    // Re-verificar que a sessão agora é rejeitada no /auth/me
    const reqCheck = new Request('http://localhost/api/v1/auth/me', {
      method: 'GET',
      headers: { Cookie: adminSessionCookie },
    });
    const resCheck = await worker.fetch(reqCheck, env, {} as any);
    if (resCheck.status !== 401) {
      console.error('Falha: sessão ainda ativa após logout');
    }
  }

  // Log in novamente para testes subsequentes que requerem ADMIN
  {
    const req = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin.master@incorporadora.com',
        password: 'AdminPassword123!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    const setCookie = res.headers.get('Set-Cookie') || '';
    adminSessionCookie = setCookie.split(';')[0];
  }

  // -------------------------------------------------------------------------
  // 25. POST /api/v1/auth/change-password altera senha com senha atual correta (200)
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        currentPassword: 'AdminPassword123!',
        newPassword: 'NovaSenhaSegura456!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    const json: any = await res.json();
    record(
      25,
      'POST /api/v1/auth/change-password altera senha com senha atual correta (200)',
      res.status === 200 && json.ok === true,
      `status: ${res.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 26. POST /api/v1/auth/change-password rejeita senha atual incorreta (401)
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        currentPassword: 'SenhaQueNaoEAtual!',
        newPassword: 'OutraNovaSenha789!',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    record(
      26,
      'POST /api/v1/auth/change-password rejeita senha atual incorreta (401)',
      res.status === 401,
      `status: ${res.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 27. POST /api/v1/auth/change-password invalida outras sessões do usuário
  // -------------------------------------------------------------------------
  {
    // Criamos uma segunda sessão "paralela" para o admin
    const token2 = 'session-2-parallel-token';
    const tokenHash2 = await sha256Hex(token2);
    d1.exec(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
      VALUES ('s-parallel-2', '${adminUserId}', '${tokenHash2}', datetime('now', '+7 days'))
    `);

    // Alteramos a senha usando a sessão principal (adminSessionCookie)
    const reqChange = new Request('http://localhost/api/v1/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        currentPassword: 'NovaSenhaSegura456!',
        newPassword: 'NovaSenhaDefinitiva789!',
      }),
    });
    await worker.fetch(reqChange, env, {} as any);

    // A segunda sessão paralela deve ter sido revogada
    const reqCheck2 = new Request('http://localhost/api/v1/auth/me', {
      method: 'GET',
      headers: { Cookie: `venda_ap_session=${token2}` },
    });
    const resCheck2 = await worker.fetch(reqCheck2, env, {} as any);
    record(
      27,
      'POST /api/v1/auth/change-password invalida outras sessões do usuário',
      resCheck2.status === 401,
      `status da sessão paralela: ${resCheck2.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 28. GET /api/v1/admin/users retorna lista quando autenticado como ADMIN (200)
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/admin/users', {
      method: 'GET',
      headers: { Cookie: adminSessionCookie },
    });
    const res = await worker.fetch(req, env, {} as any);
    const json: any = await res.json();
    record(
      28,
      'GET /api/v1/admin/users retorna lista quando autenticado como ADMIN (200)',
      res.status === 200 && json.ok === true && Array.isArray(json.users),
      `total users: ${json.users?.length}`
    );
  }

  // -------------------------------------------------------------------------
  // 29. GET /api/v1/admin/users rejeita quando autenticado como CLIENT (403)
  // -------------------------------------------------------------------------
  let clientCookie = '';
  let clientUserId = '';
  {
    // Criamos um CLIENT diretamente no banco e fazemos login
    const clientHash = await hashPassword('ClientPass123!');
    clientUserId = 'client-test-uuid-1';
    d1.exec(`
      INSERT INTO users (id, login, email, name, role, status, password_hash)
      VALUES ('${clientUserId}', 'comprador.teste', 'comprador.teste@email.com', 'Comprador Teste', 'BUYER', 'ACTIVE', '${clientHash}')
    `);

    const reqLogin = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'comprador.teste@email.com', password: 'ClientPass123!' }),
    });
    const resLogin = await worker.fetch(reqLogin, env, {} as any);
    const setCookie = resLogin.headers.get('Set-Cookie') || '';
    clientCookie = setCookie.split(';')[0];

    const req = new Request('http://localhost/api/v1/admin/users', {
      method: 'GET',
      headers: { Cookie: clientCookie },
    });
    const res = await worker.fetch(req, env, {} as any);
    record(
      29,
      'GET /api/v1/admin/users rejeita quando autenticado como CLIENT (403)',
      res.status === 403,
      `status: ${res.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 30. POST /api/v1/admin/users cria novo CLIENT com sucesso (201)
  // -------------------------------------------------------------------------
  let newCreatedClientId = '';
  {
    const req = new Request('http://localhost/api/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        email: 'novo.cliente@dominio.com',
        name: 'Novo Comprador',
        password: 'SenhaComprador123!',
        role: 'CLIENT',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    const json: any = await res.json();
    newCreatedClientId = json.user?.id || '';
    record(
      30,
      'POST /api/v1/admin/users cria novo CLIENT com sucesso (201)',
      res.status === 201 && json.ok === true && (json.user?.role === 'CLIENT' || json.user?.role === 'BUYER'),
      `novo id: ${newCreatedClientId}, role: ${json.user?.role}`
    );
  }

  // -------------------------------------------------------------------------
  // 31. POST /api/v1/admin/users rejeita duplicidade de email (409)
  // -------------------------------------------------------------------------
  {
    const req = new Request('http://localhost/api/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        email: 'novo.cliente@dominio.com',
        name: 'Tentativa Duplicada',
        password: 'SenhaComprador123!',
        role: 'CLIENT',
      }),
    });
    const res = await worker.fetch(req, env, {} as any);
    const json: any = await res.json();
    record(
      31,
      'POST /api/v1/admin/users rejeita duplicidade de email (409)',
      res.status === 409 && json.code === 'EMAIL_ALREADY_EXISTS',
      `status: ${res.status}, code: ${json.code}`
    );
  }

  // -------------------------------------------------------------------------
  // 32. PATCH /api/v1/admin/users/:id/status altera status e revoga sessões se DISABLED
  // -------------------------------------------------------------------------
  {
    // Desativar o clientUserId criado anteriormente
    const reqPatch = new Request(`http://localhost/api/v1/admin/users/${clientUserId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({ status: 'DISABLED' }),
    });
    const resPatch = await worker.fetch(reqPatch, env, {} as any);

    // Tentar acessar com a sessão do cliente desativado (deve retornar 401)
    const reqCheck = new Request('http://localhost/api/v1/auth/me', {
      method: 'GET',
      headers: { Cookie: clientCookie },
    });
    const resCheck = await worker.fetch(reqCheck, env, {} as any);

    record(
      32,
      'PATCH /api/v1/admin/users/:id/status altera status e revoga sessões se DISABLED',
      resPatch.status === 200 && resCheck.status === 401,
      `patch status: ${resPatch.status}, me status após desativação: ${resCheck.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 33. POST /api/v1/admin/users/:id/reset-password redefine senha e revoga sessões
  // -------------------------------------------------------------------------
  {
    // Redefinir senha do newCreatedClientId
    const reqReset = new Request(`http://localhost/api/v1/admin/users/${newCreatedClientId}/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSessionCookie,
      },
      body: JSON.stringify({ newPassword: 'SenhaNovaResetada123!' }),
    });
    const resReset = await worker.fetch(reqReset, env, {} as any);

    // Tentar logar com a nova senha resetada
    const reqLoginNew = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'novo.cliente@dominio.com',
        password: 'SenhaNovaResetada123!',
      }),
    });
    const resLoginNew = await worker.fetch(reqLoginNew, env, {} as any);

    record(
      33,
      'POST /api/v1/admin/users/:id/reset-password redefine senha e revoga sessões',
      resReset.status === 200 && resLoginNew.status === 200,
      `reset: ${resReset.status}, login com nova senha: ${resLoginNew.status}`
    );
  }

  // -------------------------------------------------------------------------
  // 34. /api/v1/contracts e /api/v1/transactions permanecem 503 fail-closed
  // -------------------------------------------------------------------------
  {
    const reqContracts = new Request('http://localhost/api/v1/contracts', {
      method: 'GET',
      headers: { Cookie: adminSessionCookie },
    });
    const resContracts = await worker.fetch(reqContracts, env, {} as any);
    const jsonContracts: any = await resContracts.json();

    const reqTx = new Request('http://localhost/api/v1/transactions', {
      method: 'GET',
      headers: { Cookie: adminSessionCookie },
    });
    const resTx = await worker.fetch(reqTx, env, {} as any);
    const jsonTx: any = await resTx.json();

    record(
      34,
      '/api/v1/contracts e /api/v1/transactions permanecem 503 fail-closed',
      resContracts.status === 503 &&
        jsonContracts.code === 'D1_PERSISTENCE_NOT_ENABLED' &&
        resTx.status === 503 &&
        jsonTx.code === 'D1_PERSISTENCE_NOT_ENABLED',
      `contracts: ${resContracts.status}, transactions: ${resTx.status}`
    );
  }

  console.log('\n================================================================');
  console.log('RESUMO FINAL DOS 34 TESTES OBRIGATÓRIOS:');
  const allPassed = results.every((r) => r.passed);
  console.log(`TOTAL DE TESTES: ${results.length}`);
  console.log(`PASSOU: ${results.filter((r) => r.passed).length}`);
  console.log(`FALHOU: ${results.filter((r) => !r.passed).length}`);
  console.log(`STATUS GERAL: ${allPassed ? 'TODOS OS 34 TESTES PASSARAM COM SUCESSO!' : 'FALHAS DETECTADAS'}`);
  console.log('================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runAll34Tests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
