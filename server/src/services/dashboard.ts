import { get } from "../db/index.js";
import type { Ctx } from "./context.js";
import * as fin from "./finance.js";
import * as ag from "./agenda.js";
import * as hb from "./habits.js";
import { periodRange } from "../util/time.js";

export async function dashboard(ctx: Ctx) {
  const month = periodRange("mes", ctx.now.date);
  const items = (await ag.agenda(ctx, ctx.now.date, ctx.now.date)).filter((i) => !i.done);
  const habits = await hb.listHabits(ctx);
  const habit = [...habits].sort((a, b) => b.currentStreak - a.currentStreak)[0] ?? null;
  const txCount = (await fin.totals(ctx, periodRange("tudo", ctx.now.date))).count;
  const demo = await get<{ n: number }>(
    ctx.db,
    `SELECT (SELECT COUNT(*) FROM transactions WHERE user_id = ? AND source = 'demo')
          + (SELECT COUNT(*) FROM events WHERE user_id = ? AND source = 'demo')
          + (SELECT COUNT(*) FROM reminders WHERE user_id = ? AND source = 'demo')
          + (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND source = 'demo')
          + (SELECT COUNT(*) FROM habits WHERE user_id = ? AND source = 'demo') AS n`,
    ctx.userId, ctx.userId, ctx.userId, ctx.userId, ctx.userId,
  );
  return {
    today: ctx.now.date,
    balanceCents: await fin.balance(ctx),
    monthExpenseCents: await fin.realExpenses(ctx, { from: month.from, to: ctx.now.date, label: "" }),
    monthIncomeCents: await fin.realIncome(ctx, { from: month.from, to: ctx.now.date, label: "" }),
    hasTransactions: txCount > 0,
    agendaToday: items,
    overdueCount: (await ag.overdueTasks(ctx)).length,
    habit: habit ? { id: habit.id, name: habit.name, streak: habit.currentStreak, doneToday: habit.doneToday } : null,
    demoActive: (demo?.n ?? 0) > 0,
  };
}
