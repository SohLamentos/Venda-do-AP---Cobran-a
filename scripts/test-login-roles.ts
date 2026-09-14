/**
 * ============================================================================
 * TESTES OBRIGATÓRIOS — LOGIN + ROLES + ANTI-ENUMERAÇÃO + LAST ADMIN (ETAPA 3C)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker, { validateLoginFormat } from '../worker/index';

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

  prepare(query: string) {
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

async function runTests() {
  console.log('================================================================');
  console.log('INICIANDO TESTES — SUÍTE LOGIN & ROLES & ANTI-ENUMERAÇÃO (ETAPA 3C)');
  console.log('================================================================\n');

  const d1 = new D1Mock();
  const env = {
    DB: d1 as any,
    ADMIN_BOOTSTRAP_TOKEN: 'super-secret-bootstrap-token-12345',
  };

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`✅ ${name}`);
      passed++;
    } else {
      console.error(`❌ FALHA: ${name}`);
      if (details) console.error(`   Detalhes: ${details}`);
      failed++;
    }
  }

  // 1. Validação de formato de login
  assert('1. validateLoginFormat aceita login válido', validateLoginFormat('admin.master').valid);
  assert('1b. validateLoginFormat aceita alfanumérico e traço', validateLoginFormat('corretor_01-sp').valid);
  assert('1c. validateLoginFormat rejeita login curto (<3)', !validateLoginFormat('ab').valid);
  assert('1d. validateLoginFormat rejeita login com caracteres inválidos (@, espaço)', !validateLoginFormat('user@empresa').valid);

  // 2. Bootstrap do primeiro admin
  const bootstrapRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/bootstrap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer super-secret-bootstrap-token-12345',
      },
      body: JSON.stringify({
        login: 'admin.master',
        name: 'Administrador Master',
        email: 'admin@incorporadora.com',
        password: 'AdminPassword123!',
      }),
    }),
    env,
    {} as any
  );
  const bootstrapJson = (await bootstrapRes.json()) as any;
  const adminId = bootstrapJson.user?.id;
  assert(
    '2. Bootstrap cria primeiro ADMIN com login (201)',
    bootstrapRes.status === 201 && bootstrapJson.user?.login === 'admin.master' && bootstrapJson.user?.role === 'ADMIN',
    `Status: ${bootstrapRes.status}, Login: ${bootstrapJson.user?.login}`
  );

  // 3. Login com case-insensitivity (ex: Admin.Master)
  const loginCaseRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'AdMiN.MaStEr',
        password: 'AdminPassword123!',
      }),
    }),
    env,
    {} as any
  );
  const adminCookie = loginCaseRes.headers.get('Set-Cookie')?.split(';')[0] || '';
  assert(
    '3. Login é case-insensitive e autentica com sucesso (200 + Set-Cookie)',
    loginCaseRes.status === 200 && adminCookie.includes('venda_ap_session='),
    `Status: ${loginCaseRes.status}`
  );

  // 4. Anti-enumeração: Login inexistente retorna 401 INVALID_CREDENTIALS
  const notFoundLoginRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'usuario.nao.existe',
        password: 'QualquerSenha123!',
      }),
    }),
    env,
    {} as any
  );
  const notFoundJson = (await notFoundLoginRes.json()) as any;
  assert(
    '4. Anti-enumeração: Login inexistente retorna 401 { ok: false, code: "INVALID_CREDENTIALS" }',
    notFoundLoginRes.status === 401 && notFoundJson.ok === false && notFoundJson.code === 'INVALID_CREDENTIALS',
    `Status: ${notFoundLoginRes.status}, Code: ${notFoundJson.code}`
  );

  // 5. Anti-enumeração: Senha incorreta retorna 401 INVALID_CREDENTIALS
  const wrongPassLoginRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'admin.master',
        password: 'SenhaIncorreta999!',
      }),
    }),
    env,
    {} as any
  );
  const wrongPassJson = (await wrongPassLoginRes.json()) as any;
  assert(
    '5. Anti-enumeração: Senha incorreta retorna 401 { ok: false, code: "INVALID_CREDENTIALS" }',
    wrongPassLoginRes.status === 401 && wrongPassJson.ok === false && wrongPassJson.code === 'INVALID_CREDENTIALS',
    `Status: ${wrongPassLoginRes.status}, Code: ${wrongPassJson.code}`
  );

  // 6. Admin cria usuário SELLER e BUYER
  const createSellerRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        login: 'corretor.silva',
        name: 'Carlos Silva',
        password: 'SenhaCorretor123!',
        role: 'SELLER',
      }),
    }),
    env,
    {} as any
  );
  const sellerJson = (await createSellerRes.json()) as any;
  assert(
    '6. Admin cria usuário SELLER sem e-mail (e-mail opcional) com sucesso (201)',
    createSellerRes.status === 201 && sellerJson.user?.role === 'SELLER',
    `Status: ${createSellerRes.status}, Role: ${sellerJson.user?.role}`
  );

  const createBuyerRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        login: 'comprador.souza',
        name: 'Mariana Souza',
        email: 'mariana.souza@gmail.com',
        password: 'SenhaComprador123!',
        role: 'BUYER',
      }),
    }),
    env,
    {} as any
  );
  const buyerJson = (await createBuyerRes.json()) as any;
  const buyerId = buyerJson.user?.id;
  assert(
    '7. Admin cria usuário BUYER com e-mail com sucesso (201)',
    createBuyerRes.status === 201 && buyerJson.user?.role === 'BUYER',
    `Status: ${createBuyerRes.status}, Role: ${buyerJson.user?.role}`
  );

  // 8. Admin desativa usuário BUYER
  const disableBuyerRes = await worker.fetch(
    new Request(`http://localhost/api/v1/admin/users/${buyerId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({ status: 'DISABLED' }),
    }),
    env,
    {} as any
  );
  assert(
    '8. Admin desativa usuário BUYER (200)',
    disableBuyerRes.status === 200,
    `Status: ${disableBuyerRes.status}`
  );

  // 9. Anti-enumeração: Usuário DISABLED tenta logar e recebe 401 INVALID_CREDENTIALS (sem revelar USER_DISABLED)
  const disabledLoginRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'comprador.souza',
        password: 'SenhaComprador123!',
      }),
    }),
    env,
    {} as any
  );
  const disabledJson = (await disabledLoginRes.json()) as any;
  assert(
    '9. Anti-enumeração estrita: Usuário DISABLED retorna 401 { ok: false, code: "INVALID_CREDENTIALS" }',
    disabledLoginRes.status === 401 && disabledJson.ok === false && disabledJson.code === 'INVALID_CREDENTIALS',
    `Status: ${disabledLoginRes.status}, Code: ${disabledJson.code}`
  );

  // 10. Proteção Último Admin: Tentativa de mudar role do único ADMIN ativo retorna 409 LAST_ADMIN_PROTECTION
  const demoteAdminRes = await worker.fetch(
    new Request(`http://localhost/api/v1/admin/users/${adminId}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({ role: 'SELLER' }),
    }),
    env,
    {} as any
  );
  const demoteJson = (await demoteAdminRes.json()) as any;
  assert(
    '10. Proteção: Bloqueio 409 { ok: false, code: "LAST_ADMIN_PROTECTION" } ao tentar mudar role do único ADMIN ativo',
    demoteAdminRes.status === 409 && demoteJson.ok === false && demoteJson.code === 'LAST_ADMIN_PROTECTION',
    `Status: ${demoteAdminRes.status}, Code: ${demoteJson.code}`
  );

  // 11. Proteção Último Admin: Tentativa de desativar o único ADMIN ativo retorna 409 LAST_ADMIN_PROTECTION
  const disableAdminRes = await worker.fetch(
    new Request(`http://localhost/api/v1/admin/users/${adminId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({ status: 'DISABLED' }),
    }),
    env,
    {} as any
  );
  const disableJson = (await disableAdminRes.json()) as any;
  assert(
    '11. Proteção: Bloqueio 409 { ok: false, code: "LAST_ADMIN_PROTECTION" } ao tentar desativar o único ADMIN ativo',
    disableAdminRes.status === 409 && disableJson.ok === false && disableJson.code === 'LAST_ADMIN_PROTECTION',
    `Status: ${disableAdminRes.status}, Code: ${disableJson.code}`
  );

  // 12. Execução de PRAGMA foreign_key_check
  // Criar contrato e sessão vinculados ao admin para validar FK
  d1.exec(`
    INSERT INTO contracts (id, user_id, name, start_date)
    VALUES ('contrato-admin-1', '${adminId}', 'Contrato do Admin', '2026-01-01');
  `);

  const fkCheckResults = d1.exec('PRAGMA foreign_key_check;');
  const checkStmt = d1.prepare('PRAGMA foreign_key_check;').all();
  const fkViolations = (await checkStmt).results;
  assert(
    '12. PRAGMA foreign_key_check retorna ZERO violações de integridade',
    Array.isArray(fkViolations) && fkViolations.length === 0,
    `Violações encontradas: ${fkViolations.length}`
  );

  console.log('\n================================================================');
  console.log(`TOTAL DE TESTES: ${passed + failed}`);
  console.log(`PASSOU: ${passed}`);
  console.log(`FALHOU: ${failed}`);
  if (failed === 0) {
    console.log('STATUS: TODOS OS TESTES PASSARAM COM SUCESSO!');
  } else {
    console.error('STATUS: HOUVE FALHAS NOS TESTES.');
    process.exit(1);
  }
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
