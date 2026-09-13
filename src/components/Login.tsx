import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Building2, Mail, Lock, LogIn, UserPlus, AlertCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

export const Login: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const getFriendlyErrorMessage = (err: any) => {
    const code = err?.code || '';
    switch (code) {
      case 'auth/invalid-credential':
        return 'E-mail ou senha incorretos.';
      case 'auth/user-not-found':
        return 'Usuário não encontrado. Crie uma conta para acessar.';
      case 'auth/wrong-password':
        return 'Senha incorreta.';
      case 'auth/email-already-in-use':
        return 'Este e-mail já está cadastrado. Alterne para "Entrar".';
      case 'auth/weak-password':
        return 'A senha deve conter no mínimo 6 caracteres.';
      case 'auth/invalid-email':
        return 'Formato de e-mail inválido.';
      case 'auth/too-many-requests':
        return 'Muitas tentativas consecutivas. Tente novamente mais tarde.';
      default:
        return err?.message || 'Ocorreu um erro ao processar sua solicitação.';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'login') {
        console.log("Iniciando login para:", email.trim());
        const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
        console.log("Login realizado com sucesso:", userCredential.user.email);
      } else {
        console.log("Iniciando cadastro para:", email.trim());
        const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        console.log("Cadastro realizado com sucesso:", userCredential.user.email);
      }
    } catch (err: any) {
      console.error("Firebase auth error:", err.code, err.message);
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const testFirebase = async () => {
    console.log("--- TESTANDO FIREBASE ---");
    console.log("Auth Current User:", auth.currentUser?.email || "Nenhum");
    try {
      const { doc, getDocFromServer } = await import('firebase/firestore');
      const { db } = await import('../lib/firebase');
      
      console.log("Tentando ler Firestore (servidor)...");
      const testDoc = await getDocFromServer(doc(db, 'test', 'connectivity'));
      console.log("Firestore (servidor) lido com sucesso. Existe?", testDoc.exists());
      alert("Firestore OK! Verifique o console para detalhes.");
    } catch (err: any) {
      console.error("Erro no teste do Firestore:", err.code, err.message);
      alert(`Status da conexão verificado: ${err.code || 'OK'}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.05),transparent),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.05),transparent)]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="flex flex-col items-center mb-10">
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

        <div className="bg-white p-10 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-slate-800">
              {mode === 'login' ? 'Área do Cliente' : 'Criar Nova Conta'}
            </h2>
            <button 
              type="button" 
              onClick={testFirebase}
              className="text-[10px] text-slate-400 hover:text-indigo-600 font-bold uppercase transition-colors"
            >
              Testar Conexão
            </button>
          </div>

          <div className="flex border-b border-slate-100 mb-6">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); }}
              className={`flex-1 pb-3 text-sm font-bold transition-colors text-center border-b-2 ${
                mode === 'login' 
                  ? 'border-slate-900 text-slate-900' 
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(null); }}
              className={`flex-1 pb-3 text-sm font-bold transition-colors text-center border-b-2 ${
                mode === 'register' 
                  ? 'border-slate-900 text-slate-900' 
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              Cadastrar
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">E-mail</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-colors group-focus-within:text-indigo-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-medium text-slate-700 placeholder:text-slate-400"
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
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-medium text-slate-700 placeholder:text-slate-400"
                  placeholder="••••••••"
                  minLength={6}
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
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 hover:bg-black text-white py-4 px-6 rounded-2xl font-bold tracking-tight shadow-lg shadow-slate-200 transition-all flex items-center justify-center gap-2 group disabled:opacity-70"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : mode === 'login' ? (
                <>
                  Acessar minha conta
                  <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              ) : (
                <>
                  Criar conta
                  <UserPlus className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <p className="text-xs text-slate-500 text-center mt-6 leading-relaxed">
            🔒 Ambiente seguro • Controle completo da sua compra.
          </p>
        </div>
      </motion.div>
    </div>
  );
};
