import React from 'react';
import { 
  Building2, 
  Settings2, 
  Table as TableIcon, 
  History, 
  TrendingDown, 
  DollarSign, 
  Percent, 
  Plus, 
  Target,
  ArrowUpRight,
  Info,
  FileText,
  X,
  Eye,
  Paperclip,
  LogOut,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area 
} from 'recharts';
import { format, parse } from 'date-fns';
import { cn, formatCurrency, formatPercent, safeNumber, safeDate, round2, parseCurrencyBR, formatCurrencyInput } from './lib/utils';
import { financeService } from './services/financeService';
import { ContractConfig, Transaction, AmortizationRow } from './types';
import { useFirebase } from './components/FirebaseProvider';
import { Login } from './components/Login';
import { auth, db } from './lib/firebase';
import { signOut } from 'firebase/auth';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  collection, 
  query, 
  orderBy, 
  addDoc, 
  deleteDoc,
  getDoc,
  serverTimestamp
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  const isPermissionError = error?.code === 'permission-denied' || error?.message?.includes('Missing or insufficient permissions');
  
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  if (isPermissionError) {
    alert("Erro de permissão no Firestore. Verifique as regras de segurança.");
  }

  return new Error(JSON.stringify(errInfo));
}

const CONTRACT_ID = "apt_maringa_2026";

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

const FIXED_INSTALLMENT = 1965.63;

function getPaidAmountByInstallment(transactions: Transaction[], installmentNumber: number) {
  return (Array.isArray(transactions) ? transactions : [])
    .filter(t => t.type === "PAYMENT" && safeNumber(t.installmentNumber) === safeNumber(installmentNumber))
    .reduce((sum, t) => sum + safeNumber(t.amount), 0);
}

function isInstallmentPaid(transactions: Transaction[], installmentNumber: number) {
  return getPaidAmountByInstallment(transactions, installmentNumber) >= FIXED_INSTALLMENT - 0.01;
}

function getFirstUnpaidInstallment(transactions: Transaction[], termMonths: number = 240) {
  for (let i = 1; i <= termMonths; i++) {
    if (!isInstallmentPaid(transactions, i)) return i;
  }
  return 1;
}

function getCurrentBalance(schedule: AmortizationRow[], transactions: Transaction[], financedAmount: number) {
  if (!Array.isArray(schedule) || schedule.length === 0) return financedAmount;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return financedAmount;
  }

  const paidRows = schedule.filter(row => row.status === "PAGO" || row.status === "QUITADO");
  if (paidRows.length > 0) {
    return safeNumber(paidRows[paidRows.length - 1].finalBalance);
  }

  const firstOpen = schedule.find(row => row.status === "EM_ABERTO" || row.status === "ATRASO");
  if (firstOpen) {
    return safeNumber(firstOpen.previousBalance);
  }

  return financedAmount;
}

export default function App() {
  const { user, loading } = useFirebase();
  const [config, setConfig] = React.useState<ContractConfig>({
    financedAmount: 235000,
    fixedInstallment: 1965.63,
    annualInterestRate: 8,
    termMonths: 240,
    startDate: format(new Date(), 'yyyy-MM-dd'),
    finePercent: 2,
    trMode: 'ANNUAL',
  });

  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [amortization, setAmortization] = React.useState<AmortizationRow[]>([]);
  const [activeTab, setActiveTab] = React.useState<'dashboard' | 'amortization' | 'transactions'>('dashboard');
  const [viewMode, setViewMode] = React.useState<'PROJECTED' | 'REAL'>('REAL');
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [viewingAttachment, setViewingAttachment] = React.useState<Transaction | null>(null);

  const [error, setError] = React.useState<string | null>(null);
  const [isSyncing, setIsSyncing] = React.useState(true);

  // Firebase Sync: Config
  React.useEffect(() => {
    if (!user) return;

    const docRef = doc(db, 'contracts', CONTRACT_ID);
    
    // Check if contract exists, if not create it with default values
    const ensureContract = async () => {
      try {
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
          console.log("Creating new contract document:", CONTRACT_ID);
          await setDoc(docRef, {
            ...config,
            ownerId: user.uid,
            id: CONTRACT_ID
          });
        } else {
          console.log("Contract document already exists:", CONTRACT_ID);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `contracts/${CONTRACT_ID}`);
      }
    };
    ensureContract();

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        console.log("Contract synced from Firestore:", CONTRACT_ID, "Owner:", data.ownerId);
        setConfig(prev => ({
          ...prev,
          ...data,
          // Force fixed values as per requirement (calculo financeiro)
          financedAmount: 235000,
          fixedInstallment: 1965.63,
          annualInterestRate: 8,
          termMonths: 240,
          finePercent: 2,
        }));
      }
      setIsSyncing(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `contracts/${CONTRACT_ID}`);
      setError("Login realizado, mas houve erro ao carregar dados do contrato.");
      setIsSyncing(false);
    });

    return () => unsubscribe();
  }, [user]);

  // Firebase Sync: Transactions
  React.useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'contracts', CONTRACT_ID, 'transactions'),
      orderBy('createdAt', 'desc')
    );

    console.log("Starting transactions listener for:", CONTRACT_ID);
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      console.log(`Received transactions update: ${querySnapshot.size} records`);
      const txs: Transaction[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        // Convert Firestore Timestamps to ISO strings for compatibility
        if (data.createdAt && typeof data.createdAt.toDate === 'function') {
          data.createdAt = data.createdAt.toDate().toISOString();
        }
        txs.push({ id: doc.id, ...data } as any);
      });
      setTransactions(txs);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `contracts/${CONTRACT_ID}/transactions`);
    });

    return () => unsubscribe();
  }, [user]);

  // Global error listener for debug
  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error("Erro global capturado:", event.message, event.error);
    };
    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, []);

  // Initialize TR data and calculate initial amortization
  React.useEffect(() => {
    const init = async () => {
      try {
        setError(null);
        await financeService.loadTRData();
        const rows = financeService.calculateAmortization(
          config, 
          Array.isArray(transactions) ? transactions : [],
          viewMode
        );
        if (!Array.isArray(rows)) throw new Error('Cálculo inválido: resultado não é array');
        setAmortization(rows);
      } catch (err) {
        console.error("Erro no cálculo de amortização:", err);
        setError("Erro ao calcular amortização. Verifique os valores ou lançamentos.");
      }
    };
    init();
  }, [config, transactions, viewMode]);

  const stats = React.useMemo(() => {
    const list = Array.isArray(amortization) ? amortization : [];
    if (list.length === 0) return { 
      currentBalance: 0, 
      totalPaid: 0, 
      totalInterest: 0, 
      totalLances: 0, 
      totalTR: 0,
      amortizedPrincipal: 0,
      paidCount: 0,
      totalCount: 0,
      remainingMonths: 0,
      interestRatio: 0,
      debtPaidPercent: 0
    };
    
    const totalPaid = list.reduce((acc, row) => acc + safeNumber(row.paymentDone) + safeNumber(row.lanceApplied), 0);
    const totalInterest = list.reduce((acc, row) => acc + safeNumber(row.paymentDone > 0 || row.lanceApplied > 0 ? row.interestAmount : 0), 0);
    const totalLances = list.reduce((acc, row) => acc + safeNumber(row.lanceApplied), 0);
    const totalTR = list.reduce((acc, row) => acc + safeNumber(row.trCorrection), 0);
    const paidCount = list.filter(r => r.status === 'PAGO' || r.status === 'QUITADO').length;
    const totalCount = safeNumber(config.termMonths);
    const remainingMonths = Math.max(0, totalCount - paidCount);
    
    const currentBalance = getCurrentBalance(list, Array.isArray(transactions) ? transactions : [], safeNumber(config.financedAmount));
    const amortizedPrincipal = Math.max(0, round2(safeNumber(config.financedAmount) - currentBalance));
    
    const interestRatio = totalPaid > 0 ? (totalInterest / totalPaid) : 0;
    const debtPaidPercent = safeNumber(config.financedAmount) > 0 ? (amortizedPrincipal / safeNumber(config.financedAmount)) : 0;

    return {
      currentBalance,
      totalPaid,
      totalInterest,
      totalLances,
      totalTR,
      amortizedPrincipal,
      paidCount,
      totalCount,
      remainingMonths,
      interestRatio,
      debtPaidPercent
    };
  }, [amortization, config, transactions]);

  const chartData = React.useMemo(() => {
    const list = Array.isArray(amortization) ? amortization : [];
    
    // Projeção Ideal: Simulamos o contrato em modo PROJECTED (pagando tudo em dia)
    const listIdeal = financeService.calculateAmortization(config, transactions, 'PROJECTED');
    
    return list.map((row, idx) => ({
      name: safeNumber(row.installmentNumber),
      saldoAtual: safeNumber(row.finalBalance),
      saldoIdeal: listIdeal[idx] ? safeNumber(listIdeal[idx].finalBalance) : 0,
    }));
  }, [amortization, config, transactions]);

  const handleAddTransaction = async (newTx: Omit<Transaction, 'id'>, file?: File | null) => {
    if (!user) {
      console.error("Usuário não autenticado");
      return;
    }

    console.log("Confirmando lançamento", { newTx, file });
    console.log("Arquivo no submit:", file);
    console.log("Usuário atual", user.email, user.uid);
    console.log("Contrato", CONTRACT_ID);

    try {
      let receiptBase64 = null;
      let receiptMimeType = null;
      let receiptFileName = null;

      if (file) {
        console.log("Iniciando conversão do arquivo para base64");
        console.log("Arquivo:", file.name, file.size, file.type);

        if (file.size > 1024 * 1024) {
          alert("O arquivo é muito grande (máximo 1MB). Por favor, use um arquivo menor.");
          throw new Error("FILE_TOO_LARGE");
        }

        try {
          receiptBase64 = await fileToBase64(file);
          receiptMimeType = file.type;
          receiptFileName = file.name;
          console.log("Conversão concluída com sucesso");
        } catch (convErr) {
          console.error("Erro na conversão:", convErr);
          alert("Erro ao processar arquivo. O pagamento não foi salvo.");
          throw convErr;
        }
      }

      await addDoc(collection(db, 'contracts', CONTRACT_ID, 'transactions'), {
        date: newTx.date || format(new Date(), 'yyyy-MM-dd'),
        installmentNumber: safeNumber(newTx.installmentNumber),
        amount: safeNumber(newTx.amount),
        type: newTx.type || 'PAYMENT',
        method: newTx.method || 'PIX',
        receiptBase64,
        receiptMimeType,
        receiptFileName,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        createdByEmail: user.email || null,
        status: 'PAGO'
      });

      console.log("Lançamento salvo no Firestore com sucesso!");
      alert("Lançamento registrado com sucesso");
    } catch (err: any) {
      if (err.message === "FILE_TOO_LARGE") return;
      
      console.error("Erro ao salvar lançamento:", err);
      const errorMessage = err?.code ? `${err.code} - ${err.message}` : err.message;
      setError(errorMessage);

      if (err?.code === 'permission-denied') {
        alert("Erro de permissão no Firestore. Verifique as regras de segurança.");
      }
      handleFirestoreError(err, OperationType.CREATE, `contracts/${CONTRACT_ID}/transactions`);
    }
  };

  const handleUpdateConfig = async (newConfig: Partial<ContractConfig>) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'contracts', CONTRACT_ID), {
        ...config,
        ...newConfig,
        ownerId: user.uid
      }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `contracts/${CONTRACT_ID}`);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!user) return;
    if (!confirm("Deseja realmente excluir este lançamento?")) return;
    try {
      await deleteDoc(doc(db, 'contracts', CONTRACT_ID, 'transactions', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `contracts/${CONTRACT_ID}/transactions/${id}`);
    }
  };

  if (loading || (user && isSyncing)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
          <p className="text-slate-500 font-medium">Carregando seu painel...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-900 font-sans">
      {/* Sidebar - Configuração */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 320 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="bg-white border-r border-slate-200 overflow-hidden shrink-0 flex flex-col"
      >
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
            <Building2 size={22} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">FinanTech</h1>
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Simulador de Crédito</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex items-center gap-2 text-slate-500 mb-2">
            <Settings2 size={16} />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Parâmetros Fixos</h2>
          </div>

          <ReadOnlyDisplay 
            label="Valor Financiado" 
            value={formatCurrency(config.financedAmount)} 
            icon={<DollarSign size={16} />}
          />
          <ReadOnlyDisplay 
            label="Parcela Fixa" 
            value={formatCurrency(config.fixedInstallment)} 
            icon={<Target size={16} />}
          />
          <div className="grid grid-cols-2 gap-4">
            <ReadOnlyDisplay 
              label="Juros Anual" 
              value={formatPercent(config.annualInterestRate)} 
              icon={<Percent size={16} />}
            />
            <ReadOnlyDisplay 
              label="Multa" 
              value={formatPercent(config.finePercent)} 
            />
          </div>
          <ReadOnlyDisplay 
            label="Prazo Contratual" 
            value={`${config.termMonths} Meses`} 
          />

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase">Data de Início</label>
            <input 
              type="date" 
              value={config.startDate}
              onChange={e => handleUpdateConfig({ startDate: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase">Modo de TR</label>
            <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button 
                onClick={() => handleUpdateConfig({ trMode: 'MONTHLY' })}
                className={cn(
                  "flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all",
                  config.trMode === 'MONTHLY' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                TR MENSAL
              </button>
              <button 
                onClick={() => handleUpdateConfig({ trMode: 'ANNUAL' })}
                className={cn(
                  "flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all",
                  config.trMode === 'ANNUAL' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                TR ANUAL
              </button>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100">
            <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
              <div className="flex items-center gap-2 text-indigo-700 mb-2 font-semibold text-sm">
                <Info size={16} />
                Calculadora TR
              </div>
              <p className="text-xs text-indigo-600 leading-relaxed">
                As projeções utilizam dados reais da Taxa Referencial (SGS 7811) do Banco Central, atualizados mensalmente.
              </p>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header / Navigation */}
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-8 h-full">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 -ml-2 text-slate-400 hover:text-indigo-600 transition-colors"
            >
              <Settings2 size={20} />
            </button>
            
            <nav className="flex items-center gap-6 h-full">
              <TabButton 
                active={activeTab === 'dashboard'} 
                onClick={() => setActiveTab('dashboard')} 
                icon={<TrendingDown size={18} />}
                label="Visão Geral" 
              />
              <TabButton 
                active={activeTab === 'amortization'} 
                onClick={() => setActiveTab('amortization')} 
                icon={<TableIcon size={18} />}
                label="Tabela de Amortização" 
              />
              <TabButton 
                active={activeTab === 'transactions'} 
                onClick={() => setActiveTab('transactions')} 
                icon={<History size={18} />}
                label="Lançamentos" 
              />
            </nav>
          </div>

          <div className="flex items-center gap-4">
             <button 
              onClick={() => setActiveTab('transactions')}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-100"
            >
              <Plus size={18} />
              Novo Lançamento
             </button>
             <button 
              onClick={() => signOut(auth)}
              className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
              title="Sair"
            >
              <LogOut size={20} />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
          {error && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-rose-600 font-semibold shadow-sm">
              <Info size={18} />
              {error}
            </div>
          )}
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                {/* Stats Grid - Resumo Principal */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                  <StatCard 
                    label="Saldo Devedor" 
                    value={formatCurrency(stats.currentBalance)} 
                    sub="Valor atualizado para quitação"
                    icon={<DollarSign className="text-white" />}
                    color="indigo"
                    highlight
                  />
                  <StatCard 
                    label="Total já Pago" 
                    value={formatCurrency(stats.totalPaid)} 
                    sub="Soma de todas as parcelas"
                    icon={<ArrowUpRight className="text-emerald-600" />}
                    color="emerald"
                  />
                  <StatCard 
                    label="Parcelas Quitadas" 
                    value={`${stats.paidCount} / ${stats.totalCount}`} 
                    sub={`${Math.round((stats.paidCount / stats.totalCount) * 100)}% do prazo concluído`}
                    icon={<TrendingDown className="text-amber-600" />}
                    color="amber"
                    progress={stats.paidCount / stats.totalCount}
                  />
                  <StatCard 
                    label="Tempo Restante" 
                    value={`${stats.remainingMonths} meses`} 
                    sub="Previsão para encerramento"
                    icon={<History className="text-slate-600" />}
                    color="indigo"
                  />
                </div>

                {/* Composição Financeira */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                      <div className="flex items-center justify-between mb-8">
                        <div>
                          <h3 className="font-bold text-slate-800">Evolução do Financiamento</h3>
                          <p className="text-xs text-slate-400 font-medium">Projeção do saldo devedor até a quitação</p>
                        </div>
                        <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider">
                           <div className="flex items-center gap-1.5">
                             <div className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                             <span className="text-slate-600">Situação Atual</span>
                           </div>
                           <div className="flex items-center gap-1.5">
                             <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                             <span className="text-slate-400">Pagando todas as parcelas</span>
                           </div>
                        </div>
                      </div>
                      <div className="h-[320px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData}>
                            <defs>
                              <linearGradient id="colorSaldo" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                                <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis 
                              dataKey="name" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 10, fill: '#94a3b8' }} 
                              minTickGap={30}
                              label={{ value: 'Parcelas', position: 'insideBottom', offset: -10, fontSize: 10, fill: '#cbd5e1' }}
                            />
                            <YAxis 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 10, fill: '#94a3b8' }}
                              tickFormatter={(v) => `R$ ${v/1000}k`}
                              domain={[0, 'auto']}
                            />
                            <Tooltip 
                              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                              formatter={(value: number) => formatCurrency(value)}
                              labelFormatter={(label) => `Parcela #${label}`}
                            />
                            <Area type="monotone" dataKey="saldoAtual" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorSaldo)" />
                            <Area type="monotone" dataKey="saldoIdeal" stroke="#cbd5e1" strokeWidth={2} strokeDasharray="5 5" fill="none" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Insights Inteligentes */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                       <InsightCard 
                         icon={<Percent className="text-emerald-500" />}
                         title="Dívida Quitada"
                         value={formatPercent(stats.debtPaidPercent * 100)}
                         description="Do valor total financiado"
                       />
                       <InsightCard 
                         icon={<TrendingDown className="text-rose-500" />}
                         title="Custo de Juros"
                         value={formatPercent(stats.interestRatio * 100)}
                         description="Dos seus pagamentos totais"
                       />
                       <InsightCard 
                         icon={<Info className="text-indigo-500" />}
                         title="Impacto da TR"
                         value={formatCurrency(stats.totalTR)}
                         description="Acumulado no saldo devedor"
                       />
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col">
                    <h3 className="font-bold text-slate-800 mb-6">Composição Financeira</h3>
                    <div className="flex-1 space-y-6">
                      <CompositionItem 
                        label="Principal Amortizado" 
                        amount={stats.amortizedPrincipal} 
                        total={stats.totalPaid + stats.currentBalance} 
                        color="bg-emerald-500" 
                      />
                      <CompositionItem 
                        label="Juros Pagos" 
                        amount={stats.totalInterest} 
                        total={stats.totalPaid + stats.currentBalance} 
                        color="bg-rose-500" 
                      />
                      <CompositionItem 
                        label="Correção TR" 
                        amount={stats.totalTR} 
                        total={stats.totalPaid + stats.currentBalance} 
                        color="bg-indigo-500" 
                      />
                      <CompositionItem 
                        label="Lances Extra" 
                        amount={stats.totalLances} 
                        total={stats.totalPaid + stats.currentBalance} 
                        color="bg-amber-500" 
                      />
                    </div>
                    
                    <div className="mt-10 p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-4">
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Status de Quitação</p>
                       <div className="flex items-center justify-center">
                          <div className="relative w-24 h-24">
                             <svg className="w-full h-full" viewBox="0 0 36 36">
                                <path
                                  className="text-slate-200"
                                  strokeDasharray="100, 100"
                                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                />
                                <motion.path
                                  initial={{ strokeDasharray: "0, 100" }}
                                  animate={{ strokeDasharray: `${Math.round(stats.debtPaidPercent * 100)}, 100` }}
                                  className="text-emerald-500"
                                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                />
                             </svg>
                             <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <span className="text-xl font-black text-slate-900">{Math.round(stats.debtPaidPercent * 100)}%</span>
                             </div>
                          </div>
                       </div>
                       <p className="text-xs font-semibold text-slate-500 text-center leading-relaxed">
                          Você já quitou {formatCurrency(stats.amortizedPrincipal)} do capital original.
                       </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'amortization' && (
              <motion.div 
                key="amortization"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm"
              >
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Tabela de Amortização</h2>
                    <p className="text-sm text-slate-500">Fluxo completo do contrato e projeção de saldo</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200">
                      <button 
                        onClick={() => setViewMode('PROJECTED')}
                        className={cn(
                          "px-4 py-1.5 text-[10px] font-bold rounded-lg transition-all",
                          viewMode === 'PROJECTED' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        VISÃO PROJETADA
                      </button>
                      <button 
                        onClick={() => setViewMode('REAL')}
                        className={cn(
                          "px-4 py-1.5 text-[10px] font-bold rounded-lg transition-all",
                          viewMode === 'REAL' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        VISÃO REAL
                      </button>
                    </div>
                    <div className="px-3 py-1 bg-emerald-50 rounded-lg text-emerald-600 text-xs font-bold flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      Cálculo em Tempo Real
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto w-full">
                  <table className="min-w-[1400px] w-full text-left border-collapse">
                    <thead className="bg-slate-50/80 sticky top-0 z-20 backdrop-blur-sm border-b border-slate-200">
                      <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="px-3 py-4 font-bold sticky left-0 bg-slate-50 z-30 border-r border-slate-200 shadow-[2px_0_5px_rgba(0,0,0,0.05)] text-center w-12">Nº</th>
                        <th className="px-3 py-4 font-bold sticky left-12 bg-slate-50 z-30 border-r border-slate-200 shadow-[2px_0_5px_rgba(0,0,0,0.05)] w-24">Vencimento</th>
                        <th className="px-3 py-4 font-bold sticky left-[144px] bg-slate-50 z-30 border-r border-slate-200 shadow-[2px_0_5px_rgba(0,0,0,0.05)] w-32">Saldo Ant.</th>
                        <th className="px-3 py-4 font-bold w-24 text-center">TR Aplicada (%)</th>
                        <th className="px-3 py-4 font-bold w-32 shadow-sm">Correção TR</th>
                        <th className="px-3 py-4 font-bold w-32">Saldo Pós TR</th>
                        <th className="px-3 py-4 font-bold w-28 text-rose-500">Juros</th>
                        <th className="px-3 py-4 font-bold w-28 text-emerald-500">Amortização</th>
                        <th className="px-3 py-4 font-bold w-32">Parcela</th>
                        <th className="px-3 py-4 font-bold w-32">Pagamento</th>
                        <th className="px-3 py-4 font-bold w-28">Lance</th>
                        <th className="px-3 py-4 font-bold w-24">Multa</th>
                        <th className="px-3 py-4 font-bold sticky right-0 bg-slate-50 z-30 border-l border-slate-200 shadow-[-2px_0_5px_rgba(0,0,0,0.05)] text-right w-36">Saldo Final</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[12px]">
                      {(Array.isArray(amortization) ? amortization : []).map((row) => (
                        <tr key={row.installmentNumber} className={cn(
                          "hover:bg-slate-50/50 transition-colors",
                          row.status === 'ATRASO' && "bg-rose-50/20"
                        )}>
                          <td className="px-3 py-2.5 font-bold text-slate-400 sticky left-0 bg-white z-10 border-r border-slate-100 shadow-[2px_0_5px_rgba(0,0,0,0.02)] text-center">{row.installmentNumber}</td>
                          <td className="px-3 py-2.5 text-slate-600 font-medium sticky left-12 bg-white z-10 border-r border-slate-100 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                            <div className="flex flex-col leading-tight">
                              <span>{format(row.date, 'MM/yyyy')}</span>
                              <span className={cn(
                                "text-[9px] font-bold uppercase",
                                row.status === 'PAGO' ? "text-emerald-500" :
                                row.status === 'QUITADO' ? "text-indigo-500" :
                                row.status === 'ATRASO' ? "text-rose-500" : "text-slate-300"
                              )}>
                                {row.status}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 sticky left-[144px] bg-white z-10 border-r border-slate-100 shadow-[2px_0_5px_rgba(0,0,0,0.02)] font-mono">{formatCurrency(row.previousBalance)}</td>
                          <td className="px-3 py-2.5 text-indigo-600 font-bold bg-indigo-50/10 text-center">
                            {row.monthTR !== null ? formatPercent(row.monthTR * 100) : '-'}
                          </td>
                          <td className="px-3 py-2.5 text-indigo-500">{row.trCorrection > 0 ? formatCurrency(row.trCorrection) : '-'}</td>
                          <td className="px-3 py-2.5 text-slate-500 font-mono italic">{formatCurrency(row.balanceAfterTR)}</td>
                          <td className="px-3 py-2.5 text-rose-600 font-medium">{formatCurrency(row.interestAmount)}</td>
                          <td className="px-3 py-2.5 text-emerald-600 font-medium">{formatCurrency(row.amortizationAmount)}</td>
                          <td className="px-3 py-2.5 text-slate-700 font-bold">{formatCurrency(row.contractedInstallment)}</td>
                          <td className="px-3 py-2.5 text-emerald-600">{formatCurrency(row.paymentDone)}</td>
                          <td className="px-3 py-2.5 bg-amber-50/30 font-bold text-amber-700">{row.lanceApplied > 0 ? formatCurrency(row.lanceApplied) : '-'}</td>
                          <td className="px-3 py-2.5 text-rose-500 font-bold">{row.penalty > 0 ? formatCurrency(row.penalty) : '-'}</td>
                          <td className="px-3 py-2.5 sticky right-0 bg-white z-10 border-l border-slate-100 shadow-[-2px_0_5px_rgba(0,0,0,0.02)] text-right font-bold text-slate-900 font-mono bg-slate-50/30">
                            {formatCurrency(row.finalBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {activeTab === 'transactions' && (
              <motion.div 
                key="transactions"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="grid grid-cols-1 lg:grid-cols-3 gap-8"
              >
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h3 className="font-bold text-slate-800 mb-6">Registrar Pagamento / Lance</h3>
                    <TransactionForm 
                      onAdd={handleAddTransaction} 
                      maxInstallment={config.termMonths}
                      installmentAmount={config.fixedInstallment}
                      transactions={transactions}
                    />
                  </div>
                </div>

                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                   <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                     <h3 className="font-bold text-slate-800">Histórico de Movimentações</h3>
                     <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{transactions.length} LANÇAMENTOS</span>
                   </div>
                   <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="px-6 py-4 font-bold text-slate-600">Data</th>
                              <th className="px-6 py-4 font-bold text-slate-600">Parcela</th>
                              <th className="px-6 py-4 font-bold text-slate-600">Tipo</th>
                              <th className="px-6 py-4 font-bold text-slate-600">Valor</th>
                              <th className="px-6 py-4 font-bold text-slate-600">Método</th>
                              <th className="px-6 py-4 font-bold text-slate-600 text-center">Doc</th>
                              <th className="px-6 py-4 font-bold text-slate-600 text-right pr-6">Ação</th>
                            </tr>
                          </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(!Array.isArray(transactions) || transactions.length === 0) ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">Nenhum lançamento registrado ainda.</td>
                          </tr>
                        ) : (
                          [...transactions].sort((a, b) => {
                            const dateA = new Date(a.createdAt || a.date).getTime();
                            const dateB = new Date(b.createdAt || b.date).getTime();
                            return dateB - dateA;
                          }).map(tx => (
                            <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4 font-medium">{format(safeDate(parse(tx.date, 'yyyy-MM-dd', new Date())), 'dd/MM/yyyy')}</td>
                              <td className="px-6 py-4 text-slate-500">#{tx.installmentNumber}</td>
                              <td className="px-6 py-4">
                                <span className={cn(
                                  "text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border",
                                  tx.type === 'LANCE' ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"
                                )}>
                                  {tx.type}
                                </span>
                              </td>
                              <td className="px-6 py-4 font-bold text-slate-900">{formatCurrency(tx.amount)}</td>
                              <td className="px-6 py-4 text-slate-500 uppercase text-[10px] font-bold tracking-widest">{tx.method}</td>
                              <td className="px-6 py-4 text-center">
                                {(tx.receiptUrl || tx.receiptBase64) ? (
                                  <button 
                                    onClick={() => setViewingAttachment(tx)}
                                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors tooltip flex items-center justify-center mx-auto"
                                    title="Ver comprovante"
                                  >
                                    <span className="text-xs font-bold underline">Ver</span>
                                  </button>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right pr-6">
                                <button 
                                  onClick={() => handleDeleteTransaction(tx.id)}
                                  className="text-rose-500 hover:text-rose-700 p-2 rounded-lg transition-colors"
                                >
                                  Excluir
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                   </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
      
      <AnimatePresence>
        {viewingAttachment && (
          <AttachmentViewer 
            attachment={viewingAttachment} 
            onClose={() => setViewingAttachment(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function AttachmentViewer({ attachment, onClose }: { attachment: Transaction; onClose: () => void }) {
  const isPDF = attachment.receiptMimeType === 'application/pdf' || 
                attachment.receiptFileName?.toLowerCase().endsWith('.pdf') ||
                attachment.receiptUrl?.toLowerCase().includes('.pdf');

  const contentUrl = attachment.receiptBase64 || attachment.receiptUrl || '';

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
              <FileText size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Comprovante de Lançamento</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{attachment.receiptFileName || 'Arquivo'}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-all"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="flex-1 bg-slate-50 p-4 md:p-8 overflow-auto flex items-center justify-center">
          {isPDF ? (
            <iframe 
              src={contentUrl} 
              className="w-full h-[70vh] rounded-lg border border-slate-200"
              title="Comprovante PDF"
            />
          ) : (
            <img 
              src={contentUrl} 
              alt="Comprovante" 
              className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-lg border border-slate-200"
            />
          )}
        </div>
        
        <div className="p-4 bg-white border-t border-slate-100 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-6 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
          >
            Fechar
          </button>
          {(attachment.receiptUrl) && (
            <a 
              href={attachment.receiptUrl} 
              target="_blank"
              rel="noopener noreferrer"
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors"
            >
              Abrir original
            </a>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// Sub-components

function ReadOnlyDisplay({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100 shadow-inner">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</label>
      <div className="flex items-center gap-2">
        {icon && <div className="text-indigo-400">{icon}</div>}
        <span className="text-sm font-bold text-slate-700">{value}</span>
      </div>
    </div>
  );
}

function ConfigInput({ label, value, onChange, icon, prefix, suffix, isCurrency }: { 
  label: string; 
  value: number; 
  onChange: (v: number) => void; 
  icon?: React.ReactNode;
  prefix?: string;
  suffix?: string;
  isCurrency?: boolean;
}) {
  const displayValue = isCurrency ? formatCurrencyInput(value) : value;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isCurrency) {
      onChange(parseCurrencyBR(e.target.value));
    } else {
      onChange(safeNumber(e.target.value));
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-tight">{label}</label>
      <div className="relative group">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-500 transition-colors">
            {icon}
          </div>
        )}
        <input 
          type={isCurrency ? "text" : "number"} 
          value={displayValue}
          onChange={handleChange}
          className={cn(
            "w-full bg-slate-50 border border-slate-200 rounded-lg py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-semibold",
            icon ? "pl-10 pr-4" : "px-4"
          )}
        />
        {prefix && <span className="absolute right-10 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-300 pointer-events-none">{prefix}</span>}
        {suffix && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-300 pointer-events-none">{suffix}</span>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon, color, highlight, progress }: { 
  label: string; 
  value: string; 
  sub: string; 
  icon: React.ReactNode;
  color: 'rose' | 'emerald' | 'indigo' | 'amber';
  highlight?: boolean;
  progress?: number;
}) {
  const colors = {
    rose: 'bg-rose-50 text-rose-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    amber: 'bg-amber-50 text-amber-600'
  };

  return (
    <div className={cn(
      "p-6 rounded-2xl border transition-all duration-300 shadow-sm grow-0 flex flex-col justify-between",
      highlight ? "bg-indigo-600 border-indigo-500 hover:shadow-indigo-200" : "bg-white border-slate-200 hover:shadow-md"
    )}>
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", highlight ? "bg-white/10 text-white" : colors[color])}>
            {React.cloneElement(icon as React.ReactElement, { className: highlight ? 'text-white' : (icon as React.ReactElement).props.className })}
          </div>
          {!highlight && <span className="text-[10px] font-bold text-slate-400 border border-slate-100 px-2 py-0.5 rounded-full">ATIVO</span>}
        </div>
        <p className={cn("text-xs font-bold uppercase tracking-wider mb-1", highlight ? "text-indigo-100" : "text-slate-400")}>{label}</p>
        <h4 className={cn("text-2xl font-black mb-1 tracking-tight", highlight ? "text-white" : "text-slate-900")}>{value}</h4>
      </div>
      
      <div className="mt-4">
        {progress !== undefined && (
           <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mb-2">
             <motion.div 
               initial={{ width: 0 }}
               animate={{ width: `${progress * 100}%` }}
               className="h-full bg-amber-500"
             />
           </div>
        )}
        <p className={cn("text-[10px] font-medium leading-relaxed", highlight ? "text-indigo-200" : "text-slate-400")}>{sub}</p>
      </div>
    </div>
  );
}

function InsightCard({ icon, title, value, description }: { icon: React.ReactNode; title: string; value: string; description: string }) {
  return (
    <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col gap-1">
       <div className="flex items-center gap-2 mb-2">
         {icon}
         <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{title}</span>
       </div>
       <p className="text-lg font-black text-slate-900">{value}</p>
       <p className="text-[9px] font-bold text-slate-400 leading-tight uppercase">{description}</p>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 h-full px-2 border-b-2 transition-all relative font-semibold text-sm",
        active ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"
      )}
    >
      {icon}
      {label}
      {active && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />}
    </button>
  );
}

function CompositionItem({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const percent = Math.round((amount / (total || 1)) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-tight">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          className={cn("h-full", color)}
        />
      </div>
      <p className="text-[10px] font-bold text-slate-400 text-right">{formatCurrency(amount)}</p>
    </div>
  );
}

function TransactionForm({ onAdd, maxInstallment, installmentAmount, transactions }: { 
  onAdd: (tx: Omit<Transaction, 'id'>, file?: File | null) => void, 
  maxInstallment: number,
  installmentAmount: number,
  transactions: Transaction[]
}) {
  const [formData, setFormData] = React.useState({
    type: 'PAYMENT' as 'PAYMENT' | 'LANCE',
    amount: installmentAmount,
    installmentNumber: getFirstUnpaidInstallment(transactions, maxInstallment),
    method: 'PIX',
    date: format(new Date(), 'yyyy-MM-dd'),
  });

  const [receiptFile, setReceiptFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    console.log("Arquivo selecionado:", file);
    setReceiptFile(file);
  };

  // Automatically load the first unpaid installment when opening or when transactions change
  React.useEffect(() => {
    setFormData(prev => ({ 
      ...prev, 
      installmentNumber: getFirstUnpaidInstallment(transactions, maxInstallment)
    }));
  }, [transactions, maxInstallment]);

  // Keep amount synced with installment amount when type is PAYMENT
  React.useEffect(() => {
    if (formData.type === 'PAYMENT') {
      setFormData(prev => ({ ...prev, amount: safeNumber(installmentAmount) }));
    }
  }, [installmentAmount, formData.type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Arquivo no submit:", receiptFile);
    setLoading(true);
    try {
      // Validate inputs before adding
      const amount = safeNumber(formData.amount);
      const instNum = safeNumber(formData.installmentNumber);
      
      if (amount <= 0) {
        alert("O valor deve ser maior que zero.");
        setLoading(false);
        return;
      }

      // Block duplicate payment
      if (formData.type === 'PAYMENT' && isInstallmentPaid(transactions, instNum)) {
        alert(`Esta parcela já está paga. O próximo pagamento pendente é a parcela ${getFirstUnpaidInstallment(transactions, maxInstallment)}.`);
        setLoading(false);
        return;
      }

      await onAdd({
        type: formData.type || 'PAYMENT',
        amount: amount,
        installmentNumber: instNum || 1,
        date: formData.date || format(new Date(), 'yyyy-MM-dd'),
        method: formData.method || 'PIX',
        status: 'PAGO',
      }, receiptFile);

      // Reset
      setReceiptFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      
      setFormData(prev => ({ 
        ...prev, 
        amount: formData.type === 'LANCE' ? 0 : installmentAmount
      }));
    } catch (err) {
      console.error("Erro completo ao registrar lançamento:", err);
      alert("Erro ao registrar lançamento. Por favor, verifique os dados.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex p-1 bg-slate-100 rounded-xl">
        <button 
          type="button"
          onClick={() => setFormData(prev => ({ ...prev, type: 'PAYMENT', amount: installmentAmount }))}
          className={cn(
            "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
            formData.type === 'PAYMENT' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
          )}
        >
          PAGAMENTO
        </button>
        <button 
          type="button"
          onClick={() => setFormData(prev => ({ ...prev, type: 'LANCE', amount: 1000 }))}
          className={cn(
            "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
            formData.type === 'LANCE' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
          )}
        >
          LANCE EXTRA
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ConfigInput 
          label="Parcela Ref." 
          value={formData.installmentNumber} 
          onChange={v => setFormData(prev => ({ ...prev, installmentNumber: v }))} 
        />
        <ConfigInput 
          label="Valor" 
          value={formData.amount} 
          onChange={v => setFormData(prev => ({ ...prev, amount: v }))} 
          isCurrency
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-500 uppercase">Data Pagamento</label>
        <input 
          type="date" 
          value={formData.date}
          onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-500 uppercase">Método</label>
        <select 
          value={formData.method}
          onChange={e => setFormData(prev => ({ ...prev, method: e.target.value }))}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-semibold"
        >
          <option value="PIX">PIX</option>
          <option value="BOLETO">BOLETO</option>
          <option value="TRANSFERÊNCIA">TRANSFERÊNCIA</option>
          <option value="OUTROS">OUTROS</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-2">
          <Paperclip size={14} />
          Comprovante (opcional)
        </label>
        <div className="relative group">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*,.pdf"
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-[10px] file:font-black file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100"
          />
          {receiptFile && (
            <button 
              type="button"
              onClick={() => {
                setReceiptFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-rose-500 hover:text-rose-700"
            >
              <X size={16} />
            </button>
          )}
        </div>
        {receiptFile && (
          <p className="text-[10px] font-bold text-emerald-600 truncate px-1">
            ✓ {receiptFile.name} selecionado
          </p>
        )}
      </div>

      <button 
        type="submit"
        disabled={loading}
        className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? 'Processando...' : 'Confirmar Lançamento'}
      </button>
    </form>
  );
}
