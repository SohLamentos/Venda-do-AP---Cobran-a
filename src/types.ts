export interface ContractConfig {
  id?: string;
  name?: string;
  propertyDescription?: string;
  financedAmount: number;
  fixedInstallment: number;
  annualInterestRate: number;
  termMonths: number;
  startDate: string;
  finePercent: number;
  trMode: 'MONTHLY' | 'ANNUAL';
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type TransactionType = 'PAYMENT' | 'LANCE';

export interface Transaction {
  id: string;
  contractId?: string;
  date: string;
  installmentNumber: number;
  amount: number;
  type: TransactionType;
  method: string;
  observation?: string;
  status: 'PAGO' | 'EM_ABERTO';
  createdAt?: string;
  receiptKey?: string; // Prepared for Cloudflare R2 bucket migration
  receiptUrl?: string; // Temporarily kept for compatibility if needed
  receiptBase64?: string;
  receiptMimeType?: string;
  receiptFileName?: string;
  createdBy?: string;
  createdByEmail?: string;
}

export interface AmortizationRow {
  installmentNumber: number;
  date: Date;
  previousBalance: number;
  monthTR: number | null;
  trCorrection: number;
  balanceAfterTR: number;
  interestAmount: number;
  amortizationAmount: number;
  contractedInstallment: number;
  paymentDone: number;
  lanceApplied: number;
  openDifference: number;
  penalty: number;
  finalBalance: number;
  status: 'PAGO' | 'EM_ABERTO' | 'ATRASO' | 'QUITADO';
}

export interface BCBTRPoint {
  data: string; // dd/MM/yyyy
  valor: string; // daily rate
}

export type UserRole = 'ADMIN' | 'SELLER' | 'BUYER';
export type UserStatus = 'ACTIVE' | 'DISABLED';

export interface CloudflareUser {
  id: string;
  login: string;
  email?: string | null;
  name: string | null;
  role: UserRole;
  status?: UserStatus;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string | null;
}
