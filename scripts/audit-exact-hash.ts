/**
 * AUDITORIA DETALHADA DO FLUXO REAL DE POST /api/v1/auth/login
 * Testando especificamente com o hash exato armazenado no D1:
 * pbkdf2_sha256$310000$jiWvRyUKtcN4wW/TdNosng==$npr/OzGksv9HsHBUVSd8wSZMk0ONJoBpbf+jz0dUFJM=
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker, { verifyPassword, base64Decode, base64Encode } from '../worker/index';

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
}

async function auditExactHash() {
  console.log('================================================================');
  console.log('AUDITORIA REAL DO POST /api/v1/auth/login');
  console.log('================================================================\n');

  const STORED_HASH = 'pbkdf2_sha256$310000$jiWvRyUKtcN4wW/TdNosng==$npr/OzGksv9HsHBUVSd8wSZMk0ONJoBpbf+jz0dUFJM=';

  // 1. Verificar a decodificação de salt e hash
  const parts = STORED_HASH.split('$');
  console.log('1. Parsing de storedHash:');
  console.log(`   parts.length = ${parts.length}`);
  console.log(`   prefix = "${parts[0]}"`);
  console.log(`   iterations = ${parts[1]}`);
  console.log(`   salt b64 = "${parts[2]}"`);
  console.log(`   hash b64 = "${parts[3]}"`);

  const saltBytes = base64Decode(parts[2]);
  const hashBytes = base64Decode(parts[3]);
  console.log(`   salt bytes length = ${saltBytes.length} (esperado 16)`);
  console.log(`   hash bytes length = ${hashBytes.length} (esperado 32)`);

  // Testar se base64Encode reconstrói exatamente os mesmos b64
  const reEncodedSalt = base64Encode(saltBytes);
  const reEncodedHash = base64Encode(hashBytes);
  console.log(`   salt re-encoded bate: ${reEncodedSalt === parts[2]}`);
  console.log(`   hash re-encoded bate: ${reEncodedHash === parts[3]}`);

  // 2. Testar verifyPassword direto com a senha correspondente (usando senha de teste local compatível)
  const TEST_PASSWORD = 'Moniqu300#';
  const directVerify = await verifyPassword(TEST_PASSWORD, STORED_HASH);
  console.log(`2. verifyPassword(TEST_PASSWORD, STORED_HASH) direto: ${directVerify}`);

  // 3. Simular no banco com a linha exata que está no D1
  const d1 = new D1Mock();
  const env = { DB: d1 as any };

  const adminId = 'd7d6b38c-3aa2-4c6f-a886-c567bb0cecb7';
  await d1.prepare(`
    INSERT INTO users (id, login, name, email, role, status, password_hash, created_at, updated_at)
    VALUES (?, 'admin', 'Thiago Anderson da Silva', NULL, 'ADMIN', 'ACTIVE', ?, datetime('now'), datetime('now'))
  `).bind(adminId, STORED_HASH).run();

  // Testar query SQL do Worker:
  const queryResult = await d1.prepare(
    'SELECT id, login, email, name, role, status, password_hash FROM users WHERE login = ? OR email = ?'
  ).bind('admin', 'admin').first<any>();

  console.log('3. Resultado da query SELECT no D1:');
  console.log('   id:', queryResult?.id);
  console.log('   login:', queryResult?.login);
  console.log('   role:', queryResult?.role);
  console.log('   status:', queryResult?.status);
  console.log('   row.password_hash exists:', typeof queryResult?.password_hash === 'string');
  console.log('   row.password_hash === STORED_HASH:', queryResult?.password_hash === STORED_HASH);

  // 4. Executar requisição HTTP simulada para POST /api/v1/auth/login
  console.log('\n4. Executando POST /api/v1/auth/login com TEST_PASSWORD:');
  const req = new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.168.1.100',
    },
    body: JSON.stringify({
      login: 'admin',
      password: TEST_PASSWORD,
    }),
  });

  const res = await worker.fetch(req, env, {} as any);
  const json = await res.json() as any;
  console.log(`   Status HTTP: ${res.status}`);
  console.log(`   Response JSON:`, json);
  console.log(`   Set-Cookie:`, res.headers.get('Set-Cookie') ? 'PRESENTE' : 'AUSENTE');

  // 5. Testar o que acontece se o login enviado tiver case diferente ou espaços
  const reqWithSpaces = new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: '  ADMIN  ',
      password: TEST_PASSWORD,
    }),
  });
  const resSpaces = await worker.fetch(reqWithSpaces, env, {} as any);
  console.log(`5. Login com '  ADMIN  ': status ${resSpaces.status}, ok: ${(await resSpaces.json() as any).ok}`);

  // 6. Testar o que acontece se password for diferente (ex: sem o #, com digitação incorreta, etc.)
  const reqWrongPw = new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: 'admin',
      password: 'OutraSenhaErrada123#',
    }),
  });
  const resWrongPw = await worker.fetch(reqWrongPw, env, {} as any);
  console.log(`6. Login com senha errada: status ${resWrongPw.status}, ok: ${(await resWrongPw.json() as any).ok}`);

  // 7. Testar se rate limit foi acionado após 5 tentativas
  console.log('\n7. Testando limite de tentativas (Rate Limit):');
  for (let i = 0; i < 6; i++) {
    const r = await worker.fetch(new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.1' },
      body: JSON.stringify({ login: 'admin', password: 'wrong' }),
    }), env, {} as any);
    const j = await r.json() as any;
    console.log(`   Tentativa ${i + 1}: status ${r.status}, code: ${j.code}`);
  }
}

auditExactHash().catch((e) => {
  console.error(e);
  process.exit(1);
});
