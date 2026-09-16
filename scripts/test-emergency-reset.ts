/**
 * ============================================================================
 * ETAPA 3C.6 — TESTE DE REGRESSÃO: REVOGAÇÃO DEFINITIVA DO EMERGENCY RESET
 * ============================================================================
 * Comprova que:
 * A. emergency-reset-password não está mais disponível.
 * B. requisição POST para a rota retorna 404 (rota inexistente).
 * C. nenhuma senha é alterada ao chamar a antiga rota.
 * D. login normal continua funcionando com senha válida.
 * E. hash PBKDF2 100000 continua autenticando normalmente.
 * F. senha incorreta retorna 401.
 * G. /auth/me autenticado continua funcionando.
 * H. ADMIN mantém permissões administrativas normais.
 * I. criação/gestão de usuários continua funcionando perfeitamente.
 * J. nenhum endpoint alternativo de emergency reset foi criado.
 * + Fail-closed de contracts/transactions (503) e integridade de financeService.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker, { hashPassword, verifyPassword } from '../worker/index';

class D1Mock {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
    const m1 = fs.readFileSync(path.join(process.cwd(), 'migrations', '0001_initial.sql'), 'utf8');
    const m2 = fs.readFileSync(path.join(process.cwd(), 'migrations', '0002_cloudflare_auth.sql'), 'utf8');
    const m3 = fs.readFileSync(path.join(process.cwd(), 'migrations', '0003_login_roles.sql'), 'utf8');
    this.db.exec(m1);
    this.db.exec(m2);
    this.db.exec(m3);
  }

  prepare(query: string): any {
    const db = this.db;
    const createStatement = (boundParams: any[] = []) => ({
      bind(...params: any[]) {
        return createStatement(params);
      },
      async first<T = any>(): Promise<T | null> {
        const stmt = db.prepare(query);
        const result = stmt.get(...boundParams) as T | undefined;
        return result ?? null;
      },
      async all<T = any>(): Promise<{ results: T[] }> {
        const stmt = db.prepare(query);
        const results = stmt.all(...boundParams) as T[];
        return { results };
      },
      async run(): Promise<{ meta: { changes: number } }> {
        const stmt = db.prepare(query);
        const info = stmt.run(...boundParams);
        return { meta: { changes: Number(info.changes) } };
      },
    });

    return createStatement();
  }

  exec(sql: string) {
    return this.db.exec(sql);
  }

  async batch(statements: any[]) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}

async function runRevocationRegressionTests() {
  console.log('================================================================');
  console.log('ETAPA 3C.6 — REGRESSÃO: REVOGAÇÃO DO EMERGENCY RESET');
  console.log('================================================================\n');

  // Setup Mock Database
  const d1 = new D1Mock();
  const env = {
    DB: d1 as any,
    ADMIN_BOOTSTRAP_TOKEN: 'dev_bootstrap_token_12345',
  };

  const adminId = crypto.randomUUID();
  const ADMIN_PASSWORD = 'AdminPassword123#Secure';
  const adminHash = await hashPassword(ADMIN_PASSWORD);

  // Cadastra admin já homologado com hash PBKDF2 100.000
  await env.DB.prepare(`
    INSERT INTO users (id, login, name, email, role, status, password_hash, created_at, updated_at)
    VALUES (?, 'admin', 'Thiago Anderson da Silva', NULL, 'ADMIN', 'ACTIVE', ?, datetime('now'), datetime('now'))
  `).bind(adminId, adminHash).run();

  // -------------------------------------------------------------------------
  // CENÁRIO E: Hash PBKDF2 100000 continua derivando e autenticando
  // -------------------------------------------------------------------------
  const hashParts = adminHash.split('$');
  console.log('E. Validação PBKDF2 (100.000 iterações mantidas):');
  console.log(`   Formato: ${hashParts[0]}`);
  console.log(`   Iterações: ${hashParts[1]} (esperado: 100000)`);
  if (hashParts[0] !== 'pbkdf2_sha256' || hashParts[1] !== '100000') {
    throw new Error('CENÁRIO E FALHOU: PBKDF2 não está utilizando 100.000 iterações!');
  }
  const isCorrect = await verifyPassword(ADMIN_PASSWORD, adminHash);
  if (!isCorrect) {
    throw new Error('CENÁRIO E FALHOU: verifyPassword falhou para senha válida!');
  }

  // -------------------------------------------------------------------------
  // CENÁRIOS A & B: Rota emergency-reset-password revogada e retorna HTTP 404
  // -------------------------------------------------------------------------
  console.log('\nA. e B. Tentativa de chamada à rota revogada emergency-reset-password:');
  
  // Teste sem token
  const noTokenRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/emergency-reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', newPassword: 'MaliciousResetPass123#' }),
    }),
    env,
    {} as any
  );
  console.log(`   POST sem token -> Status: ${noTokenRes.status} (esperado: 404)`);
  if (noTokenRes.status !== 404) {
    throw new Error(`CENÁRIO B FALHOU: emergency-reset-password sem token retornou ${noTokenRes.status}, esperado 404`);
  }

  // Teste com token Bearer válido
  const withTokenRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/emergency-reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.ADMIN_BOOTSTRAP_TOKEN}`,
      },
      body: JSON.stringify({ login: 'admin', newPassword: 'MaliciousResetPass123#' }),
    }),
    env,
    {} as any
  );
  console.log(`   POST com Bearer token -> Status: ${withTokenRes.status} (esperado: 404)`);
  if (withTokenRes.status !== 404) {
    throw new Error(`CENÁRIO B FALHOU: emergency-reset-password com token retornou ${withTokenRes.status}, esperado 404`);
  }

  // -------------------------------------------------------------------------
  // CENÁRIO C: Nenhuma senha é alterada ao chamar a antiga rota
  // -------------------------------------------------------------------------
  const userAfterRevokedCalls: any = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(adminId).first();
  console.log('\nC. Integridade do hash no banco após tentativas na rota revogada:');
  console.log(`   Hash idêntico ao original: ${userAfterRevokedCalls?.password_hash === adminHash}`);
  if (userAfterRevokedCalls?.password_hash !== adminHash) {
    throw new Error('CENÁRIO C FALHOU: a senha no banco foi alterada por rota revogada!');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO F: Senha incorreta retorna 401
  // -------------------------------------------------------------------------
  const wrongLoginRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: 'WrongPassword999#' }),
    }),
    env,
    {} as any
  );
  const wrongLoginJson = (await wrongLoginRes.json()) as any;
  console.log(`\nF. Login com senha errada -> Status: ${wrongLoginRes.status}, code: ${wrongLoginJson.code} (esperado: 401 INVALID_CREDENTIALS)`);
  if (wrongLoginRes.status !== 401 || wrongLoginJson.code !== 'INVALID_CREDENTIALS') {
    throw new Error('CENÁRIO F FALHOU: senha incorreta não retornou 401 INVALID_CREDENTIALS!');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO D: Login normal continua funcionando
  // -------------------------------------------------------------------------
  const loginRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: ADMIN_PASSWORD }),
    }),
    env,
    {} as any
  );
  const loginJson = (await loginRes.json()) as any;
  const setCookie = loginRes.headers.get('Set-Cookie');
  console.log(`\nD. Login com senha normal -> Status: ${loginRes.status}, ok: ${loginJson.ok}, role: ${loginJson.user?.role}`);
  if (loginRes.status !== 200 || !loginJson.ok || loginJson.user?.role !== 'ADMIN' || !setCookie) {
    throw new Error('CENÁRIO D FALHOU: login normal com senha válida falhou!');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO G: /auth/me autenticado continua funcionando
  // -------------------------------------------------------------------------
  const sessionCookie = setCookie.split(';')[0];
  const meRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/me', {
      method: 'GET',
      headers: { Cookie: sessionCookie },
    }),
    env,
    {} as any
  );
  const meJson = (await meRes.json()) as any;
  console.log(`\nG. GET /api/v1/auth/me autenticado -> Status: ${meRes.status}, login: ${meJson.user?.login}, role: ${meJson.user?.role}`);
  if (meRes.status !== 200 || !meJson.ok || meJson.user?.login !== 'admin' || meJson.user?.role !== 'ADMIN') {
    throw new Error('CENÁRIO G FALHOU: /auth/me autenticado falhou!');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO H: ADMIN mantém permissões administrativas normais
  // -------------------------------------------------------------------------
  const adminUsersGetRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/users', {
      method: 'GET',
      headers: { Cookie: sessionCookie },
    }),
    env,
    {} as any
  );
  const adminUsersGetJson = (await adminUsersGetRes.json()) as any;
  console.log(`\nH. Permissão administrativa (GET /api/v1/admin/users) -> Status: ${adminUsersGetRes.status}, total: ${adminUsersGetJson.users?.length}`);
  if (adminUsersGetRes.status !== 200 || !adminUsersGetJson.ok || !Array.isArray(adminUsersGetJson.users)) {
    throw new Error('CENÁRIO H FALHOU: admin não conseguiu acessar /api/v1/admin/users!');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO I: Criação e gestão de usuários continua funcionando perfeitamente
  // -------------------------------------------------------------------------
  const createUserRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        login: 'corretor.novo',
        name: 'Corretor Novo Teste',
        password: 'Password123#NewUser',
        role: 'SELLER',
      }),
    }),
    env,
    {} as any
  );
  const createUserJson = (await createUserRes.json()) as any;
  console.log(`\nI. Criação de usuário pelo admin -> Status: ${createUserRes.status}, ok: ${createUserJson.ok}, role: ${createUserJson.user?.role}`);
  if (createUserRes.status !== 201 || !createUserJson.ok || createUserJson.user?.role !== 'SELLER') {
    throw new Error('CENÁRIO I FALHOU: criação de novo usuário falhou!');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO J: Nenhum endpoint alternativo de emergency reset foi criado
  // -------------------------------------------------------------------------
  const alternativeRoutes = [
    '/api/v1/admin/emergency-reset',
    '/api/v1/emergency-reset',
    '/api/v1/emergency-reset-password',
    '/api/v1/admin/reset',
  ];
  console.log('\nJ. Verificação de ausência de rotas alternativas/backdoors:');
  for (const route of alternativeRoutes) {
    const altRes = await worker.fetch(
      new Request(`http://localhost${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'admin', newPassword: 'AnyPassword123#' }),
      }),
      env,
      {} as any
    );
    console.log(`   POST ${route} -> Status: ${altRes.status} (esperado: 404)`);
    if (altRes.status !== 404) {
      throw new Error(`CENÁRIO J FALHOU: rota alternativa ${route} retornou ${altRes.status}, esperado 404!`);
    }
  }

  // -------------------------------------------------------------------------
  // Validações adicionais obrigatórias: Fail-closed e Integridade de financeService
  // -------------------------------------------------------------------------
  const contractsRes = await worker.fetch(new Request('http://localhost/api/v1/contracts'), env, {} as any);
  const transactionsRes = await worker.fetch(new Request('http://localhost/api/v1/transactions'), env, {} as any);
  console.log(`\nFail-closed check: contracts ${contractsRes.status}, transactions ${transactionsRes.status}`);
  if (contractsRes.status !== 503 || transactionsRes.status !== 503) {
    throw new Error('Fail-closed violado!');
  }

  const financeContent = fs.readFileSync(path.join(process.cwd(), 'src/services/financeService.ts'), 'utf8');
  if (financeContent.length !== 6618 && financeContent.length !== 6615) {
    throw new Error(`financeService.ts violado! Tamanho: ${financeContent.length}`);
  }
  console.log(`financeService.ts intacto (${financeContent.length} bytes).`);

  console.log('\n================================================================');
  console.log('TODAS AS VERIFICAÇÕES DE REGRESSÃO DA ETAPA 3C.6 PASSARAM!');
  console.log('================================================================');
}

runRevocationRegressionTests().catch((err) => {
  console.error('Erro nos testes de regressão:', err);
  process.exit(1);
});
