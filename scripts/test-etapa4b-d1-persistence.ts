/**
 * ============================================================================
 * ETAPA 4B — VALIDAÇÃO GO-LIVE FINANCEIRO CLOUDFLARE D1
 * PERSISTÊNCIA REAL + CONTRATOS DRAFT/ACTIVE + TRANSAÇÕES + CONTROLE DE ACESSO
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index';

class D1Mock {
  public db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(':memory:');
    const m1 = fs.readFileSync(path.join(process.cwd(), 'migrations', '0001_initial.sql'), 'utf8');
    const m2 = fs.readFileSync(path.join(process.cwd(), 'migrations', '0002_cloudflare_auth.sql'), 'utf8');
    const m3 = fs.readFileSync(path.join(process.cwd(), 'migrations', '0003_login_roles.sql'), 'utf8');
    const m4 = fs.readFileSync(path.join(process.cwd(), 'migrations', '0004_contract_draft_active.sql'), 'utf8');
    
    this.db.exec(m1);
    this.db.exec(m2);
    this.db.exec(m3);
    this.db.exec(m4);
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

async function runEtapa4bTests() {
  console.log('================================================================');
  console.log('INICIANDO TESTES ETAPA 4B — GO-LIVE FINANCEIRO CLOUDFLARE D1');
  console.log('================================================================\n');

  const d1 = new D1Mock();
  const env = {
    DB: d1,
    ENVIRONMENT: 'test',
    ADMIN_BOOTSTRAP_TOKEN: 'super_secret_token_123',
    SESSION_SECRET: 'test_session_secret_at_least_32_chars_long_123456',
    ENABLE_D1_PERSISTENCE: 'true',
  };

  const executeWorker = async (url: string, options: any = {}) => {
    const req = new Request(`https://api.incorporadora.com${url}`, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
    });
    return worker.fetch(req, env as any, {} as any);
  };

  const getCookieHeader = (res: Response) => {
    return res.headers.get('set-cookie') || res.headers.get('Set-Cookie') || ((res.headers as any).getSetCookie?.()?.[0]) || '';
  };

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`✅ ${message}`);
      passed++;
    } else {
      console.error(`❌ FALHA: ${message}`);
      failed++;
    }
  }

  // 1. Bootstrap primeiro ADMIN
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
    bootstrapRes.status === 201 && bootstrapData.user?.login === 'admin.master',
    '1. Bootstrap cria primeiro admin com sucesso (201)'
  );

  // 2. Login Admin
  const adminLoginRes = await executeWorker('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin.master',
      password: 'SenhaForteAdmin123!',
    }),
  });
  const adminCookie = getCookieHeader(adminLoginRes);
  assert(
    adminLoginRes.status === 200 && adminCookie.includes('venda_ap_session='),
    '2. Login do Admin gera sessão HttpOnly (200)'
  );

  // 3. Admin cria usuário SELLER
  const sellerCreateRes = await executeWorker('/api/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      login: 'corretor.vendas',
      password: 'SenhaForteSeller123!',
      name: 'Corretor Vendas',
      role: 'SELLER',
    }),
  });
  assert(sellerCreateRes.status === 201, '3. Admin cria usuário SELLER com sucesso (201)');

  // 4. Admin cria usuário BUYER
  const buyerCreateRes = await executeWorker('/api/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      login: 'comprador.teste',
      password: 'SenhaForteBuyer123!',
      name: 'Comprador Teste',
      role: 'BUYER',
    }),
  });
  assert(buyerCreateRes.status === 201, '4. Admin cria usuário BUYER com sucesso (201)');

  // 5. Login SELLER
  const sellerLoginRes = await executeWorker('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'corretor.vendas',
      password: 'SenhaForteSeller123!',
    }),
  });
  const sellerCookie = getCookieHeader(sellerLoginRes);
  assert(sellerLoginRes.status === 200, '5. Login do SELLER com sucesso (200)');

  // 6. SELLER cria contrato em DRAFT no D1
  const contractId = 'contrato-teste-d1-4b';
  const createContractRes = await executeWorker('/api/v1/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sellerCookie },
    body: JSON.stringify({
      id: contractId,
      name: 'Apartamento 302 Residencial Solar',
      propertyDescription: 'Apto 302 com 2 vagas',
      financedAmount: 200000,
      fixedInstallment: 2500,
      annualInterestRate: 12,
      termMonths: 120,
      startDate: '2026-01-01',
      finePercent: 2,
      trMode: 'ANNUAL',
      status: 'DRAFT',
    }),
  });
  const createContractBody = await createContractRes.json() as any;
  assert(
    createContractRes.status === 201 && createContractBody.contract?.status === 'DRAFT',
    '6. SELLER cria contrato no D1 em status DRAFT (201)'
  );

  // 7. SELLER edita rascunho (salva alterações enquanto DRAFT)
  const updateDraftRes = await executeWorker(`/api/v1/contracts/${contractId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: sellerCookie },
    body: JSON.stringify({
      financedAmount: 210000,
      fixedInstallment: 2600,
      status: 'DRAFT',
    }),
  });
  const updateDraftBody = await updateDraftRes.json() as any;
  assert(
    updateDraftRes.status === 200 && updateDraftBody.contract?.financedAmount === 210000,
    '7. SELLER pode salvar alterações no rascunho enquanto DRAFT (200)'
  );

  // 8. TENTATIVA de lançamento em contrato DRAFT é REJEITADA com 400 CONTRACT_NOT_ACTIVE
  const blockedTxRes = await executeWorker('/api/v1/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sellerCookie },
    body: JSON.stringify({
      contractId: contractId,
      date: '2026-02-05',
      installmentNumber: 1,
      amount: 2600,
      type: 'PAYMENT',
      method: 'PIX',
    }),
  });
  const blockedTxBody = await blockedTxRes.json() as any;
  assert(
    blockedTxRes.status === 400 && blockedTxBody.code === 'CONTRACT_NOT_ACTIVE',
    '8. Backend bloqueia lançamento financeiro com 400 CONTRACT_NOT_ACTIVE quando status é DRAFT'
  );

  // 9. Ativação do contrato (POST /api/v1/contracts/:id/activate)
  const activateRes = await executeWorker(`/api/v1/contracts/${contractId}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sellerCookie },
  });
  const activateBody = await activateRes.json() as any;
  assert(
    activateRes.status === 200 &&
    activateBody.contract?.status === 'ACTIVE' &&
    typeof activateBody.contract?.activatedAt === 'string' &&
    activateBody.contract?.activatedBy === 'corretor.vendas',
    '9. Ativação do contrato transita status para ACTIVE com activated_at e activated_by (200)'
  );

  // 10. Tentativa de alterar parâmetros estruturais após ACTIVE é BLOQUEADA com 409 CONTRACT_LOCKED
  const blockedEditRes = await executeWorker(`/api/v1/contracts/${contractId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: sellerCookie },
    body: JSON.stringify({
      financedAmount: 300000,
    }),
  });
  const blockedEditBody = await blockedEditRes.json() as any;
  assert(
    blockedEditRes.status === 409 && blockedEditBody.code === 'CONTRACT_LOCKED',
    '10. Backend bloqueia alteração de parâmetros em contrato ACTIVE com 409 CONTRACT_LOCKED'
  );

  // 11. Novo lançamento em contrato ACTIVE é PERMITIDO com sucesso (201)
  const createTxRes = await executeWorker('/api/v1/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sellerCookie },
    body: JSON.stringify({
      contractId: contractId,
      date: '2026-02-05',
      installmentNumber: 1,
      amount: 2600,
      type: 'PAYMENT',
      method: 'PIX',
      receiptBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      receiptFileName: 'comprovante-01.png',
      receiptMimeType: 'image/png',
    }),
  });
  const createTxBody = await createTxRes.json() as any;
  assert(
    createTxRes.status === 201 && createTxBody.ok === true && createTxBody.transaction?.id,
    '11. SELLER registra lançamento com comprovante em contrato ACTIVE no D1 com sucesso (201)'
  );
  const createdTxId = createTxBody.transaction?.id;

  // 12. Listagem de lançamentos do contrato no D1
  const listTxRes = await executeWorker(`/api/v1/transactions?contractId=${encodeURIComponent(contractId)}`, {
    method: 'GET',
    headers: { Cookie: sellerCookie },
  });
  const listTxBody = await listTxRes.json() as any;
  assert(
    listTxRes.status === 200 &&
    Array.isArray(listTxBody.transactions) &&
    listTxBody.transactions.length === 1 &&
    listTxBody.transactions[0].receiptFileName === 'comprovante-01.png',
    '12. SELLER lista transações persistidas no D1 com metadados do comprovante (200)'
  );

  // 13. Login BUYER e leitura de contrato e transações
  const buyerLoginRes = await executeWorker('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'comprador.teste',
      password: 'SenhaForteBuyer123!',
    }),
  });
  const buyerCookie = getCookieHeader(buyerLoginRes);
  const buyerContractRes = await executeWorker(`/api/v1/contracts/${encodeURIComponent(contractId)}`, {
    method: 'GET',
    headers: { Cookie: buyerCookie },
  });
  assert(buyerContractRes.status === 200, '13. BUYER possui permissão de leitura do contrato ativo (200)');

  const buyerTxRes = await executeWorker(`/api/v1/transactions?contractId=${encodeURIComponent(contractId)}`, {
    method: 'GET',
    headers: { Cookie: buyerCookie },
  });
  assert(buyerTxRes.status === 200, '14. BUYER possui permissão de leitura das transações do contrato (200)');

  // 15. BUYER não pode criar lançamentos (bloqueado com 403)
  const buyerTxCreateBlocked = await executeWorker('/api/v1/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: buyerCookie },
    body: JSON.stringify({
      contractId: contractId,
      date: '2026-03-05',
      installmentNumber: 2,
      amount: 2600,
      type: 'PAYMENT',
    }),
  });
  assert(buyerTxCreateBlocked.status === 403, '15. BUYER é bloqueado com 403 ao tentar criar lançamentos');

  // 16. Exclusão de lançamento por SELLER
  const deleteTxRes = await executeWorker(`/api/v1/transactions/${encodeURIComponent(createdTxId)}?contractId=${encodeURIComponent(contractId)}`, {
    method: 'DELETE',
    headers: { Cookie: sellerCookie },
  });
  assert(deleteTxRes.status === 200, '16. SELLER exclui lançamento no D1 com sucesso (200)');

  // 17. Verificação de integridade referencial SQLite
  const fkCheck = d1.db.prepare('PRAGMA foreign_key_check').all();
  assert(fkCheck.length === 0, '17. Integridade referencial D1/SQLite: ZERO violações de foreign key');

  console.log('\n================================================================');
  console.log(`TOTAL DE TESTES: ${passed + failed}`);
  console.log(`PASSOU: ${passed}`);
  console.log(`FALHOU: ${failed}`);
  if (failed === 0) {
    console.log('STATUS: TODOS OS TESTES DA ETAPA 4B PASSARAM COM 100% DE SUCESSO!');
  } else {
    console.error('STATUS: HOUVE FALHAS NOS TESTES DA ETAPA 4B!');
    process.exit(1);
  }
  console.log('================================================================');
}

runEtapa4bTests().catch((err) => {
  console.error('Erro fatal executando testes:', err);
  process.exit(1);
});
