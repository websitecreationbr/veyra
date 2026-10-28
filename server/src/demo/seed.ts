// ================================================================================================
// DADOS DE DEMONSTRAÇÃO — camada separada do restante do produto.
// Tudo o que é criado aqui é gravado com source = 'demo' e pode ser removido de uma vez, sem tocar nos dados
// reais do usuário. O app mostra um aviso enquanto houver dados de demonstração ativos.
// Só roda quando o usuário pede (botão em "Mais" ou `npm run seed`). Nunca é carregado automaticamente.
// ================================================================================================

import { randomUUID } from "node:crypto";
import { run, tx } from "../db/index.js";
import type { Ctx } from "../services/context.js";
import * as fin from "../services/finance.js";
import * as ag from "../services/agenda.js";
import { addDays } from "../util/time.js";

export function removeDemo(ctx: Ctx): void {
  tx(ctx.db, () => {
    for (const table of ["transactions", "tasks", "reminders", "events", "habits"]) {
      run(ctx.db, `DELETE FROM ${table} WHERE user_id = ? AND source = 'demo'`, ctx.userId);
    }
  });
}

export function loadDemo(ctx: Ctx): void {
  removeDemo(ctx);
  const today = ctx.now.date;
  const d = (n: number) => addDays(today, n);
  const exp = (cents: number, category: string, description: string, daysAgo: number) =>
    fin.addTransaction(ctx, { kind: "expense", amountCents: cents, category, description, date: d(-daysAgo), source: "demo" });
  const inc = (cents: number, category: string, description: string, daysAgo: number) =>
    fin.addTransaction(ctx, { kind: "income", amountCents: cents, category, description, date: d(-daysAgo), source: "demo" });

  tx(ctx.db, () => {
    inc(450000, "Salário", "Salário", 35);
    inc(450000, "Salário", "Salário", 5);
    inc(120000, "Freelance", "Projeto de site", 12);
    const spending: [number, string, string, number][] = [
      [32000, "Mercado", "Supermercado", 2], [4700, "Mercado", "Feira", 9], [18000, "Mercado", "Supermercado", 16], [27500, "Mercado", "Supermercado", 24],
      [2500, "Alimentação", "Almoço", 1], [4200, "Alimentação", "Jantar", 4], [3800, "Alimentação", "iFood", 8], [6500, "Alimentação", "Restaurante", 13], [2900, "Alimentação", "Almoço", 20],
      [8000, "Transporte", "Combustível", 3], [11000, "Transporte", "Combustível", 15], [2400, "Transporte", "Uber", 7], [9000, "Transporte", "Combustível", 28],
      [120000, "Moradia", "Aluguel", 6], [120000, "Moradia", "Aluguel", 36], [9800, "Moradia", "Internet", 10],
      [5500, "Lazer", "Cinema", 11], [3990, "Lazer", "Netflix", 14], [15000, "Saúde", "Farmácia", 18], [22000, "Compras", "Tênis", 22],
    ];
    for (const [c, cat, desc, ago] of spending) exp(c, cat, desc, ago);

    ag.addEvent(ctx, { title: "Estudar", date: today, time: "09:00", source: "demo" });
    ag.addReminder(ctx, { title: "Ligar para João", date: today, time: "14:30", source: "demo" });
    ag.addEvent(ctx, { title: "Treino", date: today, time: "18:30", recurrence: "weekdays", source: "demo" });
    ag.addEvent(ctx, { title: "Dentista", date: d(2), time: "15:00", source: "demo" });
    ag.addReminder(ctx, { title: "Beber água", date: today, time: "07:00", recurrence: "daily", source: "demo" });
    ag.addTask(ctx, { title: "Renovar seguro do carro", date: d(3), source: "demo" });
    ag.addTask(ctx, { title: "Ler capítulo 4", source: "demo" });

    const habitId = randomUUID();
    run(ctx.db, "INSERT INTO habits (id, user_id, name, icon, source) VALUES (?,?,?,?,?)", habitId, ctx.userId, "Treino", "💪", "demo");
    for (const ago of [0, 1, 2, 3, 5, 6, 8, 9, 10, 12]) {
      run(ctx.db, "INSERT INTO habit_logs (id, habit_id, user_id, log_date) VALUES (?,?,?,?)", randomUUID(), habitId, ctx.userId, d(-ago));
    }
  });
}
