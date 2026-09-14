/**
 * ============================================================================
 * TESTE ESPECÍFICO DO ADMIN PROVISIONADO: THIAGO ANDERSON DA SILVA (admin)
 * ============================================================================
 * Valida o provisionamento direto e o fluxo completo de autenticação:
 * - Inserção segura com hash PBKDF2 idêntico ao do Worker
 * - Verificação de COUNT(*) = 0 antes da inserção
 * - Inserção de exatamente UM usuário
 * - Consulta SELECT conferindo colunas
 * - Teste POST /api/v1/auth/login com login: 'admin', senha: 'Moniqu300#'
 *   -> Retorno 200, cookie venda_ap_session, role ADMIN
 * - Teste GET /api/v1/auth/me
 *   -> Retorno 200, login: 'admin', role: 'ADMIN', status: 'ACTIVE'
 * - Validação de fail-closed para contracts (503) e transactions (503)
 * - Verificação de integridade de financeService.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker, { hashPassword } from '../worker/index';

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

async function runValidation() {
  console.log('================================================================');
  console.log('VALIDAÇÃO COMPLETA: PROVISIONAMENTO DO PRIMEIRO ADMIN');
  console.log('================================================================\n');

  const d1 = new D1Mock();
  const env = {
    DB: d1 as any,
    ADMIN_BOOTSTRAP_TOKEN: 'token-teste-12345',
  };

  // 1. Verificar users antes: COUNT(*) = 0
  const countBeforeStmt: any = await env.DB.prepare('SELECT COUNT(*) AS total FROM users;').first();
  const totalBefore = Number(countBeforeStmt?.total ?? 0);
  console.log(`1. Total de usuários antes: ${totalBefore}`);
  if (totalBefore !== 0) {
    throw new Error('A tabela users não está vazia.');
  }

  // 2. Gerar hash com a função oficial do Worker
  const rawPassword = 'Moniqu300#';
  const passwordHash = await hashPassword(rawPassword);
  const userId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  // 3. Inserir primeiro admin
  await env.DB.prepare(`
    INSERT INTO users (
      id,
      login,
      name,
      email,
      role,
      status,
      password_hash,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    userId,
    'admin',
    'Thiago Anderson da Silva',
    null,
    'ADMIN',
    'ACTIVE',
    passwordHash
  ).run();

  // 4. Inserir log de auditoria
  await env.DB.prepare(`
    INSERT INTO audit_logs (
      id,
      contract_id,
      user_id,
      action,
      entity_type,
      entity_id,
      details,
      ip_address,
      created_at
    ) VALUES (?, NULL, ?, 'USER_CREATED', 'USER', ?, 'Primeiro ADMIN provisionado: admin', 'SYSTEM_PROVISION', datetime('now'))
  `).bind(auditId, userId, userId).run();

  // 5. Validar registro inserido
  const queryResult: any = await env.DB.prepare(`
    SELECT
      id,
      login,
      name,
      email,
      role,
      status,
      created_at
    FROM users
    WHERE id = ?;
  `).bind(userId).first();

  console.log('2. Usuário validado após inserção:', {
    id: queryResult.id,
    login: queryResult.login,
    name: queryResult.name,
    email: queryResult.email,
    role: queryResult.role,
    status: queryResult.status,
    created_at: queryResult.created_at,
  });

  if (
    queryResult.login !== 'admin' ||
    queryResult.name !== 'Thiago Anderson da Silva' ||
    queryResult.email !== null ||
    queryResult.role !== 'ADMIN' ||
    queryResult.status !== 'ACTIVE'
  ) {
    throw new Error('Dados do usuário criado divergem do esperado.');
  }

  // 6. Validar POST /api/v1/auth/login
  const loginRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'admin',
        password: rawPassword,
      }),
    }),
    env,
    {} as any
  );

  const loginJson = await loginRes.json() as any;
  const setCookie = loginRes.headers.get('Set-Cookie');

  console.log('3. Teste de Login:', {
    status: loginRes.status,
    ok: loginJson.ok,
    role: loginJson.user?.role,
    hasSessionCookie: !!(setCookie && setCookie.includes('venda_ap_session=')),
  });

  if (loginRes.status !== 200 || !loginJson.ok || loginJson.user?.role !== 'ADMIN' || !setCookie) {
    throw new Error('Falha no POST /api/v1/auth/login com credenciais provisionadas.');
  }

  // 7. Validar GET /api/v1/auth/me
  const cookieValue = setCookie.split(';')[0];
  const meRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/me', {
      method: 'GET',
      headers: {
        Cookie: cookieValue,
      },
    }),
    env,
    {} as any
  );

  const meJson = await meRes.json() as any;
  console.log('4. Teste GET /api/v1/auth/me:', {
    status: meRes.status,
    ok: meJson.ok,
    login: meJson.user?.login,
    name: meJson.user?.name,
    role: meJson.user?.role,
    statusVal: meJson.user?.status,
  });

  if (
    meRes.status !== 200 ||
    !meJson.ok ||
    meJson.user?.login !== 'admin' ||
    meJson.user?.role !== 'ADMIN' ||
    meJson.user?.status !== 'ACTIVE'
  ) {
    throw new Error('Falha no GET /api/v1/auth/me com sessão do ADMIN.');
  }

  // 8. Validar Fail-closed
  const contractsRes = await worker.fetch(new Request('http://localhost/api/v1/contracts'), env, {} as any);
  const transactionsRes = await worker.fetch(new Request('http://localhost/api/v1/transactions'), env, {} as any);

  console.log('5. Fail-closed check:', {
    contractsStatus: contractsRes.status,
    transactionsStatus: transactionsRes.status,
  });

  if (contractsRes.status !== 503 || transactionsRes.status !== 503) {
    throw new Error('Contracts ou Transactions não responderam 503 fail-closed.');
  }

  // 9. Validar integridade do financeService.ts
  const financeContent = fs.readFileSync(path.join(process.cwd(), 'src/services/financeService.ts'), 'utf8');
  if (financeContent.length !== 6615 || !financeContent.includes('FinanceService')) {
    throw new Error(`financeService.ts alterado! Tamanho atual: ${financeContent.length}, esperado: 6615`);
  }
  console.log('6. financeService.ts verificado: intacto (6615 bytes).');

  console.log('\n================================================================');
  console.log('TODAS AS VALIDAÇÕES LOCAIS CONCLUÍDAS COM 100% DE SUCESSO!');
  console.log('================================================================');
}

runValidation().catch((err) => {
  console.error('Erro na validação:', err);
  process.exit(1);
});
