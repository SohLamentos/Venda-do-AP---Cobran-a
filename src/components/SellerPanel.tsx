import React from 'react';
import { Building2, LogOut, Briefcase, Clock, ShieldCheck, User } from 'lucide-react';
import { CloudflareUser } from '../types';

interface SellerPanelProps {
  currentUser: CloudflareUser;
  onLogout: () => void;
}

export const SellerPanel: React.FC<SellerPanelProps> = ({ currentUser, onLogout }) => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 shrink-0 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center text-white shadow-sm">
              <Building2 size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-900 text-base leading-tight">Venda de Apartamentos</span>
                <span className="text-[10px] uppercase font-bold tracking-wider bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                  Vendedor
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">Portal de Vendas & Corretores</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-slate-900 leading-tight">{currentUser.name}</p>
                <p className="text-[11px] text-slate-400 font-medium">@{currentUser.login}</p>
              </div>

              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl text-xs font-bold transition-all cursor-pointer"
                title="Sair do Sistema"
              >
                <LogOut size={14} />
                <span>Sair</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 flex items-center justify-center">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50 p-8 sm:p-12 text-center max-w-xl w-full space-y-6">
          <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
            <Briefcase size={36} />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
              <Clock size={14} className="text-amber-600" />
              <span>Em Preparação</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              Área do Vendedor em Preparação
            </h1>

            <p className="text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
              Olá, <strong className="text-slate-800">{currentUser.name}</strong>. O módulo de intermediação e propostas de apartamentos está sendo estruturado pela incorporadora.
            </p>
          </div>

          {/* Highlights */}
          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 text-left space-y-3 text-xs text-slate-600">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              <p>
                <strong className="text-slate-800">Segurança de Dados:</strong> Seu perfil de vendedor está ativo e protegido no banco de dados Cloudflare D1.
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <Building2 size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p>
                <strong className="text-slate-800">Em Breve:</strong> Acompanhamento de propostas, espelho de unidades e envio direto de contratos para compradores.
              </p>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={onLogout}
              className="w-full bg-slate-900 hover:bg-black text-white py-3 px-6 rounded-2xl font-bold text-xs transition-all cursor-pointer"
            >
              Encerrar Sessão
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};
