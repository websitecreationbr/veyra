const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const nb = (s: string) => s.replace(/ /g, " ");

/** 4700 → "R$ 47,00" */
export const brl = (cents: number) => nb(BRL.format(cents / 100));
/** Sem centavos quando redondo: 124000 → "R$ 1.240" */
export const brlShort = (cents: number) => (cents % 100 === 0 ? `R$ ${NUM0.format(cents / 100)}` : brl(cents));
/** "+ R$ 1.500" / "− R$ 47" — o sinal faz parte do texto (acessível sem depender de cor). */
export const signed = (cents: number, kind: "income" | "expense") => `${kind === "income" ? "+" : "−"} ${brlShort(Math.abs(cents))}`;

const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DOW_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTH_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const utc = (d: string) => { const [y, m, day] = d.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, day)); };
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
export const diffDays = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);
export const dowOf = (d: string) => utc(d).getUTCDay();
export const dayNum = (d: string) => utc(d).getUTCDate();
export const monthName = (d: string) => MONTH_LONG[utc(d).getUTCMonth()]!;
export const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
export const startOfMonth = (d: string) => d.slice(0, 8) + "01";
export const endOfMonth = (d: string) => iso(new Date(Date.UTC(utc(d).getUTCFullYear(), utc(d).getUTCMonth() + 1, 0)));
export const addMonths = (d: string, n: number) => { const x = utc(startOfMonth(d)); x.setUTCMonth(x.getUTCMonth() + n); return iso(x); };
export const startOfWeek = (d: string) => addDays(d, -((dowOf(d) + 6) % 7));

/** "Hoje", "Amanhã", "Ontem" ou "qui, 29 out". */
export function humanDate(date: string, today: string): string {
  const n = diffDays(today, date);
  if (n === 0) return "Hoje";
  if (n === 1) return "Amanhã";
  if (n === -1) return "Ontem";
  const d = utc(date);
  return `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}
export function longDate(date: string): string {
  const d = utc(date);
  return `${DOW_LONG[d.getUTCDay()]}, ${d.getUTCDate()} de ${MONTH_LONG[d.getUTCMonth()]}`;
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

const REC_DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export function describeRecurrence(r: string): string {
  if (r === "daily") return "todo dia";
  if (r === "weekdays") return "seg a sex";
  if (r.startsWith("weekly:")) return r.slice(7).split(",").map((n) => REC_DOW[+n]!.slice(0, 3)).join(", ");
  if (r.startsWith("monthly:")) return `todo dia ${r.slice(8)}`;
  return r;
}
