/**
 * Automated Verification Suite for Etapa 3
 * Tests:
 * 1. GET /auth/me sem token -> 401
 * 2. Token inválido -> 401
 * 3. Token expirado -> 401
 * 4. Token com issuer incorreto -> 401
 * 5. Token com audience incorreto -> 401
 * 6. Token válido -> 200
 * 7. Primeiro login -> cria users
 * 8. Segundo login -> não duplica users
 * 9. Alteração de email Firebase -> atualiza email
 * 10. Login não altera role manual existente
 * 11. Frontend não consegue definir role
 * 12. users.id = Firebase UID
 * 13. User A não acessa contrato B (IDOR)
 * 14. User A não acessa transações do contrato B
 * 15. Contratos continuam retornando 503
 * 16. Transactions continuam retornando 503
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker, {
  verifyFirebaseIdToken,
  requireAuth,
  syncAuthenticatedUser,
  getOwnedContract,
  getOwnedContractTransactions,
  clearJwksCache,
} from '../worker/index';

// Simple D1 Mock backed by SQLite in-memory
class D1Mock {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(':memory:');
    const migrationSql = fs.readFileSync(path.join(process.cwd(), 'migrations', '0001_initial.sql'), 'utf8');
    this.db.exec(migrationSql);
  }

  prepare(query: string) {
    const db = this.db;
    return {
      bind(...params: any[]) {
        return {
          async first<T = any>(): Promise<T | null> {
            try {
              const stmt = db.prepare(query);
              const result = stmt.get(...params) as T | undefined;
              return result ?? null;
            } catch (err) {
              console.error('D1Mock.first error for query:', query, err);
              throw err;
            }
          },
          async all<T = any>(): Promise<{ results: T[] }> {
            try {
              const stmt = db.prepare(query);
              const results = stmt.all(...params) as T[];
              return { results };
            } catch (err) {
              console.error('D1Mock.all error for query:', query, err);
              throw err;
            }
          },
          async run(): Promise<{ meta: { changes: number } }> {
            try {
              const stmt = db.prepare(query);
              const info = stmt.run(...params);
              return { meta: { changes: Number(info.changes) } };
            } catch (err) {
              console.error('D1Mock.run error for query:', query, err);
              throw err;
            }
          },
        };
      },
    };
  }

  // Direct access for test seeding/inspection
  exec(sql: string) {
    return this.db.exec(sql);
  }

  query(sql: string, ...params: any[]) {
    return this.db.prepare(sql).all(...params);
  }
}

function toBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function runTests() {
  console.log('================================================================');
  console.log('INICIANDO BATERIA DE TESTES — ETAPA 3 (AUTENTICAÇÃO & OWNERSHIP)');
  console.log('================================================================\n');

  // 1. Setup local cryptographic keypair & JWKS server
  const testKeyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const pubJwk: any = await crypto.subtle.exportKey('jwk', testKeyPair.publicKey);
  const testKid = 'test-kid-etapa-3';
  pubJwk.kid = testKid;
  pubJwk.alg = 'RS256';
  pubJwk.use = 'sig';

  const jwksData = JSON.stringify({ keys: [pubJwk] });

  const jwksServer = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(jwksData);
  });

  const jwksPort = 9888;
  await new Promise<void>((resolve) => jwksServer.listen(jwksPort, '127.0.0.1', () => resolve()));
  const jwksUrl = `http://127.0.0.1:${jwksPort}/jwks.json`;

  const PROJECT_ID = 'test-firebase-project';

  // Helper to generate test JWT
  async function makeJwt(payloadOverrides: Record<string, any> = {}, headerOverrides: Record<string, any> = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: 'RS256',
      kid: testKid,
      typ: 'JWT',
      ...headerOverrides,
    };
    const payload = {
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID,
      sub: 'firebase-uid-user-a',
      user_id: 'firebase-uid-user-a',
      email: 'usera@example.com',
      name: 'User Alpha',
      iat: now - 10,
      exp: now + 3600,
      ...payloadOverrides,
    };

    const headerB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', testKeyPair.privateKey, dataToSign);
    const sigB64 = toBase64Url(signature);

    return `${headerB64}.${payloadB64}.${sigB64}`;
  }

  const d1 = new D1Mock();
  const env: any = {
    DB: d1,
    FIREBASE_PROJECT_ID: PROJECT_ID,
    FIREBASE_JWKS_URL: jwksUrl,
  };

  const results: { test: string; passed: boolean; detail?: string }[] = [];

  function record(test: string, passed: boolean, detail = '') {
    results.push({ test, passed, detail });
    console.log(`${passed ? '✅ PASS' : '❌ FAIL'}: ${test}${detail ? ` (${detail})` : ''}`);
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: GET /auth/me sem token -> 401
    // -------------------------------------------------------------------------
    {
      const req = new Request('http://localhost/api/v1/auth/me', { method: 'GET' });
      const res = await worker.fetch(req, env, {} as any);
      const json: any = await res.json();
      record(
        '1. GET /auth/me sem token -> 401',
        res.status === 401 && json.ok === false && json.code === 'UNAUTHORIZED',
        `status: ${res.status}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 2: Token inválido -> 401
    // -------------------------------------------------------------------------
    {
      const req = new Request('http://localhost/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: 'Bearer token-invalido-malformado' },
      });
      const res = await worker.fetch(req, env, {} as any);
      const json: any = await res.json();
      record(
        '2. Token inválido -> 401',
        res.status === 401 && json.ok === false && json.code === 'UNAUTHORIZED',
        `status: ${res.status}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 3: Token expirado -> 401
    // -------------------------------------------------------------------------
    {
      const expiredToken = await makeJwt({
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600, // expired 1h ago
      });
      const req = new Request('http://localhost/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      const res = await worker.fetch(req, env, {} as any);
      const json: any = await res.json();
      record(
        '3. Token expirado -> 401',
        res.status === 401 && json.ok === false && json.code === 'UNAUTHORIZED',
        `status: ${res.status}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 4: Token com issuer incorreto -> 401
    // -------------------------------------------------------------------------
    {
      const wrongIssToken = await makeJwt({
        iss: 'https://attacker-domain.com/fake-project',
      });
      const req = new Request('http://localhost/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${wrongIssToken}` },
      });
      const res = await worker.fetch(req, env, {} as any);
      const json: any = await res.json();
      record(
        '4. Token com issuer incorreto -> 401',
        res.status === 401 && json.ok === false && json.code === 'UNAUTHORIZED',
        `status: ${res.status}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 5: Token com audience incorreto -> 401
    // -------------------------------------------------------------------------
    {
      const wrongAudToken = await makeJwt({
        aud: 'outro-projeto-diferente',
      });
      const req = new Request('http://localhost/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${wrongAudToken}` },
      });
      const res = await worker.fetch(req, env, {} as any);
      const json: any = await res.json();
      record(
        '5. Token com audience incorreto -> 401',
        res.status === 401 && json.ok === false && json.code === 'UNAUTHORIZED',
        `status: ${res.status}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 6: Token válido -> 200
    // -------------------------------------------------------------------------
    const validTokenUserA = await makeJwt({
      sub: 'firebase-uid-user-a',
      email: 'usera@example.com',
      name: 'User Alpha',
    });
    {
      const req = new Request('http://localhost/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${validTokenUserA}` },
      });
      const res = await worker.fetch(req, env, {} as any);
      const json: any = await res.json();
      record(
        '6. Token válido -> 200',
        res.status === 200 && json.ok === true && json.user?.id === 'firebase-uid-user-a',
        `user: ${json.user?.email}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 7: Primeiro login -> cria users
    // -------------------------------------------------------------------------
    {
      const rows = d1.query('SELECT * FROM users WHERE id = ?', 'firebase-uid-user-a');
      record(
        '7. Primeiro login -> cria users',
        rows.length === 1 && rows[0].role === 'client' && rows[0].email === 'usera@example.com',
        `count: ${rows.length}, role: ${rows[0]?.role}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 8: Segundo login -> não duplica users
    // -------------------------------------------------------------------------
    {
      const req = new Request('http://localhost/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${validTokenUserA}` },
      });
      const res = await worker.fetch(req, env, {} as any);
      const json: any = await res.json();
      const rows = d1.query('SELECT * FROM users WHERE id = ?', 'firebase-uid-user-a');
      record(
        '8. Segundo login -> não duplica users',
        res.status === 200 && rows.length === 1,
        `total users with id: ${rows.length}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 9: Alteração de email Firebase -> atualiza email
    // -------------------------------------------------------------------------
    {
      const updatedEmailToken = await makeJwt({
        sub: 'firebase-uid-user-a',
        email: 'usera.updated@example.com',
        name: 'User Alpha Updated',
      });
      const req = new Request('http://localhost/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${updatedEmailToken}` },
      });
      const res = await worker.fetch(req, env, {} as any);
      const json: any = await res.json();
      const rows = d1.query('SELECT * FROM users WHERE id = ?', 'firebase-uid-user-a');
      record(
        '9. Alteração de email Firebase -> atualiza email',
        res.status === 200 && rows[0].email === 'usera.updated@example.com' && rows[0].name === 'User Alpha Updated',
        `updated email: ${rows[0]?.email}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 10: Login não altera role manual existente
    // -------------------------------------------------------------------------
    {
      // Set role manually in database to 'admin' (e.g. via direct DBA action)
      d1.exec("UPDATE users SET role = 'admin' WHERE id = 'firebase-uid-user-a'");
      
      const req = new Request('http://localhost/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${validTokenUserA}` },
      });
      const res = await worker.fetch(req, env, {} as any);
      const json: any = await res.json();
      const rows = d1.query('SELECT * FROM users WHERE id = ?', 'firebase-uid-user-a');
      record(
        '10. Login não altera role manual existente',
        rows[0].role === 'admin' && json.user?.role === 'admin',
        `persisted role: ${rows[0]?.role}`
      );
      // Restore back to client
      d1.exec("UPDATE users SET role = 'client' WHERE id = 'firebase-uid-user-a'");
    }

    // -------------------------------------------------------------------------
    // TEST 11: Frontend não consegue definir role
    // -------------------------------------------------------------------------
    {
      // Test 1: POST to /api/v1/auth/me should be rejected (405)
      const reqPost = new Request('http://localhost/api/v1/auth/me', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validTokenUserA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'admin' }),
      });
      const resPost = await worker.fetch(reqPost, env, {} as any);

      // Test 2: syncAuthenticatedUser ignores any client-supplied role
      const synced = await syncAuthenticatedUser(env.DB, {
        uid: 'user-b-new',
        email: 'userb@example.com',
        name: 'User Bravo',
        // Even if an attacker injects role into user object, sync sets 'client'
      } as any);

      const rows = d1.query('SELECT role FROM users WHERE id = ?', 'user-b-new');
      record(
        '11. Frontend não consegue definir role',
        resPost.status === 405 && rows[0]?.role === 'client',
        `post status: ${resPost.status}, user-b role: ${rows[0]?.role}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 12: users.id = Firebase UID
    // -------------------------------------------------------------------------
    {
      const rows = d1.query('SELECT id FROM users WHERE id = ?', 'firebase-uid-user-a');
      record(
        '12. users.id = Firebase UID',
        rows.length === 1 && rows[0].id === 'firebase-uid-user-a',
        `exact uid: ${rows[0]?.id}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 13: User A não acessa contrato B (IDOR)
    // -------------------------------------------------------------------------
    {
      // Seed Contract A for User A, and Contract B for User B
      d1.exec(`
        INSERT INTO contracts (id, user_id, name, financed_amount, fixed_installment, annual_interest_rate, term_months, start_date)
        VALUES ('contract-a', 'firebase-uid-user-a', 'Contrato Alpha', 10000000, 100000, 10.0, 100, '2025-01-01');

        INSERT INTO contracts (id, user_id, name, financed_amount, fixed_installment, annual_interest_rate, term_months, start_date)
        VALUES ('contract-b', 'user-b-new', 'Contrato Bravo', 20000000, 200000, 12.0, 120, '2025-02-01');
      `);

      // getOwnedContract with User A UID on Contract B must return null (which translates to 404)
      const ownedByA = await getOwnedContract(env.DB, 'contract-b', 'firebase-uid-user-a');
      const ownedByB = await getOwnedContract(env.DB, 'contract-b', 'user-b-new');
      const ownedSelf = await getOwnedContract(env.DB, 'contract-a', 'firebase-uid-user-a');

      record(
        '13. User A não acessa contrato B (IDOR)',
        ownedByA === null && ownedByB !== null && ownedSelf !== null,
        `User A looking at Contract B: ${ownedByA ? 'LEAKED' : 'NULL (404 safe)'}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 14: User A não acessa transações do contrato B
    // -------------------------------------------------------------------------
    {
      d1.exec(`
        INSERT INTO transactions (id, contract_id, date, installment_number, amount, type, method, status)
        VALUES ('tx-b1', 'contract-b', '2025-03-01', 1, 200000, 'PAYMENT', 'PIX', 'PAGO');
      `);

      const txsUserA = await getOwnedContractTransactions(env.DB, 'contract-b', 'firebase-uid-user-a');
      const txsUserB = await getOwnedContractTransactions(env.DB, 'contract-b', 'user-b-new');

      record(
        '14. User A não acessa transações do contrato B',
        txsUserA.length === 0 && txsUserB.length === 1,
        `txs seen by User A: ${txsUserA.length}, txs seen by User B: ${txsUserB.length}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 15: Contratos continuam retornando 503
    // -------------------------------------------------------------------------
    {
      const reqGet = new Request('http://localhost/api/v1/contracts', {
        method: 'GET',
        headers: { Authorization: `Bearer ${validTokenUserA}` },
      });
      const resGet = await worker.fetch(reqGet, env, {} as any);
      const jsonGet: any = await resGet.json();

      const reqPost = new Request('http://localhost/api/v1/contracts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validTokenUserA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Hack Contrato' }),
      });
      const resPost = await worker.fetch(reqPost, env, {} as any);
      const jsonPost: any = await resPost.json();

      record(
        '15. Contratos continuam retornando 503',
        resGet.status === 503 &&
          jsonGet.code === 'D1_PERSISTENCE_NOT_ENABLED' &&
          resPost.status === 503 &&
          jsonPost.code === 'D1_PERSISTENCE_NOT_ENABLED',
        `GET: ${resGet.status}, POST: ${resPost.status}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 16: Transactions continuam retornando 503
    // -------------------------------------------------------------------------
    {
      const reqGet = new Request('http://localhost/api/v1/transactions?contractId=contract-a', {
        method: 'GET',
        headers: { Authorization: `Bearer ${validTokenUserA}` },
      });
      const resGet = await worker.fetch(reqGet, env, {} as any);
      const jsonGet: any = await resGet.json();

      const reqPost = new Request('http://localhost/api/v1/transactions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validTokenUserA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contractId: 'contract-a', amount: 1000 }),
      });
      const resPost = await worker.fetch(reqPost, env, {} as any);
      const jsonPost: any = await resPost.json();

      record(
        '16. Transactions continuam retornando 503',
        resGet.status === 503 &&
          jsonGet.code === 'D1_PERSISTENCE_NOT_ENABLED' &&
          resPost.status === 503 &&
          jsonPost.code === 'D1_PERSISTENCE_NOT_ENABLED',
        `GET: ${resGet.status}, POST: ${resPost.status}`
      );
    }
  } finally {
    jwksServer.close();
  }

  console.log('\n================================================================');
  console.log('RESUMO FINAL DOS TESTES:');
  const allPassed = results.every((r) => r.passed);
  console.log(`TOTAL DE TESTES: ${results.length}`);
  console.log(`PASSOU: ${results.filter((r) => r.passed).length}`);
  console.log(`FALHOU: ${results.filter((r) => !r.passed).length}`);
  console.log(`STATUS GERAL: ${allPassed ? 'TODOS OS 16 TESTES PASSARAM!' : 'FALHAS DETECTADAS'}`);
  console.log('================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
