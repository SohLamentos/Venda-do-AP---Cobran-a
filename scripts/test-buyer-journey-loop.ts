import { round2 } from '../src/lib/utils';

const currentBal = 234546.37;
const simulatedAmount = 5000.00;
const newEstimatedBalance = Math.max(0, round2(currentBal - simulatedAmount));
const annualRatePercent = 8;
const monthlyRate = Math.pow(1 + annualRatePercent / 100, 1 / 12) - 1;
const monthlyPayment = 1965.63;

// Loop idêntico ao de BuyerJourney.tsx
let balBase = currentBal;
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

console.log('BuyerJourney simulation loop output:');
console.log('monthsBase:', monthsBase);
console.log('monthsSim:', monthsSim);
console.log('reducedMonths:', reducedMonths);
console.log('totalInterestBase:', round2(totalInterestBase));
console.log('totalInterestSim:', round2(totalInterestSim));
console.log('estimatedInterestSaved:', estimatedInterestSaved);
