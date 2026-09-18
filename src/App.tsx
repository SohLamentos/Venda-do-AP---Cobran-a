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
  Loader2,
  Lock,
  CheckCircle2,
  AlertCircle,
  Save,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle
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
import { format, parse, addMonths } from 'date-fns';
import { cn, formatCurrency, formatPercent, safeNumber, safeDate, round2, parseCurrencyBR, formatCurrencyInput } from './lib/utils';
import { financeService } from './services/financeService';
import { apiService } from './services/apiService';
import { ContractConfig, Transaction, AmortizationRow } from './types';
import { useFirebase } from './components/FirebaseProvider';
import { Login } from './components/Login';
import { AdminBootstrap } from './components/AdminBootstrap';
import { AdminPanel } from './components/AdminPanel';
import { SellerPanel } from './components/SellerPanel';
import { BuyerJourney } from './components/BuyerJourney';
import { AdminContractOverrideModal } from './components/AdminContractOverrideModal';


const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

function getPaidAmountByInstallment(transactions: Transaction[], installmentNumber: number) {
  return (Array.isArray(transactions) ? transactions : [])
    .filter(t => t.type === "PAYMENT" && safeNumber(t.installmentNumber) === safeNumber(installmentNumber))
    .reduce((sum, t) => sum + safeNumber(t.amount), 0);
}

function isInstallmentPaid(transactions: Transaction[], installmentNumber: number, fixedInstallment: number) {
  if (fixedInstallment <= 0) return false;
  return getPaidAmountByInstallment(transactions, installmentNumber) >= fixedInstallment - 0.01;
}

function getFirstUnpaidInstallment(transactions: Transaction[], termMonths: number, fixedInstallment: number) {
  if (termMonths <= 0) return 1;
  for (let i = 1; i <= termMonths; i++) {
    if (!isInstallmentPaid(transactions, i, fixedInstallment)) return i;
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
  const { user, loading, logout } = useFirebase();
  const [contractsList, setContractsList] = React.useState<{ id: string; name: string }[]>([]);
  const [activeContractId, setActiveContractId] = React.useState<string>(() => {
    return localStorage.getItem('active_contract_id') || '';
  });

  const [config, setConfig] = React.useState<ContractConfig>({
    name: 'Contrato de Imóvel',
    propertyDescription: '',
    financedAmount: 0,
    fixedInstallment: 0,
    annualInterestRate: 0,
    termMonths: 0,
    startDate: '2026-09-10',
    finePercent: 0,
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
  const [adminViewingBuyerPortal, setAdminViewingBuyerPortal] = React.useState(false);

  // Etapa 4A: Estados do Ciclo de Vida do Contrato (Rascunho & Ativação)
  const [isActivationModalOpen, setIsActivationModalOpen] = React.useState(false);
  const [isAdminOverrideModalOpen, setIsAdminOverrideModalOpen] = React.useState(false);
  const [activationConfirmedCheck, setActivationConfirmedCheck] = React.useState(false);
  const [isSavingDraft, setIsSavingDraft] = React.useState(false);
  const [isActivating, setIsActivating] = React.useState(false);
  const [actionFeedback, setActionFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Client-side routing for /admin/bootstrap
  const [currentPath, setCurrentPath] = React.useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname;
    }
    return '/';
  });

  React.useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  // Check Cloudflare Worker API health on mount
  React.useEffect(() => {
    apiService.checkHealth().then(res => {
      console.log("[Cloudflare Worker API]", res);
    }).catch(err => {
      console.warn("[Cloudflare Worker API] Notice:", err.message);
    });
  }, []);

  // D1 Sync: Load contracts list from Cloudflare D1 (Fonte de Verdade)
  const loadContracts = React.useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiService.getContracts();
      if (res.ok && Array.isArray(res.contracts)) {
        const list = res.contracts.map((c) => ({
          id: c.id,
          name: c.name || c.propertyDescription || `Contrato ${c.id.slice(0, 8)}`,
        }));
        setContractsList(list);

        if (list.length > 0) {
          setActiveContractId((prev) => {
            const exists = list.some((c) => c.id === prev);
            const chosen = exists ? prev : list[0].id;
            localStorage.setItem('active_contract_id', chosen);
            return chosen;
          });
        } else if (user.role === 'ADMIN' || user.role === 'SELLER') {
          // Se não existir nenhum contrato no D1, cria contrato inicial em DRAFT
          const newId = crypto.randomUUID();
          const initialContract: Partial<ContractConfig> = {
            id: newId,
            name: 'Contrato Principal',
            propertyDescription: '',
            financedAmount: 0,
            fixedInstallment: 0,
            annualInterestRate: 0,
            termMonths: 0,
            startDate: format(new Date(), 'yyyy-MM-dd'),
            finePercent: 0,
            trMode: 'ANNUAL',
            status: 'DRAFT',
          };
          const createRes = await apiService.createContract(initialContract);
          if (createRes.ok && createRes.contract) {
            setContractsList([{ id: createRes.contract.id, name: createRes.contract.name }]);
            setActiveContractId(createRes.contract.id);
            localStorage.setItem('active_contract_id', createRes.contract.id);
            setConfig(createRes.contract);
          }
        }
      } else {
        console.warn("Retorno de contratos do D1 não esperado:", res);
      }
    } catch (err) {
      console.error("Erro ao carregar contratos do D1:", err);
      setError("Falha ao comunicar com banco de dados D1.");
    } finally {
      setIsSyncing(false);
    }
  }, [user]);

  React.useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  // D1 Sync: Carregar dados do contrato ativo e lançamentos do D1 (Fonte de Verdade)
  const loadActiveContractData = React.useCallback(async (contractId: string) => {
    if (!user || !contractId) {
      setIsSyncing(false);
      return;
    }

    try {
      // 1. Carrega dados estruturais e status do D1
      const contractRes = await apiService.getContract(contractId);
      if (contractRes.ok && contractRes.contract) {
        const c = contractRes.contract;
        const sDate = c.startDate || '2026-09-10';
        const parsedStartDate = safeDate(parse(sDate, 'yyyy-MM-dd', new Date()));
        const contractDueDay = c.dueDay && c.dueDay >= 1 && c.dueDay <= 31 ? c.dueDay : parsedStartDate.getDate();
        setConfig({
          id: c.id,
          name: c.name || 'Contrato Principal',
          propertyDescription: c.propertyDescription || '',
          financedAmount: safeNumber(c.financedAmount),
          fixedInstallment: safeNumber(c.fixedInstallment),
          annualInterestRate: safeNumber(c.annualInterestRate),
          termMonths: safeNumber(c.termMonths),
          startDate: sDate,
          dueDay: contractDueDay,
          finePercent: safeNumber(c.finePercent),
          trMode: c.trMode || 'ANNUAL',
          status: c.status || 'DRAFT',
          activatedAt: c.activatedAt || null,
          activatedBy: c.activatedBy || null,
          ownerId: c.ownerId,
        });
        // Cache não autoritativo no localStorage
        localStorage.setItem(`venda_ap_contract_${contractId}`, JSON.stringify(c));
      }

      // 2. Carrega lançamentos do D1
      const txRes = await apiService.getTransactions(contractId);
      if (txRes.ok && Array.isArray(txRes.transactions)) {
        setTransactions(txRes.transactions);
      }
    } catch (err) {
      console.error("Erro ao carregar dados do contrato do D1:", err);
      setError("Falha ao sincronizar dados do contrato.");
    } finally {
      setIsSyncing(false);
    }
  }, [user]);

  React.useEffect(() => {
    if (activeContractId) {
      loadActiveContractData(activeContractId);
    }
  }, [activeContractId, loadActiveContractData]);

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

    // Regra J: Novo Lançamento permitido somente com contrato ACTIVE
    if (config.status !== 'ACTIVE') {
      setActionFeedback({
        type: 'error',
        message: 'Lançamentos financeiros só são permitidos após a ativação do contrato.',
      });
      alert("Atenção: O contrato ainda está em Rascunho (DRAFT). Salve e ative o contrato antes de registrar lançamentos.");
      return;
    }

    try {
      let receiptBase64: string | null = null;
      let receiptMimeType: string | null = null;
      let receiptFileName: string | null = null;

      if (file) {
        if (file.size > 1024 * 1024) {
          alert("O arquivo é muito grande (máximo 1MB). Por favor, use um arquivo menor.");
          throw new Error("FILE_TOO_LARGE");
        }

        try {
          receiptBase64 = await fileToBase64(file);
          receiptMimeType = file.type;
          receiptFileName = file.name;
        } catch (convErr) {
          console.error("Erro na conversão:", convErr);
          alert("Erro ao processar arquivo. O pagamento não foi salvo.");
          throw convErr;
        }
      }

      // Persistência autoritativa real no Cloudflare D1
      const res = await apiService.createTransaction({
        contractId: activeContractId,
        date: newTx.date || format(new Date(), 'yyyy-MM-dd'),
        installmentNumber: safeNumber(newTx.installmentNumber),
        amount: safeNumber(newTx.amount),
        type: newTx.type || 'PAYMENT',
        method: newTx.method || 'PIX',
        observation: newTx.observation || '',
        status: 'PAGO',
        receiptBase64: receiptBase64 || undefined,
        receiptFileName: receiptFileName || undefined,
        receiptMimeType: receiptMimeType || undefined,
      });

      if (!res.ok) {
        const msg = res.message || 'Falha ao persistir lançamento no D1.';
        setActionFeedback({ type: 'error', message: msg });
        alert(msg);
        return;
      }

      // Recarrega do D1 para recalcular a amortização e dashboard
      await loadActiveContractData(activeContractId);

      setActionFeedback({
        type: 'success',
        message: 'Lançamento persistido no D1 com sucesso!',
      });
      alert("Lançamento registrado com sucesso no D1!");
    } catch (err: any) {
      if (err.message === "FILE_TOO_LARGE") return;
      console.error("Erro ao salvar lançamento no D1:", err);
      const errorMessage = err?.message || String(err);
      setError(errorMessage);
      alert("Erro ao persistir lançamento no D1: " + errorMessage);
    }
  };

  const handleUpdateConfig = async (newConfig: Partial<ContractConfig>) => {
    if (!user || !activeContractId) return;

    // Se o contrato já estiver ACTIVE, bloqueia qualquer tentativa de alteração dos parâmetros estruturais!
    if (config.status === 'ACTIVE') {
      setActionFeedback({
        type: 'error',
        message: 'Contrato ativo. Parâmetros contratuais estão bloqueados e não podem ser alterados.',
      });
      return;
    }

    const updated: ContractConfig = {
      ...config,
      ...newConfig,
      updatedAt: new Date().toISOString(),
    };
    setConfig(updated);

    // Salva rascunho local de forma síncrona/imediata como cache de UX
    try {
      localStorage.setItem(`venda_ap_contract_${activeContractId}`, JSON.stringify(updated));
    } catch (_e) {}

    // Sincroniza diretamente com o Cloudflare D1 (Fonte de Verdade)
    try {
      const res = await apiService.updateContract(activeContractId, updated);
      if (!res.ok) {
        console.warn("D1 Update notice:", res.message);
      }
    } catch (err) {
      console.error("Erro ao atualizar contrato no D1:", err);
    }
  };

  const handleSaveDraft = async () => {
    if (!user || !activeContractId) return;
    if (config.status === 'ACTIVE') {
      setActionFeedback({
        type: 'error',
        message: 'Contrato já ativado. Parâmetros contratuais estão bloqueados.',
      });
      return;
    }

    setIsSavingDraft(true);
    try {
      const draftData: ContractConfig = {
        ...config,
        status: 'DRAFT',
        updatedAt: new Date().toISOString(),
      };

      // Persistência real autoritativa no D1
      const res = await apiService.updateContract(activeContractId, draftData);
      if (res.ok && res.contract) {
        setConfig(res.contract);
        localStorage.setItem(`venda_ap_contract_${activeContractId}`, JSON.stringify(res.contract));
      } else {
        localStorage.setItem(`venda_ap_contract_${activeContractId}`, JSON.stringify(draftData));
      }

      setActionFeedback({
        type: 'success',
        message: 'Rascunho do contrato salvo com sucesso no banco de dados D1!',
      });
    } catch (err) {
      console.error("Erro ao salvar rascunho no D1:", err);
      setActionFeedback({
        type: 'error',
        message: 'Falha ao salvar rascunho no D1. Verifique a conexão.',
      });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleOpenActivationModal = () => {
    if (config.status === 'ACTIVE') {
      setActionFeedback({
        type: 'error',
        message: 'Este contrato já se encontra ativo e com parâmetros bloqueados.',
      });
      return;
    }

    const financed = safeNumber(config.financedAmount);
    const installment = safeNumber(config.fixedInstallment);
    const term = safeNumber(config.termMonths);
    const interest = safeNumber(config.annualInterestRate);
    const fine = safeNumber(config.finePercent);
    const start = config.startDate;
    const nameVal = config.name;

    if (!nameVal || !nameVal.trim()) {
      setActionFeedback({ type: 'error', message: 'O nome ou identificação do contrato é obrigatório.' });
      return;
    }
    if (financed <= 0) {
      setActionFeedback({ type: 'error', message: 'O valor financiado deve ser maior que zero (R$ > 0).' });
      return;
    }
    if (installment <= 0) {
      setActionFeedback({ type: 'error', message: 'O valor da parcela base deve ser maior que zero (R$ > 0).' });
      return;
    }
    if (term <= 0 || !Number.isInteger(term)) {
      setActionFeedback({ type: 'error', message: 'O prazo contratual deve ser de no mínimo 1 mês inteiro.' });
      return;
    }
    if (!start || !start.trim()) {
      setActionFeedback({ type: 'error', message: 'A data inicial do contrato é obrigatória.' });
      return;
    }
    if (interest < 0) {
      setActionFeedback({ type: 'error', message: 'A taxa de juros anual não pode ser negativa.' });
      return;
    }
    if (fine < 0) {
      setActionFeedback({ type: 'error', message: 'O percentual de multa não pode ser negativo.' });
      return;
    }

    setActivationConfirmedCheck(false);
    setIsActivationModalOpen(true);
  };

  const handleConfirmActivation = async () => {
    if (!activationConfirmedCheck) return;
    if (!user || !activeContractId) return;

    setIsActivating(true);
    try {
      // 1. Executa ativação atômica real no Cloudflare D1
      const res = await apiService.activateContract(activeContractId);
      if (!res.ok || !res.contract) {
        throw new Error(res.message || 'Falha na ativação do contrato no D1.');
      }

      const activatedContract = res.contract;

      // 2. Atualiza estado em tela com os dados retornados pelo D1
      setConfig(activatedContract);

      // 3. Atualiza cache local não autoritativo
      localStorage.setItem(`venda_ap_contract_${activeContractId}`, JSON.stringify(activatedContract));

      setIsActivationModalOpen(false);
      setActionFeedback({
        type: 'success',
        message: 'Contrato ativado com sucesso no D1! Parâmetros contratuais bloqueados para edição.',
      });
    } catch (err: any) {
      console.error("Erro ao ativar contrato no D1:", err);
      setActionFeedback({
        type: 'error',
        message: err.message || 'Erro ao ativar o contrato no D1. Tente novamente.',
      });
    } finally {
      setIsActivating(false);
    }
  };

  const handleCreateContract = async () => {
    if (!user) return;
    const name = prompt("Identificador ou nome do novo contrato (ex: Apto 102, Casa 05):");
    if (!name || !name.trim()) return;

    const newId = crypto.randomUUID();
    const newContract: Partial<ContractConfig> = {
      id: newId,
      name: name.trim(),
      propertyDescription: '',
      financedAmount: 0,
      fixedInstallment: 0,
      annualInterestRate: 0,
      termMonths: 0,
      startDate: format(new Date(), 'yyyy-MM-dd'),
      finePercent: 0,
      trMode: 'ANNUAL',
      status: 'DRAFT',
    };

    try {
      const res = await apiService.createContract(newContract);
      if (res.ok && res.contract) {
        setContractsList((prev) => [...prev, { id: res.contract!.id, name: res.contract!.name }]);
        setActiveContractId(res.contract.id);
        setConfig(res.contract);
        localStorage.setItem('active_contract_id', res.contract.id);
      } else {
        alert(res.message || "Erro ao criar contrato no D1.");
      }
    } catch (err: any) {
      console.error("Erro ao criar contrato no D1:", err);
      alert("Erro ao criar contrato no D1: " + err.message);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!user || !activeContractId) return;
    if (!confirm("Deseja realmente excluir este lançamento?")) return;
    try {
      const res = await apiService.deleteTransaction(id, activeContractId);
      if (res.ok) {
        await loadActiveContractData(activeContractId);
      } else {
        alert(res.message || "Erro ao excluir lançamento.");
      }
    } catch (err: any) {
      console.error("Erro ao excluir lançamento no D1:", err);
      alert("Erro ao excluir lançamento: " + err.message);
    }
  };

  // 1. Temporary Admin Bootstrap route
  if (currentPath === '/admin/bootstrap') {
    return (
      <AdminBootstrap 
        onNavigateToLogin={() => {
          window.history.pushState({}, '', '/');
          setCurrentPath('/');
        }} 
      />
    );
  }

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
    return (
      <Login 
        onNavigateToBootstrap={() => {
          window.history.pushState({}, '', '/admin/bootstrap');
          setCurrentPath('/admin/bootstrap');
        }} 
      />
    );
  }

  // Papel: ADMIN -> Painel Administrativo
  if (user.role === 'ADMIN' && !adminViewingBuyerPortal) {
    return (
      <AdminPanel 
        currentUser={user} 
        onLogout={logout} 
        onNavigateToBuyerPortal={() => setAdminViewingBuyerPortal(true)} 
      />
    );
  }

  const isLocked = config.status === 'ACTIVE' || user.role === 'BUYER';

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
          {/* Contrato selector & creator */}
          <div className="space-y-2 pb-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Contrato</label>
              <button
                onClick={handleCreateContract}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                title="Novo Contrato"
              >
                <Plus size={14} /> Novo Contrato
              </button>
            </div>
            {contractsList.length > 1 ? (
              <select
                value={activeContractId}
                onChange={(e) => {
                  setActiveContractId(e.target.value);
                  localStorage.setItem('active_contract_id', e.target.value);
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
              >
                {contractsList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-slate-700 font-semibold truncate bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                {config.name || 'Contrato Principal'}
              </div>
            )}
          </div>

          {/* Status do Contrato (Etapa 4A) */}
          {config.status === 'ACTIVE' ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Lock size={16} />
              </div>
              <div>
                <span className="text-xs font-black text-emerald-950 uppercase tracking-wide">CONTRATO ATIVO</span>
                <p className="text-[11px] text-emerald-700 font-medium">🔒 Parâmetros bloqueados</p>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                <div>
                  <span className="text-xs font-black text-amber-950 uppercase tracking-wide">RASCUNHO (DRAFT)</span>
                  <p className="text-[11px] text-amber-700">Edição permitida pelo Vendedor</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-slate-500 mb-2">
            <Settings2 size={16} />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Parâmetros do Contrato</h2>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-tight">Nome / Identificação</label>
              {isLocked && (
                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider">
                  <Lock size={10} /> Bloqueado
                </span>
              )}
            </div>
            <input 
              type="text" 
              value={config.name || ''}
              onChange={e => handleUpdateConfig({ name: e.target.value })}
              disabled={isLocked}
              placeholder="Ex: Apartamento 402"
              className={cn(
                "w-full border rounded-lg px-4 py-2.5 text-sm outline-none transition-all font-semibold",
                isLocked 
                  ? "bg-slate-100/90 border-slate-200 text-slate-500 cursor-not-allowed select-none" 
                  : "bg-slate-50 border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900"
              )}
            />
          </div>

          <ConfigInput 
            label="Valor Financiado" 
            value={config.financedAmount} 
            onChange={v => handleUpdateConfig({ financedAmount: v })} 
            icon={<DollarSign size={16} />}
            isCurrency
            disabled={isLocked}
          />

          <ConfigInput 
            label="Parcela Base" 
            value={config.fixedInstallment} 
            onChange={v => handleUpdateConfig({ fixedInstallment: v })} 
            icon={<Target size={16} />}
            isCurrency
            disabled={isLocked}
          />

          <div className="grid grid-cols-2 gap-4">
            <ConfigInput 
              label="Juros Anual" 
              value={config.annualInterestRate} 
              onChange={v => handleUpdateConfig({ annualInterestRate: v })} 
              icon={<Percent size={16} />}
              suffix="%"
              disabled={isLocked}
            />
            <ConfigInput 
              label="Multa" 
              value={config.finePercent} 
              onChange={v => handleUpdateConfig({ finePercent: v })} 
              suffix="%"
              disabled={isLocked}
            />
          </div>

          <ConfigInput 
            label="Prazo Contratual" 
            value={config.termMonths} 
            onChange={v => handleUpdateConfig({ termMonths: v })} 
            suffix="Meses"
            disabled={isLocked}
          />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500 uppercase">Data de Início</label>
              {isLocked && (
                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider">
                  <Lock size={10} /> Bloqueado
                </span>
              )}
            </div>
            <input 
              type="date" 
              value={config.startDate}
              onChange={e => handleUpdateConfig({ startDate: e.target.value })}
              disabled={isLocked}
              className={cn(
                "w-full border rounded-lg px-4 py-2.5 text-sm outline-none transition-all font-medium",
                isLocked 
                  ? "bg-slate-100/90 border-slate-200 text-slate-500 cursor-not-allowed select-none" 
                  : "bg-slate-50 border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900"
              )}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase">Modo de TR</label>
            <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button 
                type="button"
                disabled={isLocked}
                onClick={() => handleUpdateConfig({ trMode: 'MONTHLY' })}
                className={cn(
                  "flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all",
                  config.trMode === 'MONTHLY' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700",
                  isLocked && "cursor-not-allowed opacity-80"
                )}
              >
                TR MENSAL
              </button>
              <button 
                type="button"
                disabled={isLocked}
                onClick={() => handleUpdateConfig({ trMode: 'ANNUAL' })}
                className={cn(
                  "flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all",
                  config.trMode === 'ANNUAL' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700",
                  isLocked && "cursor-not-allowed opacity-80"
                )}
              >
                TR ANUAL
              </button>
            </div>
          </div>

          {/* Ações do Ciclo de Vida: Salvar Rascunho & Salvar e Ativar */}
          {!isLocked && user.role !== 'BUYER' ? (
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSavingDraft}
                className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:border-slate-400"
              >
                <Save size={14} className={isSavingDraft ? "animate-spin text-indigo-600" : "text-slate-500"} />
                <span>{isSavingDraft ? "Salvando..." : "SALVAR RASCUNHO"}</span>
              </button>

              <button
                type="button"
                onClick={handleOpenActivationModal}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm shadow-emerald-600/20"
              >
                <ShieldCheck size={14} />
                <span>SALVAR E ATIVAR CONTRATO</span>
              </button>
            </div>
          ) : config.status === 'ACTIVE' ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Operação em Andamento:</span>
              <p className="text-[11px] mt-0.5">Parâmetros bloqueados. Utilize <strong className="text-indigo-600">+ Novo Lançamento</strong> para pagamentos e amortizações.</p>
              {user.role === 'ADMIN' && (
                <button
                  type="button"
                  onClick={() => setIsAdminOverrideModalOpen(true)}
                  className="w-full py-2 px-3 mt-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <ShieldAlert size={14} className="text-amber-700" />
                  <span>Editar contrato — ADMIN</span>
                </button>
              )}
            </div>
          ) : null}

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

          <div className="flex items-center gap-3 sm:gap-4">
            {user.role === 'ADMIN' && (
              <button 
                type="button"
                onClick={() => setAdminViewingBuyerPortal(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors cursor-pointer"
                title="Retornar para a Gestão de Usuários"
              >
                ← Painel Admin
              </button>
            )}

            {user.role !== 'BUYER' && (
              <button 
                onClick={() => {
                  if (config.status !== 'ACTIVE') {
                    setActionFeedback({
                      type: 'error',
                      message: 'Lançamentos financeiros só são permitidos após a ativação do contrato.',
                    });
                    return;
                  }
                  setActiveTab('transactions');
                }}
                title={config.status !== 'ACTIVE' ? "O contrato precisa ser ativado antes de novos lançamentos" : "Novo Lançamento"}
                className={cn(
                  "flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-sm cursor-pointer",
                  config.status === 'ACTIVE'
                    ? "bg-indigo-600 text-white hover:bg-indigo-700"
                    : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                )}
              >
                <Plus size={16} />
                <span className="hidden sm:inline">Novo Lançamento</span>
              </button>
            )}

            <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-slate-200">
              <div className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-xs font-bold text-slate-800 leading-tight">{user.name}</span>
                  {user.role === 'SELLER' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200">
                      Vendedor
                    </span>
                  )}
                  {user.role === 'ADMIN' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Admin
                    </span>
                  )}
                  {user.role === 'BUYER' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Comprador
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 font-mono">@{user.login}</span>
              </div>
            </div>

            <button 
              onClick={() => logout()}
              className="p-2 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
              title="Sair do Sistema"
            >
              <LogOut size={18} />
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
              >
                <BuyerJourney 
                  config={config}
                  transactions={transactions}
                  amortization={amortization}
                  user={user}
                  onNavigateToTransactions={() => setActiveTab('transactions')}
                />
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
                                "text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border inline-block w-fit mt-0.5",
                                row.status === 'PAGO' || safeNumber(row.paymentDone) > 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                row.status === 'QUITADO' ? "bg-indigo-50 text-indigo-700 border-indigo-200" :
                                row.status === 'ATRASO' ? "bg-rose-50 text-rose-700 border-rose-200" :
                                "bg-slate-100 text-slate-500 border-slate-200"
                              )}>
                                {row.status === 'PAGO' || safeNumber(row.paymentDone) > 0 ? 'PAGO' :
                                 row.status === 'QUITADO' ? 'QUITADO' :
                                 row.status === 'ATRASO' ? 'ATRASO' : 'PREVISTO'}
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
                {user.role !== 'BUYER' && (
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
                )}

                <div className={cn(
                  "bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm",
                  user.role === 'BUYER' ? "lg:col-span-3" : "lg:col-span-2"
                )}>
                   <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                     <div>
                       <h3 className="font-bold text-slate-800">Histórico de Movimentações</h3>
                       <p className="text-xs text-slate-400">Extrato oficial dos pagamentos registrados no sistema</p>
                     </div>
                     <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{transactions.length} LANÇAMENTOS</span>
                   </div>
                   <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                           <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="px-6 py-4 font-bold text-slate-600">Data Pagamento</th>
                              <th className="px-6 py-4 font-bold text-slate-600">Vencimento</th>
                              <th className="px-6 py-4 font-bold text-slate-600">Parcela</th>
                              <th className="px-6 py-4 font-bold text-slate-600">Tipo</th>
                              <th className="px-6 py-4 font-bold text-slate-600">Valor</th>
                              <th className="px-6 py-4 font-bold text-slate-600">Método</th>
                              <th className="px-6 py-4 font-bold text-slate-600 text-center">Doc</th>
                              {user.role !== 'BUYER' && (
                                <th className="px-6 py-4 font-bold text-slate-600 text-right pr-6">Ação</th>
                              )}
                            </tr>
                          </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(!Array.isArray(transactions) || transactions.length === 0) ? (
                          <tr>
                            <td colSpan={user.role === 'BUYER' ? 7 : 8} className="px-6 py-12 text-center text-slate-400 italic">Nenhum lançamento registrado ainda.</td>
                          </tr>
                        ) : (
                          [...transactions].sort((a, b) => {
                            const dateA = new Date(a.createdAt || a.date).getTime();
                            const dateB = new Date(b.createdAt || b.date).getTime();
                            return dateB - dateA;
                          }).map(tx => (
                            <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4 font-medium">{format(safeDate(parse(tx.date, 'yyyy-MM-dd', new Date())), 'dd/MM/yyyy')}</td>
                              <td className="px-6 py-4 text-slate-600 font-medium">
                                {tx.installmentNumber > 0
                                  ? (() => {
                                      const baseDate = safeDate(parse(config.startDate || '2026-09-10', 'yyyy-MM-dd', new Date()));
                                      if (config.dueDay && config.dueDay >= 1 && config.dueDay <= 31) {
                                        baseDate.setDate(config.dueDay);
                                      }
                                      return format(addMonths(baseDate, tx.installmentNumber - 1), 'dd/MM/yyyy');
                                    })()
                                  : '-'}
                              </td>
                              <td className="px-6 py-4 text-slate-500 font-mono">#{tx.installmentNumber}</td>
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
                              {user.role !== 'BUYER' && (
                                <td className="px-6 py-4 text-right pr-6">
                                  <button 
                                    onClick={() => handleDeleteTransaction(tx.id)}
                                    className="text-rose-500 hover:text-rose-700 p-2 rounded-lg transition-colors"
                                  >
                                    Excluir
                                  </button>
                                </td>
                              )}
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
      
      {/* Toast Feedback */}
      <AnimatePresence>
        {actionFeedback && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 max-w-md shadow-2xl rounded-2xl overflow-hidden border"
          >
            <div className={cn(
              "px-5 py-4 flex items-start gap-3.5",
              actionFeedback.type === 'success' 
                ? "bg-emerald-900 text-white border-emerald-700" 
                : "bg-rose-900 text-white border-rose-700"
            )}>
              {actionFeedback.type === 'success' ? (
                <ShieldCheck size={20} className="text-emerald-300 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={20} className="text-rose-300 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-sm font-medium leading-snug">
                {actionFeedback.message}
              </div>
              <button 
                onClick={() => setActionFeedback(null)}
                className="text-white/70 hover:text-white transition-colors cursor-pointer text-xs font-bold uppercase tracking-wider"
              >
                ✕
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Confirmação de Ativação do Contrato (Etapa 4A) */}
      <AnimatePresence>
        {isActivationModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <ShieldCheck size={22} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">Salvar e Ativar Contrato</h2>
                    <p className="text-xs text-emerald-100">Transição definitiva de Rascunho para Produção</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsActivationModalOpen(false)}
                  disabled={isActivating}
                  className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-5">
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 text-amber-900">
                  <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs leading-relaxed">
                    <strong className="font-bold">Atenção Crítica:</strong> Ao ativar o contrato, seus parâmetros estruturais ficarão <span className="font-bold underline">bloqueados para alteração</span>. A operação seguinte será realizada exclusivamente por meio de <strong>Novos Lançamentos</strong>.
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Conferência dos Parâmetros Reais</h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Identificação</span>
                      <span className="font-bold text-slate-800 text-sm truncate block">{config.name || 'Sem nome'}</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Valor Financiado</span>
                      <span className="font-bold text-slate-800 text-sm block">{formatCurrency(config.financedAmount)}</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Parcela Base</span>
                      <span className="font-bold text-slate-800 text-sm block">{formatCurrency(config.fixedInstallment)}</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Prazo Contratual</span>
                      <span className="font-bold text-slate-800 text-sm block">{config.termMonths} meses</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Juros Anual</span>
                      <span className="font-bold text-slate-800 block">{config.annualInterestRate}% a.a.</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Multa</span>
                      <span className="font-bold text-slate-800 block">{config.finePercent}%</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Data de Início</span>
                      <span className="font-bold text-slate-800 block">{config.startDate}</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Modo TR</span>
                      <span className="font-bold text-slate-800 block">{config.trMode === 'ANNUAL' ? 'Anual' : 'Mensal'}</span>
                    </div>
                  </div>
                </div>

                <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-100 border border-slate-200 cursor-pointer select-none hover:bg-slate-200/70 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={activationConfirmedCheck}
                    onChange={e => setActivationConfirmedCheck(e.target.checked)}
                    className="mt-0.5 w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
                  />
                  <span className="text-xs text-slate-700 font-medium leading-relaxed">
                    Confirmo que conferi todos os dados financeiros acima e autorizo a ativação deste contrato em produção com bloqueio dos parâmetros estruturais.
                  </span>
                </label>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsActivationModalOpen(false)}
                  disabled={isActivating}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmActivation}
                  disabled={!activationConfirmedCheck || isActivating}
                  className={cn(
                    "px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2 transition-all shadow-sm cursor-pointer",
                    (!activationConfirmedCheck || isActivating)
                      ? "bg-slate-300 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-emerald-600/20"
                  )}
                >
                  <ShieldCheck size={16} />
                  <span>{isActivating ? "Ativando Contrato..." : "Confirmar e Ativar Contrato"}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Edição Excepcional de Contrato Ativo - ADMIN (Etapa 4E.2) */}
      <AdminContractOverrideModal
        isOpen={isAdminOverrideModalOpen}
        onClose={() => setIsAdminOverrideModalOpen(false)}
        config={config}
        onSuccess={(updated) => {
          setConfig(updated);
          setActionFeedback({
            type: 'success',
            message: 'Parâmetros contratuais atualizados excepcionalmente pelo Administrador. Audit log registrado.',
          });
          if (activeContractId) {
            loadActiveContractData(activeContractId);
          }
          loadContracts();
        }}
      />
      
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

function ConfigInput({ label, value, onChange, icon, prefix, suffix, isCurrency, disabled }: { 
  label: string; 
  value: number; 
  onChange: (v: number) => void; 
  icon?: React.ReactNode;
  prefix?: string;
  suffix?: string;
  isCurrency?: boolean;
  disabled?: boolean;
}) {
  const displayValue = isCurrency ? formatCurrencyInput(value) : value;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (isCurrency) {
      onChange(parseCurrencyBR(e.target.value));
    } else {
      onChange(safeNumber(e.target.value));
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-tight">{label}</label>
        {disabled && (
          <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider">
            <Lock size={10} /> Bloqueado
          </span>
        )}
      </div>
      <div className="relative group">
        {icon && (
          <div className={cn(
            "absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors",
            disabled ? "text-slate-300" : "text-slate-300 group-focus-within:text-indigo-500"
          )}>
            {icon}
          </div>
        )}
        <input 
          type={isCurrency ? "text" : "number"} 
          value={displayValue}
          onChange={handleChange}
          disabled={disabled}
          className={cn(
            "w-full border rounded-lg py-2.5 text-sm outline-none transition-all font-semibold",
            disabled 
              ? "bg-slate-100/90 border-slate-200 text-slate-500 cursor-not-allowed select-none" 
              : "bg-slate-50 border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900",
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
    installmentNumber: getFirstUnpaidInstallment(transactions, maxInstallment, installmentAmount),
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
      installmentNumber: getFirstUnpaidInstallment(transactions, maxInstallment, installmentAmount)
    }));
  }, [transactions, maxInstallment, installmentAmount]);

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
      if (formData.type === 'PAYMENT' && isInstallmentPaid(transactions, instNum, installmentAmount)) {
        alert(`Esta parcela já está paga. O próximo pagamento pendente é a parcela ${getFirstUnpaidInstallment(transactions, maxInstallment, installmentAmount)}.`);
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
