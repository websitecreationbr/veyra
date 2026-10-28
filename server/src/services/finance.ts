import { randomUUID } from "node:crypto";
import { all, get, run, type DB } from "../db/index.js";
import type { Ctx } from "./context.js";
import { MAX_AMOUNT_CENTS } from "../util/money.js";
import { addDays, daysBetween, isDate, periodRange, type Period, type Range } from "../util/time.js";
import { bad } from "../util/validate.js";
import { capitalize, norm } from "../util/text.js";

export type Kind = "expense" | "income";

export interface Category {
  id: string;
  name: string;
  kind: Kind;
  icon: string;
}
export interface Transaction {
  id: string;
  kind: Kind;
  amountCents: number;
  description: string;
  date: string;
  category: { id: string; name: string; icon: string } | null;
  source: "user" | "demo";
}

export const DEFAULT_CATEGORIES: { name: string; kind: Kind; icon: string }[] = [
  { name: "Mercado", kind: "expense", icon: "🛒" },
  { name: "Alimentação", kind: "expense", icon: "🍔" },
  { name: "Transporte", kind: "expense", icon: "🚗" },
  { name: "Moradia", kind: "expense", icon: "🏠" },
  { name: "Contas", kind: "expense", icon: "🧾" },
  { name: "Saúde", kind: "expense", icon: "💊" },
  { name: "Lazer", kind: "expense", icon: "🎬" },
  { name: "Educação", kind: "expense", icon: "📚" },
  { name: "Compras", kind: "expense", icon: "🛍️" },
  { name: "Outros", kind: "expense", icon: "•" },
  { name: "Salário", kind: "income", icon: "💼" },
  { name: "Freelance", kind: "income", icon: "🧑‍💻" },
  { name: "Investimentos", kind: "income", icon: "📈" },
  { name: "Outras receitas", kind: "income", icon: "•" },
];

export const ADJUST_CATEGORY = "Ajuste de saldo";

export function seedDefaultCategories(db: DB, userId: string): void {
  for (const c of DEFAULT_CATEGORIES) {
    run(db, "INSERT OR IGNORE INTO categories (id, user_id, name, kind, icon) VALUES (?,?,?,?,?)", randomUUID(), userId, c.name, c.kind, c.icon);
  }
}

export function listCategories(ctx: Ctx, kind?: Kind): Category[] {
  return all<Category>(
    ctx.db,
    `SELECT id, name, kind, icon FROM categories WHERE user_id = ? ${kind ? "AND kind = ?" : ""} ORDER BY name`,
    ...(kind ? [ctx.userId, kind] : [ctx.userId]),
  );
}

/** Acha a categoria pelo nome (sem acento/caixa) ou cria uma nova para o usuário. Nunca cruza usuários. */
export function resolveCategory(ctx: Ctx, kind: Kind, name: string | undefined): Category | null {
  if (!name || !name.trim()) return null;
  const wanted = norm(name);
  const existing = listCategories(ctx, kind).find((c) => norm(c.name) === wanted);
  if (existing) return existing;
  const clean = capitalize(name.trim()).slice(0, 40);
  const id = randomUUID();
  run(ctx.db, "INSERT INTO categories (id, user_id, name, kind, icon) VALUES (?,?,?,?,?)", id, ctx.userId, clean, kind, "•");
  return { id, name: clean, kind, icon: "•" };
}

export interface NewTransaction {
  kind: Kind;
  amountCents: number;
  category?: string;
  description?: string;
  date?: string;
  source?: "user" | "demo";
}

export function addTransaction(ctx: Ctx, input: NewTransaction): Transaction {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw bad("O valor precisa ser maior que zero.");
  if (input.amountCents > MAX_AMOUNT_CENTS) throw bad("Esse valor é alto demais para registrar.");
  const date = input.date ?? ctx.now.date;
  if (!isDate(date)) throw bad("Data inválida.");
  const cat = resolveCategory(ctx, input.kind, input.category ?? (input.kind === "expense" ? "Outros" : "Outras receitas"));
  const id = randomUUID();
  run(
    ctx.db,
    "INSERT INTO transactions (id, user_id, kind, amount_cents, category_id, description, occurred_on, source) VALUES (?,?,?,?,?,?,?,?)",
    id, ctx.userId, input.kind, input.amountCents, cat?.id ?? null, (input.description ?? "").trim().slice(0, 120), date, input.source ?? "user",
  );
  return getTransaction(ctx, id)!;
}

interface TxRow {
  id: string;
  kind: Kind;
  amount_cents: number;
  description: string;
  occurred_on: string;
  source: "user" | "demo";
  cat_id: string | null;
  cat_name: string | null;
  cat_icon: string | null;
}
const TX_SELECT = `SELECT t.id, t.kind, t.amount_cents, t.description, t.occurred_on, t.source,
  c.id AS cat_id, c.name AS cat_name, c.icon AS cat_icon
  FROM transactions t LEFT JOIN categories c ON c.id = t.category_id`;

const toTx = (r: TxRow): Transaction => ({
  id: r.id,
  kind: r.kind,
  amountCents: r.amount_cents,
  description: r.description,
  date: r.occurred_on,
  category: r.cat_id ? { id: r.cat_id, name: r.cat_name!, icon: r.cat_icon! } : null,
  source: r.source,
});

export function getTransaction(ctx: Ctx, id: string): Transaction | undefined {
  const r = get<TxRow>(ctx.db, `${TX_SELECT} WHERE t.user_id = ? AND t.id = ?`, ctx.userId, id);
  return r ? toTx(r) : undefined;
}

export function deleteTransaction(ctx: Ctx, id: string): boolean {
  return run(ctx.db, "DELETE FROM transactions WHERE user_id = ? AND id = ?", ctx.userId, id).changes > 0;
}

export function listTransactions(
  ctx: Ctx,
  opts: { range?: Range; kind?: Kind; category?: string; limit?: number; offset?: number } = {},
): Transaction[] {
  const r = opts.range ?? periodRange("tudo", ctx.now.date);
  const params: unknown[] = [ctx.userId, r.from, r.to];
  let where = "t.user_id = ? AND t.occurred_on BETWEEN ? AND ?";
  if (opts.kind) { where += " AND t.kind = ?"; params.push(opts.kind); }
  if (opts.category) { where += " AND c.name = ? COLLATE NOCASE"; params.push(opts.category); }
  params.push(Math.min(opts.limit ?? 50, 200), opts.offset ?? 0);
  return all<TxRow>(
    ctx.db,
    `${TX_SELECT} WHERE ${where} ORDER BY t.occurred_on DESC, t.created_at DESC, t.rowid DESC LIMIT ? OFFSET ?`,
    ...params,
  ).map(toTx);
}

export function totals(ctx: Ctx, range: Range): { income: number; expense: number; count: number } {
  const rows = all<{ kind: Kind; total: number; n: number }>(
    ctx.db,
    `SELECT kind, COALESCE(SUM(amount_cents),0) AS total, COUNT(*) AS n FROM transactions
     WHERE user_id = ? AND occurred_on BETWEEN ? AND ? GROUP BY kind`,
    ctx.userId, range.from, range.to,
  );
  const income = rows.find((r) => r.kind === "income")?.total ?? 0;
  const expense = rows.find((r) => r.kind === "expense")?.total ?? 0;
  return { income, expense, count: rows.reduce((a, r) => a + r.n, 0) };
}

/** Saldo atual = tudo que entrou até hoje − tudo que saiu até hoje. (Lançamentos futuros não contam.) */
export function balance(ctx: Ctx): number {
  const t = totals(ctx, { from: "0000-01-01", to: ctx.now.date, label: "" });
  return t.income - t.expense;
}

export interface CategoryTotal {
  name: string;
  icon: string;
  totalCents: number;
  share: number; // 0..1
}

export function expensesByCategory(ctx: Ctx, range: Range): CategoryTotal[] {
  const rows = all<{ name: string | null; icon: string | null; total: number }>(
    ctx.db,
    `SELECT c.name AS name, c.icon AS icon, SUM(t.amount_cents) AS total
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.kind = 'expense' AND t.occurred_on BETWEEN ? AND ?
       AND COALESCE(c.name,'') <> ?
     GROUP BY t.category_id ORDER BY total DESC`,
    ctx.userId, range.from, range.to, ADJUST_CATEGORY,
  );
  const sum = rows.reduce((a, r) => a + r.total, 0) || 1;
  return rows.map((r) => ({ name: r.name ?? "Sem categoria", icon: r.icon ?? "•", totalCents: r.total, share: r.total / sum }));
}

export function biggestExpense(ctx: Ctx, range: Range): Transaction | undefined {
  const r = get<TxRow>(
    ctx.db,
    `${TX_SELECT} WHERE t.user_id = ? AND t.kind = 'expense' AND t.occurred_on BETWEEN ? AND ?
       AND COALESCE(c.name,'') <> ? ORDER BY t.amount_cents DESC, t.occurred_on DESC LIMIT 1`,
    ctx.userId, range.from, range.to, ADJUST_CATEGORY,
  );
  return r ? toTx(r) : undefined;
}

/** Despesas "reais" (sem ajustes de saldo) — usadas em comparações e projeções. */
export function realExpenses(ctx: Ctx, range: Range): number {
  const r = get<{ total: number }>(
    ctx.db,
    `SELECT COALESCE(SUM(t.amount_cents),0) AS total FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.kind = 'expense' AND t.occurred_on BETWEEN ? AND ? AND COALESCE(c.name,'') <> ?`,
    ctx.userId, range.from, range.to, ADJUST_CATEGORY,
  );
  return r?.total ?? 0;
}

export function realIncome(ctx: Ctx, range: Range): number {
  const r = get<{ total: number }>(
    ctx.db,
    `SELECT COALESCE(SUM(t.amount_cents),0) AS total FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.kind = 'income' AND t.occurred_on BETWEEN ? AND ? AND COALESCE(c.name,'') <> ?`,
    ctx.userId, range.from, range.to, ADJUST_CATEGORY,
  );
  return r?.total ?? 0;
}

/** Compara o mesmo recorte do mês atual (1º até hoje) com o mesmo recorte do mês passado. */
export function monthOverMonth(ctx: Ctx): { currentCents: number; previousCents: number; changePct: number | null } {
  const today = ctx.now.date;
  const cur = periodRange("mes", today);
  const prevFull = periodRange("mes_passado", today);
  const dayN = Number(today.slice(8));
  const prevTo = addDays(prevFull.from, Math.min(dayN, Number(prevFull.to.slice(8))) - 1);
  const currentCents = realExpenses(ctx, { from: cur.from, to: today, label: "" });
  const previousCents = realExpenses(ctx, { from: prevFull.from, to: prevTo, label: "" });
  return { currentCents, previousCents, changePct: previousCents > 0 ? ((currentCents - previousCents) / previousCents) * 100 : null };
}

export interface Projection {
  enough: boolean;
  balanceCents: number;
  monthlySpendCents?: number;
  monthsLeft?: number;
  weeklyBudgetCents?: number;
  basisDays?: number;
}

/**
 * Estimativa de ritmo de gasto. Usa os últimos 30 dias; se o histórico for mais curto,
 * extrapola (mínimo de 7 dias de dados). É sempre uma ESTIMATIVA.
 */
export function projection(ctx: Ctx): Projection {
  const bal = balance(ctx);
  const first = get<{ d: string | null }>(
    ctx.db,
    `SELECT MIN(t.occurred_on) AS d FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.kind = 'expense' AND COALESCE(c.name,'') <> ?`,
    ctx.userId, ADJUST_CATEGORY,
  )?.d;
  if (!first) return { enough: false, balanceCents: bal };
  const spanDays = Math.min(30, daysBetween(first, ctx.now.date) + 1);
  if (spanDays < 7) return { enough: false, balanceCents: bal, basisDays: spanDays };
  const spent = realExpenses(ctx, { from: addDays(ctx.now.date, -(spanDays - 1)), to: ctx.now.date, label: "" });
  const monthly = Math.round((spent / spanDays) * 30);
  const end = periodRange("mes", ctx.now.date).to;
  const daysLeft = Math.max(1, daysBetween(ctx.now.date, end) + 1);
  return {
    enough: monthly > 0,
    balanceCents: bal,
    monthlySpendCents: monthly,
    monthsLeft: monthly > 0 ? bal / monthly : undefined,
    weeklyBudgetCents: Math.round(bal / (daysLeft / 7)),
    basisDays: spanDays,
  };
}

/** Faz o saldo atual ficar igual ao valor informado, criando um lançamento de ajuste transparente. */
export function adjustBalance(ctx: Ctx, targetCents: number): { diffCents: number; tx?: Transaction } {
  const diff = targetCents - balance(ctx);
  if (diff === 0) return { diffCents: 0 };
  const t = addTransaction(ctx, {
    kind: diff > 0 ? "income" : "expense",
    amountCents: Math.abs(diff),
    category: ADJUST_CATEGORY,
    description: "Ajuste para o saldo informado",
  });
  return { diffCents: diff, tx: t };
}

export function periodRangeOf(p: Period, ctx: Ctx): Range {
  return periodRange(p, ctx.now.date);
}
