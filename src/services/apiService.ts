/**
 * Cloudflare Worker API Service
 * 
 * Provides unified access to /api/v1 endpoints served by the Cloudflare Worker.
 * Used for transitioning persistence from Firebase to Cloudflare D1 and R2.
 */

import { ContractConfig, Transaction } from '../types';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';

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
}

export interface AuthMeResponse {
  ok: boolean;
  user?: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  };
  code?: string;
}

class ApiService {
  private baseUrl = '/api/v1';

  /**
   * Performs an authenticated fetch with Firebase ID Token
   * Includes one-time token refresh retry on 401.
   */
  async apiFetchAuthenticated(user: User, endpoint: string, init?: RequestInit): Promise<Response> {
    let token = await user.getIdToken();
    let res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    // If 401, retry once with forced refreshed token
    if (res.status === 401) {
      token = await user.getIdToken(true);
      res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${token}`,
        },
      });
    }

    return res;
  }

  /**
   * Calls GET /api/v1/auth/me to validate Worker authentication
   * and idempotently synchronize user in D1 users table.
   */
  async getAuthMe(user: User): Promise<AuthMeResponse> {
    try {
      const res = await this.apiFetchAuthenticated(user, '/auth/me');
      return await res.json();
    } catch (err) {
      console.warn('[ApiService] /api/v1/auth/me call error:', err);
      return { ok: false, code: 'NETWORK_ERROR' };
    }
  }

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
   * List all contracts or fetch specific contract
   */
  async getContracts(): Promise<ApiResponse<ContractConfig[]>> {
    const res = await fetch(`${this.baseUrl}/contracts`);
    return res.json();
  }

  async getContract(id: string): Promise<ApiResponse<ContractConfig>> {
    const res = await fetch(`${this.baseUrl}/contracts/${id}`);
    return res.json();
  }

  /**
   * Create a new contract
   */
  async createContract(contract: Partial<ContractConfig>): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/contracts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contract),
    });
    return res.json();
  }

  /**
   * Update existing contract
   */
  async updateContract(id: string, contract: Partial<ContractConfig>): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/contracts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contract),
    });
    return res.json();
  }

  /**
   * List transactions for a contract
   */
  async getTransactions(contractId: string): Promise<ApiResponse<Transaction[]>> {
    const res = await fetch(`${this.baseUrl}/transactions?contractId=${encodeURIComponent(contractId)}`);
    return res.json();
  }

  /**
   * Create a transaction
   */
  async createTransaction(transaction: Partial<Transaction> & { contractId: string }): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transaction),
    });
    return res.json();
  }

  /**
   * Delete a transaction
   */
  async deleteTransaction(id: string, contractId?: string): Promise<ApiResponse> {
    const url = contractId 
      ? `${this.baseUrl}/transactions?id=${encodeURIComponent(id)}&contractId=${encodeURIComponent(contractId)}`
      : `${this.baseUrl}/transactions?id=${encodeURIComponent(id)}`;
    const res = await fetch(url, { method: 'DELETE' });
    return res.json();
  }
}

export const apiService = new ApiService();

// Lightweight background synchronization with D1 users on Firebase authentication
let lastSyncedUid: string | null = null;
if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, async (user) => {
    if (user && user.uid !== lastSyncedUid) {
      lastSyncedUid = user.uid;
      try {
        const result = await apiService.getAuthMe(user);
        if (result.ok) {
          console.log('[D1 Users] Synchronized authenticated user with D1:', result.user?.id);
        } else {
          console.warn('[D1 Users] Synchronization returned:', result);
        }
      } catch (err) {
        console.warn('[D1 Users] Synchronization error:', err);
      }
    } else if (!user) {
      lastSyncedUid = null;
    }
  });
}
