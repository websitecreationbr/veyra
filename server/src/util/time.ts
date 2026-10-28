// Datas "de parede" (wall-clock) no fuso do usuário.
// Datas são strings 'YYYY-MM-DD' e horas 'HH:mm'. Isso evita bugs de fuso em agenda/lembretes
// e mantém o banco legível. O "agora" é sempre injetado (Clock) para os testes serem determinísticos.

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export const DEFAULT_TZ = "America/Sao_Paulo";

export interface LocalNow {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  dow: number; // 0 = domingo
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localNow(clock: Clock, tz: string): LocalNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(clock.now());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { date, time: `${get("hour")}:${get("minute")}`, dow: dayOfWeek(date) };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

export function isTime(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function toUTC(date: string): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Data inválida: ${date}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
}
function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

export function addMonths(date: string, n: number): string {
  const d = toUTC(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return fromUTC(d);
}

export function dayOfWeek(date: string): number {
  return toUTC(date).getUTCDay();
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

export function startOfMonth(date: string): string {
  return date.slice(0, 8) + "01";
}
export function endOfMonth(date: string): string {
  const d = toUTC(date);
  return fromUTC(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}
/** Segunda-feira da semana que contém `date`. */
export function startOfWeek(date: string): string {
  const dow = dayOfWeek(date);
  return addDays(date, -((dow + 6) % 7));
}

export type Period = "hoje" | "ontem" | "semana" | "mes" | "mes_passado" | "30_dias" | "ano" | "tudo";
export const PERIODS: Period[] = ["hoje", "ontem", "semana", "mes", "mes_passado", "30_dias", "ano", "tudo"];

export interface Range {
  from: string;
  to: string; // inclusivo
  label: string;
}

export function periodRange(period: Period, today: string): Range {
  switch (period) {
    case "hoje":
      return { from: today, to: today, label: "hoje" };
    case "ontem": {
      const y = addDays(today, -1);
      return { from: y, to: y, label: "ontem" };
    }
    case "semana":
      return { from: startOfWeek(today), to: addDays(startOfWeek(today), 6), label: "esta semana" };
    case "mes":
      return { from: startOfMonth(today), to: endOfMonth(today), label: "este mês" };
    case "mes_passado": {
      const prev = addMonths(startOfMonth(today), -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev), label: "no mês passado" };
    }
    case "30_dias":
      return { from: addDays(today, -29), to: today, label: "nos últimos 30 dias" };
    case "ano":
      return { from: today.slice(0, 4) + "-01-01", to: today.slice(0, 4) + "-12-31", label: "este ano" };
    case "tudo":
      return { from: "0000-01-01", to: "9999-12-31", label: "no total" };
  }
}

const DOW_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const DOW_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "Hoje", "Amanhã", "Ontem" ou "qui, 29 out". */
export function humanDate(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  const d = toUTC(date);
  return `${DOW_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** Versão em minúsculas para usar no meio de frases: "hoje", "amanhã", "quinta, 29 out". */
export function humanDateInline(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff >= 0 && diff <= 1) return humanDate(date, today).toLowerCase();
  if (diff === -1) return "ontem";
  const d = toUTC(date);
  const name = diff > 1 && diff < 7 ? DOW_NAMES[d.getUTCDay()]! : DOW_SHORT[d.getUTCDay()]!;
  return `${name}, ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

// ---------- Recorrência ----------
// 'daily' | 'weekdays' | 'weekly:1,3' (0=dom) | 'monthly:15'
export type Recurrence = string;

export function isRecurrence(r: unknown): r is Recurrence {
  if (typeof r !== "string") return false;
  if (r === "daily" || r === "weekdays") return true;
  if (/^weekly:[0-6](,[0-6])*$/.test(r)) return true;
  const m = /^monthly:(\d{1,2})$/.exec(r);
  return !!m && +m[1]! >= 1 && +m[1]! <= 31;
}

export function occursOn(rule: Recurrence | null, startDate: string, date: string): boolean {
  if (!rule) return date === startDate;
  if (date < startDate) return false;
  if (rule === "daily") return true;
  const dow = dayOfWeek(date);
  if (rule === "weekdays") return dow >= 1 && dow <= 5;
  if (rule.startsWith("weekly:")) return rule.slice(7).split(",").map(Number).includes(dow);
  if (rule.startsWith("monthly:")) {
    const want = Number(rule.slice(8));
    const last = Number(endOfMonth(date).slice(8));
    return Number(date.slice(8)) === Math.min(want, last);
  }
  return false;
}

export function describeRecurrence(rule: Recurrence): string {
  if (rule === "daily") return "todo dia";
  if (rule === "weekdays") return "de segunda a sexta";
  if (rule.startsWith("weekly:")) {
    const days = rule.slice(7).split(",").map(Number);
    if (days.length === 1) return `toda ${DOW_NAMES[days[0]!]}`;
    return "toda " + days.map((d) => DOW_NAMES[d]).join(", ").replace(/, ([^,]*)$/, " e $1");
  }
  if (rule.startsWith("monthly:")) return `todo dia ${rule.slice(8)} do mês`;
  return rule;
}
