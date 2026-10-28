import { randomUUID } from "node:crypto";
import { all, get, run } from "../db/index.js";
import type { Ctx } from "./context.js";
import { addDays, daysBetween, isDate, isRecurrence, isTime, occursOn, type Recurrence } from "../util/time.js";
import { bad } from "../util/validate.js";

export type Priority = "baixa" | "normal" | "alta";
export type AgendaKind = "event" | "reminder" | "task";

export interface AgendaItem {
  key: string; // único na lista (id + data)
  id: string;
  kind: AgendaKind;
  title: string;
  date: string;
  time: string | null;
  endTime?: string | null;
  location?: string;
  recurrence: Recurrence | null;
  priority: Priority;
  done: boolean;
  source: "user" | "demo";
}

function checkWhen(date: string | undefined, time: string | undefined | null, recurrence: string | undefined | null) {
  if (date !== undefined && !isDate(date)) throw bad("Data inválida.");
  if (time !== undefined && time !== null && !isTime(time)) throw bad("Horário inválido (use HH:mm).");
  if (recurrence !== undefined && recurrence !== null && !isRecurrence(recurrence)) throw bad("Recorrência inválida.");
}
const cleanTitle = (t: string) => {
  const s = t.trim().replace(/\s+/g, " ");
  if (!s) throw bad("Dê um título.");
  return s.slice(0, 140);
};

// ---------- Tarefas ----------
export function addTask(ctx: Ctx, i: { title: string; date?: string; time?: string; priority?: Priority; source?: "user" | "demo" }) {
  checkWhen(i.date, i.time, undefined);
  const id = randomUUID();
  run(ctx.db, "INSERT INTO tasks (id, user_id, title, due_date, due_time, priority, source) VALUES (?,?,?,?,?,?,?)",
    id, ctx.userId, cleanTitle(i.title), i.date ?? null, i.time ?? null, i.priority ?? "normal", i.source ?? "user");
  return { id, title: cleanTitle(i.title), date: i.date ?? null, time: i.time ?? null };
}

export function setTaskDone(ctx: Ctx, id: string, done: boolean): boolean {
  return run(ctx.db, "UPDATE tasks SET done_at = ? WHERE user_id = ? AND id = ?", done ? new Date().toISOString() : null, ctx.userId, id).changes > 0;
}

/** Conclui a tarefa aberta cujo título contém o texto (ou a única tarefa aberta que combine). */
export function completeTaskByTitle(ctx: Ctx, text: string): { id: string; title: string } | "ambiguous" | undefined {
  const rows = all<{ id: string; title: string }>(ctx.db, "SELECT id, title FROM tasks WHERE user_id = ? AND done_at IS NULL", ctx.userId);
  const q = text.trim().toLowerCase();
  const hits = rows.filter((r) => r.title.toLowerCase().includes(q) || q.includes(r.title.toLowerCase()));
  if (hits.length === 0) return undefined;
  if (hits.length > 1) return "ambiguous";
  setTaskDone(ctx, hits[0]!.id, true);
  return hits[0]!;
}

// ---------- Lembretes ----------
export function addReminder(
  ctx: Ctx,
  i: { title: string; date?: string; time?: string; recurrence?: Recurrence; priority?: Priority; notes?: string; source?: "user" | "demo" },
) {
  checkWhen(i.date, i.time, i.recurrence);
  const date = i.date ?? ctx.now.date;
  const id = randomUUID();
  run(ctx.db, "INSERT INTO reminders (id, user_id, title, notes, remind_date, remind_time, recurrence, priority, source) VALUES (?,?,?,?,?,?,?,?,?)",
    id, ctx.userId, cleanTitle(i.title), (i.notes ?? "").slice(0, 500), date, i.time ?? null, i.recurrence ?? null, i.priority ?? "normal", i.source ?? "user");
  return { id, title: cleanTitle(i.title), date, time: i.time ?? null, recurrence: i.recurrence ?? null };
}

export function setReminderDone(ctx: Ctx, id: string, done: boolean): boolean {
  return run(ctx.db, "UPDATE reminders SET done_at = ? WHERE user_id = ? AND id = ?", done ? new Date().toISOString() : null, ctx.userId, id).changes > 0;
}

// ---------- Eventos ----------
export function addEvent(
  ctx: Ctx,
  i: { title: string; date?: string; time?: string; endTime?: string; location?: string; recurrence?: Recurrence; notes?: string; source?: "user" | "demo" },
) {
  checkWhen(i.date, i.time, i.recurrence);
  if (i.endTime !== undefined && !isTime(i.endTime)) throw bad("Horário final inválido.");
  const date = i.date ?? ctx.now.date;
  const id = randomUUID();
  run(ctx.db, "INSERT INTO events (id, user_id, title, notes, location, start_date, start_time, end_time, recurrence, source) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id, ctx.userId, cleanTitle(i.title), (i.notes ?? "").slice(0, 500), (i.location ?? "").slice(0, 120), date, i.time ?? null, i.endTime ?? null, i.recurrence ?? null, i.source ?? "user");
  return { id, title: cleanTitle(i.title), date, time: i.time ?? null, recurrence: i.recurrence ?? null };
}

// ---------- Remoção genérica (usada pelo "Desfazer") ----------
export type RecordKind = "transaction" | "task" | "reminder" | "event";
export const RECORD_TABLE: Record<RecordKind, string> = {
  transaction: "transactions",
  task: "tasks",
  reminder: "reminders",
  event: "events",
};
export function deleteRecord(ctx: Ctx, kind: RecordKind, id: string): boolean {
  const table = RECORD_TABLE[kind]; // valor vem de um mapa fixo — nunca de entrada do usuário
  return run(ctx.db, `DELETE FROM ${table} WHERE user_id = ? AND id = ?`, ctx.userId, id).changes > 0;
}

// ---------- Leitura da agenda ----------
interface EventRow { id: string; title: string; location: string; start_date: string; start_time: string | null; end_time: string | null; recurrence: string | null; source: "user" | "demo" }
interface ReminderRow { id: string; title: string; remind_date: string; remind_time: string | null; recurrence: string | null; priority: Priority; done_at: string | null; source: "user" | "demo" }
interface TaskRow { id: string; title: string; due_date: string | null; due_time: string | null; priority: Priority; done_at: string | null; source: "user" | "demo" }

const MAX_SPAN_DAYS = 400;

/** Agenda unificada (eventos + lembretes + tarefas com data) entre duas datas, com recorrências expandidas. */
export function agenda(ctx: Ctx, from: string, to: string): AgendaItem[] {
  if (!isDate(from) || !isDate(to) || to < from) throw bad("Período inválido.");
  if (daysBetween(from, to) > MAX_SPAN_DAYS) throw bad("Período grande demais.");
  const items: AgendaItem[] = [];

  const events = all<EventRow>(ctx.db,
    "SELECT id, title, location, start_date, start_time, end_time, recurrence, source FROM events WHERE user_id = ? AND start_date <= ?", ctx.userId, to);
  const reminders = all<ReminderRow>(ctx.db,
    "SELECT id, title, remind_date, remind_time, recurrence, priority, done_at, source FROM reminders WHERE user_id = ? AND remind_date <= ?", ctx.userId, to);

  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const e of events) {
      if (occursOn(e.recurrence, e.start_date, d))
        items.push({ key: `e:${e.id}:${d}`, id: e.id, kind: "event", title: e.title, date: d, time: e.start_time, endTime: e.end_time, location: e.location, recurrence: e.recurrence, priority: "normal", done: false, source: e.source });
    }
    for (const r of reminders) {
      if (occursOn(r.recurrence, r.remind_date, d))
        items.push({ key: `r:${r.id}:${d}`, id: r.id, kind: "reminder", title: r.title, date: d, time: r.remind_time, recurrence: r.recurrence, priority: r.priority, done: !r.recurrence && !!r.done_at, source: r.source });
    }
  }

  const tasks = all<TaskRow>(ctx.db,
    "SELECT id, title, due_date, due_time, priority, done_at, source FROM tasks WHERE user_id = ? AND due_date BETWEEN ? AND ?", ctx.userId, from, to);
  for (const t of tasks)
    items.push({ key: `t:${t.id}`, id: t.id, kind: "task", title: t.title, date: t.due_date!, time: t.due_time, recurrence: null, priority: t.priority, done: !!t.done_at, source: t.source });

  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.title.localeCompare(b.title));
}

/** Tarefas abertas sem data — aparecem numa seção própria na Agenda. */
export function undatedTasks(ctx: Ctx): AgendaItem[] {
  return all<TaskRow>(ctx.db,
    "SELECT id, title, due_date, due_time, priority, done_at, source FROM tasks WHERE user_id = ? AND due_date IS NULL AND done_at IS NULL ORDER BY created_at DESC LIMIT 50", ctx.userId)
    .map((t) => ({ key: `t:${t.id}`, id: t.id, kind: "task" as const, title: t.title, date: "", time: null, recurrence: null, priority: t.priority, done: false, source: t.source }));
}

/** Tarefas com prazo vencido e ainda abertas (antes de hoje). */
export function overdueTasks(ctx: Ctx): AgendaItem[] {
  return all<TaskRow>(ctx.db,
    "SELECT id, title, due_date, due_time, priority, done_at, source FROM tasks WHERE user_id = ? AND done_at IS NULL AND due_date < ? ORDER BY due_date", ctx.userId, ctx.now.date)
    .map((t) => ({ key: `t:${t.id}`, id: t.id, kind: "task" as const, title: t.title, date: t.due_date!, time: t.due_time, recurrence: null, priority: t.priority, done: false, source: t.source }));
}

export function countOpenTasks(ctx: Ctx): number {
  return get<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND done_at IS NULL", ctx.userId)?.n ?? 0;
}
