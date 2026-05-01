import { addMonths, format, parse, startOfMonth } from 'date-fns';
import { AmortizationRow, BCBTRPoint, ContractConfig, Transaction } from '../types';
import { safeNumber, safeDate, round2, parseBCBRate } from '../lib/utils';

class FinanceService {
  private trCache: Map<string, number> = new Map(); // month-key (yyyy-MM) -> monthly-rate
  

  private sumByInstallment(transactions: Transaction[], installmentNumber: number, type: 'PAYMENT' | 'LANCE'): number {
    if (!Array.isArray(transactions)) return 0;
    return transactions
      .filter(t => safeNumber(t.installmentNumber) === safeNumber(installmentNumber) && t.type === type)
      .reduce((acc, t) => acc + safeNumber(t.amount), 0);
  }

  /**
   * Fetches TR data from BCB.
   * TR (7811) in this context is monthly percentage.
   */
  async loadTRData() {
    try {
      const response = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.7811/dados?formato=json');
      if (!response.ok) throw new Error('BCB API error');
      
      const data: BCBTRPoint[] = await response.json();
      
      this.trCache.clear();

      if (Array.isArray(data)) {
        const monthlyGroups: { [key: string]: number[] } = {};
        
        data.forEach(point => {
          const date = safeDate(parse(point.data, 'dd/MM/yyyy', new Date()));
          const key = format(date, 'yyyy-MM');
          const rate = parseBCBRate(point.valor);
          
          if (Number.isFinite(rate)) {
            if (!monthlyGroups[key]) monthlyGroups[key] = [];
            monthlyGroups[key].push(rate);
          }
        });

        Object.entries(monthlyGroups).forEach(([key, rates]) => {
          // Compounding formula: (1+r1)*(1+r2)... - 1
          const compoundRate = rates.reduce((acc, r) => acc * (1 + r), 1) - 1;
          this.trCache.set(key, compoundRate);
        });
      }
    } catch (error) {
      console.warn('Erro ao carregar TR BCB. Usando TR zero.', error);
    }
  }

  getTRForMonth(date: Date): number {
    const key = format(safeDate(date), 'yyyy-MM');
    let rate = this.trCache.get(key) || 0;
    
    // Protection: TR monthly is usually very small
    if (rate > 0.1) { // Changed from 0.01 to 0.1 as per prompt (up to 10% month)
      console.warn("TR mensal inválida detectada (muito alta):", rate);
      return 0;
    }
    return rate;
  }

  getAnnualTR(dueDate: Date): number {
    let compoundRate = 1;
    // We need the 12 months previous to the dueDate
    for (let i = 1; i <= 12; i++) {
      const monthDate = addMonths(dueDate, -i);
      const rate = this.getTRForMonth(monthDate);
      compoundRate *= (1 + rate);
    }
    return compoundRate - 1;
  }

  calculateAmortization(config: ContractConfig, transactions: Transaction[], viewMode: 'PROJECTED' | 'REAL' = 'PROJECTED'): AmortizationRow[] {
    const rows: AmortizationRow[] = [];
    
    const annualRatePercent = safeNumber(config.annualInterestRate);
    const monthlyInterestRate = Math.pow(1 + (annualRatePercent / 100), 1 / 12) - 1;
    
    const financedAmount = safeNumber(config.financedAmount);
    const termMonths = safeNumber(config.termMonths);
    const fixedInstallment = safeNumber(config.fixedInstallment);
    const finePercent = safeNumber(config.finePercent);
    const trMode = config.trMode || 'ANNUAL';

    let balance = round2(financedAmount);
    const startDate = safeDate(parse(config.startDate, 'yyyy-MM-dd', new Date()));
    const anniversaryMonth = startDate.getMonth(); // 0-11
    const today = new Date();

    for (let i = 1; i <= termMonths; i++) {
      if (balance <= 0.01 && i > 1) break;

      const dueDate = addMonths(startDate, i - 1);
      const previousBalance = balance;

      // 1. Determine TR Applied
      let monthTRApplied: number | null = null;
      if (trMode === 'MONTHLY') {
        monthTRApplied = this.getTRForMonth(dueDate);
      } else {
        // ANNUAL: Apply only on anniversary starting from month 13
        const isAnniversary = dueDate.getMonth() === anniversaryMonth && i >= 13;
        if (isAnniversary) {
          monthTRApplied = this.getAnnualTR(dueDate);
        }
      }

      // 2. Apply TR Correction
      const trCorrectionValue = monthTRApplied !== null ? round2(previousBalance * monthTRApplied) : 0;
      const balanceAfterTR = round2(previousBalance + trCorrectionValue);

      // 3. Apply Interest
      const interestAmount = round2(balanceAfterTR * monthlyInterestRate);
      const balanceWithInterest = round2(balanceAfterTR + interestAmount);
      
      // Amortization (Contractual)
      const amortizationAmount = round2(fixedInstallment - interestAmount);

      // 4. Lançamentos for this installment
      const paymentDone = round2(this.sumByInstallment(transactions, i, 'PAYMENT'));
      const lanceApplied = round2(this.sumByInstallment(transactions, i, 'LANCE'));

      // 5. Open difference and Penalty
      const openDifference = round2(Math.max(0, fixedInstallment - paymentDone));
      const hasUnpaidBalance = openDifference > 0.01;
      const isPastDue = dueDate < startOfMonth(today);
      const isOverdue = isPastDue && hasUnpaidBalance;
      const penalty = isOverdue ? round2(openDifference * (finePercent / 100)) : 0;

      // 6. Update Balance
      const effectivePayment = viewMode === 'PROJECTED' ? fixedInstallment : paymentDone;

      let finalBalance = round2(balanceWithInterest - effectivePayment - lanceApplied + penalty);
      
      if (!Number.isFinite(finalBalance) || isNaN(finalBalance)) {
        console.error("Erro no cálculo da parcela", { i, balance, balanceWithInterest, effectivePayment, lanceApplied, penalty });
        finalBalance = previousBalance;
      }

      if (finalBalance < 0.01) finalBalance = 0;

      // 7. Status
      let status: 'PAGO' | 'EM_ABERTO' | 'ATRASO' | 'QUITADO' = 'EM_ABERTO';
      if (finalBalance === 0) status = 'QUITADO';
      else if (paymentDone >= fixedInstallment - 0.01) status = 'PAGO';
      else if (isOverdue) status = 'ATRASO';

      rows.push({
        installmentNumber: i,
        date: dueDate,
        previousBalance: round2(previousBalance),
        monthTR: monthTRApplied,
        trCorrection: trCorrectionValue,
        balanceAfterTR,
        interestAmount,
        amortizationAmount,
        contractedInstallment: fixedInstallment,
        paymentDone,
        lanceApplied,
        openDifference,
        penalty,
        finalBalance,
        status
      });

      balance = finalBalance;
      if (balance <= 0) break;
    }

    return rows;
  }
}

export const financeService = new FinanceService();
