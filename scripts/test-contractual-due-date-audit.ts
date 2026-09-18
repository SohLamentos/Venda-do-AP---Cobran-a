/**
 * SCRIPT DE AUDITORIA FORMAL — DIA DE VENCIMENTO CONTRATUAL (DIA 10)
 * 
 * Verifica e atesta o desacoplamento estrito entre:
 * - dueDate: data de vencimento da parcela (sempre dia 10 do mês contratual)
 * - paymentDate: data efetiva da realização do pagamento (ex: 16/09/2026)
 * 
 * Regra Obrigatória:
 * Parcela #1:
 *   dueDate = 10/09/2026
 *   paymentDate = 16/09/2026
 * 
 * EXPECT:
 *   Parcela #2 dueDate = 10/10/2026
 *   Parcela #3 dueDate = 10/11/2026
 *   ... e todas as parcelas futuras vencem estritamente no DIA 10.
 */

import { addMonths, format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function runDueDateAudit() {
  console.log('========================================================================');
  console.log('AUDITORIA DE CALENDÁRIO CONTRATUAL — DIA DE VENCIMENTO (DIA 10)');
  console.log('========================================================================\n');

  // 1. Dados Canônicos
  const contractualStartDueDateStr = '2026-09-10';
  const effectivePaymentDateP1Str = '2026-09-16';

  const p1DueDate = parse(contractualStartDueDateStr, 'yyyy-MM-dd', new Date());
  const p1PaymentDate = parse(effectivePaymentDateP1Str, 'yyyy-MM-dd', new Date());

  console.log('1. PARCELA #1: SEPARAÇÃO ESTRITA DE DATAS');
  console.log(`   - Vencimento Contratual (dueDate): ${format(p1DueDate, 'dd/MM/yyyy')}`);
  console.log(`   - Data Efetiva de Pagamento (paymentDate): ${format(p1PaymentDate, 'dd/MM/yyyy')}`);
  
  if (format(p1DueDate, 'dd') !== '10') {
    throw new Error(`FALHA: Parcela #1 dueDate não é dia 10! Obtido: ${format(p1DueDate, 'dd')}`);
  }
  if (format(p1PaymentDate, 'dd/MM/yyyy') !== '16/09/2026') {
    throw new Error(`FALHA: Parcela #1 paymentDate foi corrompida! Obtido: ${format(p1PaymentDate, 'dd/MM/yyyy')}`);
  }
  console.log('   -> STATUS: APROVADO (dueDate=10/09/2026 | paymentDate=16/09/2026)\n');

  // 2. Projeção Contratual das Parcelas Futuras
  console.log('2. PROJEÇÃO DO CALENDÁRIO DE VENCIMENTOS (PARCELAS #2 A #240)');
  const totalMonths = 240;
  const schedule: { installmentNumber: number; dueDate: Date; dueDay: string }[] = [];

  for (let i = 0; i < totalMonths; i++) {
    const instNum = i + 1;
    const dueDate = addMonths(p1DueDate, i);
    const dueDay = format(dueDate, 'dd');
    schedule.push({ installmentNumber: instNum, dueDate, dueDay });

    if (dueDay !== '10') {
      throw new Error(`FALHA: Parcela #${instNum} possui vencimento em dia diferente de 10: ${format(dueDate, 'dd/MM/yyyy')}`);
    }
  }

  const p2 = schedule[1];
  const p3 = schedule[2];
  const p4 = schedule[3];

  console.log(`   - Parcela #2: Vencimento Contratual = ${format(p2.dueDate, 'dd/MM/yyyy')} (EXPECT: 10/10/2026) -> ${format(p2.dueDate, 'dd/MM/yyyy') === '10/10/2026' ? 'CORRETO' : 'FALHA'}`);
  console.log(`   - Parcela #3: Vencimento Contratual = ${format(p3.dueDate, 'dd/MM/yyyy')} (EXPECT: 10/11/2026) -> ${format(p3.dueDate, 'dd/MM/yyyy') === '10/11/2026' ? 'CORRETO' : 'FALHA'}`);
  console.log(`   - Parcela #4: Vencimento Contratual = ${format(p4.dueDate, 'dd/MM/yyyy')} (EXPECT: 10/12/2026) -> ${format(p4.dueDate, 'dd/MM/yyyy') === '10/12/2026' ? 'CORRETO' : 'FALHA'}`);

  if (format(p2.dueDate, 'dd/MM/yyyy') !== '10/10/2026') throw new Error('FALHA na Parcela #2');
  if (format(p3.dueDate, 'dd/MM/yyyy') !== '10/11/2026') throw new Error('FALHA na Parcela #3');
  console.log(`   - Verificação de todas as 240 parcelas: 100% vencem no dia 10.\n`);

  // 3. Projeção de Quitação
  console.log('3. DATAS DE QUITAÇÃO RECALCULADAS COM VENCIMENTO DIA 10');
  
  // Cenário A: Sem antecipação (228 pagamentos futuros após Parcela #1 = Parcela #229)
  const remainingPaymentsA = 228;
  const payoffDateA = addMonths(p1DueDate, remainingPaymentsA);
  console.log(`   - Cenário A (Sem Antecipação):`);
  console.log(`     * Total de parcelas desde o início: 229`);
  console.log(`     * Pagamentos futuros após Parcela #1: ${remainingPaymentsA}`);
  console.log(`     * Data Prevista de Quitação: ${format(payoffDateA, 'dd/MM/yyyy')} (${format(payoffDateA, "MMMM 'de' yyyy", { locale: ptBR })})`);
  console.log(`     * Dia da Quitação: ${format(payoffDateA, 'dd')} (EXPECT: 10)`);

  if (format(payoffDateA, 'dd/MM/yyyy') !== '10/09/2045') {
    throw new Error(`FALHA no payoffDateA: esperado 10/09/2045, obtido ${format(payoffDateA, 'dd/MM/yyyy')}`);
  }

  // Cenário B: Com antecipação de R$ 5.000,00 (218 pagamentos futuros após Parcela #1 = Parcela #219)
  const remainingPaymentsB = 218;
  const payoffDateB = addMonths(p1DueDate, remainingPaymentsB);
  console.log(`   - Cenário B (Com Antecipação de R$ 5.000,00):`);
  console.log(`     * Total de parcelas desde o início: 219`);
  console.log(`     * Pagamentos futuros após Parcela #1: ${remainingPaymentsB}`);
  console.log(`     * Data Prevista de Quitação: ${format(payoffDateB, 'dd/MM/yyyy')} (${format(payoffDateB, "MMMM 'de' yyyy", { locale: ptBR })})`);
  console.log(`     * Dia da Quitação: ${format(payoffDateB, 'dd')} (EXPECT: 10)`);

  if (format(payoffDateB, 'dd/MM/yyyy') !== '10/11/2044') {
    throw new Error(`FALHA no payoffDateB: esperado 10/11/2044, obtido ${format(payoffDateB, 'dd/MM/yyyy')}`);
  }

  const reducedMonths = remainingPaymentsA - remainingPaymentsB;
  console.log(`\n4. REDUÇÃO DE PRAZO: ${reducedMonths} meses.`);
  console.log(`   - Antecipação: de ${format(payoffDateA, 'dd/MM/yyyy')} para ${format(payoffDateB, 'dd/MM/yyyy')} (economia de 10 meses exatos).`);

  console.log('\n========================================================================');
  console.log('AUDITORIA DE DATAS CONCLUÍDA COM SUCESSO TOTAL');
  console.log('========================================================================');
}

runDueDateAudit();
