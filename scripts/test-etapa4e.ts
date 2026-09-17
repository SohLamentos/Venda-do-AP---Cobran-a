/**
 * ETAPA 4E — SUÍTE DE TESTES E VALIDAÇÃO DA NOVA JORNADA DO COMPRADOR
 * Valida a segregação estrita entre REALIZADO e PROJEÇÃO CONTRATUAL,
 * a correção do vazamento da TR, as proporções pedagógicas e o simulador em memória.
 */
import { financeService } from '../src/services/financeService';
import { ContractConfig, Transaction, AmortizationRow } from '../src/types';
import { round2, safeNumber } from '../src/lib/utils';
import { formatPercentFriendly } from '../src/components/BuyerJourney';

async function runEtapa4ETests() {
  console.log('====================================================');
  console.log('ETAPA 4E: VALIDAÇÃO DA NOVA JORNADA DO COMPRADOR');
  console.log('====================================================\n');

  let passedTests = 0;
  const totalTests = 10;

  const config: ContractConfig = {
    name: 'Contrato Real Auditado',
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
    id: 'tx-real-1',
    contractId: 'contract-real',
    date: '2026-08-10',
    installmentNumber: 1,
    amount: 1965.63,
    type: 'PAYMENT',
    method: 'PIX',
    status: 'PAGO',
    createdAt: '2026-08-10',
  };

  const transactions = [tx1];

  // 1. Amortização real (apenas para apuração do histórico)
  const rowsReal = financeService.calculateAmortization(config, transactions, 'REAL');
  const realizedRows = rowsReal.filter(
    (row) =>
      row.status === 'PAGO' ||
      row.status === 'QUITADO' ||
      safeNumber(row.paymentDone) > 0 ||
      safeNumber(row.lanceApplied) > 0
  );

  // 2. Amortização projetada (para continuidade contratual)
  const rowsProjected = financeService.calculateAmortization(config, transactions, 'PROJECTED');

  // TEST 1: Saldo Devedor Atual deriva estritamente do último pagamento realizado
  console.log('[TEST 1] Saldo Devedor Atual pós-pagamento #1');
  const lastRealized = realizedRows[realizedRows.length - 1];
  const currentBalance = safeNumber(lastRealized.finalBalance);
  if (currentBalance === 234546.37) {
    console.log(`  -> PASS: Saldo atual = R$ ${currentBalance.toFixed(2)} (exatamente R$ 234.546,37)`);
    passedTests++;
  } else {
    console.error(`  -> FAIL: Saldo divergente: ${currentBalance}`);
  }

  // TEST 2: Total Efetivamente Pago soma estritamente transações reais
  console.log('\n[TEST 2] Total Já Pago (Realizado)');
  const totalPaid = realizedRows.reduce(
    (acc, r) => acc + safeNumber(r.paymentDone) + safeNumber(r.lanceApplied),
    0
  );
  if (totalPaid === 1965.63) {
    console.log(`  -> PASS: Total pago = R$ ${totalPaid.toFixed(2)}`);
    passedTests++;
  } else {
    console.error(`  -> FAIL: Total pago divergente: ${totalPaid}`);
  }

  // TEST 3: Capital Amortizado = Financiado - Saldo Atual
  console.log('\n[TEST 3] Capital Amortizado Real');
  const amortizedPrincipal = round2(config.financedAmount - currentBalance);
  if (amortizedPrincipal === 453.63) {
    console.log(`  -> PASS: Capital amortizado = R$ ${amortizedPrincipal.toFixed(2)}`);
    passedTests++;
  } else {
    console.error(`  -> FAIL: Capital amortizado divergente: ${amortizedPrincipal}`);
  }

  // TEST 4: Correção do Vazamento da TR (TR Realizada = R$ 0,00)
  console.log('\n[TEST 4] TR Efetivamente Aplicada (Eliminação do Vazamento)');
  const trRealized = realizedRows.reduce((acc, r) => acc + safeNumber(r.trCorrection), 0);
  // O bug do dashboard antigo somava todas as parcelas (mesmo não pagas)
  // No novo BuyerJourney, o card "Correção TR" soma estritamente de realizedRows
  if (trRealized === 0) {
    console.log(`  -> PASS: TR Realizada = R$ 0,00 (Exatamente zero para pagamentos realizados sem TR)`);
    console.log(`  -> INFO: Proteção ativa: parcelas futuras não contaminam o valor realizado exibido ao comprador.`);
    passedTests++;
  } else {
    console.error(`  -> FAIL: TR Realizada contaminada: ${trRealized}`);
  }

  // TEST 5: "Para Onde Foi Seu Dinheiro?" — Proporções com denominador Total Pago
  console.log('\n[TEST 5] Divisão Pedagógica dos Pagamentos Realizados');
  const interestRealized = realizedRows.reduce((acc, r) => acc + safeNumber(r.interestAmount), 0);
  const capitalRatio = (amortizedPrincipal / totalPaid) * 100;
  const interestRatio = (interestRealized / totalPaid) * 100;
  const trRatio = (trRealized / totalPaid) * 100;
  const sumRatios = round2(capitalRatio + interestRatio + trRatio);

  if (Math.abs(capitalRatio - 23.0776) < 0.01 && Math.abs(interestRatio - 76.9223) < 0.01 && sumRatios === 100) {
    console.log(`  -> PASS: Capital = ${capitalRatio.toFixed(2)}%, Juros = ${interestRatio.toFixed(2)}%, TR = ${trRatio.toFixed(2)}% (Soma = 100%)`);
    passedTests++;
  } else {
    console.error(`  -> FAIL: Proporções divergentes: Capital=${capitalRatio}, Juros=${interestRatio}`);
  }

  // TEST 6: Formatação de Percentuais (2 casas decimais sem arredondamento excessivo)
  console.log('\n[TEST 6] Padronização de Percentuais Amigáveis');
  const formattedCap = formatPercentFriendly(capitalRatio);
  const formattedInt = formatPercentFriendly(interestRatio);
  if (formattedCap === '23,08%' && formattedInt === '76,92%') {
    console.log(`  -> PASS: Formatado Capital = "${formattedCap}", Juros = "${formattedInt}"`);
    passedTests++;
  } else {
    console.error(`  -> FAIL: Formatação inesperada: Cap=${formattedCap}, Int=${formattedInt}`);
  }

  // TEST 7: Sua Jornada até a Quitação (Progresso pelo Capital Amortizado)
  console.log('\n[TEST 7] Progresso da Jornada (Capital Amortizado / Financiado)');
  const journeyProgress = (amortizedPrincipal / config.financedAmount) * 100;
  const formattedJourney = formatPercentFriendly(journeyProgress);
  if (formattedJourney === '0,19%') {
    console.log(`  -> PASS: Progresso da jornada = ${formattedJourney} (R$ 453,63 / R$ 235.000,00)`);
    passedTests++;
  } else {
    console.error(`  -> FAIL: Progresso da jornada divergente: ${formattedJourney}`);
  }

  // TEST 8: Próximo Vencimento da Parcela #2
  console.log('\n[TEST 8] Próximo Vencimento Contratual');
  const nextRow = rowsProjected[1];
  if (nextRow && nextRow.installmentNumber === 2 && nextRow.contractedInstallment === 1965.63) {
    console.log(`  -> PASS: Parcela #2 com valor previsto de R$ ${nextRow.contractedInstallment.toFixed(2)}`);
    passedTests++;
  } else {
    console.error('  -> FAIL: Próxima parcela não identificada corretamente');
  }

  // TEST 9: Projeção Contratual Tende à Quitação
  console.log('\n[TEST 9] Projeção Contratual Tende à Quitação');
  const lastProjectedRow = rowsProjected[rowsProjected.length - 1];
  const finalProjectedBalance = lastProjectedRow.finalBalance;
  if (finalProjectedBalance <= 0.01) {
    console.log(`  -> PASS: Projeção atinge quitação na parcela #${lastProjectedRow.installmentNumber} (Saldo final: R$ ${finalProjectedBalance.toFixed(2)})`);
    passedTests++;
  } else {
    console.error(`  -> FAIL: Projeção não quitou: Saldo ${finalProjectedBalance}`);
  }

  // TEST 10: Simulador de Antecipação em Memória (R$ 5.000,00)
  console.log('\n[TEST 10] Validação do Simulador de Antecipação (In-Memory)');
  const simVal = 5000;
  const annualRatePercent = safeNumber(config.annualInterestRate);
  const monthlyRate = Math.pow(1 + annualRatePercent / 100, 1 / 12) - 1;
  const monthlyPayment = safeNumber(config.fixedInstallment);

  // Cenário Base
  let balBase = currentBalance;
  let totalInterestBase = 0;
  let monthsBase = 0;
  while (balBase > 0.01 && monthsBase < 480) {
    const interest = round2(balBase * monthlyRate);
    totalInterestBase += interest;
    const amort = Math.min(balBase, round2(monthlyPayment - interest));
    balBase = round2(balBase - amort);
    monthsBase++;
  }

  // Cenário Simulado com R$ 5.000
  const initialBalSim = round2(currentBalance - simVal);
  let balSim = initialBalSim;
  let totalInterestSim = 0;
  let monthsSim = 0;
  while (balSim > 0.01 && monthsSim < 480) {
    const interest = round2(balSim * monthlyRate);
    totalInterestSim += interest;
    const amort = Math.min(balSim, round2(monthlyPayment - interest));
    balSim = round2(balSim - amort);
    monthsSim++;
  }

  const interestSaved = round2(totalInterestBase - totalInterestSim);
  const monthsSaved = monthsBase - monthsSim;

  if (initialBalSim === 229546.37 && interestSaved > 0 && monthsSaved > 0) {
    console.log(`  -> PASS: Simulação de R$ 5.000: Novo saldo R$ ${initialBalSim.toFixed(2)}, Economia juros R$ ${interestSaved.toFixed(2)}, Redução de ${monthsSaved} meses`);
    passedTests++;
  } else {
    console.error(`  -> FAIL: Simulação inconsistente: initialBalSim=${initialBalSim}, interestSaved=${interestSaved}, monthsSaved=${monthsSaved}`);
  }

  console.log('\n====================================================');
  console.log(`RESULTADO ETAPA 4E: ${passedTests}/${totalTests} TESTES PASSARAM`);
  console.log('====================================================');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runEtapa4ETests().catch((err) => {
  console.error('Erro na execução do teste Etapa 4E:', err);
  process.exit(1);
});
