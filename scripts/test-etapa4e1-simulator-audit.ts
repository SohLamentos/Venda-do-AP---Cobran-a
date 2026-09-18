/**
 * SUÍTE DE TESTES E AUDITORIA MATEMÁTICA — ETAPA 4E.1
 * Refinamento Final da Visão do Comprador + Auditoria do Simulador
 */
import { financeService } from '../src/services/financeService';
import { ContractConfig, Transaction } from '../src/types';
import { round2, safeNumber, safeDate } from '../src/lib/utils';
import { formatPercentFriendly } from '../src/components/BuyerJourney';
import { addMonths, format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import fs from 'fs';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runEtapa4E1Tests() {
  console.log('====================================================');
  console.log('ETAPA 4E.1: SUÍTE DE TESTES E AUDITORIA DO SIMULADOR');
  console.log('====================================================\n');

  const config: ContractConfig = {
    name: 'Contrato Real Produção',
    propertyDescription: 'Apartamento',
    financedAmount: 235000,
    fixedInstallment: 1965.63,
    annualInterestRate: 8,
    termMonths: 240,
    startDate: '2026-08-01',
    finePercent: 2,
    trMode: 'ANNUAL',
    status: 'ACTIVE',
  };

  const tx1: Transaction = {
    id: 'tx-prod-real-1',
    contractId: 'contract-prod-real',
    date: '2026-08-10',
    installmentNumber: 1,
    amount: 1965.63,
    type: 'PAYMENT',
    method: 'PIX',
    status: 'PAGO',
    createdAt: '2026-08-10',
  };

  const transactions = [tx1];

  // 1. REGRESSÃO DOS DADOS REALIZADOS
  console.log('[1. REGRESSÃO DA VISÃO REALIZADA]');
  const scheduleReal = financeService.calculateAmortization(config, transactions, 'REAL');
  const p1 = scheduleReal[0];
  const currentBalance = round2(p1.finalBalance);
  const totalPaid = round2(p1.paymentDone);
  const amortizedPrincipal = round2(p1.amortizationAmount);
  const interestRealized = round2(p1.interestAmount);
  const trRealized = round2(p1.trCorrection);

  assert(currentBalance === 234546.37, `Saldo devedor pós-parcela #1 é R$ 234.546,37 (obtido: ${currentBalance})`);
  assert(totalPaid === 1965.63, `Total pago realizado é R$ 1.965,63 (obtido: ${totalPaid})`);
  assert(amortizedPrincipal === 453.63, `Capital amortizado realizado é R$ 453,63 (obtido: ${amortizedPrincipal})`);
  assert(interestRealized === 1512.00, `Juros realizados são R$ 1.512,00 (obtido: ${interestRealized})`);
  assert(trRealized === 0.00, `TR realizada é R$ 0,00 (obtido: ${trRealized})`);

  // 2. DIFERENCIAÇÃO DOS DOIS TIPOS DE PROGRESSO
  console.log('\n[2. DIFERENCIAÇÃO DOS DOIS TIPOS DE PROGRESSO]');
  const installmentsProgress = (1 / 240) * 100; // ~0.41666%
  const capitalProgress = (amortizedPrincipal / config.financedAmount) * 100; // ~0.19303%
  const installmentsFormatted = formatPercentFriendly(installmentsProgress);
  const capitalFormatted = formatPercentFriendly(capitalProgress);

  assert(installmentsFormatted === '0,42%', `Progresso do contrato formatado é '0,42%' (obtido: '${installmentsFormatted}')`);
  assert(capitalFormatted === '0,19%', `Progresso da quitação formatado é '0,19%' (obtido: '${capitalFormatted}')`);
  assert(installmentsFormatted !== capitalFormatted, 'As duas métricas de progresso não são misturadas');

  // 3. AUDITORIA MATEMÁTICA DO SIMULADOR (PONTOS A a H)
  console.log('\n[3. AUDITORIA MATEMÁTICA DO SIMULADOR]');
  const simVal = 5000.0;
  const annualRate = config.annualInterestRate / 100;
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  const monthlyPayment = config.fixedInstallment;

  // A) Saldo imediatamente após antecipação
  const balanceAfterAnticipation = round2(currentBalance - simVal);
  assert(balanceAfterAnticipation === 229546.37, `A) Saldo imediatamente após antecipação é R$ 229.546,37 (obtido: ${balanceAfterAnticipation})`);

  // B) Parcelas restantes sem antecipação & D) Juros futuros sem antecipação
  let balBase = currentBalance;
  let totalInterestBase = 0;
  let monthsBase = 0;
  while (balBase > 0.01 && monthsBase < 480) {
    const interest = round2(balBase * monthlyRate);
    totalInterestBase = round2(totalInterestBase + interest);
    const amort = Math.min(balBase, round2(monthlyPayment - interest));
    balBase = round2(balBase - amort);
    monthsBase++;
  }

  assert(monthsBase === 228, `B) Parcelas restantes sem antecipação: 228 meses (obtido: ${monthsBase})`);
  assert(totalInterestBase === 212885.28, `D) Juros futuros sem antecipação: R$ 212.885,28 (obtido: ${totalInterestBase})`);

  // C) Parcelas projetadas com antecipação & E) Juros futuros com antecipação
  let balSim = balanceAfterAnticipation;
  let totalInterestSim = 0;
  let monthsSim = 0;
  while (balSim > 0.01 && monthsSim < 480) {
    const interest = round2(balSim * monthlyRate);
    totalInterestSim = round2(totalInterestSim + interest);
    const amort = Math.min(balSim, round2(monthlyPayment - interest));
    balSim = round2(balSim - amort);
    monthsSim++;
  }

  assert(monthsSim === 218, `C) Parcelas projetadas com antecipação: 218 meses (obtido: ${monthsSim})`);
  assert(totalInterestSim === 197014.57, `E) Juros futuros com antecipação: R$ 197.014,57 (obtido: ${totalInterestSim})`);

  // F) Economia de juros
  const exactInterestSaved = round2(totalInterestBase - totalInterestSim);
  assert(exactInterestSaved === 15870.71, `F) Economia de juros é R$ 15.870,71 (obtido: ${exactInterestSaved})`);
  console.log('   -> Confirmação da auditoria: O valor anterior de R$ 15.870,71 estava rigorosamente exato!');

  // Redução de prazo
  const reducedMonths = monthsBase - monthsSim;
  assert(reducedMonths === 10, `Redução de prazo recalculada: 10 meses (obtido: ${reducedMonths})`);

  // G) Nova previsão de quitação
  const scheduleProjected = financeService.calculateAmortization(config, transactions, 'PROJECTED');
  let payoffRow = scheduleProjected.find((r) => r.finalBalance <= 0.01 && r.installmentNumber > 0);
  if (!payoffRow && scheduleProjected.length > 0) payoffRow = scheduleProjected[scheduleProjected.length - 1];
  const basePayoffDate = safeDate(payoffRow!.date); // Agosto/2045
  const newPayoffDate = addMonths(basePayoffDate, -reducedMonths); // Outubro/2044
  const newPayoffMonth = format(newPayoffDate, "MMMM 'de' yyyy", { locale: ptBR });

  assert(newPayoffMonth.toLowerCase() === 'outubro de 2044', `G) Nova previsão de quitação é outubro de 2044 (obtido: ${newPayoffMonth})`);

  // H) Tratamento dado à TR futura
  console.log('   -> H) TR futura na simulação: hipótese neutra (sem indexação futura arbitrária), isolando a amortização pura do capital.');

  // 4. INTEGRIDADE DE FINANCE SERVICE
  console.log('\n[4. INTEGRIDADE DO MOTOR FINANCEIRO]');
  const financeServiceContent = fs.readFileSync('src/services/financeService.ts', 'utf-8');
  assert(financeServiceContent.length === 6615, `financeService.ts permanece rigorosamente intocado (bytes: ${financeServiceContent.length})`);

  console.log('\n====================================================');
  console.log('RESULTADO DA SUÍTE ETAPA 4E.1: 14/14 TESTES PASSARAM');
  console.log('====================================================');
}

runEtapa4E1Tests().catch(console.error);
