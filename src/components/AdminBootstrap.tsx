import React, { useState } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Lock, 
  Mail, 
  User, 
  AtSign,
  KeyRound, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  ArrowLeft,
  Info
} from 'lucide-react';
import { motion } from 'motion/react';
import { apiService } from '../services/apiService';
import { CloudflareUser } from '../types';

interface AdminBootstrapProps {
  onNavigateToLogin?: () => void;
}

export const AdminBootstrap: React.FC<AdminBootstrapProps> = ({ onNavigateToLogin }) => {
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBlockedAlreadyExists, setIsBlockedAlreadyExists] = useState(false);
  const [successUser, setSuccessUser] = useState<CloudflareUser | null>(null);

  const handleGoToLogin = () => {
    if (onNavigateToLogin) {
      onNavigateToLogin();
    } else {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const validateForm = (): string | null => {
    if (!name.trim()) {
      return 'O nome do administrador é obrigatório.';
    }

    const trimmedLogin = login.trim().toLowerCase();
    if (!trimmedLogin) {
      return 'O login (usuário) é obrigatório.';
    }
    if (trimmedLogin.length < 3 || trimmedLogin.length > 50) {
      return 'O login deve ter entre 3 e 50 caracteres.';
    }
    if (/\s/.test(trimmedLogin)) {
      return 'O login não pode conter espaços.';
    }
    if (!/^[a-z0-9._-]+$/.test(trimmedLogin)) {
      return 'O login pode conter apenas letras minúsculas, números, ponto (.), traço (-) e sublinhado (_).';
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        return 'Informe um e-mail válido ou deixe o campo em branco.';
      }
    }

    if (password.length < 10) {
      return 'A senha deve ter no mínimo 10 caracteres.';
    }
    if (password.length > 128) {
      return 'A senha não pode exceder 128 caracteres.';
    }
    if (!/[a-zA-Z]/.test(password)) {
      return 'A senha deve conter pelo menos uma letra.';
    }
    if (!/[0-9]/.test(password)) {
      return 'A senha deve conter pelo menos um número.';
    }

    if (password !== confirmPassword) {
      return 'A confirmação de senha não confere.';
    }

    if (!bootstrapToken.trim()) {
      return 'O token de bootstrap (ADMIN_BOOTSTRAP_TOKEN) é obrigatório.';
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBlockedAlreadyExists || loading) return;

    setError(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      const res = await apiService.adminBootstrap(
        {
          login: login.trim().toLowerCase(),
          name: name.trim(),
          email: email.trim() || undefined,
          password,
        },
        bootstrapToken.trim()
      );

      if (res.ok && (res.status === 201 || (res as any).user)) {
        setSuccessUser({
          id: res.user?.id || '',
          login: res.user?.login || login.trim().toLowerCase(),
          name: res.user?.name || name.trim(),
          email: res.user?.email || (email.trim() || null),
          role: 'ADMIN',
          status: 'ACTIVE',
        });

        // Immediately wipe sensitive credentials from memory
        setPassword('');
        setConfirmPassword('');
        setBootstrapToken('');
        setName('');
        setLogin('');
        setEmail('');
        setError(null);
      } else if (res.status === 409 || res.code === 'ADMIN_ALREADY_EXISTS') {
        setIsBlockedAlreadyExists(true);
        setError('O primeiro administrador já foi criado no sistema. O bootstrap está desativado.');
        setPassword('');
        setConfirmPassword('');
        setBootstrapToken('');
      } else if (res.status === 401 || res.status === 403 || res.code === 'FORBIDDEN' || res.code === 'UNAUTHORIZED') {
        setError('Token de bootstrap inválido ou não configurado no Cloudflare (ADMIN_BOOTSTRAP_TOKEN).');
      } else if (res.code === 'LOGIN_ALREADY_EXISTS') {
        setError('Este login de usuário já está em uso.');
      } else if (res.code === 'EMAIL_ALREADY_EXISTS') {
        setError('Este endereço de e-mail já está cadastrado.');
      } else {
        setError(res.message || res.error || 'Não foi possível completar o bootstrap do administrador.');
      }
    } catch (_err) {
      setError('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.06),transparent),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.06),transparent)] font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg"
      >
        {/* Header Branding */}
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-900 to-slate-950 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-200/50 mb-4 transform -rotate-2">
            <KeyRound className="text-white w-8 h-8" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold mb-2">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
            <span>Configuração Inicial — Execução Única</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Bootstrap de Administrador
          </h1>
          <p className="text-slate-500 font-medium text-xs sm:text-sm mt-1 max-w-md">
            Criação exclusiva do primeiro usuário ADMIN no Cloudflare D1
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl shadow-slate-200/60 border border-slate-100">
          {successUser ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-4 space-y-6"
            >
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-9 h-9" />
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-black text-slate-900">
                  Administrador criado com sucesso!
                </h2>
                <p className="text-sm text-slate-500">
                  O primeiro acesso administrativo foi registrado com segurança no banco de dados.
                </p>
              </div>

              {/* Verified details */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 text-left space-y-2.5 text-sm">
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Nome:</span>
                  <span className="font-semibold text-slate-800">{successUser.name || '—'}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Login:</span>
                  <span className="font-bold text-indigo-700">{successUser.login}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">E-mail:</span>
                  <span className="font-semibold text-slate-800">{successUser.email || 'Não informado (opcional)'}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-500 font-medium">Perfil:</span>
                  <span className="inline-flex items-center gap-1 font-bold text-xs uppercase bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full border border-indigo-200">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {successUser.role}
                  </span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleGoToLogin}
                  className="w-full bg-slate-900 hover:bg-black text-white py-3.5 px-6 rounded-2xl font-bold tracking-tight shadow-lg shadow-slate-200 transition-all flex items-center justify-center gap-2 cursor-pointer text-sm"
                >
                  <ArrowLeft className="w-4 h-4" />
                  IR PARA O LOGIN
                </button>
              </div>
            </motion.div>
          ) : (
            <>
              {isBlockedAlreadyExists ? (
                <div className="py-4 space-y-6 text-center">
                  <div className="w-14 h-14 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto">
                    <ShieldAlert className="w-7 h-7" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-lg font-bold text-slate-900">
                      Bootstrap Desativado
                    </h2>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      O primeiro administrador já foi cadastrado no sistema. O provisionamento por token foi permanentemente desativado.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleGoToLogin}
                    className="w-full bg-slate-900 hover:bg-black text-white py-3.5 px-6 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 cursor-pointer text-sm"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    IR PARA O LOGIN
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      Esta interface realiza exclusivamente o provisionamento inicial do primeiro administrador. Demais usuários são geridos pelo painel após o login.
                    </p>
                  </div>

                  {/* Nome do Administrador */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider ml-1">
                      Nome Completo
                    </label>
                    <div className="relative group">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={loading}
                        className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm font-medium text-slate-800 placeholder:text-slate-400 disabled:opacity-60"
                        placeholder="Nome do administrador"
                        required
                      />
                    </div>
                  </div>

                  {/* Login (Usuário) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                        Login (Usuário)
                      </label>
                      <span className="text-[10px] text-slate-400 font-medium">Usado para login</span>
                    </div>
                    <div className="relative group">
                      <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                      <input
                        type="text"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={login}
                        onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                        disabled={loading}
                        className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm font-medium text-slate-800 placeholder:text-slate-400 disabled:opacity-60"
                        placeholder="admin"
                        required
                      />
                    </div>
                  </div>

                  {/* E-mail (Opcional) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                        E-mail
                      </label>
                      <span className="text-[10px] text-slate-400 font-medium">Opcional</span>
                    </div>
                    <div className="relative group">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={loading}
                        className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm font-medium text-slate-800 placeholder:text-slate-400 disabled:opacity-60"
                        placeholder="admin@empresa.com (opcional)"
                      />
                    </div>
                  </div>

                  {/* Senha */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider ml-1">
                      Senha Inicial
                    </label>
                    <div className="relative group">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={loading}
                        className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm font-medium text-slate-800 placeholder:text-slate-400 disabled:opacity-60"
                        placeholder="Mínimo 10 caracteres (letras e números)"
                        required
                      />
                    </div>
                  </div>

                  {/* Confirmar Senha */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider ml-1">
                      Confirmar Senha
                    </label>
                    <div className="relative group">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={loading}
                        className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm font-medium text-slate-800 placeholder:text-slate-400 disabled:opacity-60"
                        placeholder="Repita a senha digitada"
                        required
                      />
                    </div>
                  </div>

                  {/* ADMIN_BOOTSTRAP_TOKEN */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-bold text-indigo-950 uppercase tracking-wider">
                        ADMIN_BOOTSTRAP_TOKEN
                      </label>
                      <span className="text-[10px] text-slate-400 font-medium">Secret configurado no Cloudflare</span>
                    </div>
                    <div className="relative group">
                      <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500 group-focus-within:text-indigo-700 transition-colors" />
                      <input
                        type="password"
                        autoComplete="off"
                        value={bootstrapToken}
                        onChange={(e) => setBootstrapToken(e.target.value)}
                        disabled={loading}
                        className="w-full pl-10 pr-3.5 py-2.5 bg-indigo-50/40 border border-indigo-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm font-mono text-slate-800 placeholder:text-slate-400 disabled:opacity-60"
                        placeholder="••••••••••••••••••••••••••••••••"
                        required
                      />
                    </div>
                  </div>

                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 p-3 bg-rose-50 text-rose-700 rounded-xl border border-rose-200 text-xs font-medium"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                      <span>{error}</span>
                    </motion.div>
                  )}

                  <div className="pt-2 space-y-3">
                    <button
                      type="submit"
                      disabled={loading || isBlockedAlreadyExists}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white py-3.5 px-6 rounded-2xl font-bold text-sm tracking-tight shadow-md shadow-indigo-200 transition-all flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Processando Bootstrap...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          <span>CRIAR PRIMEIRO ADMINISTRADOR</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleGoToLogin}
                      disabled={loading}
                      className="w-full py-2.5 text-xs text-slate-500 hover:text-slate-800 font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Voltar para o Login
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};
