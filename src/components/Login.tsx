import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Building2, Mail, Lock, LogIn, AlertCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      console.log("Iniciando login para:", email.trim());
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      console.log("Login realizado com sucesso:", userCredential.user.email);
    } catch (err: any) {
      console.error("Firebase login error:", err.code, err.message);
      setError(`${err.code}: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const testFirebase = async () => {
    console.log("--- TESTANDO FIREBASE ---");
    console.log("Auth Current User:", auth.currentUser?.email || "Nenhum");
    try {
      const { doc, getDocFromCache, getDocFromServer } = await import('firebase/firestore');
      const { db } = await import('../lib/firebase');
      
      console.log("Tentando ler Firestore (servidor)...");
      // Test read from a known collection or just any path
      const testDoc = await getDocFromServer(doc(db, 'test', 'connectivity'));
      console.log("Firestore (servidor) lido com sucesso. Existe?", testDoc.exists());
      alert("Firestore OK! Verifique o console para detalhes.");
    } catch (err: any) {
      console.error("Erro no teste do Firestore:", err.code, err.message);
      alert(`Erro no teste: ${err.code}`);
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
          <h2 className="text-xl font-bold text-slate-800 mb-8 flex items-center justify-between">
            Área do Cliente
            <button 
              type="button" 
              onClick={testFirebase}
              className="text-[10px] text-slate-400 hover:text-indigo-600 font-bold uppercase transition-colors"
            >
              Testar Conexão
            </button>
          </h2>

          <form onSubmit={handleLogin} className="space-y-6">
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
              ) : (
                <>
                  Acessar minha conta
                  <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
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
