import React, { useState } from 'react';
import { Building2, User, Lock, LogIn, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from './FirebaseProvider';

interface LoginProps {
  onNavigateToBootstrap?: () => void;
}

export const Login: React.FC<LoginProps> = ({ onNavigateToBootstrap }) => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGoToBootstrap = () => {
    if (onNavigateToBootstrap) {
      onNavigateToBootstrap();
    } else {
      window.history.pushState({}, '', '/admin/bootstrap');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const getFriendlyErrorMessage = (codeOrMessage: string) => {
    switch (codeOrMessage) {
      case 'INVALID_CREDENTIALS':
        return 'Usuário ou senha incorretos.';
      case 'TOO_MANY_ATTEMPTS':
        return 'Muitas tentativas consecutivas de login. Por segurança, aguarde alguns minutos antes de tentar novamente.';
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
    if (loading) return;

    const trimmedUser = username.trim().toLowerCase();
    if (!trimmedUser) {
      setError('Por favor, informe seu nome de usuário.');
      return;
    }

    if (!password) {
      setError('Por favor, digite sua senha.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await login(trimmedUser, password);
      if (!res.ok) {
        setError(getFriendlyErrorMessage(res.error || 'INVALID_CREDENTIALS'));
      }
      // Note: Credentials and session token are NOT stored in localStorage or sessionStorage.
      // Authentication is statefully verified via HttpOnly, SameSite=Lax cookie on Cloudflare Workers.
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err?.message || 'Erro inesperado'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.05),transparent),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.05),transparent)] font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-950 rounded-2xl flex items-center justify-center shadow-indigo-200 shadow-xl mb-5 transform -rotate-2">
            <Building2 className="text-white w-9 h-9" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-1 text-center">
            Venda de Apartamentos
          </h1>
          <p className="text-slate-500 font-semibold tracking-wide text-xs uppercase text-center">
            Sistema de Gestão & Portal do Imóvel
          </p>
        </div>

        <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-slate-800">
              Acesso ao Sistema
            </h2>
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/60">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Autenticação Segura</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
                Usuário (Login)
              </label>
              <div className="relative group">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-colors group-focus-within:text-indigo-600" />
                <input
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-medium text-slate-800 placeholder:text-slate-400 text-sm"
                  placeholder="seu.usuario"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
                Senha
              </label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-colors group-focus-within:text-indigo-600" />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-medium text-slate-800 placeholder:text-slate-400 text-sm"
                  placeholder="••••••••••"
                  required
                />
              </div>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex items-center gap-2 p-3.5 bg-rose-50 text-rose-700 rounded-2xl border border-rose-200 text-xs font-medium"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600" />
                <span>{error}</span>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 hover:bg-black text-white py-3.5 px-6 rounded-2xl font-bold tracking-tight shadow-md shadow-slate-300 transition-all flex items-center justify-center gap-2 group disabled:opacity-70 cursor-pointer text-sm"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Entrar no Sistema
                  <LogIn className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 text-center flex flex-col items-center">
            <p className="text-xs text-slate-500 leading-relaxed">
              O acesso é restrito a administradores, corretores e compradores autorizados pela incorporadora.
            </p>
            <button
              type="button"
              onClick={handleGoToBootstrap}
              className="mt-3 text-xs text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
            >
              Configuração Inicial do 1º Administrador (Bootstrap) →
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
