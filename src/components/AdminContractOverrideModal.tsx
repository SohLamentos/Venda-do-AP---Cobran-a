import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert, AlertTriangle, X, Check, Save, Info } from 'lucide-react';
import { ContractConfig } from '../types';
import { apiService } from '../services/apiService';
import { formatCurrency, safeNumber, formatBRL, parseBRL } from '../lib/utils';

interface AdminContractOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ContractConfig;
  onSuccess: (updated: ContractConfig) => void;
}

export const AdminContractOverrideModal: React.FC<AdminContractOverrideModalProps> = ({
  isOpen,
  onClose,
  config,
  onSuccess,
}) => {
  const [formData, setFormData] = React.useState({
    name: config.name || '',
    propertyDescription: config.propertyDescription || '',
    financedAmount: config.financedAmount || 0,
    fixedInstallment: config.fixedInstallment || 0,
    annualInterestRate: config.annualInterestRate || 0,
    termMonths: config.termMonths || 0,
    startDate: config.startDate || '',
    finePercent: config.finePercent || 0,
    trMode: config.trMode || 'ANNUAL',
    reason: '',
  });

  const [confirmCheckbox, setConfirmCheckbox] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Sincroniza formulário com o contrato selecionado
  React.useEffect(() => {
    if (isOpen) {
      setFormData({
        name: config.name || '',
        propertyDescription: config.propertyDescription || '',
        financedAmount: config.financedAmount || 0,
        fixedInstallment: config.fixedInstallment || 0,
        annualInterestRate: config.annualInterestRate || 0,
        termMonths: config.termMonths || 0,
        startDate: config.startDate || '',
        finePercent: config.finePercent || 0,
        trMode: config.trMode || 'ANNUAL',
        reason: '',
      });
      setConfirmCheckbox(false);
      setErrorMsg(null);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  // Detecta se houve campos financeiros alterados
  const hasFinancialChanges =
    formData.financedAmount !== config.financedAmount ||
    formData.fixedInstallment !== config.fixedInstallment ||
    formData.annualInterestRate !== config.annualInterestRate ||
    formData.termMonths !== config.termMonths ||
    formData.startDate !== config.startDate ||
    formData.trMode !== config.trMode;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!formData.reason.trim() || formData.reason.trim().length < 10) {
      setErrorMsg('A justificativa da alteração administrativa é obrigatória (mínimo de 10 caracteres).');
      return;
    }

    if (!confirmCheckbox) {
      setErrorMsg('Você precisa confirmar que está ciente do impacto antes de salvar.');
      return;
    }

    if (formData.financedAmount <= 0 || formData.fixedInstallment <= 0 || formData.termMonths <= 0) {
      setErrorMsg('Valor financiado, parcela e prazo devem ser maiores que zero.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiService.adminOverrideContract(config.id, {
        name: formData.name.trim(),
        propertyDescription: formData.propertyDescription.trim(),
        financedAmount: Number(formData.financedAmount),
        fixedInstallment: Number(formData.fixedInstallment),
        annualInterestRate: Number(formData.annualInterestRate),
        termMonths: Number(formData.termMonths),
        startDate: formData.startDate.trim(),
        finePercent: Number(formData.finePercent),
        trMode: formData.trMode as 'ANNUAL' | 'MONTHLY',
        reason: formData.reason.trim(),
      });

      if (res.ok && res.contract) {
        onSuccess(res.contract);
        onClose();
      } else {
        setErrorMsg(res.message || res.error || 'Falha ao salvar alteração administrativa.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro inesperado na comunicação com o servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-xl w-full overflow-hidden flex flex-col max-h-[92vh]"
        >
          {/* Header */}
          <div className="p-6 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <ShieldAlert size={22} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Editar Contrato — ADMIN</h2>
                <p className="text-xs text-amber-100">Operação Excepcional com Auditoria Rigorosa</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1">
            {/* Aviso de impacto */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 text-amber-900">
              <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed space-y-1">
                <p>
                  <strong className="font-bold">Aviso Crítico de Impacto Financeiro:</strong> Este contrato encontra-se <span className="font-bold underline">ATIVO</span>.
                </p>
                <p>
                  A alteração de parâmetros estruturais (valor financiado, prestação, juros, data inicial, prazo ou TR) <strong className="font-bold">modificará as projeções futuras de amortização</strong>.
                </p>
                <p className="text-amber-800">
                  🛡️ <strong>Imutabilidade histórica:</strong> Os lançamentos financeiros e pagamentos já realizados permanecerão 100% inalterados.
                </p>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">
                {errorMsg}
              </div>
            )}

            {/* Campos de formulário */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Nome / Identificação do Contrato</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Valor Financiado (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.financedAmount}
                    onChange={(e) => setFormData({ ...formData, financedAmount: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">Atual: {formatCurrency(config.financedAmount)}</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Parcela Base Fixa (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.fixedInstallment}
                    onChange={(e) => setFormData({ ...formData, fixedInstallment: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">Atual: {formatCurrency(config.fixedInstallment)}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Prazo (Meses)</label>
                  <input
                    type="number"
                    value={formData.termMonths}
                    onChange={(e) => setFormData({ ...formData, termMonths: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">Atual: {config.termMonths}m</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Juros (% a.a.)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.annualInterestRate}
                    onChange={(e) => setFormData({ ...formData, annualInterestRate: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">Atual: {config.annualInterestRate}%</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Multa Atraso (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.finePercent}
                    onChange={(e) => setFormData({ ...formData, finePercent: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">Atual: {config.finePercent}%</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Data de Início Contratual</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">Atual: {config.startDate}</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Regime TR</label>
                  <select
                    value={formData.trMode}
                    onChange={(e) => setFormData({ ...formData, trMode: e.target.value as any })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  >
                    <option value="ANNUAL">Anual (Aniversário a partir do mês 13)</option>
                    <option value="MONTHLY">Mensal</option>
                  </select>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Atual: {config.trMode === 'ANNUAL' ? 'Anual' : 'Mensal'}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Justificativa Administrativa da Alteração <span className="text-rose-600">*</span>
                </label>
                <textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="Ex: Correção da data inicial do contrato para 10/09/2026 conforme instrumento particular homologado."
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  required
                />
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  Esta justificativa é obrigatória (mínimo de 10 caracteres) e será gravada no registro indelével de auditoria (audit log) com seu login de ADMIN.
                </span>
              </div>
            </div>

            {hasFinancialChanges && (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                <Info size={16} className="text-amber-700 shrink-0 mt-0.5" />
                <span>
                  Foram detectadas alterações em parâmetros que afetam projeções. O cronograma futuro de amortização será recalculado imediatamente após a confirmação.
                </span>
              </div>
            )}

            {/* Checkbox de confirmação */}
            <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-100 border border-slate-200 cursor-pointer select-none hover:bg-slate-200/70 transition-colors">
              <input
                type="checkbox"
                checked={confirmCheckbox}
                onChange={(e) => setConfirmCheckbox(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-amber-600 rounded focus:ring-amber-500 cursor-pointer"
              />
              <span className="text-xs text-slate-700 font-medium leading-relaxed">
                Confirmo que sou Administrador autorizado, revisei os parâmetros alterados e autorizo a atualização excepcional deste contrato com registro de auditoria.
              </span>
            </label>

            {/* Botões */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !confirmCheckbox || formData.reason.trim().length < 10}
                className="flex-1 py-2.5 px-4 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
              >
                {isSubmitting ? (
                  <span>Salvando no D1...</span>
                ) : (
                  <>
                    <Save size={15} />
                    <span>Salvar Alteração — ADMIN</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
