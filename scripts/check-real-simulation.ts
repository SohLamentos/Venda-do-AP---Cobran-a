import { round2 } from '../src/lib/utils';
import { addMonths, format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const currentBalance = 234546.37;
const simVal = 5000.00;
const balanceAfterAnticipation = round2(currentBalance - simVal);
const annualRate = 0.08;
const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
const monthlyPayment = 1965.63;

console.log('--- RECALCULO RIGOROSO MÊS A MÊS ---');
console.log('Taxa mensal equivalente:', monthlyRate, `(${(monthlyRate * 100).toFixed(6)}%)`);

// 1. Sem antecipação
let balBase = currentBalance;
let totalInterestBase = 0;
let totalPaidBase = 0;
let monthsBase = 0;
let lastPaymentBase = 0;

while (balBase > 0.001 && monthsBase < 480) {
  const interest = round2(balBase * monthlyRate);
  totalInterestBase = round2(totalInterestBase + interest);
  monthsBase++;
  
  if (balBase + interest <= monthlyPayment) {
    lastPaymentBase = round2(balBase + interest);
    totalPaidBase = round2(totalPaidBase + lastPaymentBase);
    const amort = balBase;
    balBase = 0;
    break;
  } else {
    const amort = round2(monthlyPayment - interest);
    balBase = round2(balBase - amort);
    totalPaidBase = round2(totalPaidBase + monthlyPayment);
  }
}

console.log('\nSEM ANTECIPAÇÃO:');
console.log('Meses restantes:', monthsBase);
console.log('Total Juros Futuros: R$', totalInterestBase.toFixed(2));
console.log('Total Pagamentos Futuros: R$', totalPaidBase.toFixed(2));
console.log('Última parcela residual: R$', lastPaymentBase.toFixed(2));

// 2. Com antecipação de R$ 5.000,00
let balSim = balanceAfterAnticipation;
let totalInterestSim = 0;
let totalPaidSim = 0;
let monthsSim = 0;
let lastPaymentSim = 0;

while (balSim > 0.001 && monthsSim < 480) {
  const interest = round2(balSim * monthlyRate);
  totalInterestSim = round2(totalInterestSim + interest);
  monthsSim++;
  
  if (balSim + interest <= monthlyPayment) {
    lastPaymentSim = round2(balSim + interest);
    totalPaidSim = round2(totalPaidSim + lastPaymentSim);
    const amort = balSim;
    balSim = 0;
    break;
  } else {
    const amort = round2(monthlyPayment - interest);
    balSim = round2(balSim - amort);
    totalPaidSim = round2(totalPaidSim + monthlyPayment);
  }
}

console.log('\nCOM ANTECIPAÇÃO:');
console.log('Meses restantes:', monthsSim);
console.log('Total Juros Futuros: R$', totalInterestSim.toFixed(2));
console.log('Total Pagamentos Futuros (sem contar os R$ 5.000): R$', totalPaidSim.toFixed(2));
console.log('Última parcela residual: R$', lastPaymentSim.toFixed(2));

const reducedMonths = monthsBase - monthsSim;
const interestSaved = round2(totalInterestBase - totalInterestSim);

console.log('\nCOMPARATIVO:');
console.log('Meses economizados:', reducedMonths);
console.log('Economia estimada em juros: R$', interestSaved.toFixed(2));

// Datas de quitação a partir do próximo vencimento 10/10/2026 (ou a partir de startDate 10/09/2026)
// Como parcela 1 foi em 10/09/2026 (ou 16/09/2026), a parcela 2 vence em 10/10/2026 (mês 1 dos pagamentos futuros).
// Parcela final sem antecipação vence em: addMonths(new Date(2026, 8, 10), monthsBase) -> 10/09/2026 + 228 meses
const startDate = parse('2026-09-10', 'yyyy-MM-dd', new Date());
const payoffDateBase = addMonths(startDate, monthsBase);
const payoffDateSim = addMonths(startDate, monthsSim);

console.log('Data quitação sem antecipação:', format(payoffDateBase, "dd/MM/yyyy (MMMM 'de' yyyy)", { locale: ptBR }));
console.log('Data quitação com antecipação:', format(payoffDateSim, "dd/MM/yyyy (MMMM 'de' yyyy)", { locale: ptBR }));
