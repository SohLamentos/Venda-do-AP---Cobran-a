import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiService } from '../services/apiService';
import { CloudflareUser, UserRole } from '../types';

export interface AuthContextType {
  user: {
    uid: string;
    login: string;
    email: string | null;
    name?: string | null;
    role: UserRole;
  } | null;
  cloudflareUser: CloudflareUser | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  cloudflareUser: null,
  loading: true,
  login: async () => ({ ok: false }),
  logout: async () => {},
  refreshUser: async () => {},
});

export const useFirebase = () => useContext(AuthContext);
export const useAuth = () => useContext(AuthContext);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cloudflareUser, setCloudflareUser] = useState<CloudflareUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await apiService.getAuthMe();
      if (res.ok && res.user) {
        setCloudflareUser(res.user);
      } else {
        setCloudflareUser(null);
      }
    } catch (_err) {
      setCloudflareUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial session restore via GET /api/v1/auth/me (HttpOnly cookie)
    refreshUser();
  }, [refreshUser]);

  const login = async (loginParam: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await apiService.login(loginParam, password);
      if (res.ok && res.user) {
        setCloudflareUser(res.user);
        return { ok: true };
      }
      return { ok: false, error: res.message || res.code || 'Credenciais inválidas' };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Erro de conexão com o servidor' };
    }
  };

  const logout = async () => {
    try {
      await apiService.logout();
    } finally {
      setCloudflareUser(null);
    }
  };

  const user = cloudflareUser
    ? {
        uid: cloudflareUser.id,
        login: cloudflareUser.login,
        email: cloudflareUser.email || null,
        name: cloudflareUser.name,
        role: cloudflareUser.role,
      }
    : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        cloudflareUser,
        loading,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
