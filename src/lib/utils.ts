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
 * Formats a number to Brazilian currency string with R$ symbol
 * Example: 5000 -> "R$ 5.000,00"
 */
export function formatBRL(value: number): string {
  const n = safeNumber(value);
  const formattedNumber = n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `R$ ${formattedNumber}`;
}

/**
 * Robust parser for Brazilian currency inputs.
 * Handles naturally typed user inputs:
 * "5000" -> 5000.00
 * "5.000" -> 5000.00
 * "5.000,00" -> 5000.00
 * "5000,50" -> 5000.50
 * "10.000,75" -> 10000.75
 * "R$ 5.000,00" -> 5000.00
 */
export function parseBRL(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : 0;
  }

  let s = String(value).trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!s) return 0;

  if (s.includes(",")) {
    // Padrão brasileiro com vírgula como separador decimal: remove milhares e converte vírgula
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(".")) {
    // Possui ponto e nenhuma vírgula. Se corresponder ao padrão de milhares (ex: "5.000" ou "10.000")
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, "");
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.round((n + Number.EPSILON) * 100) / 100) : 0;
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
