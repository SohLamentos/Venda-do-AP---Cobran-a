import { parseBRL, formatBRL, formatCurrency, formatCurrencyInput, round2, safeNumber } from '../src/lib/utils';
import { financeService } from '../src/services/financeService';
import { ContractConfig, Transaction } from '../src/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

console.log('=== TESTES ETAPA 4E.2: SIMULADOR, TR & AUDITORIA ===\n');

// 1. TESTE DE PARSING E FORMATAÇÃO BRL (utils.ts)
console.log('--- 1. Validação do Parsing BRL ---');
assert(parseBRL('5.000,00') === 5000, 'parseBRL("5.000,00") deve ser 5000');
assert(parseBRL('5000') === 5000, 'parseBRL("5000") deve ser 5000');
assert(parseBRL('5000,50') === 5000.5, 'parseBRL("5000,50") deve ser 5000.5');
assert(parseBRL('R$ 12.345,67') === 12345.67, 'parseBRL("R$ 12.345,67") deve ser 12345.67');
assert(parseBRL('1.000.000,00') === 1000000, 'parseBRL("1.000.000,00") deve ser 1000000');
assert(parseBRL('0') === 0, 'parseBRL("0") deve ser 0');
assert(parseBRL('-500') === 0, 'parseBRL("-500") deve retornar 0');
assert(parseBRL('invalid') === 0, 'parseBRL("invalid") deve retornar 0');

assert(formatBRL(5000) === 'R$ 5.000,00', `formatBRL(5000) deve ser "R$ 5.000,00", obtido: ${formatBRL(5000)}`);
assert(formatBRL(12345.67) === 'R$ 12.345,67', `formatBRL(12345.67) deve ser "R$ 12.345,67", obtido: ${formatBRL(12345.67)}`);
assert(formatCurrencyInput(5000) === '5.000,00', `formatCurrencyInput(5000) deve ser "5.000,00", obtido: ${formatCurrencyInput(5000)}`);

// 2. TESTE DA MATEMÁTICA DO SIMULADOR DE ANTECIPAÇÃO
console.log('\n--- 2. Validação da Matemática do Simulador ---');
const currentBal = 197886.81; // Saldo devedor após Parcela 1
const annualRatePercent = 12; // 12% a.a.
const monthlyRate = Math.pow(1 + annualRatePercent / 100, 1 / 12) - 1;
const monthlyPayment = 2390.62;

function simulateAnticipation(simVal: number, currentBalance: number) {
  if (currentBalance <= 0 || simVal <= 0) {
    return {
      newEstimatedBalance: currentBalance,
      simVal: 0,
      estimatedInterestSaved: 0,
      reducedMonths: 0,
    };
  }

  const validSimVal = Math.min(currentBalance, simVal);
  const newEstimatedBalance = Math.max(0, round2(currentBalance - validSimVal));

  // Simulação Base sem antecipação
  let balBase = currentBalance;
  let totalInterestBase = 0;
  let monthsBase = 0;
  while (balBase > 0.01 && monthsBase < 480) {
    const interest = round2(balBase * monthlyRate);
    totalInterestBase += interest;
    const amort = Math.min(balBase, round2(monthlyPayment - interest));
    if (amort <= 0) break;
    balBase = round2(balBase - amort);
    monthsBase++;
  }

  // Simulação com Antecipação
  let balSim = newEstimatedBalance;
  let totalInterestSim = 0;
  let monthsSim = 0;
  while (balSim > 0.01 && monthsSim < 480) {
    const interest = round2(balSim * monthlyRate);
    totalInterestSim += interest;
    const amort = Math.min(balSim, round2(monthlyPayment - interest));
    if (amort <= 0) break;
    balSim = round2(balSim - amort);
    monthsSim++;
  }

  const reducedMonths = Math.max(0, monthsBase - monthsSim);
  const estimatedInterestSaved = Math.max(0, round2(totalInterestBase - totalInterestSim));

  return {
    newEstimatedBalance,
    simVal: validSimVal,
    estimatedInterestSaved,
    reducedMonths,
    monthsBase,
    monthsSim,
  };
}

// Teste Antecipação R$ 5.000,00
const sim5k = simulateAnticipation(5000, currentBal);
console.log('Simulação R$ 5.000,00:', sim5k);
assert(sim5k.newEstimatedBalance === 192886.81, `Novo saldo deve ser 192.886,81, obtido: ${sim5k.newEstimatedBalance}`);
assert(sim5k.estimatedInterestSaved > 0, `Economia de juros deve ser positiva (> 0), obtido: ${sim5k.estimatedInterestSaved}`);
assert(sim5k.reducedMonths > 0, `Meses reduzidos deve ser positivo (> 0), obtido: ${sim5k.reducedMonths}`);
assert(sim5k.monthsSim < sim5k.monthsBase, `Prazo simulado (${sim5k.monthsSim}) deve ser menor que base (${sim5k.monthsBase})`);

// Teste Quitação Integral (simVal = currentBal)
const simFull = simulateAnticipation(currentBal, currentBal);
console.log('Simulação Quitação Integral:', simFull);
assert(simFull.newEstimatedBalance === 0, `Novo saldo na quitação deve ser 0, obtido: ${simFull.newEstimatedBalance}`);
assert(simFull.monthsSim === 0, `Prazo restante deve ser 0 na quitação, obtido: ${simFull.monthsSim}`);
assert(simFull.reducedMonths === sim5k.monthsBase, `Todos os meses restantes devem ser reduzidos na quitação`);

// 3. AUDITORIA DA TR NO FINANCE SERVICE
console.log('\n--- 3. Auditoria da TR (Taxa Referencial) ---');
const trFuture = financeService.getTRForMonth(new Date('2027-01-10'));
assert(trFuture === 0, `TR futura sem dado divulgado deve ser 0%, obtido: ${trFuture}`);

// Teste de cálculo com TR = 0 vs com TR > 0
const dummyConfig: ContractConfig = {
  id: 'test-c1',
  name: 'Teste TR',
  financedAmount: 200000,
  fixedInstallment: 2390.62,
  annualInterestRate: 12,
  termMonths: 180,
  startDate: '2026-09-10',
  dueDay: 10,
  finePercent: 2,
  trMode: 'ANNUAL',
  status: 'ACTIVE',
};

const schedule = financeService.calculateAmortization(dummyConfig, []);
assert(schedule.length > 0, 'Schedule deve gerar parcelas');
assert(schedule[0].installmentNumber === 1, 'Primeira parcela deve ser 1');
assert(schedule[0].monthTR === null, 'No regime ANNUAL, mês 1 não é aniversário (monthTR é null)');
assert(schedule[0].trCorrection === 0, 'Correção TR mês 1 deve ser 0');

console.log('\n✅ TODOS OS TESTES UNITÁRIOS DA ETAPA 4E.2 PASSARAM COM SUCESSO!\n');
