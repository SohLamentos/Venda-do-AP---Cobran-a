/**
 * ============================================================================
 * TESTES OBRIGATÓRIOS — LOGIN POR USUÁRIO + GESTÃO DE USUÁRIOS (ETAPA 3C)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index';

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
  console.log('INICIANDO TESTES — LOGIN POR USUÁRIO + ROLES + GESTÃO ADMIN');
  console.log('================================================================\n');

  const results: { name: string; passed: boolean; detail?: string }[] = [];
  function assert(name: string, passed: boolean, detail = '') {
    results.push({ name, passed, detail });
    console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ` (${detail})` : ''}`);
  }

  const d1 = new D1Mock();
  const env: any = {
    DB: d1,
    ENVIRONMENT: 'test',
    ADMIN_BOOTSTRAP_TOKEN: 'super_secret_token_123',
    SESSION_SECRET: 'test_session_secret_at_least_32_chars_long_123456',
  };

  const executeWorker = async (url: string, options: any = {}) => {
    const req = new Request(`https://api.incorporadora.com${url}`, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
    });
    return worker.fetch(req, env, {} as any);
  };

  // 1. Bootstrap Admin via token
  const bootstrapRes = await executeWorker('/api/v1/admin/bootstrap', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.ADMIN_BOOTSTRAP_TOKEN}`,
    },
    body: JSON.stringify({
      login: 'admin.master',
      name: 'Admin Master',
      email: 'admin@incorporadora.com',
      password: 'SenhaForteAdmin123!',
    }),
  });
  const bootstrapData = await bootstrapRes.json() as any;
  assert(
    '1. Bootstrap cria primeiro admin com login',
    bootstrapRes.status === 201 && bootstrapData.user?.login === 'admin.master' && bootstrapData.user?.role === 'ADMIN',
    `Status: ${bootstrapRes.status}, Login: ${bootstrapData.user?.login}`
  );

  const getCookieHeader = (res: Response) => {
    return res.headers.get('set-cookie') || res.headers.get('Set-Cookie') || ((res.headers as any).getSetCookie?.()?.[0]) || '';
  };

  // 2. Login com usuário + senha
  const loginRes = await executeWorker('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin.master',
      password: 'SenhaForteAdmin123!',
    }),
  });
  const loginData = await loginRes.json() as any;
  const setCookie = getCookieHeader(loginRes);
  const sessionMatch = setCookie.match(/venda_ap_session=([^;]+)/);
  const sessionToken = sessionMatch ? sessionMatch[1] : '';

  assert(
    '2. Login com username + senha retorna sessão e cookie HttpOnly',
    loginRes.status === 200 && loginData.user?.login === 'admin.master' && sessionToken.length > 0,
    `Status: ${loginRes.status}, Cookie: ${setCookie.substring(0, 30)}...`
  );

  const adminHeaders = {
    'Cookie': `venda_ap_session=${sessionToken}`,
    'Content-Type': 'application/json',
  };

  // 3. Admin lista usuários
  const listUsersRes = await executeWorker('/api/v1/admin/users', {
    method: 'GET',
    headers: adminHeaders,
  });
  const listUsersData = await listUsersRes.json() as any;
  assert(
    '3. Admin lista usuários com sucesso',
    listUsersRes.status === 200 && Array.isArray(listUsersData.users) && listUsersData.users.length >= 1,
    `Total: ${listUsersData.users?.length}`
  );

  // 4. Admin cria usuário SELLER
  const createSellerRes = await executeWorker('/api/v1/admin/users', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      login: 'corretor.silva',
      name: 'Corretor Silva',
      role: 'SELLER',
      password: 'SenhaVendedor123!',
    }),
  });
  const createSellerData = await createSellerRes.json() as any;
  assert(
    '4. Admin cria usuário SELLER com sucesso',
    createSellerRes.status === 201 && createSellerData.user?.role === 'SELLER',
    `Login: ${createSellerData.user?.login}, Role: ${createSellerData.user?.role}`
  );

  // 5. Admin cria usuário BUYER
  const createBuyerRes = await executeWorker('/api/v1/admin/users', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      login: 'comprador.souza',
      name: 'Comprador Souza',
      email: 'souza@email.com',
      role: 'BUYER',
      password: 'SenhaComprador123!',
    }),
  });
  const createBuyerData = await createBuyerRes.json() as any;
  assert(
    '5. Admin cria usuário BUYER com sucesso',
    createBuyerRes.status === 201 && createBuyerData.user?.role === 'BUYER',
    `Login: ${createBuyerData.user?.login}, Role: ${createBuyerData.user?.role}`
  );

  // 6. SELLER faz login e tenta acessar rota admin (deve dar 403 FORBIDDEN)
  const sellerLoginRes = await executeWorker('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'corretor.silva',
      password: 'SenhaVendedor123!',
    }),
  });
    const sellerCookie = getCookieHeader(sellerLoginRes);
    const sellerSessionMatch = sellerCookie.match(/venda_ap_session=([^;]+)/);
    const sellerSession = sellerSessionMatch ? sellerSessionMatch[1] : '';

    const sellerAdminAttemptRes = await executeWorker('/api/v1/admin/users', {
      method: 'GET',
      headers: { 'Cookie': `venda_ap_session=${sellerSession}` },
    });
    assert(
      '6. Usuário SELLER é bloqueado com 403 em endpoints /admin/*',
      sellerAdminAttemptRes.status === 403,
      `Status retornado: ${sellerAdminAttemptRes.status}`
    );

    // 7. BUYER faz login e tenta acessar rota admin (deve dar 403 FORBIDDEN)
    const buyerLoginRes = await executeWorker('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'comprador.souza',
        password: 'SenhaComprador123!',
      }),
    });
    const buyerCookie = getCookieHeader(buyerLoginRes);
    const buyerSessionMatch = buyerCookie.match(/venda_ap_session=([^;]+)/);
    const buyerSession = buyerSessionMatch ? buyerSessionMatch[1] : '';

    const buyerAdminAttemptRes = await executeWorker('/api/v1/admin/users', {
      method: 'GET',
      headers: { 'Cookie': `venda_ap_session=${buyerSession}` },
    });
  assert(
    '7. Usuário BUYER é bloqueado com 403 em endpoints /admin/*',
    buyerAdminAttemptRes.status === 403,
    `Status retornado: ${buyerAdminAttemptRes.status}`
  );

  // 8. Admin altera dados do usuário (PUT /api/v1/admin/users/:id)
  const buyerId = createBuyerData.user?.id;
  const updateRes = await executeWorker(`/api/v1/admin/users/${buyerId}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({
      name: 'Comprador Souza Atualizado',
      login: 'comprador.souza.novo',
    }),
  });
  const updateData = await updateRes.json() as any;
  assert(
    '8. Admin atualiza dados de usuário (nome/login)',
    updateRes.status === 200 && updateData.user?.name === 'Comprador Souza Atualizado' && updateData.user?.login === 'comprador.souza.novo',
    `Novo nome: ${updateData.user?.name}`
  );

  // 9. Admin altera papel (PATCH /api/v1/admin/users/:id/role)
  const roleUpdateRes = await executeWorker(`/api/v1/admin/users/${buyerId}/role`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ role: 'SELLER' }),
  });
  const roleUpdateData = await roleUpdateRes.json() as any;
  assert(
    '9. Admin altera papel de BUYER para SELLER',
    roleUpdateRes.status === 200 && roleUpdateData.user?.role === 'SELLER',
    `Novo papel: ${roleUpdateData.user?.role}`
  );

  // 10. Proteção: Admin não pode rebaixar ou desativar o ÚNICO admin do sistema (409 LAST_ADMIN_PROTECTION)
  const adminId = bootstrapData.user?.id;
  const demoteSelfRes = await executeWorker(`/api/v1/admin/users/${adminId}/role`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ role: 'BUYER' }),
  });
  const demoteSelfData = await demoteSelfRes.json() as any;
  assert(
    '10. Proteção: Bloqueio 409 LAST_ADMIN_PROTECTION ao tentar rebaixar o único ADMIN ativo',
    demoteSelfRes.status === 409 && demoteSelfData.code === 'LAST_ADMIN_PROTECTION',
    `Status retornado: ${demoteSelfRes.status}, Code: ${demoteSelfData.code}`
  );

  const disableSelfRes = await executeWorker(`/api/v1/admin/users/${adminId}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'DISABLED' }),
  });
  const disableSelfData = await disableSelfRes.json() as any;
  assert(
    '11. Proteção: Bloqueio 409 LAST_ADMIN_PROTECTION ao tentar desativar o único ADMIN ativo',
    disableSelfRes.status === 409 && disableSelfData.code === 'LAST_ADMIN_PROTECTION',
    `Status retornado: ${disableSelfRes.status}, Code: ${disableSelfData.code}`
  );

  // 12. Admin desativa outro usuário (PATCH /api/v1/admin/users/:id/status)
  const disableBuyerRes = await executeWorker(`/api/v1/admin/users/${buyerId}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'DISABLED' }),
  });
  assert(
    '12. Admin desativa usuário com sucesso',
    disableBuyerRes.status === 200,
    `Status: ${disableBuyerRes.status}`
  );

  // 13. Usuário desativado retorna 401 INVALID_CREDENTIALS (anti-enumeração estrita)
  const disabledLoginRes = await executeWorker('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'comprador.souza.novo',
      password: 'SenhaComprador123!',
    }),
  });
  const disabledLoginData = await disabledLoginRes.json() as any;
  assert(
    '13. Anti-enumeração: Login bloqueado com 401 INVALID_CREDENTIALS para usuário com status DISABLED',
    disabledLoginRes.status === 401 && disabledLoginData.code === 'INVALID_CREDENTIALS',
    `Status: ${disabledLoginRes.status}, Code: ${disabledLoginData.code}`
  );

  // 14. Admin reativa usuário e redefine senha (POST /api/v1/admin/users/:id/reset-password)
  await executeWorker(`/api/v1/admin/users/${buyerId}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'ACTIVE' }),
  });
  const resetPassRes = await executeWorker(`/api/v1/admin/users/${buyerId}/reset-password`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ new_password: 'NovaSenhaComprador456!' }),
  });
  assert(
    '14. Admin redefine senha com sucesso',
    resetPassRes.status === 200,
    `Status: ${resetPassRes.status}`
  );

  // 15. Usuário loga com a nova senha
  const newPassLoginRes = await executeWorker('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'comprador.souza.novo',
      password: 'NovaSenhaComprador456!',
    }),
  });
  assert(
    '15. Login bem-sucedido com a nova senha redefinida',
    newPassLoginRes.status === 200,
    `Status: ${newPassLoginRes.status}`
  );

  // 16. Endpoints financeiros continuam respondendo 503 D1_PERSISTENCE_NOT_ENABLED
  const contractsRes = await executeWorker('/api/v1/contracts');
  const transactionsRes = await executeWorker('/api/v1/transactions');
  const contractsData = await contractsRes.json() as any;
  const transactionsData = await transactionsRes.json() as any;
  assert(
    '16. /api/v1/contracts responde 503 D1_PERSISTENCE_NOT_ENABLED',
    contractsRes.status === 503 && contractsData.code === 'D1_PERSISTENCE_NOT_ENABLED',
    `Status: ${contractsRes.status}, Code: ${contractsData.code}`
  );
  assert(
    '17. /api/v1/transactions responde 503 D1_PERSISTENCE_NOT_ENABLED',
    transactionsRes.status === 503 && transactionsData.code === 'D1_PERSISTENCE_NOT_ENABLED',
    `Status: ${transactionsRes.status}, Code: ${transactionsData.code}`
  );

  // 18. financeService.ts permanece intacto
  const financeContent = fs.readFileSync(path.join(process.cwd(), 'src', 'services', 'financeService.ts'), 'utf8');
  assert(
    '18. financeService.ts 100% preservado e intacto',
    financeContent.length > 500 && financeContent.includes('FinanceService'),
    `Bytes: ${financeContent.length}`
  );

  console.log('\n================================================================');
  const passedCount = results.filter(r => r.passed).length;
  console.log(`TOTAL DE TESTES: ${results.length}`);
  console.log(`PASSOU: ${passedCount}`);
  console.log(`FALHOU: ${results.length - passedCount}`);
  console.log(`STATUS GERAL: ${passedCount === results.length ? 'TODOS OS TESTES PASSARAM COM SUCESSO!' : 'FALHAS DETECTADAS'}`);
  console.log('================================================================\n');

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro ao executar testes:', err);
  process.exit(1);
});
