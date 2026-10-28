import { randomUUID } from "node:crypto";
import { all, get, run } from "../db/index.js";
import type { Ctx } from "./context.js";
import { addDays } from "../util/time.js";
import { norm, capitalize } from "../util/text.js";

export interface Habit {
  id: string;
  name: string;
  icon: string;
  currentStreak: number;
  bestStreak: number;
  doneToday: boolean;
  last7: boolean[]; // do mais antigo (6 dias atrás) ao mais novo (hoje)
  frequency30: number; // 0..1
  totalDays: number;
}

export function streaks(dates: string[], today: string): { current: number; best: number } {
  const set = new Set(dates);
  // sequência atual: termina hoje ou ontem (se ainda não registrou hoje, não quebra)
  let cursor = set.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (set.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  const sorted = [...set].sort();
  let best = 0, run_ = 0, prev = "";
  for (const d of sorted) {
    run_ = prev && addDays(prev, 1) === d ? run_ + 1 : 1;
    best = Math.max(best, run_);
    prev = d;
  }
  return { current, best };
}

export function listHabits(ctx: Ctx): Habit[] {
  const habits = all<{ id: string; name: string; icon: string }>(ctx.db,
    "SELECT id, name, icon FROM habits WHERE user_id = ? AND archived = 0 ORDER BY created_at", ctx.userId);
  return habits.map((h) => {
    const dates = all<{ log_date: string }>(ctx.db, "SELECT log_date FROM habit_logs WHERE user_id = ? AND habit_id = ?", ctx.userId, h.id).map((r) => r.log_date);
    const set = new Set(dates);
    const { current, best } = streaks(dates, ctx.now.date);
    const last7 = Array.from({ length: 7 }, (_, i) => set.has(addDays(ctx.now.date, i - 6)));
    const last30 = Array.from({ length: 30 }, (_, i) => set.has(addDays(ctx.now.date, -i))).filter(Boolean).length;
    return { ...h, currentStreak: current, bestStreak: best, doneToday: set.has(ctx.now.date), last7, frequency30: last30 / 30, totalDays: dates.length };
  });
}

export function findHabit(ctx: Ctx, name: string): { id: string; name: string } | undefined {
  const wanted = norm(name);
  return all<{ id: string; name: string }>(ctx.db, "SELECT id, name FROM habits WHERE user_id = ? AND archived = 0", ctx.userId)
    .find((h) => norm(h.name) === wanted);
}

/** Registra o hábito no dia (cria o hábito se ele ainda não existir — menos perguntas para o usuário). */
export function logHabit(ctx: Ctx, name: string, date?: string, icon = "•"): { habit: { id: string; name: string }; created: boolean; alreadyLogged: boolean } {
  let habit = findHabit(ctx, name);
  let created = false;
  if (!habit) {
    const id = randomUUID();
    const clean = capitalize(name.trim()).slice(0, 40);
    run(ctx.db, "INSERT INTO habits (id, user_id, name, icon) VALUES (?,?,?,?)", id, ctx.userId, clean, icon);
    habit = { id, name: clean };
    created = true;
  }
  const d = date ?? ctx.now.date;
  const exists = get(ctx.db, "SELECT 1 AS x FROM habit_logs WHERE habit_id = ? AND log_date = ?", habit.id, d);
  if (!exists) run(ctx.db, "INSERT INTO habit_logs (id, habit_id, user_id, log_date) VALUES (?,?,?,?)", randomUUID(), habit.id, ctx.userId, d);
  return { habit, created, alreadyLogged: !!exists };
}

export function unlogHabit(ctx: Ctx, habitId: string, date: string): boolean {
  return run(ctx.db, "DELETE FROM habit_logs WHERE user_id = ? AND habit_id = ? AND log_date = ?", ctx.userId, habitId, date).changes > 0;
}

export function deleteHabit(ctx: Ctx, habitId: string): boolean {
  return run(ctx.db, "DELETE FROM habits WHERE user_id = ? AND id = ?", ctx.userId, habitId).changes > 0;
}
