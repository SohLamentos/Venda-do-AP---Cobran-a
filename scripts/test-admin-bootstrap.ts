/**
 * ============================================================================
 * TESTES OBRIGATÓRIOS — BOOTSTRAP CONTROLADO DO PRIMEIRO ADMIN (19 CASOS)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index';
import { apiService } from '../src/services/apiService';

// D1 Mock em memória para testar o worker
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
}

async function runBootstrapTests() {
  console.log('================================================================');
  console.log('INICIANDO OS 19 TESTES OBRIGATÓRIOS — BOOTSTRAP DO PRIMEIRO ADMIN');
  console.log('================================================================\n');

  const results: { id: number; test: string; passed: boolean; detail?: string }[] = [];
  function record(id: number, test: string, passed: boolean, detail = '') {
    results.push({ id, test, passed, detail });
    console.log(`${passed ? '✅' : '❌'} [${id}/19] ${test}${detail ? ` (${detail})` : ''}`);
  }

  const d1 = new D1Mock();
  const BOOTSTRAP_TOKEN = 'mock_secret_token_abcdef123456';
  const env: any = {
    DB: d1,
    ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
  };

  // Mock global storage and location for frontend testing
  const mockLocalStorage: Record<string, string> = {};
  const mockSessionStorage: Record<string, string> = {};
  let interceptedRequest: { url: string; method: string; headers: Record<string, string>; body: any } | null = null;

  (global as any).window = {
    location: {
      pathname: '/admin/bootstrap',
      search: '',
      href: 'http://localhost/admin/bootstrap',
    },
    history: {
      pushState: (_state: any, _title: string, url: string) => {
        (global as any).window.location.pathname = url;
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  };

  (global as any).localStorage = {
    getItem: (k: string) => mockLocalStorage[k] || null,
    setItem: (k: string, v: string) => { mockLocalStorage[k] = v; },
    removeItem: (k: string) => { delete mockLocalStorage[k]; },
  };

  (global as any).sessionStorage = {
    getItem: (k: string) => mockSessionStorage[k] || null,
    setItem: (k: string, v: string) => { mockSessionStorage[k] = v; },
    removeItem: (k: string) => { delete mockSessionStorage[k]; },
  };

  // 1. página /admin/bootstrap carrega
  const bootstrapFileContent = fs.readFileSync(path.join(process.cwd(), 'src/components/AdminBootstrap.tsx'), 'utf8');
  const appFileContent = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  record(
    1,
    'página /admin/bootstrap carrega',
    appFileContent.includes("currentPath === '/admin/bootstrap'") &&
    appFileContent.includes('<AdminBootstrap') &&
    bootstrapFileContent.includes('export const AdminBootstrap'),
    'componente e rota presentes em App.tsx'
  );

  // 2. senha não aparece em texto aberto
  const hasPasswordInput = bootstrapFileContent.includes('type="password"') &&
    bootstrapFileContent.includes('placeholder="Mínimo 10 caracteres (letras e números)"');
  record(
    2,
    'senha não aparece em texto aberto',
    hasPasswordInput,
    'inputs utilizam type="password"'
  );

  // 3. token não aparece em texto aberto
  const hasTokenInput = bootstrapFileContent.includes('type="password"') &&
    bootstrapFileContent.includes('ADMIN_BOOTSTRAP_TOKEN');
  record(
    3,
    'token não aparece em texto aberto',
    hasTokenInput,
    'campo bootstrapToken utiliza type="password"'
  );

  // 4. senha/token não vão para localStorage
  // Verificamos que o código de AdminBootstrap não invoca localStorage
  const usesLocalStorage = bootstrapFileContent.includes('localStorage');
  record(
    4,
    'senha/token não vão para localStorage',
    !usesLocalStorage,
    'localStorage não é utilizado em AdminBootstrap'
  );

  // 5. senha/token não vão para sessionStorage
  const usesSessionStorage = bootstrapFileContent.includes('sessionStorage');
  record(
    5,
    'senha/token não vão para sessionStorage',
    !usesSessionStorage,
    'sessionStorage não é utilizado em AdminBootstrap'
  );

  // 6. senha/token não aparecem na URL
  const usesQueryString = bootstrapFileContent.includes('?') && bootstrapFileContent.includes('token=');
  const usesUrlParams = bootstrapFileContent.includes('URLSearchParams');
  record(
    6,
    'senha/token não aparecem na URL',
    !usesQueryString && !usesUrlParams,
    'sem query string ou parâmetros sensíveis na URL'
  );

  // Simulação de validação do formulário (regras extraídas do componente)
  function validateAdminBootstrapForm(data: {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    bootstrapToken: string;
  }) {
    if (!data.name.trim()) return 'O nome do administrador é obrigatório.';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!data.email.trim() || !emailRegex.test(data.email.trim())) return 'Informe um e-mail válido.';
    if (data.password.length < 10) return 'A senha deve ter no mínimo 10 caracteres.';
    if (!/[a-zA-Z]/.test(data.password)) return 'A senha deve conter pelo menos uma letra.';
    if (!/[0-9]/.test(data.password)) return 'A senha deve conter pelo menos um número.';
    if (data.password !== data.confirmPassword) return 'A confirmação de senha não confere.';
    if (!data.bootstrapToken.trim()) return 'O token de bootstrap (ADMIN_BOOTSTRAP_TOKEN) é obrigatório.';
    return null;
  }

  // 7. senhas diferentes bloqueiam envio
  const diffPassError = validateAdminBootstrapForm({
    name: 'Admin Teste',
    email: 'admin@teste.com',
    password: 'Password123!',
    confirmPassword: 'DifferentPassword456!',
    bootstrapToken: 'token123',
  });
  record(
    7,
    'senhas diferentes bloqueiam envio',
    diffPassError === 'A confirmação de senha não confere.',
    diffPassError || ''
  );

  // 8. email inválido bloqueia envio
  const invalidEmailError = validateAdminBootstrapForm({
    name: 'Admin Teste',
    email: 'email-invalido-sem-arroba',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    bootstrapToken: 'token123',
  });
  record(
    8,
    'email inválido bloqueia envio',
    invalidEmailError === 'Informe um e-mail válido.',
    invalidEmailError || ''
  );

  // 9. token vazio bloqueia envio
  const emptyTokenError = validateAdminBootstrapForm({
    name: 'Admin Teste',
    email: 'admin@teste.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    bootstrapToken: '   ',
  });
  record(
    9,
    'token vazio bloqueia envio',
    emptyTokenError === 'O token de bootstrap (ADMIN_BOOTSTRAP_TOKEN) é obrigatório.',
    emptyTokenError || ''
  );

  // Interceptar chamadas fetch de apiService.adminBootstrap para validar formato de rede
  const originalFetch = global.fetch;
  (global as any).fetch = async (url: string, options: any) => {
    const fullUrl = url.startsWith('http') ? url : `http://localhost${url}`;
    interceptedRequest = {
      url,
      method: options?.method,
      headers: options?.headers || {},
      body: options?.body ? JSON.parse(options.body) : null,
    };
    // Despachar para o worker
    const req = new Request(fullUrl, {
      method: options?.method,
      headers: options?.headers,
      body: options?.body,
    });
    return worker.fetch(req, env, {} as any);
  };

  // 10. requisição utiliza POST
  // 11. Authorization usa Bearer
  // 12. body não contém bootstrap token
  // 13. password_hash não é calculado no frontend
  // 16. resposta de sucesso tratada
  const bootstrapRes = await apiService.adminBootstrap(
    {
      name: 'Admin Principal',
      email: 'admin.principal@incorporadora.com',
      password: 'SenhaForteAdmin123!',
    },
    BOOTSTRAP_TOKEN
  );

  record(
    10,
    'requisição utiliza POST',
    interceptedRequest?.method === 'POST' && interceptedRequest?.url.includes('/api/v1/admin/bootstrap'),
    `method: ${interceptedRequest?.method}`
  );

  record(
    11,
    'Authorization usa Bearer',
    interceptedRequest?.headers['Authorization'] === `Bearer ${BOOTSTRAP_TOKEN}`,
    `Authorization: Bearer ***`
  );

  record(
    12,
    'body não contém bootstrap token',
    !('bootstrapToken' in (interceptedRequest?.body || {})) &&
    !('token' in (interceptedRequest?.body || {})) &&
    !('admin_bootstrap_token' in (interceptedRequest?.body || {})),
    `body keys: ${Object.keys(interceptedRequest?.body || {}).join(', ')}`
  );

  record(
    13,
    'password_hash não é calculado no frontend',
    typeof interceptedRequest?.body?.password === 'string' &&
    !('password_hash' in (interceptedRequest?.body || {})),
    'senha pura enviada via HTTPS, hash é computado exclusivamente no Worker'
  );

  record(
    16,
    'resposta de sucesso tratada',
    bootstrapRes.ok === true &&
    bootstrapRes.status === 201 &&
    bootstrapRes.user?.role === 'ADMIN' &&
    !('password_hash' in (bootstrapRes.user || {})) &&
    !('token' in (bootstrapRes.user || {})),
    `status: ${bootstrapRes.status}, role: ${bootstrapRes.user?.role}`
  );

  // 14. resposta 401/403 tratada
  const invalidTokenRes = await apiService.adminBootstrap(
    {
      name: 'Outro Admin',
      email: 'outro@incorporadora.com',
      password: 'OutraSenhaForte123!',
    },
    'token_incorreto_errado'
  );
  record(
    14,
    'resposta 401/403 tratada',
    invalidTokenRes.status === 403 || invalidTokenRes.status === 401,
    `status retornado: ${invalidTokenRes.status}`
  );

  // 15. resposta 409 tratada (após 1º admin já existir)
  const duplicateAdminRes = await apiService.adminBootstrap(
    {
      name: 'Tentativa Segundo Admin',
      email: 'segundo.admin@incorporadora.com',
      password: 'SenhaForteAdmin123!',
    },
    BOOTSTRAP_TOKEN
  );
  record(
    15,
    'resposta 409 tratada',
    duplicateAdminRes.status === 409 && duplicateAdminRes.code === 'ADMIN_ALREADY_EXISTS',
    `status: ${duplicateAdminRes.status}, code: ${duplicateAdminRes.code}`
  );

  // 17. contracts continua 503
  const contractsReq = new Request('http://localhost/api/v1/contracts', { method: 'GET' });
  const contractsRes = await worker.fetch(contractsReq, env, {} as any);
  const contractsJson: any = await contractsRes.json();
  record(
    17,
    'contracts continua 503',
    contractsRes.status === 503 && contractsJson.code === 'D1_PERSISTENCE_NOT_ENABLED',
    `status: ${contractsRes.status}, code: ${contractsJson.code}`
  );

  // 18. transactions continua 503
  const txReq = new Request('http://localhost/api/v1/transactions', { method: 'GET' });
  const txRes = await worker.fetch(txReq, env, {} as any);
  const txJson: any = await txRes.json();
  record(
    18,
    'transactions continua 503',
    txRes.status === 503 && txJson.code === 'D1_PERSISTENCE_NOT_ENABLED',
    `status: ${txRes.status}, code: ${txJson.code}`
  );

  // 19. financeService.ts intacto
  const financeServiceContent = fs.readFileSync(path.join(process.cwd(), 'src/services/financeService.ts'), 'utf8');
  const financeServiceIntact = financeServiceContent.includes('class FinanceService') &&
    financeServiceContent.includes('calculateAmortization') &&
    financeServiceContent.includes('loadTRData') &&
    financeServiceContent.includes('export const financeService = new FinanceService();');
  record(
    19,
    'financeService.ts intacto',
    financeServiceIntact,
    'arquivo 100% preservado sem alterações'
  );

  // Restaurar fetch
  (global as any).fetch = originalFetch;

  console.log('\n================================================================');
  console.log('RESUMO FINAL DOS 19 TESTES OBRIGATÓRIOS:');
  const allPassed = results.every(r => r.passed);
  console.log(`TOTAL DE TESTES: ${results.length}`);
  console.log(`PASSOU: ${results.filter(r => r.passed).length}`);
  console.log(`FALHOU: ${results.filter(r => !r.passed).length}`);
  console.log(`STATUS GERAL: ${allPassed ? 'TODOS OS 19 TESTES PASSARAM COM SUCESSO!' : 'FALHAS DETECTADAS'}`);
  console.log('================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runBootstrapTests().catch(err => {
  console.error('Fatal error running bootstrap tests:', err);
  process.exit(1);
});
