import React, { useState } from 'react';
import { Building2, Mail, Lock, LogIn, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from './FirebaseProvider';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const getFriendlyErrorMessage = (codeOrMessage: string) => {
    switch (codeOrMessage) {
      case 'INVALID_CREDENTIALS':
        return 'E-mail ou senha incorretos.';
      case 'TOO_MANY_ATTEMPTS':
        return 'Muitas tentativas de login consecutivas. Por segurança, aguarde alguns minutos antes de tentar novamente.';
      case 'CSRF_FORBIDDEN':
        return 'Falha na validação de segurança da requisição (CSRF). Recarregue a página.';
      case 'DATABASE_UNAVAILABLE':
        return 'Banco de dados temporariamente indisponível. Tente novamente em instantes.';
      default:
        return codeOrMessage || 'Ocorreu um erro ao processar seu login.';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await login(email.trim(), password);
      if (!res.ok) {
        setError(getFriendlyErrorMessage(res.error || 'INVALID_CREDENTIALS'));
      }
      // Note: No password or session token is stored in localStorage/sessionStorage/IndexedDB.
      // Session is securely managed via Cloudflare HttpOnly, SameSite=Lax cookie.
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err?.message || 'Erro inesperado'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.05),transparent),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.05),transparent)]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl flex items-center justify-center shadow-indigo-200 shadow-xl mb-6 transform -rotate-3">
            <Building2 className="text-white w-9 h-9" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">
            Portal do Comprador
          </h1>
          <p className="text-slate-500 font-medium tracking-wide text-sm uppercase">
            Acompanhamento de Pagamentos do Imóvel
          </p>
        </div>

        <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-800">
              Acesso ao Sistema
            </h2>
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Autenticação Nativa D1</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">E-mail</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-colors group-focus-within:text-indigo-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-medium text-slate-700 placeholder:text-slate-400"
                  placeholder="seu@email.com"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Senha</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-colors group-focus-within:text-indigo-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-medium text-slate-700 placeholder:text-slate-400"
                  placeholder="••••••••••"
                  required
                />
              </div>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex items-center gap-2 p-4 bg-rose-50 text-rose-600 rounded-2xl border border-rose-100 text-sm font-medium"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 hover:bg-black text-white py-4 px-6 rounded-2xl font-bold tracking-tight shadow-lg shadow-slate-200 transition-all flex items-center justify-center gap-2 group disabled:opacity-70 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Entrar no Portal
                  <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-500 leading-relaxed">
              O acesso de novos clientes e administradores é provisionado de forma segura pelo painel da incorporadora.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
