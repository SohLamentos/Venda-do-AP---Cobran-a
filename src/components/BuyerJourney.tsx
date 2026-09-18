import React from 'react';
import { 
  DollarSign, 
  ArrowUpRight, 
  TrendingDown, 
  CheckCircle2, 
  Calendar, 
  Clock, 
  Sparkles, 
  Info, 
  ArrowRight, 
  HelpCircle, 
  ShieldCheck, 
  Home, 
  Percent, 
  Calculator,
  Flame,
  ChevronRight
} from 'lucide-react';
import { motion } from 'motion/react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ReferenceLine 
} from 'recharts';
import { format, parse, addMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn, formatCurrency, safeNumber, safeDate, round2, formatCurrencyInput, parseCurrencyBR, parseBRL, formatBRL } from '../lib/utils';
import { ContractConfig, Transaction, AmortizationRow, CloudflareUser } from '../types';
import { financeService } from '../services/financeService';

export interface BuyerJourneyProps {
  config: ContractConfig;
  transactions: Transaction[];
  amortization: AmortizationRow[];
  user: CloudflareUser;
  onNavigateToTransactions: () => void;
}

/**
 * Formata percentuais com 2 casas decimais de forma amigável
 * Ex: 0.1930 -> "0,19%" | 76.9219 -> "76,92%"
 */
export function formatPercentFriendly(value: number): string {
  const n = safeNumber(value);
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
}

interface ChartPoint {
  name: number;
  label: string;
  installmentNumber: number;
  date: Date;
  dateFormatted: string;
  saldoRealizado: number | null;
  saldoProjetado: number | null;
  isRealized: boolean;
  isToday: boolean;
  valorPago?: number;
  valorPrevisto?: number;
  capitalAmortizado?: number;
  capitalEstimado?: number;
  juros?: number;
  jurosEstimados?: number;
  tr?: number;
  trEstimada?: number;
  status: string;
}

export const BuyerJourney: React.FC<BuyerJourneyProps> = ({
  config,
  transactions,
  amortization,
  user,
  onNavigateToTransactions,
}) => {
  // 1. UNIVERSO REALIZADO (Exclusivamente fatos financeiros já ocorridos/persistidos)
  const realizedRows = React.useMemo(() => {
    const list = Array.isArray(amortization) ? amortization : [];
    return list.filter(
      (row) =>
        row.status === 'PAGO' ||
        row.status === 'QUITADO' ||
        safeNumber(row.paymentDone) > 0 ||
        safeNumber(row.lanceApplied) > 0
    );
  }, [amortization]);

  const lastRealizedRow = realizedRows.length > 0 ? realizedRows[realizedRows.length - 1] : null;

  // Identificar a transação de pagamento correspondente à última parcela realizada para preservar paymentDate real
  const lastRealizedPaymentTx = React.useMemo(() => {
    if (!lastRealizedRow || !Array.isArray(transactions)) return null;
    const matches = transactions.filter(
      (tx) => tx.installmentNumber === lastRealizedRow.installmentNumber && tx.type === 'PAYMENT'
    );
    if (matches.length === 0) return null;
    return matches.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  }, [lastRealizedRow, transactions]);

  // REGRA CANÔNICA CONTRATUAL:
  // O dia de vencimento (dueDay) pertence ao contrato ativo (extraído de config.dueDay ou config.startDate).
  // Separar estritamente:
  // - dueDate: data de vencimento da competência (derivada de contractualStartDate e dueDay do contrato)
  // - paymentDate: data efetiva em que o pagamento foi realizado (ex: 16/09/2026 para Parcela #1)
  // NUNCA utilizar paymentDate para derivar o calendário de vencimentos futuros.
  const contractDueDay = React.useMemo(() => {
    if (config.dueDay && config.dueDay >= 1 && config.dueDay <= 31) {
      return config.dueDay;
    }
    if (config.startDate) {
      const parsed = safeDate(parse(config.startDate, 'yyyy-MM-dd', new Date()));
      return parsed.getDate();
    }
    return 10;
  }, [config.dueDay, config.startDate]);

  const contractualStartDate = React.useMemo(() => {
    const rawStart = config.startDate || '2026-09-10';
    const parsed = safeDate(parse(rawStart, 'yyyy-MM-dd', new Date()));
    parsed.setDate(contractDueDay);
    return parsed;
  }, [config.startDate, contractDueDay]);

  const contractualConfig = React.useMemo(() => {
    return {
      ...config,
      startDate: format(contractualStartDate, 'yyyy-MM-dd'),
      dueDay: contractDueDay,
    };
  }, [config, contractualStartDate, contractDueDay]);

  // 2. UNIVERSO PROJETADO (Simulação de quitação contratual contínua com pagamentos regulares)
  const projectedSchedule = React.useMemo(() => {
    return financeService.calculateAmortization(
      contractualConfig,
      Array.isArray(transactions) ? transactions : [],
      'PROJECTED'
    );
  }, [contractualConfig, transactions]);

  // Indicadores Derivados Estritamente Segregados
  const stats = React.useMemo(() => {
    const financedAmount = safeNumber(config.financedAmount);
    const totalCount = safeNumber(config.termMonths) || 240;
    const paidCount = realizedRows.length;
    const remainingMonths = Math.max(0, totalCount - paidCount);

    // Saldo Devedor Atual Real (Após o último pagamento efetivado)
    let currentBalance = financedAmount;
    if (lastRealizedRow) {
      currentBalance = safeNumber(lastRealizedRow.finalBalance);
    }

    // Capital Efetivamente Amortizado = Valor Financiado - Saldo Real Atual
    const amortizedPrincipal = Math.max(0, round2(financedAmount - currentBalance));

    // Total Pago Realizado (Soma exclusiva dos pagamentos e lances realizados)
    const totalPaid = realizedRows.reduce(
      (acc, r) => acc + safeNumber(r.paymentDone) + safeNumber(r.lanceApplied),
      0
    );

    // Juros Efetivamente Pagos (Apenas de parcelas com pagamento realizado)
    const totalInterestRealized = realizedRows.reduce(
      (acc, r) => acc + safeNumber(r.interestAmount),
      0
    );

    // TR Efetivamente Aplicada (Apenas de competências realizadas)
    const totalTRRealized = realizedRows.reduce(
      (acc, r) => acc + safeNumber(r.trCorrection),
      0
    );

    // Lances Extras Realizados
    const totalLancesRealized = realizedRows.reduce(
      (acc, r) => acc + safeNumber(r.lanceApplied),
      0
    );

    // TR Estimada na Projeção Futura (Apenas para fins informativos e sem misturar com realizado)
    const projectedTotalTR = projectedSchedule.reduce(
      (acc, r) => acc + safeNumber(r.trCorrection),
      0
    );

    // Percentuais Derivados com Denominadores Corretos
    // Dívida quitada: Capital amortizado / Valor financiado
    const debtPaidPercent = financedAmount > 0 ? (amortizedPrincipal / financedAmount) * 100 : 0;

    // Percentual de parcelas concluídas: paidCount / totalCount
    const paidInstallmentsPercent = totalCount > 0 ? (paidCount / totalCount) * 100 : 0;

    // Proporção dos pagamentos realizados
    const capitalPaidRatio = totalPaid > 0 ? (amortizedPrincipal / totalPaid) * 100 : 0;
    const interestPaidRatio = totalPaid > 0 ? (totalInterestRealized / totalPaid) * 100 : 0;
    const trPaidRatio = totalPaid > 0 ? (totalTRRealized / totalPaid) * 100 : 0;
    const lancesPaidRatio = totalPaid > 0 ? (totalLancesRealized / totalPaid) * 100 : 0;

    // Próximo Vencimento
    const nextInstallmentNumber = paidCount + 1;
    const nextRow = projectedSchedule[paidCount] || null;
    const contractStartDate = safeDate(parse(contractualConfig.startDate, 'yyyy-MM-dd', new Date()));
    const nextDueDate = nextRow
      ? safeDate(nextRow.date)
      : addMonths(contractStartDate, paidCount);
    const nextAmount = nextRow ? safeNumber(nextRow.contractedInstallment) : safeNumber(contractualConfig.fixedInstallment);

    // Previsão de Quitação pela Projeção Contratual
    let payoffRow = projectedSchedule.find((r) => r.finalBalance <= 0.01 && r.installmentNumber > 0);
    if (!payoffRow && projectedSchedule.length > 0) {
      payoffRow = projectedSchedule[projectedSchedule.length - 1];
    }
    const payoffInstallmentNumber = payoffRow ? payoffRow.installmentNumber : totalCount;
    // REGRA CANÔNICA: Derivada estritamente do calendário contratual de vencimentos (Dia 10)
    const payoffDate = payoffRow ? safeDate(payoffRow.date) : addMonths(contractStartDate, totalCount - 1);
    const projectedRemainingPayments = Math.max(0, payoffInstallmentNumber - paidCount);

    return {
      currentBalance,
      financedAmount,
      totalPaid,
      amortizedPrincipal,
      totalInterestRealized,
      totalTRRealized,
      totalLancesRealized,
      projectedTotalTR,
      paidCount,
      totalCount,
      remainingMonths,
      projectedRemainingPayments,
      debtPaidPercent,
      paidInstallmentsPercent,
      capitalPaidRatio,
      interestPaidRatio,
      trPaidRatio,
      lancesPaidRatio,
      nextInstallmentNumber,
      nextDueDate,
      nextAmount,
      payoffDate,
      payoffInstallmentNumber,
    };
  }, [contractualConfig, realizedRows, lastRealizedRow, projectedSchedule]);

  // 3. ESTRUTURAÇÃO DO NOVO GRÁFICO PRINCIPAL (Sem duplicação temporal no ponto inicial)
  const chartData = React.useMemo<ChartPoint[]>(() => {
    const points: ChartPoint[] = [];
    const totalCount = safeNumber(contractualConfig.termMonths) || 240;
    const paidCount = stats.paidCount;

    // Pontos 1..N: Representa claramente a posição a partir da Parcela #1 (Hoje) e a projeção futura
    for (let i = 0; i < totalCount; i++) {
      const instNum = i + 1;
      const realRow = amortization[i];
      const projRow = projectedSchedule[i];
      // Vencimento contratual derivado da âncora contratual
      const dueDate = projRow ? safeDate(projRow.date) : addMonths(contractualStartDate, i);

      const isRealized =
        realRow &&
        (realRow.status === 'PAGO' ||
          realRow.status === 'QUITADO' ||
          safeNumber(realRow.paymentDone) > 0 ||
          safeNumber(realRow.lanceApplied) > 0);

      if (isRealized) {
        points.push({
          name: instNum,
          label: `Parcela #${instNum}`,
          installmentNumber: instNum,
          date: dueDate,
          dateFormatted: format(dueDate, 'dd/MM/yyyy'),
          saldoRealizado: safeNumber(realRow.finalBalance),
          // Conecta perfeitamente com a linha projetada a partir do último ponto pago
          saldoProjetado: instNum === paidCount ? safeNumber(realRow.finalBalance) : null,
          isRealized: true,
          isToday: instNum === paidCount,
          valorPago: safeNumber(realRow.paymentDone),
          capitalAmortizado: safeNumber(realRow.amortizationAmount),
          juros: safeNumber(realRow.interestAmount),
          tr: safeNumber(realRow.trCorrection),
          status: 'Pago',
        });
      } else {
        // Ponto Projetado (Sem pagamentos reais, assume quitação contratual regular)
        points.push({
          name: instNum,
          label: `Parcela #${instNum}`,
          installmentNumber: instNum,
          date: dueDate,
          dateFormatted: format(dueDate, 'dd/MM/yyyy'),
          saldoRealizado: null,
          saldoProjetado: projRow ? safeNumber(projRow.finalBalance) : 0,
          isRealized: false,
          isToday: false,
          valorPrevisto: projRow ? safeNumber(projRow.contractedInstallment) : safeNumber(contractualConfig.fixedInstallment),
          capitalEstimado: projRow ? safeNumber(projRow.amortizationAmount) : 0,
          jurosEstimados: projRow ? safeNumber(projRow.interestAmount) : 0,
          trEstimada: projRow ? safeNumber(projRow.trCorrection) : 0,
          status: 'Previsão Contratual',
        });
      }
    }

    return points;
  }, [contractualConfig, contractualStartDate, stats.paidCount, amortization, projectedSchedule]);

  // 4. SIMULADOR DE ANTECIPAÇÃO (Estritamente Read-Only em Memória)
  const [anticipationInput, setAnticipationInput] = React.useState('5.000,00');
  const [simulatedAmount, setSimulatedAmount] = React.useState<number>(5000);
  const [simError, setSimError] = React.useState<string | null>(null);

  const handleSimulate = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseBRL(anticipationInput);
    if (val <= 0) {
      setSimError('O valor da antecipação deve ser maior que zero (ex: R$ 5.000,00).');
      return;
    }
    if (val > stats.currentBalance) {
      setSimError(`O valor não pode ser superior ao saldo devedor atual (${formatCurrency(stats.currentBalance)}).`);
      return;
    }
    setSimError(null);
    setSimulatedAmount(val);
    setAnticipationInput(formatCurrencyInput(val));
  };

  const handleBlurInput = () => {
    const val = parseBRL(anticipationInput);
    if (val > 0) {
      setAnticipationInput(formatCurrencyInput(val));
    }
  };

  const simulationResults = React.useMemo(() => {
    const currentBal = stats.currentBalance;
    const simVal = Math.min(currentBal, simulatedAmount);
    const newEstimatedBalance = Math.max(0, round2(currentBal - simVal));

    if (currentBal <= 0 || simVal <= 0) {
      return {
        newEstimatedBalance: currentBal,
        simVal: 0,
        estimatedInterestSaved: 0,
        reducedMonths: 0,
        newPayoffDate: stats.payoffDate,
      };
    }

    const annualRatePercent = safeNumber(config.annualInterestRate);
    const monthlyRate = Math.pow(1 + annualRatePercent / 100, 1 / 12) - 1;
    const monthlyPayment = safeNumber(config.fixedInstallment);

    // Simulação 1: Fluxo base sem antecipação a partir do saldo atual
    let balBase = currentBal;
    let totalInterestBase = 0;
    let monthsBase = 0;
    while (balBase > 0.01 && monthsBase < 480) {
      const interest = round2(balBase * monthlyRate);
      totalInterestBase += interest;
      const amort = Math.min(balBase, round2(monthlyPayment - interest));
      if (amort <= 0) break; // salvaguarda
      balBase = round2(balBase - amort);
      monthsBase++;
    }

    // Simulação 2: Fluxo com a antecipação pontual aplicada imediatamente
    let balSim = newEstimatedBalance;
    let totalInterestSim = 0;
    let monthsSim = 0;
    while (balSim > 0.01 && monthsSim < 480) {
      const interest = round2(balSim * monthlyRate);
      totalInterestSim += interest;
      const amort = Math.min(balSim, round2(monthlyPayment - interest));
      if (amort <= 0) break; // salvaguarda
      balSim = round2(balSim - amort);
      monthsSim++;
    }

    const reducedMonths = Math.max(0, monthsBase - monthsSim);
    const estimatedInterestSaved = Math.max(0, round2(totalInterestBase - totalInterestSim));
    // Âncora temporal exata: deduz as parcelas economizadas da data contratual de quitação
    const newPayoffDate = addMonths(stats.payoffDate, -reducedMonths);

    return {
      newEstimatedBalance,
      simVal,
      estimatedInterestSaved,
      reducedMonths,
      newPayoffDate,
    };
  }, [stats.currentBalance, stats.payoffDate, simulatedAmount, config.annualInterestRate, config.fixedInstallment]);

  // Formatação amigável da data de quitação
  const payoffFormatted = React.useMemo(() => {
    try {
      const formatted = format(stats.payoffDate, "MMMM 'de' yyyy", { locale: ptBR });
      return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    } catch {
      return 'Em definição';
    }
  }, [stats.payoffDate]);

  const payoffFormattedShort = React.useMemo(() => {
    try {
      const formatted = format(stats.payoffDate, "MMM/yyyy", { locale: ptBR });
      return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    } catch {
      return 'Em definição';
    }
  }, [stats.payoffDate]);

  const simPayoffFormatted = React.useMemo(() => {
    try {
      const formatted = format(simulationResults.newPayoffDate, "MMMM 'de' yyyy", { locale: ptBR });
      return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    } catch {
      return 'Em definição';
    }
  }, [simulationResults.newPayoffDate]);

  // Marcos Simplificados para o Eixo Horizontal (X) do Gráfico
  const payoffInstallment = stats.payoffInstallmentNumber || stats.totalCount;
  const xAxisTicks = React.useMemo(() => {
    const todayTick = stats.paidCount > 0 ? stats.paidCount : 1;
    return [todayTick, 60, 120, 180, payoffInstallment];
  }, [stats.paidCount, payoffInstallment]);

  const formatXAxisTick = (val: number): string => {
    const todayTick = stats.paidCount > 0 ? stats.paidCount : 1;
    if (val === todayTick) return 'Hoje';
    if (val === 60) return '5 anos';
    if (val === 120) return '10 anos';
    if (val === 180) return '15 anos';
    if (val === payoffInstallment) return 'Quitação';
    return '';
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* 1. NOVO CABEÇALHO DA VISÃO GERAL */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Meu Imóvel</h1>
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider border',
                config.status === 'ACTIVE'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              )}
            >
              <ShieldCheck size={13} className="text-emerald-600" />
              {config.status === 'ACTIVE' ? 'Contrato Ativo' : 'Em Rascunho'}
            </span>
          </div>
          <p className="text-sm text-slate-500 font-medium">Acompanhe sua jornada até a quitação</p>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-600 bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200">
          <Home size={16} className="text-indigo-600 shrink-0" />
          <div className="flex flex-col">
            <span className="font-bold text-slate-800">{config.name || 'Financiamento Imobiliário'}</span>
            <span className="text-[11px] text-slate-500">
              {config.propertyDescription ? config.propertyDescription : `Valor Original: ${formatCurrency(stats.financedAmount)}`}
            </span>
          </div>
        </div>
      </div>

      {/* 2. CARDS PRINCIPAIS — PRIMEIRA LINHA */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        {/* CARD 1 — SALDO DEVEDOR ATUAL */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Saldo Devedor Atual</span>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-2 font-mono">
                {formatCurrency(stats.currentBalance)}
              </h2>
            </div>
            <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <DollarSign size={22} />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-slate-500 font-medium">Saldo após o último pagamento</span>
          </div>
        </div>

        {/* CARD 2 — TOTAL JÁ PAGO */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Já Pago</span>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-2 font-mono">
                {formatCurrency(stats.totalPaid)}
              </h2>
            </div>
            <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <ArrowUpRight size={22} />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100">
            <span className="text-xs text-slate-500 font-medium">Valor efetivamente pago até agora</span>
          </div>
        </div>

        {/* CARD 3 — CAPITAL AMORTIZADO */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Capital Amortizado</span>
              <h2 className="text-2xl sm:text-3xl font-black text-emerald-600 tracking-tight mt-2 font-mono">
                {formatCurrency(stats.amortizedPrincipal)}
              </h2>
            </div>
            <div className="w-11 h-11 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 shrink-0">
              <Sparkles size={22} />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Quanto da dívida você já reduziu</span>
            <span className="font-bold text-slate-700">{formatPercentFriendly(stats.debtPaidPercent)}</span>
          </div>
        </div>

        {/* CARD 4 — PROGRESSO DO CONTRATO */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Progresso do Contrato</span>
                <div className="group relative inline-flex items-center">
                  <HelpCircle size={14} className="text-slate-400 hover:text-slate-600 cursor-help" />
                  <div className="invisible group-hover:visible absolute left-0 bottom-full mb-2 w-64 p-2.5 bg-slate-900 text-white text-[11px] font-medium rounded-lg shadow-xl z-30 leading-relaxed pointer-events-none">
                    O número de parcelas pagas e o percentual do capital quitado são diferentes porque parte de cada pagamento corresponde a juros e correções.
                  </div>
                </div>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-2 font-mono">
                {stats.paidCount} de {stats.totalCount} parcelas pagas
              </h2>
            </div>
            <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <TrendingDown size={22} />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div
                className="bg-amber-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0.5, stats.paidInstallmentsPercent))}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-[11px] font-semibold text-slate-500">
              <span>{formatPercentFriendly(stats.paidInstallmentsPercent)} das parcelas</span>
              <span>{stats.remainingMonths} restantes no prazo original</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. SEGUNDA LINHA — PRÓXIMOS PASSOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CARD: PRÓXIMO VENCIMENTO */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-indigo-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Próximo Vencimento</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-xl font-black text-slate-900">Parcela #{stats.nextInstallmentNumber}</span>
              <span className="text-lg font-bold text-slate-700 font-mono">{formatCurrency(stats.nextAmount)}</span>
            </div>
            <p className="text-xs text-slate-500">
              Vencimento previsto:{' '}
              <strong className="text-slate-800 font-semibold">
                {format(stats.nextDueDate, 'dd/MM/yyyy')}
              </strong>
            </p>
          </div>
          <div className="hidden sm:flex px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold">
            Previsão Contratual
          </div>
        </div>

        {/* CARD: PREVISÃO DE QUITAÇÃO */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-emerald-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Previsão de Quitação</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-xl font-black text-emerald-700">{payoffFormatted}</span>
            </div>
            <p className="text-xs text-slate-500">Quitação na parcela #{stats.payoffInstallmentNumber} mantendo os pagamentos regulares</p>
          </div>
          <div className="hidden sm:flex px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold">
            {stats.projectedRemainingPayments} Parcelas Restantes
          </div>
        </div>
      </div>

      {/* 4. GRÁFICO PRINCIPAL — SUA DÍVIDA AO LONGO DO TEMPO */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Sua dívida ao longo do tempo</h2>
            <p className="text-xs text-slate-500 font-medium">Veja como seu saldo pode diminuir mantendo os pagamentos previstos.</p>
          </div>

          <div className="flex items-center gap-5 text-xs font-semibold">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-600" />
              <span className="text-slate-700">Realizado</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 border-t-2 border-dashed border-indigo-500" />
              <span className="text-slate-600">Projeção contratual</span>
            </div>
          </div>
        </div>

        {/* Destaque dos Pontos Chave: HOJE e QUITAÇÃO PREVISTA */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200/80">
            <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full bg-emerald-600 shrink-0" />
              <div>
                <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block">Hoje</span>
                <span className="text-lg font-black text-slate-900 font-mono">{formatCurrency(stats.currentBalance)}</span>
              </div>
            </div>
            <span className="text-[11px] font-bold text-emerald-700 bg-white px-2.5 py-1 rounded-lg border border-emerald-200 shadow-2xs">
              Parcela #{stats.paidCount} paga
            </span>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200/80">
            <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full bg-indigo-600 shrink-0" />
              <div>
                <span className="text-[11px] font-bold text-indigo-800 uppercase tracking-wider block">Quitação prevista</span>
                <span className="text-lg font-black text-slate-900">{payoffFormattedShort}</span>
              </div>
            </div>
            <span className="text-[11px] font-bold text-indigo-700 bg-white px-2.5 py-1 rounded-lg border border-indigo-200 shadow-2xs">
              Saldo R$ 0,00
            </span>
          </div>
        </div>

        <div className="h-[340px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 15, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                ticks={xAxisTicks}
                tickFormatter={formatXAxisTick}
                tick={{ fontSize: 11, fill: '#475569', fontWeight: 600 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`}
                domain={[0, 'auto']}
              />
              <Tooltip content={<CustomChartTooltip />} />

              {/* Marcador Visual: HOJE */}
              {stats.paidCount > 0 && (
                <ReferenceLine
                  x={stats.paidCount}
                  stroke="#059669"
                  strokeDasharray="3 3"
                  label={{
                    value: `Hoje (${formatCurrency(stats.currentBalance)})`,
                    fill: '#059669',
                    fontSize: 11,
                    fontWeight: 800,
                    position: 'top',
                  }}
                />
              )}

              {/* Linha 1: REALIZADO (Sólida, termina no último pagamento real) */}
              <Line
                type="monotone"
                dataKey="saldoRealizado"
                stroke="#059669"
                strokeWidth={3}
                dot={{ r: 4, fill: '#059669', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6, fill: '#059669', strokeWidth: 2, stroke: '#fff' }}
                name="Realizado"
                connectNulls={false}
              />

              {/* Linha 2: PROJEÇÃO CONTRATUAL (Tracejada, parte do saldo real e tende a zero) */}
              <Line
                type="monotone"
                dataKey="saldoProjetado"
                stroke="#6366f1"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 5, fill: '#6366f1' }}
                name="Projeção contratual"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 5. "PARA ONDE FOI SEU DINHEIRO?" & CARD DA TR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Para Onde Foi Seu Dinheiro?</h3>
              <p className="text-xs text-slate-500">
                Divisão dos pagamentos realizados até agora (Total:{' '}
                <strong className="text-slate-800 font-bold">{formatCurrency(stats.totalPaid)}</strong>)
              </p>
            </div>
            <div className="px-2.5 py-1 bg-slate-100 rounded-lg text-slate-600 text-[11px] font-bold">
              Denominador: Pagamentos Reais
            </div>
          </div>

          {/* Barra Segmentada Proporcional */}
          <div className="space-y-2">
            <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
              {stats.capitalPaidRatio > 0 && (
                <div
                  style={{ width: `${stats.capitalPaidRatio}%` }}
                  className="bg-emerald-500 h-full transition-all duration-500"
                  title={`Capital amortizado: ${formatPercentFriendly(stats.capitalPaidRatio)}`}
                />
              )}
              {stats.interestPaidRatio > 0 && (
                <div
                  style={{ width: `${stats.interestPaidRatio}%` }}
                  className="bg-rose-500 h-full transition-all duration-500"
                  title={`Juros pagos: ${formatPercentFriendly(stats.interestPaidRatio)}`}
                />
              )}
              {stats.trPaidRatio > 0 && (
                <div
                  style={{ width: `${stats.trPaidRatio}%` }}
                  className="bg-indigo-500 h-full transition-all duration-500"
                  title={`Correção TR: ${formatPercentFriendly(stats.trPaidRatio)}`}
                />
              )}
              {stats.lancesPaidRatio > 0 && (
                <div
                  style={{ width: `${stats.lancesPaidRatio}%` }}
                  className="bg-amber-500 h-full transition-all duration-500"
                  title={`Lances extras: ${formatPercentFriendly(stats.lancesPaidRatio)}`}
                />
              )}
            </div>

            <div className="flex flex-wrap gap-4 pt-1 text-[11px] font-semibold text-slate-600">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span>Capital Amortizado ({formatPercentFriendly(stats.capitalPaidRatio)})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <span>Juros Pagos ({formatPercentFriendly(stats.interestPaidRatio)})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <span>Correção TR ({formatPercentFriendly(stats.trPaidRatio)})</span>
              </div>
              {stats.totalLancesRealized > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span>Lances Extras ({formatPercentFriendly(stats.lancesPaidRatio)})</span>
                </div>
              )}
            </div>
          </div>

          {/* Grid de Itens Detalhados */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100">
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Capital Amortizado</span>
              <p className="text-xl font-black text-slate-900 font-mono mt-1">{formatCurrency(stats.amortizedPrincipal)}</p>
              <span className="text-xs text-emerald-600 font-semibold">{formatPercentFriendly(stats.capitalPaidRatio)} do pago</span>
            </div>

            <div className="p-4 rounded-xl bg-rose-50/50 border border-rose-100">
              <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Juros Contratuais</span>
              <p className="text-xl font-black text-slate-900 font-mono mt-1">{formatCurrency(stats.totalInterestRealized)}</p>
              <span className="text-xs text-rose-600 font-semibold">{formatPercentFriendly(stats.interestPaidRatio)} do pago</span>
            </div>

            <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-100">
              <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">Correção TR Realizada</span>
              <p className="text-xl font-black text-slate-900 font-mono mt-1">{formatCurrency(stats.totalTRRealized)}</p>
              <span className="text-xs text-indigo-600 font-semibold">{formatPercentFriendly(stats.trPaidRatio)} do pago</span>
            </div>
          </div>

          {/* Explicação Pedagógica */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-3 text-xs text-slate-600 leading-relaxed">
            <Info size={18} className="text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <p>
                <strong>Entendendo seu pagamento:</strong> De cada{' '}
                <strong className="text-slate-800">R$ 100,00 pagos</strong> até o momento,{' '}
                <strong className="text-emerald-700 font-bold">
                  {formatCurrency((stats.capitalPaidRatio / 100) * 100)}
                </strong>{' '}
                abateram diretamente o saldo principal da dívida e{' '}
                <strong className="text-rose-700 font-bold">
                  {formatCurrency((stats.interestPaidRatio / 100) * 100)}
                </strong>{' '}
                remuneraram os juros contratuais. Conforme você avança nas parcelas, a fatia de capital amortizado aumenta e os juros diminuem.
              </p>
            </div>
          </div>
        </div>

        {/* CARD DA TR CORRIGIDO & INFORMAÇÕES CONTRATUAIS */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Impacto da TR</h3>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                Oficial BCB
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-indigo-50/60 border border-indigo-100 space-y-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">TR Efetivamente Aplicada</span>
              <p className="text-3xl font-black text-slate-900 font-mono">{formatCurrency(stats.totalTRRealized)}</p>
              <p className="text-[11px] text-slate-500 leading-snug">
                {config.trMode === 'ANNUAL'
                  ? 'Contrato com correção anual no aniversário (a partir do mês 13). Nenhuma TR incidiu na parcela inicial.'
                  : 'Atualizada mensalmente conforme série SGS 7811 do Banco Central.'}
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
            <div className="flex justify-between items-center text-slate-600">
              <span>TR estimada na projeção (20 anos):</span>
              <span className="font-bold text-slate-900 font-mono">{formatCurrency(stats.projectedTotalTR)}</span>
            </div>
            <div className="flex justify-between items-center text-slate-600">
              <span>Regime contratual:</span>
              <span className="font-bold text-slate-900">{config.trMode === 'ANNUAL' ? 'Anual (Aniversário)' : 'Mensal'}</span>
            </div>
            <div className="flex justify-between items-center text-slate-600">
              <span>Taxa de juros contratual:</span>
              <span className="font-bold text-slate-900 font-mono">{safeNumber(config.annualInterestRate)}% a.a.</span>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 italic">
            * Valores futuros de TR são estimados e podem variar conforme a economia.
          </div>
        </div>
      </div>

      {/* 6. SUA JORNADA ATÉ A QUITAÇÃO — PROGRESSO DA QUITAÇÃO */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">Progresso da Quitação</h3>
              <div className="group relative inline-flex items-center">
                <HelpCircle size={14} className="text-slate-400 hover:text-slate-600 cursor-help" />
                <div className="invisible group-hover:visible absolute left-0 bottom-full mb-2 w-72 p-2.5 bg-slate-900 text-white text-[11px] font-medium rounded-lg shadow-xl z-30 leading-relaxed pointer-events-none">
                  O número de parcelas pagas e o percentual do capital quitado são diferentes porque parte de cada pagamento corresponde a juros e correções.
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Acompanhe seu progresso de amortização do capital financiado
            </p>
          </div>
          <div className="text-left sm:text-right">
            <span className="text-sm sm:text-base font-bold text-slate-700 block">
              {formatCurrency(stats.amortizedPrincipal)} de {formatCurrency(stats.financedAmount)} amortizados
            </span>
            <span className="text-xs font-bold text-emerald-600 font-mono">
              {formatPercentFriendly(stats.debtPaidPercent)} do capital
            </span>
          </div>
        </div>

        {/* Nota explicativa amigável */}
        <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed">
          <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
          <p>
            O número de parcelas pagas e o percentual do capital quitado são diferentes porque parte de cada pagamento corresponde a juros e correções.
          </p>
        </div>

        {/* Barra de Marcos */}
        <div className="relative pt-2 pb-2">
          <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(1, stats.debtPaidPercent))}%` }}
            />
          </div>

          {/* Marcadores de Etapas */}
          <div className="grid grid-cols-6 gap-2 mt-4 text-center">
            {[
              { label: 'Início', target: 0, amount: 0 },
              { label: '10%', target: 10, amount: stats.financedAmount * 0.1 },
              { label: '25%', target: 25, amount: stats.financedAmount * 0.25 },
              { label: '50%', target: 50, amount: stats.financedAmount * 0.5 },
              { label: '75%', target: 75, amount: stats.financedAmount * 0.75 },
              { label: 'Quitado', target: 100, amount: stats.financedAmount },
            ].map((m, idx) => {
              const reached = stats.debtPaidPercent >= m.target;
              const isNext = !reached && (idx === 0 || stats.debtPaidPercent < m.target);
              return (
                <div key={m.label} className="flex flex-col items-center">
                  <div
                    className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all border-2',
                      reached
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : isNext
                        ? 'bg-white border-emerald-500 text-emerald-700 shadow-sm animate-pulse'
                        : 'bg-white border-slate-200 text-slate-400'
                    )}
                  >
                    {reached ? <CheckCircle2 size={15} /> : `${m.target}%`}
                  </div>
                  <span className={cn('text-xs font-bold mt-2', reached ? 'text-slate-900' : 'text-slate-400')}>
                    {m.label}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                    {formatCurrency(m.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 7. RESUMO DA ÚLTIMA PARCELA & SIMULADOR DE ANTECIPAÇÃO */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* SEU ÚLTIMO PAGAMENTO */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Seu Último Pagamento</h3>
                <p className="text-xs text-slate-500">Histórico da última prestação confirmada</p>
              </div>
              <button
                type="button"
                onClick={onNavigateToTransactions}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1 cursor-pointer"
              >
                Ver todos os lançamentos <ChevronRight size={14} />
              </button>
            </div>

            {lastRealizedRow ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <span className="text-xs text-slate-500 font-semibold">Competência</span>
                    <h4 className="text-lg font-black text-slate-900">Parcela #{lastRealizedRow.installmentNumber}</h4>
                    <div className="flex flex-col text-xs text-slate-600 mt-1 space-y-0.5">
                      <span>
                        Vencimento:{' '}
                        <strong className="text-slate-800 font-semibold">
                          {format(
                            addMonths(
                              contractualStartDate,
                              lastRealizedRow.installmentNumber - 1
                            ),
                            'dd/MM/yyyy'
                          )}
                        </strong>
                      </span>
                      {lastRealizedPaymentTx && (
                        <span className="text-emerald-700 font-medium">
                          Pago em:{' '}
                          <strong className="font-semibold">
                            {format(
                              safeDate(parse(lastRealizedPaymentTx.date, 'yyyy-MM-dd', new Date())),
                              'dd/MM/yyyy'
                            )}
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500 font-semibold">Valor Pago</span>
                    <p className="text-xl font-black text-emerald-600 font-mono">
                      {formatCurrency(lastRealizedRow.paymentDone)}
                    </p>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      Confirmado
                    </span>
                  </div>
                </div>

                {/* Divisão da Parcela */}
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-100 text-slate-600">
                    <span>Capital Amortizado:</span>
                    <span className="font-bold text-emerald-600 font-mono">
                      {formatCurrency(lastRealizedRow.amortizationAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-100 text-slate-600">
                    <span>Juros Contratuais:</span>
                    <span className="font-bold text-rose-600 font-mono">
                      {formatCurrency(lastRealizedRow.interestAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-100 text-slate-600">
                    <span>Correção Monetária (TR):</span>
                    <span className="font-bold text-indigo-600 font-mono">
                      {formatCurrency(lastRealizedRow.trCorrection)}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 text-slate-900 font-bold bg-slate-50 px-3 rounded-lg mt-2">
                    <span>Saldo devedor após o pagamento:</span>
                    <span className="font-mono text-slate-900">{formatCurrency(lastRealizedRow.finalBalance)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 italic text-sm">
                Nenhum pagamento registrado ainda.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onNavigateToTransactions}
            className="w-full py-2.5 px-4 rounded-xl border border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-50 font-bold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            Acessar extrato completo de lançamentos
          </button>
        </div>

        {/* SIMULADOR DE ANTECIPAÇÃO (READ-ONLY) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Calculator size={18} className="text-indigo-600" />
                  <h3 className="text-base font-bold text-slate-900">Simule uma Antecipação</h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Simulação considerando redução do prazo e manutenção da prestação.
                </p>
              </div>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                Simulador
              </span>
            </div>

            <form onSubmit={handleSimulate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Quanto você gostaria de antecipar?
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                      R$
                    </span>
                    <input
                      type="text"
                      value={anticipationInput}
                      onChange={(e) => {
                        setAnticipationInput(e.target.value);
                        if (simError) setSimError(null);
                      }}
                      onBlur={handleBlurInput}
                      placeholder="5.000,00"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 font-mono font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
                  >
                    Simular
                  </button>
                </div>
                {simError && (
                  <p className="text-xs text-rose-600 font-medium mt-1.5 flex items-center gap-1">
                    {simError}
                  </p>
                )}
              </div>

              {simulationResults.newEstimatedBalance === 0 && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-bold">
                  ✓ Cenário de quitação integral estimada: o valor simulado zera completamente o saldo devedor.
                </div>
              )}

              {/* Resultados da Simulação */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Novo Saldo Estimado</span>
                  <p className="text-base font-black text-slate-900 font-mono mt-0.5">
                    {formatCurrency(simulationResults.newEstimatedBalance)}
                  </p>
                </div>

                <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Economia Estimada em Juros</span>
                  <p className="text-base font-black text-emerald-700 font-mono mt-0.5">
                    {formatCurrency(simulationResults.estimatedInterestSaved)}
                  </p>
                </div>

                <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl">
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Parcelas Reduzidas</span>
                  <p className="text-base font-black text-indigo-700 font-mono mt-0.5">
                    ~{simulationResults.reducedMonths} meses a menos
                  </p>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nova Previsão</span>
                  <p className="text-xs font-bold text-slate-900 mt-1">
                    {simPayoffFormatted}
                  </p>
                </div>
              </div>
            </form>
          </div>

          <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl text-[11px] text-amber-900 leading-relaxed space-y-1.5">
            <p className="font-semibold text-amber-950">
              Simulação considerando redução do prazo e manutenção da prestação.
            </p>
            <p>
              Para esta simulação, a TR futura foi considerada igual a 0,00% a.a. O resultado é estimativo e poderá mudar conforme a TR efetivamente aplicada ao contrato.
            </p>
            <p className="text-[10px] text-amber-800">
              Esta é uma simulação para planejamento. Os valores são estimados e podem variar conforme correções futuras e condições contratuais. Nenhum lançamento financeiro será realizado.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Tooltip Customizado para o Gráfico de Evolução do Saldo Devedor
 */
function CustomChartTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;

  const data: ChartPoint = payload[0].payload;
  const isRealized = Boolean(data.isRealized);

  return (
    <div className="bg-white p-4 rounded-xl shadow-xl border border-slate-200 text-xs space-y-2 min-w-[240px]">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <span className="font-bold text-slate-900">{data.label}</span>
        <span
          className={cn(
            'text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border',
            isRealized
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
          )}
        >
          {isRealized ? 'Realizado' : 'Valor Projetado'}
        </span>
      </div>

      <div className="space-y-1.5 font-medium">
        <div className="flex justify-between text-slate-600">
          <span>{isRealized ? 'Saldo após pagamento:' : 'Saldo projetado:'}</span>
          <strong className="text-slate-900 font-mono">
            {formatCurrency(isRealized ? safeNumber(data.saldoRealizado) : safeNumber(data.saldoProjetado))}
          </strong>
        </div>

        {isRealized ? (
          <>
            <div className="flex justify-between text-slate-600">
              <span>Valor pago:</span>
              <strong className="text-emerald-600 font-mono">{formatCurrency(safeNumber(data.valorPago))}</strong>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Capital amortizado:</span>
              <strong className="text-slate-700 font-mono">{formatCurrency(safeNumber(data.capitalAmortizado))}</strong>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Juros:</span>
              <strong className="text-rose-600 font-mono">{formatCurrency(safeNumber(data.juros))}</strong>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Correção TR:</span>
              <strong className="text-indigo-600 font-mono">{formatCurrency(safeNumber(data.tr))}</strong>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between text-slate-600">
              <span>Parcela prevista:</span>
              <strong className="text-slate-900 font-mono">{formatCurrency(safeNumber(data.valorPrevisto))}</strong>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Capital estimado:</span>
              <strong className="text-slate-700 font-mono">{formatCurrency(safeNumber(data.capitalEstimado))}</strong>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Juros estimados:</span>
              <strong className="text-slate-700 font-mono">{formatCurrency(safeNumber(data.jurosEstimados))}</strong>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>TR estimada:</span>
              <strong className="text-indigo-600 font-mono">{formatCurrency(safeNumber(data.trEstimada))}</strong>
            </div>
          </>
        )}

        <div className="pt-1.5 border-t border-slate-100 flex justify-between text-[11px] text-slate-400">
          <span>Competência:</span>
          <span>{data.dateFormatted}</span>
        </div>
      </div>
    </div>
  );
}
