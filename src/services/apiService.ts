/**
 * Cloudflare Worker API Service
 * 
 * Provides unified access to /api/v1 endpoints served by the Cloudflare Worker.
 * Used for transitioning persistence from Firebase to Cloudflare D1 and R2.
 */

import { ContractConfig, Transaction } from '../types';

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
