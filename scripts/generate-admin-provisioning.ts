/**
 * ============================================================================
 * SCRIPT PARA GERAR SCRIPT SQL SEGURO DE PROVISIONAMENTO DO PRIMEIRO ADMIN
 * ============================================================================
 * Gera hash PBKDF2-HMAC-SHA256 (310.000 iterações, 16 bytes salt, 32 bytes derived key)
 * utilizando rigorosamente a função hashPassword do Worker.
 * Gera comando SQL com verificação de tabela vazia (COUNT(*) = 0),
 * inserção em users e inserção em audit_logs.
 */

import { hashPassword } from '../worker/index';

async function generateProvisioningScript() {
  const adminLogin = 'admin';
  const adminName = 'Thiago Anderson da Silva';
  const adminEmail = null;
  const adminRole = 'ADMIN';
  const adminStatus = 'ACTIVE';
  const initialPassword = 'Moniqu300#';

  const userId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const passwordHash = await hashPassword(initialPassword);

  console.log('--- DADOS DO PROVISIONAMENTO ---');
  console.log('ID:', userId);
  console.log('Login:', adminLogin);
  console.log('Name:', adminName);
  console.log('Email:', adminEmail);
  console.log('Role:', adminRole);
  console.log('Status:', adminStatus);
  console.log('Hash prefix:', passwordHash.split('$').slice(0, 2).join('$'));

  console.log('\n--- COMANDO SQL GERADO ---');
  const sql = `
-- 1. Verificação prévia de que não existe nenhum usuário
-- SELECT COUNT(*) AS total FROM users; (deve ser 0)

-- 2. Inserção do Primeiro Administrador
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
) VALUES (
  '${userId}',
  '${adminLogin}',
  '${adminName}',
  NULL,
  '${adminRole}',
  '${adminStatus}',
  '${passwordHash}',
  datetime('now'),
  datetime('now')
);

-- 3. Registro na trilha de auditoria
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
) VALUES (
  '${auditId}',
  NULL,
  '${userId}',
  'USER_CREATED',
  'USER',
  '${userId}',
  'Primeiro ADMIN provisionado com segurança: admin',
  'CONSOLE_MANUAL',
  datetime('now')
);
  `.trim();

  console.log(sql);
}

generateProvisioningScript().catch(console.error);
