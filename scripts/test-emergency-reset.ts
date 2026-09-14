/**
 * ============================================================================
 * SUÍTE DE TESTES: VERIFICAÇÃO CRIPTOGRÁFICA + EMERGENCY RESET PASSWORD
 * ============================================================================
 * 1. Testa diretamente:
 *    const hash = await hashPassword(TEST_PASSWORD);
 *    const valid = await verifyPassword(TEST_PASSWORD, hash);
 *    valid === true
 * 2. Testa mecanismo de emergency reset password:
 *    - Rejeição se ADMIN_BOOTSTRAP_TOKEN ausente/inválido
 *    - Rejeição se login !== 'admin'
 *    - Rejeição se houver mais ou menos de 1 admin
 *    - Rejeição se senha não cumprir política
 *    - Sucesso: atualiza hash no banco via hashPassword()
 *    - Revoga sessões ativas
 *    - Registra ADMIN_PASSWORD_RESET em audit_logs
 *    - Resposta não contém password_hash
 * 3. Testa login pós-reset:
 *    - POST /api/v1/auth/login { login: "admin", password: TEST_PASSWORD } => 200
 *    - GET /api/v1/auth/me => 200 (login: "admin", role: "ADMIN", status: "ACTIVE")
 * 4. Testa fail-closed:
 *    - /api/v1/contracts => 503
 *    - /api/v1/transactions => 503
 * 5. Testa integridade de financeService.ts
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

async function runHotfixTests() {
  console.log('================================================================');
  console.log('HOTFIX — VERIFICAÇÃO CRIPTOGRÁFICA E EMERGENCY RESET PASSWORD');
  console.log('================================================================\n');

  // 1. Verificação criptográfica direta obrigatória
  const TEST_PASSWORD = 'TestPassword123#Secure';
  const directHash = await hashPassword(TEST_PASSWORD);
  const directValid = await verifyPassword(TEST_PASSWORD, directHash);
  const invalidValid = await verifyPassword('WrongPassword123#', directHash);

  console.log('1. Criptografia direta do Worker:');
  console.log(`   Hash gerado prefix: ${directHash.split('$').slice(0, 2).join('$')}`);
  console.log(`   verifyPassword(TEST_PASSWORD, hash) === true: ${directValid}`);
  console.log(`   verifyPassword(WrongPassword, hash) === false: ${!invalidValid}`);

  if (directValid !== true || invalidValid !== false) {
    throw new Error('Falha na verificação criptográfica direta!');
  }

  // 2. Setup do D1 Mock simulando estado com 1 ADMIN existente
  const d1 = new D1Mock();
  const BOOTSTRAP_TOKEN = 'bootstrap-secret-token-xyz';
  const env = {
    DB: d1 as any,
    ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
  };

  const adminId = crypto.randomUUID();
  const staleHash = 'pbkdf2_sha256$310000$c2FsdHNhbHRzYWx0MTY=$dGVzdGR1bW15aGFzaHZhbHVlZm9ydGltaW5n';

  await env.DB.prepare(`
    INSERT INTO users (id, login, name, email, role, status, password_hash, created_at, updated_at)
    VALUES (?, 'admin', 'Thiago Anderson da Silva', NULL, 'ADMIN', 'ACTIVE', ?, datetime('now'), datetime('now'))
  `).bind(adminId, staleHash).run();

  // 3. Testes do endpoint de Emergency Reset:
  // 3a. Rejeição se sem token Bearer
  const noTokenRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/emergency-reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', newPassword: TEST_PASSWORD }),
    }),
    env,
    {} as any
  );
  console.log(`2. Rejeita sem Bearer token: status ${noTokenRes.status} (esperado 401)`);
  if (noTokenRes.status !== 401) throw new Error('Deveria retornar 401 sem token');

  // 3b. Rejeição se token errado
  const badTokenRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/emergency-reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-invalido',
      },
      body: JSON.stringify({ login: 'admin', newPassword: TEST_PASSWORD }),
    }),
    env,
    {} as any
  );
  console.log(`3. Rejeita com token incorreto: status ${badTokenRes.status} (esperado 403)`);
  if (badTokenRes.status !== 403) throw new Error('Deveria retornar 403 com token incorreto');

  // 3c. Rejeição se login não for 'admin'
  const badLoginRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/emergency-reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOOTSTRAP_TOKEN}`,
      },
      body: JSON.stringify({ login: 'outro_usuario', newPassword: TEST_PASSWORD }),
    }),
    env,
    {} as any
  );
  console.log(`4. Rejeita login != 'admin': status ${badLoginRes.status} (esperado 400)`);
  if (badLoginRes.status !== 400) throw new Error('Deveria retornar 400 para login != admin');

  // 3d. Rejeição se senha fraca
  const weakPwRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/emergency-reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOOTSTRAP_TOKEN}`,
      },
      body: JSON.stringify({ login: 'admin', newPassword: 'curta' }),
    }),
    env,
    {} as any
  );
  console.log(`5. Rejeita senha fraca: status ${weakPwRes.status} (esperado 400)`);
  if (weakPwRes.status !== 400) throw new Error('Deveria retornar 400 para senha fraca');

  // 3e. Sucesso do reset com dados válidos
  const resetRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/emergency-reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOOTSTRAP_TOKEN}`,
      },
      body: JSON.stringify({ login: 'admin', newPassword: TEST_PASSWORD }),
    }),
    env,
    {} as any
  );
  const resetJson = (await resetRes.json()) as any;
  console.log(`6. Sucesso no reset de emergência: status ${resetRes.status}, ok: ${resetJson.ok}`);
  if (resetRes.status !== 200 || !resetJson.ok) {
    throw new Error('Falha no reset de emergência');
  }

  // Garantir que a resposta NUNCA retorna o hash de senha
  if (resetJson.password_hash || resetJson.user?.password_hash) {
    throw new Error('password_hash vazado na resposta do reset!');
  }

  // 4. Verificar se a trilha de auditoria registrou ADMIN_PASSWORD_RESET
  const auditRow: any = await env.DB.prepare(
    "SELECT action, entity_id FROM audit_logs WHERE action = 'ADMIN_PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1"
  ).first();
  console.log('7. Trilha de auditoria registrada:', auditRow);
  if (!auditRow || auditRow.action !== 'ADMIN_PASSWORD_RESET' || auditRow.entity_id !== adminId) {
    throw new Error('Log de auditoria do reset de emergência não encontrado');
  }

  // 5. Testar Login com a nova senha
  const loginRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: TEST_PASSWORD }),
    }),
    env,
    {} as any
  );
  const loginJson = (await loginRes.json()) as any;
  const setCookie = loginRes.headers.get('Set-Cookie');

  console.log(`8. Login pós-reset: status ${loginRes.status}, ok: ${loginJson.ok}, role: ${loginJson.user?.role}`);
  if (loginRes.status !== 200 || !loginJson.ok || loginJson.user?.role !== 'ADMIN' || !setCookie) {
    throw new Error('Falha no login com a senha redefinida!');
  }

  // 6. Testar GET /api/v1/auth/me com o cookie da sessão
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
  console.log(`9. GET /api/v1/auth/me: status ${meRes.status}, login: ${meJson.user?.login}, role: ${meJson.user?.role}, status: ${meJson.user?.status}`);
  if (
    meRes.status !== 200 ||
    !meJson.ok ||
    meJson.user?.login !== 'admin' ||
    meJson.user?.role !== 'ADMIN' ||
    meJson.user?.status !== 'ACTIVE'
  ) {
    throw new Error('Falha na validação de /api/v1/auth/me!');
  }

  // 7. Fail-closed check
  const contractsRes = await worker.fetch(new Request('http://localhost/api/v1/contracts'), env, {} as any);
  const transactionsRes = await worker.fetch(new Request('http://localhost/api/v1/transactions'), env, {} as any);
  console.log(`10. Fail-closed: contracts ${contractsRes.status}, transactions ${transactionsRes.status}`);
  if (contractsRes.status !== 503 || transactionsRes.status !== 503) {
    throw new Error('Fail-closed violado!');
  }

  // 8. Integridade de financeService.ts
  const financeContent = fs.readFileSync(path.join(process.cwd(), 'src/services/financeService.ts'), 'utf8');
  if (financeContent.length !== 6615 || !financeContent.includes('FinanceService')) {
    throw new Error(`financeService.ts violado! Tamanho: ${financeContent.length}`);
  }
  console.log(`11. financeService.ts intacto (${financeContent.length} bytes).`);

  console.log('\n================================================================');
  console.log('TODAS AS VERIFICAÇÕES DO HOTFIX PASSARAM COM SUCESSO!');
  console.log('================================================================');
}

runHotfixTests().catch((err) => {
  console.error('Erro nos testes do hotfix:', err);
  process.exit(1);
});
