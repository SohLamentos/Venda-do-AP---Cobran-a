import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  UserPlus, 
  ShieldCheck, 
  ShieldAlert, 
  Building2, 
  LogOut, 
  Search, 
  Filter, 
  Edit3, 
  KeyRound, 
  UserCheck, 
  UserX, 
  ArrowRightLeft, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Loader2, 
  Shield, 
  User, 
  Mail, 
  Lock, 
  Eye, 
  ExternalLink 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiService } from '../services/apiService';
import { CloudflareUser } from '../types';

interface AdminPanelProps {
  currentUser: CloudflareUser;
  onLogout: () => void;
  onNavigateToBuyerPortal?: () => void;
}

type Role = 'ADMIN' | 'SELLER' | 'BUYER';
type Status = 'ACTIVE' | 'DISABLED';

interface UserRecord {
  id: string;
  login: string;
  name: string;
  email: string | null;
  role: Role;
  status: Status;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ 
  currentUser, 
  onLogout,
  onNavigateToBuyerPortal 
}) => {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'metrics'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | Role>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | Status>('ALL');

  // Feedback notifications
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<UserRecord | null>(null);
  const [userToChangeRole, setUserToChangeRole] = useState<UserRecord | null>(null);
  const [userToChangeStatus, setUserToChangeStatus] = useState<UserRecord | null>(null);
  const [userToResetPassword, setUserToResetPassword] = useState<UserRecord | null>(null);

  const fetchUsers = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      const res = await apiService.adminGetUsers();
      if (res.ok && Array.isArray(res.users)) {
        setUsers(res.users);
      } else {
        setFeedback({ 
          type: 'error', 
          message: res.message || res.error || 'Erro ao carregar lista de usuários.' 
        });
      }
    } catch (_err) {
      setFeedback({ type: 'error', message: 'Falha na conexão com o servidor.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback(prev => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchesSearch = 
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.login.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const matchesStatus = statusFilter === 'ALL' || u.status === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  // Metrics summary
  const metrics = useMemo(() => {
    const total = users.length;
    const admins = users.filter(u => u.role === 'ADMIN').length;
    const sellers = users.filter(u => u.role === 'SELLER').length;
    const buyers = users.filter(u => u.role === 'BUYER').length;
    const active = users.filter(u => u.status === 'ACTIVE').length;
    const disabled = users.filter(u => u.status === 'DISABLED').length;
    return { total, admins, sellers, buyers, active, disabled };
  }, [users]);

  const formatDate = (isoStr: string | null) => {
    if (!isoStr) return 'Nunca acessou';
    try {
      const date = new Date(isoStr);
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 shrink-0 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-sm">
              <Building2 size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-900 text-base leading-tight">Venda de Apartamentos</span>
                <span className="text-[10px] uppercase font-bold tracking-wider bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200">
                  Painel Admin
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">Gestão Centralizada de Usuários & Acessos</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {onNavigateToBuyerPortal && (
              <button
                type="button"
                onClick={onNavigateToBuyerPortal}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                title="Visualizar Simulador e Extrato"
              >
                <Eye size={14} />
                <span>Portal do Comprador</span>
              </button>
            )}

            <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
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

      {/* Feedback Banner */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`px-4 py-3 flex items-center justify-between text-sm font-semibold border-b ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
              <div className="flex items-center gap-2">
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                )}
                <span>{feedback.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Navigation Tabs & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'users'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
            >
              <Users size={16} />
              <span>Gestão de Usuários</span>
              <span className="text-xs bg-slate-800 px-2 py-0.5 rounded-full text-slate-200 font-mono">
                {users.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('metrics')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'metrics'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
            >
              <ShieldCheck size={16} />
              <span>Visão Geral & Segurança</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchUsers(true)}
              disabled={refreshing}
              className="p-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              title="Atualizar lista"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin text-indigo-600' : ''} />
            </button>

            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-all cursor-pointer"
            >
              <UserPlus size={16} />
              <span>Novo Usuário</span>
            </button>
          </div>
        </div>

        {/* METRICS VIEW */}
        {activeTab === 'metrics' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Total</p>
                <p className="text-2xl font-black text-slate-900 mt-1">{metrics.total}</p>
                <span className="text-[11px] text-slate-500">Usuários cadastrados</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-indigo-100 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Admins</p>
                <p className="text-2xl font-black text-indigo-700 mt-1">{metrics.admins}</p>
                <span className="text-[11px] text-slate-500">Acesso total</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-amber-100 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Vendedores</p>
                <p className="text-2xl font-black text-amber-700 mt-1">{metrics.sellers}</p>
                <span className="text-[11px] text-slate-500">Equipe de vendas</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Compradores</p>
                <p className="text-2xl font-black text-emerald-700 mt-1">{metrics.buyers}</p>
                <span className="text-[11px] text-slate-500">Portal do cliente</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Ativos</p>
                <p className="text-2xl font-black text-emerald-600 mt-1">{metrics.active}</p>
                <span className="text-[11px] text-slate-500">Acessos liberados</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-rose-500">Desativados</p>
                <p className="text-2xl font-black text-rose-600 mt-1">{metrics.disabled}</p>
                <span className="text-[11px] text-slate-500">Acessos bloqueados</span>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-slate-800 font-bold">
                <Shield className="w-5 h-5 text-indigo-600" />
                <span>Configurações de Segurança e Infraestrutura</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                  <p className="font-bold text-slate-900">Banco de Dados Cloudflare D1</p>
                  <p>Database: <code className="font-mono text-indigo-700">venda-apartamentos-db</code></p>
                  <p>Autenticação nativa com sessões server-side e cookie seguro HttpOnly.</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                  <p className="font-bold text-slate-900">Política de Autenticação</p>
                  <p>Identificador primário: <span className="font-bold text-slate-800">Login (usuário)</span></p>
                  <p>Criptografia: PBKDF2-HMAC-SHA256 (100.000 iterações com salt seguro).</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* USERS LIST VIEW */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            {/* Filters Bar */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-slate-50/50">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nome, login ou e-mail..."
                  className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 placeholder:text-slate-400"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                  <Filter size={14} />
                  <span>Perfil:</span>
                </div>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as any)}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500"
                >
                  <option value="ALL">Todos os Papéis</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="SELLER">SELLER (Vendedor)</option>
                  <option value="BUYER">BUYER (Comprador)</option>
                </select>

                <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold ml-2">
                  <span>Status:</span>
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500"
                >
                  <option value="ALL">Todos os Status</option>
                  <option value="ACTIVE">Ativo</option>
                  <option value="DISABLED">Desativado</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3.5 px-4 sm:px-6">Usuário</th>
                    <th className="py-3.5 px-4">E-mail</th>
                    <th className="py-3.5 px-4">Perfil</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 hidden md:table-cell">Último Acesso</th>
                    <th className="py-3.5 px-4 sm:px-6 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
                        Carregando usuários...
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        Nenhum usuário encontrado para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4 sm:px-6">
                          <div>
                            <p className="font-bold text-slate-900">{user.name}</p>
                            <p className="font-mono text-indigo-600 text-[11px]">@{user.login}</p>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={user.email ? 'text-slate-700' : 'text-slate-400 italic'}>
                            {user.email || '—'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`inline-flex items-center gap-1 font-bold text-[10px] uppercase px-2.5 py-0.5 rounded-full border ${
                            user.role === 'ADMIN'
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              : user.role === 'SELLER'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`inline-flex items-center gap-1 font-bold text-[10px] uppercase px-2 py-0.5 rounded-full border ${
                            user.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}>
                            {user.status === 'ACTIVE' ? 'Ativo' : 'Desativado'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 hidden md:table-cell text-slate-500">
                          {formatDate(user.last_login_at)}
                        </td>
                        <td className="py-3.5 px-4 sm:px-6 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* Editar Perfil */}
                            <button
                              type="button"
                              onClick={() => setUserToEdit(user)}
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                              title="Editar dados cadastrais"
                            >
                              <Edit3 size={15} />
                            </button>

                            {/* Alterar Role */}
                            <button
                              type="button"
                              onClick={() => setUserToChangeRole(user)}
                              className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                              title="Alterar papel (ADMIN / SELLER / BUYER)"
                            >
                              <ArrowRightLeft size={15} />
                            </button>

                            {/* Ativar/Desativar */}
                            <button
                              type="button"
                              onClick={() => setUserToChangeStatus(user)}
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                user.status === 'ACTIVE'
                                  ? 'text-slate-500 hover:text-rose-600 hover:bg-rose-50'
                                  : 'text-slate-500 hover:text-emerald-600 hover:bg-emerald-50'
                              }`}
                              title={user.status === 'ACTIVE' ? 'Desativar usuário' : 'Ativar usuário'}
                            >
                              {user.status === 'ACTIVE' ? <UserX size={15} /> : <UserCheck size={15} />}
                            </button>

                            {/* Redefinir Senha */}
                            <button
                              type="button"
                              onClick={() => setUserToResetPassword(user)}
                              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                              title="Redefinir senha"
                            >
                              <KeyRound size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: CRIAR NOVO USUÁRIO */}
      <AnimatePresence>
        {isCreateOpen && (
          <CreateUserModal
            onClose={() => setIsCreateOpen(false)}
            onSuccess={(msg) => {
              setIsCreateOpen(false);
              showFeedback('success', msg);
              fetchUsers();
            }}
          />
        )}
      </AnimatePresence>

      {/* MODAL: EDITAR USUÁRIO */}
      <AnimatePresence>
        {userToEdit && (
          <EditUserModal
            user={userToEdit}
            onClose={() => setUserToEdit(null)}
            onSuccess={(msg) => {
              setUserToEdit(null);
              showFeedback('success', msg);
              fetchUsers();
            }}
          />
        )}
      </AnimatePresence>

      {/* MODAL: ALTERAR PAPEL */}
      <AnimatePresence>
        {userToChangeRole && (
          <ChangeRoleModal
            user={userToChangeRole}
            currentUserId={currentUser.id}
            adminCount={metrics.admins}
            onClose={() => setUserToChangeRole(null)}
            onSuccess={(msg) => {
              setUserToChangeRole(null);
              showFeedback('success', msg);
              fetchUsers();
            }}
          />
        )}
      </AnimatePresence>

      {/* MODAL: ALTERAR STATUS (ATIVAR/DESATIVAR) */}
      <AnimatePresence>
        {userToChangeStatus && (
          <ChangeStatusModal
            user={userToChangeStatus}
            currentUserId={currentUser.id}
            adminCount={metrics.admins}
            onClose={() => setUserToChangeStatus(null)}
            onSuccess={(msg) => {
              setUserToChangeStatus(null);
              showFeedback('success', msg);
              fetchUsers();
            }}
          />
        )}
      </AnimatePresence>

      {/* MODAL: REDEFINIR SENHA */}
      <AnimatePresence>
        {userToResetPassword && (
          <ResetPasswordModal
            user={userToResetPassword}
            onClose={() => setUserToResetPassword(null)}
            onSuccess={(msg) => {
              setUserToResetPassword(null);
              showFeedback('success', msg);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ==========================================
// SUBCOMPONENTES / MODAIS
// ==========================================

interface ModalBaseProps {
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

const ModalBase: React.FC<ModalBaseProps> = ({ onClose, title, subtitle, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 overflow-hidden"
    >
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
        <div>
          <h3 className="font-bold text-slate-900 text-base">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </motion.div>
  </div>
);

// 1. Create User Modal
const CreateUserModal: React.FC<{
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('BUYER');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedLogin = login.trim().toLowerCase();
    if (!name.trim()) return setError('Nome é obrigatório.');
    if (!trimmedLogin) return setError('Login é obrigatório.');
    if (trimmedLogin.length < 3 || trimmedLogin.length > 50) return setError('Login deve ter de 3 a 50 caracteres.');
    if (!/^[a-z0-9._-]+$/.test(trimmedLogin)) return setError('Login pode conter apenas letras minúsculas, números, ponto, hífen e sublinhado.');

    if (email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) return setError('E-mail inválido.');
    }

    if (password.length < 8) return setError('Senha deve ter no mínimo 8 caracteres.');
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return setError('Senha deve conter ao menos 1 letra e 1 número.');
    if (password !== confirmPassword) return setError('As senhas não conferem.');

    setLoading(true);
    try {
      const res = await apiService.adminCreateUser({
        name: name.trim(),
        login: trimmedLogin,
        email: email.trim() || undefined,
        role,
        password,
      });

      if (res.ok) {
        onSuccess(`Usuário @${trimmedLogin} criado com sucesso!`);
      } else {
        setError(res.message || res.error || 'Erro ao criar usuário.');
      }
    } catch (_e) {
      setError('Falha de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalBase onClose={onClose} title="Novo Usuário" subtitle="Cadastrar credencial de acesso ao sistema">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs flex items-center gap-2 border border-rose-200">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Nome Completo</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: João da Silva"
            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Login (Usuário)</label>
            <input
              type="text"
              autoCapitalize="none"
              spellCheck={false}
              value={login}
              onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/\s+/g, ''))}
              placeholder="joao.silva"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Perfil (Role)</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              <option value="BUYER">BUYER (Comprador)</option>
              <option value="SELLER">SELLER (Vendedor)</option>
              <option value="ADMIN">ADMIN (Administrador)</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            E-mail <span className="text-slate-400 font-normal">(Opcional)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="joao@email.com"
            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Senha Inicial</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mín. 8 caracteres"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Confirmar Senha</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repita a senha"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              required
            />
          </div>
        </div>

        <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            <span>Salvar Usuário</span>
          </button>
        </div>
      </form>
    </ModalBase>
  );
};

// 2. Edit User Modal
const EditUserModal: React.FC<{
  user: UserRecord;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ user, onClose, onSuccess }) => {
  const [name, setName] = useState(user.name);
  const [login, setLogin] = useState(user.login);
  const [email, setEmail] = useState(user.email || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedLogin = login.trim().toLowerCase();
    if (!name.trim()) return setError('Nome é obrigatório.');
    if (!trimmedLogin) return setError('Login é obrigatório.');
    if (!/^[a-z0-9._-]+$/.test(trimmedLogin)) return setError('Login com caracteres inválidos.');

    setLoading(true);
    try {
      const res = await apiService.adminUpdateUser(user.id, {
        name: name.trim(),
        login: trimmedLogin,
        email: email.trim() || undefined,
      });

      if (res.ok) {
        onSuccess('Dados do usuário atualizados com sucesso!');
      } else {
        setError(res.message || res.error || 'Erro ao atualizar.');
      }
    } catch (_e) {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalBase onClose={onClose} title="Editar Usuário" subtitle={`Atualizar dados cadastrais de @${user.login}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs flex items-center gap-2 border border-rose-200">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Nome Completo</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Login</label>
          <input
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/\s+/g, ''))}
            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            E-mail <span className="text-slate-400 font-normal">(Opcional)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
        </div>

        <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            <span>Salvar Alterações</span>
          </button>
        </div>
      </form>
    </ModalBase>
  );
};

// 3. Change Role Modal
const ChangeRoleModal: React.FC<{
  user: UserRecord;
  currentUserId: string;
  adminCount: number;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ user, currentUserId, adminCount, onClose, onSuccess }) => {
  const [role, setRole] = useState<Role>(user.role);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLastAdminDemoting = user.role === 'ADMIN' && role !== 'ADMIN' && adminCount <= 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role === user.role) return onClose();

    if (isLastAdminDemoting) {
      return setError('Não é permitido alterar o papel do único administrador ativo do sistema.');
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiService.adminUpdateUserRole(user.id, role);
      if (res.ok) {
        onSuccess(`Papel de @${user.login} alterado para ${role}.`);
      } else {
        setError(res.message || res.error || 'Erro ao alterar papel.');
      }
    } catch (_e) {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalBase onClose={onClose} title="Alterar Papel de Acesso" subtitle={`Usuário: @${user.login}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs flex items-center gap-2 border border-rose-200">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
          <p className="font-bold text-slate-800">Papel atual: <span className="text-indigo-600">{user.role}</span></p>
          <p>A alteração entra em vigor imediatamente para as próximas requisições do usuário.</p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Novo Papel</label>
          <div className="grid grid-cols-3 gap-2">
            {(['BUYER', 'SELLER', 'ADMIN'] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  role === r
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {user.id === currentUserId && role !== 'ADMIN' && (
          <div className="p-3 bg-amber-50 text-amber-800 rounded-xl text-xs flex items-start gap-2 border border-amber-200">
            <ShieldAlert size={16} className="shrink-0 mt-0.5 text-amber-600" />
            <span>Atenção: você está alterando seu próprio perfil. Você perderá acesso a este painel administrativo.</span>
          </div>
        )}

        <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || isLastAdminDemoting}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
            <span>Confirmar Papel</span>
          </button>
        </div>
      </form>
    </ModalBase>
  );
};

// 4. Change Status Modal
const ChangeStatusModal: React.FC<{
  user: UserRecord;
  currentUserId: string;
  adminCount: number;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ user, currentUserId, adminCount, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStatus: Status = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  const isLastAdminDisabling = user.role === 'ADMIN' && nextStatus === 'DISABLED' && adminCount <= 1;

  const handleConfirm = async () => {
    if (isLastAdminDisabling) {
      return setError('Não é permitido desativar o único administrador ativo do sistema.');
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiService.adminUpdateUserStatus(user.id, nextStatus);
      if (res.ok) {
        onSuccess(`Usuário @${user.login} ${nextStatus === 'ACTIVE' ? 'ativado' : 'desativado'} com sucesso.`);
      } else {
        setError(res.message || res.error || 'Erro ao alterar status.');
      }
    } catch (_e) {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalBase 
      onClose={onClose} 
      title={nextStatus === 'ACTIVE' ? 'Ativar Usuário' : 'Desativar Usuário'} 
      subtitle={`Usuário: @${user.login}`}
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs flex items-center gap-2 border border-rose-200">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-700 space-y-2">
          <p className="font-semibold">
            {nextStatus === 'DISABLED' ? (
              <>
                Deseja realmente <span className="font-bold text-rose-600">desativar</span> o acesso de @{user.login}?
                O usuário não conseguirá mais efetuar login e as sessões ativas serão encerradas.
              </>
            ) : (
              <>
                Deseja <span className="font-bold text-emerald-600">reativar</span> o acesso de @{user.login}?
                O usuário poderá efetuar login normalmente.
              </>
            )}
          </p>
        </div>

        {user.id === currentUserId && nextStatus === 'DISABLED' && (
          <div className="p-3 bg-rose-50 text-rose-800 rounded-xl text-xs flex items-start gap-2 border border-rose-200">
            <ShieldAlert size={16} className="shrink-0 mt-0.5 text-rose-600" />
            <span>Atenção: você está desativando seu próprio usuário. Sua sessão será revogada.</span>
          </div>
        )}

        <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || isLastAdminDisabling}
            className={`px-5 py-2.5 rounded-xl font-bold text-xs text-white flex items-center gap-2 cursor-pointer disabled:opacity-50 ${
              nextStatus === 'ACTIVE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
            }`}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            <span>{nextStatus === 'ACTIVE' ? 'Reativar Usuário' : 'Desativar Acesso'}</span>
          </button>
        </div>
      </div>
    </ModalBase>
  );
};

// 5. Reset Password Modal
const ResetPasswordModal: React.FC<{
  user: UserRecord;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ user, onClose, onSuccess }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) return setError('A nova senha deve ter no mínimo 8 caracteres.');
    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) return setError('A senha deve conter ao menos 1 letra e 1 número.');
    if (newPassword !== confirmPassword) return setError('A confirmação de senha não confere.');

    setLoading(true);
    try {
      const res = await apiService.adminResetPassword(user.id, newPassword);
      if (res.ok) {
        onSuccess(`Senha de @${user.login} redefinida com sucesso!`);
      } else {
        setError(res.message || res.error || 'Erro ao redefinir senha.');
      }
    } catch (_e) {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalBase onClose={onClose} title="Redefinir Senha" subtitle={`Alterar credencial de @${user.login}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs flex items-center gap-2 border border-rose-200">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Nova Senha</label>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres (letras e números)"
            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Confirmar Nova Senha</label>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repita a nova senha"
            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            required
          />
        </div>

        <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-slate-900 hover:bg-black text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            <span>Salvar Nova Senha</span>
          </button>
        </div>
      </form>
    </ModalBase>
  );
};
