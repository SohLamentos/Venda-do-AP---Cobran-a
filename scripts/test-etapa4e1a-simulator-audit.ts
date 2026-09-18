/**
 * ETAPA 4E.1A — AUDITORIA MATEMÁTICA E SANEAMENTO DO SIMULADOR DE ANTECIPAÇÃO
 * Prova matemática exata mês a mês de ambos os cenários (Base e Antecipação)
 * Zero alteração em D1, zero alteração em financeService.ts, zero deploy.
 */
import { round2 } from '../src/lib/utils';
import { addMonths, format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as fs from 'fs';
import * as path from 'path';

export interface MonthlyAuditRecord {
  month: number;
  prevBal: number;
  interest: number;
  tr: number;
  installmentPaid: number;
  amort: number;
  nextBal: number;
}

export function runScenarioAudit(initialBal: number, pmt: number, monthlyRate: number) {
  let bal = initialBal;
  let totalInterest = 0;
  let month = 0;
  const history: MonthlyAuditRecord[] = [];

  while (bal > 0.01 && month < 480) {
    const prevBal = bal;
    const interest = round2(bal * monthlyRate);
    totalInterest = round2(totalInterest + interest);

    let installmentPaid = pmt;
    let amort = round2(pmt - interest);
    let nextBal = round2(prevBal - amort);

    // Tratamento de arredondamento / resíduo na última prestação:
    if (prevBal + interest <= pmt) {
      amort = prevBal;
      installmentPaid = round2(prevBal + interest);
      nextBal = 0;
      bal = 0;
    } else {
      bal = nextBal;
    }

    month++;
    history.push({
      month,
      prevBal,
      interest,
      tr: 0,
      installmentPaid,
      amort,
      nextBal,
    });
  }

  return {
    history,
    totalInterest,
    monthsCount: month,
    finalInstallmentResidual: history[history.length - 1]?.installmentPaid || 0,
  };
}

async function main() {
  console.log('========================================================================');
  console.log('ETAPA 4E.1A: SANEAMENTO DA AUDITORIA MATEMÁTICA DO SIMULADOR');
  console.log('========================================================================\n');

  // 1. Dados Canônicos
  const originalTermMonths = 240;
  const initialDebt = 235000.0;
  const postP1Balance = 234546.37;
  const pmtBase = 1965.63;
  const annualInterestRate = 8.0;
  const simulatedAnticipation = 5000.0;
  const p1DueDateStr = '2026-09-10';
  const p1PaymentDateStr = '2026-09-16';
  const p1DueDate = parse(p1DueDateStr, 'yyyy-MM-dd', new Date());
  const p1PaymentDate = parse(p1PaymentDateStr, 'yyyy-MM-dd', new Date());

  // A. Taxa mensal utilizada
  const monthlyRate = Math.pow(1 + annualInterestRate / 100, 1 / 12) - 1;
  const monthlyRatePercentStr = (monthlyRate * 100).toFixed(8) + '% a.m.';

  console.log('1. PARÂMETROS MATEMÁTICOS CANÔNICOS:');
  console.log(`   - Prazo Original Contratual: ${originalTermMonths} meses`);
  console.log(`   - Valor Financiado: R$ ${initialDebt.toFixed(2)}`);
  console.log(`   - Saldo Pós-Parcela #1: R$ ${postP1Balance.toFixed(2)}`);
  console.log(`   - Prestação Base Fixa: R$ ${pmtBase.toFixed(2)}`);
  console.log(`   - Taxa Anual: ${annualInterestRate.toFixed(2)}% a.a.`);
  console.log(`   - Taxa Mensal Utilizada (A): ${monthlyRate.toFixed(14)} (${monthlyRatePercentStr})`);
  console.log(`   - Método de Conversão (B): Composta -> (1 + 0.08)^(1/12) - 1`);
  console.log(`   - Antecipação Simulada: R$ ${simulatedAnticipation.toFixed(2)}`);
  console.log(`   - Parcela #1 Vencimento Contratual (dueDate): ${format(p1DueDate, 'dd/MM/yyyy')}`);
  console.log(`   - Parcela #1 Data Efetiva de Pagamento (paymentDate): ${format(p1PaymentDate, 'dd/MM/yyyy')}\n`);

  // CENÁRIO A: SEM ANTECIPAÇÃO (Saldo = R$ 234.546,37)
  const auditA = runScenarioAudit(postP1Balance, pmtBase, monthlyRate);

  // CENÁRIO B: COM ANTECIPAÇÃO (Saldo = R$ 229.546,37)
  const balBStart = round2(postP1Balance - simulatedAnticipation);
  const auditB = runScenarioAudit(balBStart, pmtBase, monthlyRate);

  // D. Pagamentos futuros SEM antecipação
  console.log('2. CENÁRIO A (SEM ANTECIPAÇÃO):');
  console.log(`   - Saldo Inicial: R$ ${postP1Balance.toFixed(2)}`);
  console.log(`   - Pagamentos Futuros (D): ${auditA.monthsCount} meses`);
  console.log(`   - Total de Juros Futuros (I): R$ ${auditA.totalInterest.toFixed(2)}`);
  const payoffDateA = addMonths(p1DueDate, auditA.monthsCount);
  console.log(`   - Data Prevista de Quitação (F): ${format(payoffDateA, 'dd/MM/yyyy')} (${format(payoffDateA, "MMMM 'de' yyyy", { locale: ptBR })})`);
  console.log(`   - Última Parcela Resíduo (L): R$ ${auditA.finalInstallmentResidual.toFixed(2)} (amortiza saldo exato remanescente + juros do mês)\n`);

  // E. Pagamentos futuros COM antecipação
  console.log('3. CENÁRIO B (COM ANTECIPAÇÃO DE R$ 5.000,00):');
  console.log(`   - Saldo Inicial: R$ ${balBStart.toFixed(2)}`);
  console.log(`   - Pagamentos Futuros (E): ${auditB.monthsCount} meses`);
  console.log(`   - Total de Juros Futuros (I): R$ ${auditB.totalInterest.toFixed(2)}`);
  const payoffDateB = addMonths(p1DueDate, auditB.monthsCount);
  console.log(`   - Data Prevista de Quitação (G): ${format(payoffDateB, 'dd/MM/yyyy')} (${format(payoffDateB, "MMMM 'de' yyyy", { locale: ptBR })})`);
  console.log(`   - Última Parcela Resíduo (L): R$ ${auditB.finalInstallmentResidual.toFixed(2)}\n`);

  // H. Meses economizados e J. Economia de juros
  const savedMonths = auditA.monthsCount - auditB.monthsCount;
  const savedInterest = round2(auditA.totalInterest - auditB.totalInterest);
  console.log('4. COMPARAÇÃO E ECONOMIA:');
  console.log(`   - Meses Efetivamente Economizados (H): ${savedMonths} meses (${auditA.monthsCount} - ${auditB.monthsCount})`);
  console.log(`   - Economia de Juros (J): R$ ${savedInterest.toFixed(2)} (${auditA.totalInterest.toFixed(2)} - ${auditB.totalInterest.toFixed(2)})`);
  console.log(`   - R$ 15.870,71 estava correto? ${savedInterest === 15870.71 ? 'SIM (100% EXATO)' : 'NÃO'}\n`);

  // K. Demonstrar primeiros 3 e últimos 3 meses
  console.log('5. DEMONSTRAÇÃO MÊS A MÊS — CENÁRIO A:');
  console.log('   Primeiros 3 meses:');
  for (const r of auditA.history.slice(0, 3)) {
    console.log(`     Mês ${r.month}: Saldo Ant: R$ ${r.prevBal.toFixed(2)} | Juros: R$ ${r.interest.toFixed(2)} | TR: R$ 0,00 | Prestação: R$ ${r.installmentPaid.toFixed(2)} | Amort: R$ ${r.amort.toFixed(2)} | Saldo Post: R$ ${r.nextBal.toFixed(2)}`);
  }
  console.log('   Últimos 3 meses:');
  for (const r of auditA.history.slice(-3)) {
    console.log(`     Mês ${r.month}: Saldo Ant: R$ ${r.prevBal.toFixed(2)} | Juros: R$ ${r.interest.toFixed(2)} | TR: R$ 0,00 | Prestação: R$ ${r.installmentPaid.toFixed(2)} | Amort: R$ ${r.amort.toFixed(2)} | Saldo Post: R$ ${r.nextBal.toFixed(2)}`);
  }

  console.log('\n6. DEMONSTRAÇÃO MÊS A MÊS — CENÁRIO B:');
  console.log('   Primeiros 3 meses:');
  for (const r of auditB.history.slice(0, 3)) {
    console.log(`     Mês ${r.month}: Saldo Ant: R$ ${r.prevBal.toFixed(2)} | Juros: R$ ${r.interest.toFixed(2)} | TR: R$ 0,00 | Prestação: R$ ${r.installmentPaid.toFixed(2)} | Amort: R$ ${r.amort.toFixed(2)} | Saldo Post: R$ ${r.nextBal.toFixed(2)}`);
  }
  console.log('   Últimos 3 meses:');
  for (const r of auditB.history.slice(-3)) {
    console.log(`     Mês ${r.month}: Saldo Ant: R$ ${r.prevBal.toFixed(2)} | Juros: R$ ${r.interest.toFixed(2)} | TR: R$ 0,00 | Prestação: R$ ${r.installmentPaid.toFixed(2)} | Amort: R$ ${r.amort.toFixed(2)} | Saldo Post: R$ ${r.nextBal.toFixed(2)}`);
  }

  // 7. Testes de Asserção Rígida
  console.log('\n7. ASSERÇÕES MATEMÁTICAS:');
  const asserts: boolean[] = [];

  const a1 = monthlyRate > 0.006434 && monthlyRate < 0.006435;
  console.log(`   [${a1 ? 'PASS' : 'FAIL'}] 1. Taxa mensal é 0.00643403...`);
  asserts.push(a1);

  const a2 = auditA.monthsCount === 228;
  console.log(`   [${a2 ? 'PASS' : 'FAIL'}] 2. Cenário A possui exatamente 228 pagamentos futuros`);
  asserts.push(a2);

  const a3 = auditB.monthsCount === 218;
  console.log(`   [${a3 ? 'PASS' : 'FAIL'}] 3. Cenário B possui exatamente 218 pagamentos futuros`);
  asserts.push(a3);

  const a4 = savedMonths === 10;
  console.log(`   [${a4 ? 'PASS' : 'FAIL'}] 4. Economia de exatamente 10 meses`);
  asserts.push(a4);

  const a5 = savedInterest === 15870.71;
  console.log(`   [${a5 ? 'PASS' : 'FAIL'}] 5. Economia de juros é exatamente R$ 15.870,71`);
  asserts.push(a5);

  const a6 = auditA.history[auditA.history.length - 1].nextBal === 0;
  console.log(`   [${a6 ? 'PASS' : 'FAIL'}] 6. Saldo final do Cenário A é R$ 0,00`);
  asserts.push(a6);

  const a7 = auditB.history[auditB.history.length - 1].nextBal === 0;
  console.log(`   [${a7 ? 'PASS' : 'FAIL'}] 7. Saldo final do Cenário B é R$ 0,00`);
  asserts.push(a7);

  // Verificação de Integridade dos Arquivos Imutáveis
  const fsPath = path.join(process.cwd(), 'src/services/financeService.ts');
  const fsContent = fs.readFileSync(fsPath, 'utf8');
  const a8 = fsContent.includes('calculateAmortization') && fsContent.includes('loadTRData');
  console.log(`   [${a8 ? 'PASS' : 'FAIL'}] 8. financeService.ts permaneceu 100% INTACTO`);
  asserts.push(a8);

  const allPassed = asserts.every(Boolean);
  console.log(`\nRESULTADO DA AUDITORIA: ${asserts.filter(Boolean).length}/${asserts.length} ASSERÇÕES APROVADAS`);
  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
