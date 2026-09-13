/**
 * Cloudflare Worker API Service
 * 
 * Provides unified access to /api/v1 endpoints served by the Cloudflare Worker.
 * Used for native Cloudflare authentication and transitioning persistence from Firebase to Cloudflare D1 and R2.
 */

import { ContractConfig, Transaction, CloudflareUser } from '../types';

export interface HealthResponse {
  ok: boolean;
  service: string;
  runtime: string;
}

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  id?: string;
  error?: string;
  code?: string;
  message?: string;
  user?: CloudflareUser;
  users?: any[];
}

export interface AuthMeResponse {
  ok: boolean;
  user?: CloudflareUser;
  code?: string;
  message?: string;
}

class ApiService {
  private baseUrl = '/api/v1';

  /**
   * Health check endpoint
   */
  async checkHealth(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) {
      throw new Error(`Health check failed with status ${res.status}`);
    }
    return res.json();
  }

  /**
   * Cloudflare Native Login (POST /api/v1/auth/login)
   * Sends credentials and receives HttpOnly session cookie
   */
  async login(email: string, password: string): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return res.json();
  }

  /**
   * Cloudflare Native Logout (POST /api/v1/auth/logout)
   * Revokes server session and clears HttpOnly cookie
   */
  async logout(): Promise<ApiResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      return res.json();
    } catch (_err) {
      return { ok: true };
    }
  }

  /**
   * Cloudflare Native Auth Verification (GET /api/v1/auth/me)
   * Restores session from HttpOnly cookie
   */
  async getAuthMe(): Promise<AuthMeResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/auth/me`, {
        method: 'GET',
        credentials: 'include',
      });
      return res.json();
    } catch (_err) {
      return { ok: false, code: 'NETWORK_ERROR' };
    }
  }

  /**
   * Change current user's password (POST /api/v1/auth/change-password)
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/auth/change-password`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return res.json();
  }

  /**
   * Bootstrap First Admin (POST /api/v1/admin/bootstrap)
   * Uses existing worker endpoint with Authorization: Bearer <bootstrapToken>
   */
  async adminBootstrap(
    payload: { email: string; name?: string; password: string },
    bootstrapToken: string
  ): Promise<{ ok: boolean; status: number; user?: CloudflareUser; code?: string; error?: string }> {
    const res = await fetch(`${this.baseUrl}/admin/bootstrap`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bootstrapToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: payload.email.trim(),
        name: payload.name?.trim() || undefined,
        password: payload.password,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    return {
      ok: res.ok,
      status: res.status,
      ...json,
    };
  }

  /**
   * Admin: List users (GET /api/v1/admin/users)
   */
  async adminGetUsers(): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/admin/users`, {
      method: 'GET',
      credentials: 'include',
    });
    return res.json();
  }

  /**
   * Admin: Create Client (POST /api/v1/admin/users)
   */
  async adminCreateUser(payload: { email: string; name?: string; password: string; role?: 'CLIENT' }): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/admin/users`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, role: 'CLIENT' }),
    });
    return res.json();
  }

  /**
   * Admin: Update user status (PATCH /api/v1/admin/users/:id/status)
   */
  async adminUpdateUserStatus(id: string, status: 'ACTIVE' | 'DISABLED'): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/admin/users/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return res.json();
  }

  /**
   * Admin: Reset user password (POST /api/v1/admin/users/:id/reset-password)
   */
  async adminResetPassword(id: string, newPassword: string): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/admin/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    return res.json();
  }

  // --- Contracts & Transactions (still fail-closed 503) ---
  async getContracts(): Promise<ApiResponse<ContractConfig[]>> {
    const res = await fetch(`${this.baseUrl}/contracts`, { credentials: 'include' });
    return res.json();
  }

  async getContract(id: string): Promise<ApiResponse<ContractConfig>> {
    const res = await fetch(`${this.baseUrl}/contracts/${id}`, { credentials: 'include' });
    return res.json();
  }

  async createContract(contract: Partial<ContractConfig>): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/contracts`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contract),
    });
    return res.json();
  }

  async updateContract(id: string, contract: Partial<ContractConfig>): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/contracts/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contract),
    });
    return res.json();
  }

  async getTransactions(contractId: string): Promise<ApiResponse<Transaction[]>> {
    const res = await fetch(`${this.baseUrl}/transactions?contractId=${encodeURIComponent(contractId)}`, {
      credentials: 'include',
    });
    return res.json();
  }

  async createTransaction(transaction: Partial<Transaction> & { contractId: string }): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/transactions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transaction),
    });
    return res.json();
  }

  async deleteTransaction(id: string, contractId?: string): Promise<ApiResponse> {
    const url = contractId 
      ? `${this.baseUrl}/transactions?id=${encodeURIComponent(id)}&contractId=${encodeURIComponent(contractId)}`
      : `${this.baseUrl}/transactions?id=${encodeURIComponent(id)}`;
    const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
    return res.json();
  }
}

export const apiService = new ApiService();
