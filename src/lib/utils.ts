import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  const n = safeNumber(value);
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/**
 * Formats a number to BR currency string without currency symbol for inputs
 */
export function formatCurrencyInput(value: number): string {
  const n = safeNumber(value);
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Parses a BR formatted string or raw digits to a decimal number (dividing by 100)
 */
export function parseCurrencyBR(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  const stringValue = String(value);
  const onlyDigits = stringValue.replace(/\D/g, "");
  if (!onlyDigits) return 0;
  return Number(onlyDigits) / 100;
}

export function formatPercent(value: number): string {
  const n = safeNumber(value);
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n / 100);
}

export function parseBCBRate(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  const s = String(value).replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? 0 : n / 100;
}

export function safeNumber(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "string") {
    // Remove formatting and normalize decimal
    const normalized = value
      .replace("R$", "")
      .replace(/\./g, "")
      .replace(",", ".")
      .trim();
    return Number(normalized) || 0;
  }
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

export function safeDate(value: any): Date {
  const date = new Date(value);
  if (isNaN(date.getTime())) return new Date();
  return date;
}

export function round2(value: any): number {
  const n = safeNumber(value);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
