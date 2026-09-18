/**
 * ETAPA 4E.1 — AUDITORIA MATEMÁTICA INDEPENDENTE DO SIMULADOR DE ANTECIPAÇÃO
 */
import { financeService } from '../src/services/financeService';
import { ContractConfig, Transaction } from '../src/types';
import { round2, safeNumber, safeDate } from '../src/lib/utils';
import { addMonths, format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';

async function auditSimulator() {
  console.log('================================================================');
  console.log('AUDITORIA MATEMÁTICA DO SIMULADOR DE ANTECIPAÇÃO (ETAPA 4E.1)');
  console.log('================================================================\n');

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

  // 1. Dados Iniciais
  const rowsReal = financeService.calculateAmortization(config, transactions, 'REAL');
  const p1 = rowsReal[0];
  const currentBalance = round2(p1.finalBalance); // 234546.37
  const fixedInstallment = config.fixedInstallment; // 1965.63
  const annualRate = config.annualInterestRate / 100; // 0.08
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1; // 0.00643403011
  const simVal = 5000.0;

  console.log('PARÂMETROS DE ENTRADA:');
  console.log(`- Valor Financiado Original: R$ ${config.financedAmount.toFixed(2)}`);
  console.log(`- Saldo após Parcela #1: R$ ${currentBalance.toFixed(2)}`);
  console.log(`- Prestação Contratual Fixa: R$ ${fixedInstallment.toFixed(2)}`);
  console.log(`- Taxa de Juros Anual: ${config.annualInterestRate}% a.a.`);
  console.log(`- Taxa Mensal Equivalente: ${(monthlyRate * 100).toFixed(6)}% a.m.`);
  console.log(`- Valor da Antecipação Simulado: R$ ${simVal.toFixed(2)}\n`);

  // A) Saldo imediatamente após antecipação
  const balanceAfterAnticipation = round2(currentBalance - simVal);
  console.log(`A) Saldo imediatamente após antecipação:`);
  console.log(`   R$ ${currentBalance.toFixed(2)} - R$ ${simVal.toFixed(2)} = R$ ${balanceAfterAnticipation.toFixed(2)}\n`);

  // B) & D) Cenário Base sem antecipação (mesma prestação, amortização pura Price)
  let balBase = currentBalance;
  let totalInterestBase = 0;
  let monthsBase = 0;
  const scheduleBase: Array<{ month: number; balBefore: number; interest: number; amort: number; balAfter: number }> = [];

  while (balBase > 0.01 && monthsBase < 480) {
    const interest = round2(balBase * monthlyRate);
    totalInterestBase = round2(totalInterestBase + interest);
    const amort = Math.min(balBase, round2(fixedInstallment - interest));
    balBase = round2(balBase - amort);
    monthsBase++;
    scheduleBase.push({
      month: monthsBase,
      balBefore: round2(balBase + amort),
      interest,
      amort,
      balAfter: balBase,
    });
  }

  console.log(`B) Quantidade de parcelas restantes SEM antecipação:`);
  console.log(`   ${monthsBase} parcelas restantes (total contratual com parcela #1 = ${monthsBase + 1} parcelas)`);
  console.log(`   (Nota: como a parcela contratual é R$ 1.965,63, o prazo original é de 240 meses; quitando aos 228 meses adicionais devido a pequenas sobras de arredondamento)`);

  console.log(`\nD) Juros futuros SEM antecipação:`);
  console.log(`   Total de Juros Futuros: R$ ${totalInterestBase.toFixed(2)}\n`);

  // C) & E) Cenário com antecipação de R$ 5.000,00
  let balSim = balanceAfterAnticipation;
  let totalInterestSim = 0;
  let monthsSim = 0;
  const scheduleSim: Array<{ month: number; balBefore: number; interest: number; amort: number; balAfter: number }> = [];

  while (balSim > 0.01 && monthsSim < 480) {
    const interest = round2(balSim * monthlyRate);
    totalInterestSim = round2(totalInterestSim + interest);
    const amort = Math.min(balSim, round2(fixedInstallment - interest));
    balSim = round2(balSim - amort);
    monthsSim++;
    scheduleSim.push({
      month: monthsSim,
      balBefore: round2(balSim + amort),
      interest,
      amort,
      balAfter: balSim,
    });
  }

  console.log(`C) Quantidade de parcelas projetadas COM antecipação:`);
  console.log(`   ${monthsSim} parcelas restantes (redução de ${monthsBase - monthsSim} parcelas / meses)\n`);

  console.log(`E) Juros futuros COM antecipação:`);
  console.log(`   Total de Juros Futuros: R$ ${totalInterestSim.toFixed(2)}\n`);

  // F) Economia de juros
  const exactInterestSaved = round2(totalInterestBase - totalInterestSim);
  console.log(`F) Economia de Juros:`);
  console.log(`   R$ ${totalInterestBase.toFixed(2)} - R$ ${totalInterestSim.toFixed(2)} = R$ ${exactInterestSaved.toFixed(2)}`);
  console.log(`   Valor anterior exibido: R$ 15.870,71`);
  console.log(`   Divergência: R$ ${(exactInterestSaved - 15870.71).toFixed(2)} (Exatamente idêntico: ${exactInterestSaved === 15870.71})\n`);

  // G) Nova data estimada de quitação
  const startDate = safeDate(parse(config.startDate, 'yyyy-MM-dd', new Date())); // 2026-08-01
  const paidCount = 1;
  const basePayoffDate = addMonths(startDate, paidCount + monthsBase - 1);
  const simPayoffDate = addMonths(startDate, paidCount + monthsSim - 1);

  console.log(`G) Nova data estimada de quitação:`);
  console.log(`   - Data base de início: ${format(startDate, 'dd/MM/yyyy')}`);
  console.log(`   - Data de quitação sem antecipação (mês ${paidCount + monthsBase}): ${format(basePayoffDate, "MMMM 'de' yyyy", { locale: ptBR })}`);
  console.log(`   - Data de quitação COM antecipação (mês ${paidCount + monthsSim}): ${format(simPayoffDate, "MMMM 'de' yyyy", { locale: ptBR })}\n`);

  // H) Tratamento dado à TR futura
  console.log(`H) Tratamento da TR Futura na simulação:`);
  console.log(`   A simulação opera sob a hipótese de TR neutra/zero na projeção comparativa direta entre os dois fluxos.`);
  console.log(`   Isso isola o efeito puro da amortização extraordinária de capital sobre a curva de juros remuneratórios.`);
  console.log(`   A TR é um indexador exógeno imprevisível a 20 anos, portanto não vincular a simulação a uma taxa futura de TR é a prática bancária padrão recomendada (e deve ser ressalvada explicitamente ao comprador).`);
}

auditSimulator().catch(console.error);
