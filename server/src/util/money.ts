// Dinheiro é sempre guardado em centavos (inteiro) — nunca float.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const BRL_COMPACT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** 4700 -> "R$ 47,00" (com espaço comum, não NBSP, para ficar bonito em texto). */
export function brl(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, " ");
}

/** Sem centavos quando redondo: 124000 -> "R$ 1.240"; 4710 -> "R$ 47,10". */
export function brlShort(cents: number): string {
  if (cents % 100 === 0) return "R$ " + BRL_COMPACT.format(cents / 100);
  return brl(cents);
}

/** Converte um número em reais (como a IA ou o usuário informam) em centavos. */
export function reaisToCents(reais: number): number {
  return Math.round(reais * 100);
}

/**
 * Lê um valor escrito em português: "1.500", "1.500,50", "47", "47,9", "R$ 80", "30 reais".
 * Retorna centavos ou null.
 */
export function parseBrMoney(raw: string): number | null {
  let s = raw.replace(/r\$/gi, "").replace(/reais|real|conto|pila/gi, "").trim();
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+(,\d{1,2})$/.test(s)) {
    s = s.replace(",", ".");
  } else if (/^\d+(\.\d{1,2})?$/.test(s)) {
    // "47" ou "47.5"
  } else {
    return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export const MAX_AMOUNT_CENTS = 100_000_000_00; // R$ 100 milhões — barreira contra erro de digitação/abuso
