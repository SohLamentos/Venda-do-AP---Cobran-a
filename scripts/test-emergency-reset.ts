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

  // -------------------------------------------------------------------------
  // TESTE A: hashPassword("senha válida")
  // Formato pbkdf2_sha256$100000$..., salt 16 bytes, derived key 32 bytes
  // -------------------------------------------------------------------------
  const TEST_PASSWORD = 'TestPassword123#Secure';
  const directHash = await hashPassword(TEST_PASSWORD);
  const hashParts = directHash.split('$');
  const saltDecoded = Buffer.from(hashParts[2], 'base64');
  const keyDecoded = Buffer.from(hashParts[3], 'base64');

  console.log('A. hashPassword formato e derivação PBKDF2 (100.000 iterações):');
  console.log(`   Formato prefix: ${hashParts[0]}`);
  console.log(`   Iterações: ${hashParts[1]} (esperado: 100000)`);
  console.log(`   Salt length: ${saltDecoded.length} bytes (esperado: 16)`);
  console.log(`   Derived key length: ${keyDecoded.length} bytes (esperado: 32)`);

  if (
    hashParts.length !== 4 ||
    hashParts[0] !== 'pbkdf2_sha256' ||
    hashParts[1] !== '100000' ||
    saltDecoded.length !== 16 ||
    keyDecoded.length !== 32
  ) {
    throw new Error('TESTE A FALHOU: formato ou parâmetros PBKDF2 incorretos!');
  }

  // -------------------------------------------------------------------------
  // TESTE B: verifyPassword com hash de 100000 iterações
  // Senha correta -> true; Senha errada -> false
  // -------------------------------------------------------------------------
  const directValid = await verifyPassword(TEST_PASSWORD, directHash);
  const invalidValid = await verifyPassword('WrongPassword123#', directHash);
  console.log('B. verifyPassword com hash de 100.000 iterações:');
  console.log(`   Senha correta -> true: ${directValid}`);
  console.log(`   Senha errada -> false: ${!invalidValid}`);

  if (directValid !== true || invalidValid !== false) {
    throw new Error('TESTE B FALHOU: validação com 100.000 iterações incorreta!');
  }

  // -------------------------------------------------------------------------
  // TESTE F: hash legado 310000 recebido pelo verifyPassword
  // NÃO causar exceção não tratada / HTTP 500, comportamento fail-closed controlado
  // -------------------------------------------------------------------------
  const legacyHash310k = 'pbkdf2_sha256$310000$c2FsdHNhbHRzYWx0MTY=$dGVzdGR1bW15aGFzaHZhbHVlZm9ydGltaW5n';
  let legacyThrew = false;
  let legacyResult: boolean | null = null;
  try {
    legacyResult = await verifyPassword('QualquerSenha123#', legacyHash310k);
  } catch (_e) {
    legacyThrew = true;
  }
  console.log('F. Tratamento de hash legado 310.000 iterações:');
  console.log(`   Exceção lançada: ${legacyThrew} (esperado: false)`);
  console.log(`   Resultado: ${legacyResult} (esperado: false - fail-closed seguro)`);

  if (legacyThrew || legacyResult !== false) {
    throw new Error('TESTE F FALHOU: hash legado causou exceção ou não retornou fail-closed false!');
  }

  // 2. Setup do D1 Mock simulando estado com 1 ADMIN existente possuindo hash legado 310.000
  const d1 = new D1Mock();
  const BOOTSTRAP_TOKEN = 'bootstrap-secret-token-xyz';
  const env = {
    DB: d1 as any,
    ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
  };

  const adminId = crypto.randomUUID();
  const staleHash = legacyHash310k;

  await env.DB.prepare(`
    INSERT INTO users (id, login, name, email, role, status, password_hash, created_at, updated_at)
    VALUES (?, 'admin', 'Thiago Anderson da Silva', NULL, 'ADMIN', 'ACTIVE', ?, datetime('now'), datetime('now'))
  `).bind(adminId, staleHash).run();

  // 3. Testes do endpoint de Emergency Reset:
  // 3a. Rejeição se sem token Bearer (A: token inválido -> 401)
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

  // 3b. Rejeição se token errado (A: token inválido -> 403)
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

  // 3c. Rejeição se login inexistente (B: admin inexistente -> 400 ou 404 fail-closed)
  const nonExistentRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/emergency-reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOOTSTRAP_TOKEN}`,
      },
      body: JSON.stringify({ login: 'usuario_inexistente', newPassword: TEST_PASSWORD }),
    }),
    env,
    {} as any
  );
  console.log(`4. Rejeita login não admin: status ${nonExistentRes.status} (esperado 400)`);
  if (nonExistentRes.status !== 400) throw new Error('Deveria retornar 400 para login != admin');

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

  // 3e. Cenário C: admin com status DISABLED -> fail closed (403)
  await env.DB.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").bind(adminId).run();
  const disabledAdminRes = await worker.fetch(
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
  console.log(`6. Rejeita admin DISABLED: status ${disabledAdminRes.status} (esperado 403)`);
  if (disabledAdminRes.status !== 403) throw new Error('Deveria retornar 403 para admin DISABLED');
  await env.DB.prepare("UPDATE users SET status = 'ACTIVE' WHERE id = ?").bind(adminId).run();

  // 3f. Cenário C: mais de 1 administrador no sistema -> fail closed (412)
  const secondAdminId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO users (id, login, name, email, role, status, password_hash, created_at, updated_at)
    VALUES (?, 'admin2', 'Segundo Admin', NULL, 'ADMIN', 'ACTIVE', 'dummy', datetime('now'), datetime('now'))
  `).bind(secondAdminId).run();
  const multiAdminRes = await worker.fetch(
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
  console.log(`7. Rejeita múltiplos admins (>1): status ${multiAdminRes.status} (esperado 412)`);
  if (multiAdminRes.status !== 412) throw new Error('Deveria retornar 412 com múltiplos administradores');
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(secondAdminId).run();

  // Inserir sessão pré-existente para testar revogação (Cenário G)
  const preSessionId = crypto.randomUUID();
  const preTokenHash = 'hash-sessao-antiga-admin-xyz';
  await env.DB.prepare(`
    INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at)
    VALUES (?, ?, ?, datetime('now'), datetime('now', '+7 days'), NULL)
  `).bind(preSessionId, adminId, preTokenHash).run();

  // 3g. Cenário C & D: Sucesso do reset com dados válidos e admin ACTIVE
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
  console.log(`8. Sucesso no reset de emergência (C & D): status ${resetRes.status}, ok: ${resetJson.ok}`);
  if (resetRes.status !== 200 || !resetJson.ok) {
    throw new Error('Falha no reset de emergência');
  }

  // Cenário C: Verificar que o novo password_hash gravado no D1 possui exatamente 100.000 iterações (substituindo o legado 310.000)
  const updatedUser: any = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(adminId).first();
  const updatedParts = updatedUser?.password_hash?.split('$');
  console.log('   C. Novo password_hash gravado no D1:');
  console.log(`      Formato: ${updatedParts?.[0]}`);
  console.log(`      Iterações: ${updatedParts?.[1]} (esperado: 100000, anterior era 310000)`);
  if (!updatedUser || updatedParts?.[0] !== 'pbkdf2_sha256' || updatedParts?.[1] !== '100000') {
    throw new Error('TESTE C FALHOU: novo password_hash no D1 não possui 100.000 iterações!');
  }

  // Cenário I: Garantir que nenhuma credencial aparece em logs/respostas
  const resetResponseStr = JSON.stringify(resetJson);
  if (
    resetResponseStr.includes(TEST_PASSWORD) ||
    resetResponseStr.includes('password_hash') ||
    resetJson.password_hash ||
    resetJson.user?.password_hash
  ) {
    throw new Error('Credencial ou password_hash vazado na resposta do reset!');
  }

  // Cenário G: Verificar se sessões antigas foram revogadas
  const activeSessions: any = await env.DB.prepare(
    "SELECT COUNT(*) as active_count FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL"
  ).bind(adminId).first();
  console.log('9. Sessões ativas restantes após revogação:', activeSessions?.active_count);
  if (Number(activeSessions?.active_count ?? 0) !== 0) {
    throw new Error('Sessão pré-existente não foi revogada!');
  }

  // Cenário H: Verificar se a trilha de auditoria registrou ADMIN_PASSWORD_RESET
  const auditRow: any = await env.DB.prepare(
    "SELECT action, entity_id, details FROM audit_logs WHERE action = 'ADMIN_PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1"
  ).first();
  console.log('10. Trilha de auditoria registrada (H):', auditRow?.action, auditRow?.entity_id);
  if (!auditRow || auditRow.action !== 'ADMIN_PASSWORD_RESET' || auditRow.entity_id !== adminId) {
    throw new Error('Log de auditoria do reset de emergência não encontrado');
  }
  if (auditRow.details && auditRow.details.includes(TEST_PASSWORD)) {
    throw new Error('Senha vazada no detalhe do audit log!');
  }

  // -------------------------------------------------------------------------
  // TESTE E: Testar tentativa de login com senha antiga -> 401
  // -------------------------------------------------------------------------
  const oldLoginRes = await worker.fetch(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: 'SenhaAntigaInvalida123#' }),
    }),
    env,
    {} as any
  );
  console.log(`E. Login com senha antiga: status ${oldLoginRes.status} (esperado 401)`);
  if (oldLoginRes.status !== 401) {
    throw new Error('TESTE E FALHOU: login com senha antiga deveria retornar 401');
  }

  // -------------------------------------------------------------------------
  // TESTE D: Testar Login com a nova senha -> 200
  // -------------------------------------------------------------------------
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

  console.log(`D. Login pós-reset com nova senha: status ${loginRes.status}, ok: ${loginJson.ok}, role: ${loginJson.user?.role}`);
  if (loginRes.status !== 200 || !loginJson.ok || loginJson.user?.role !== 'ADMIN' || !setCookie) {
    throw new Error('TESTE D FALHOU: falha no login com a nova senha redefinida!');
  }

  // -------------------------------------------------------------------------
  // TESTE H (sub-verificação): falha de auditoria NÃO deve impedir o reset
  // -------------------------------------------------------------------------
  // Criamos um mock de DB onde prepare('INSERT INTO audit_logs...') lança erro
  const d1FailAudit = new D1Mock();
  const envFailAudit = {
    DB: {
      prepare(q: string) {
        if (q.includes('INSERT INTO audit_logs')) {
          return {
            bind() { return this; },
            async run() { throw new Error('Simulated audit_logs failure'); },
            async first() { throw new Error('Simulated audit_logs failure'); },
            async all() { throw new Error('Simulated audit_logs failure'); },
          };
        }
        return d1FailAudit.prepare(q);
      }
    } as any,
    ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
  };
  await envFailAudit.DB.prepare(`
    INSERT INTO users (id, login, name, email, role, status, password_hash, created_at, updated_at)
    VALUES (?, 'admin', 'Thiago Anderson da Silva', NULL, 'ADMIN', 'ACTIVE', ?, datetime('now'), datetime('now'))
  `).bind(crypto.randomUUID(), legacyHash310k).run();

  const auditFailRes = await worker.fetch(
    new Request('http://localhost/api/v1/admin/emergency-reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOOTSTRAP_TOKEN}`,
      },
      body: JSON.stringify({ login: 'admin', newPassword: 'AnotherPassword456#Secure' }),
    }),
    envFailAudit,
    {} as any
  );
  const auditFailJson = (await auditFailRes.json()) as any;
  console.log(`H. Resiliência a falha de audit_logs: status ${auditFailRes.status}, ok: ${auditFailJson.ok}`);
  if (auditFailRes.status !== 200 || !auditFailJson.ok) {
    throw new Error('TESTE H FALHOU: falha em audit_logs não deveria impedir o reset emergencial!');
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
  console.log(`13. GET /api/v1/auth/me: status ${meRes.status}, login: ${meJson.user?.login}, role: ${meJson.user?.role}, status: ${meJson.user?.status}`);
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
