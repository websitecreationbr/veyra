import { route, sessionCookie, clearCookie } from "../http/app.js";
import * as auth from "../services/auth.js";
import * as fin from "../services/finance.js";
import * as ag from "../services/agenda.js";
import * as hb from "../services/habits.js";
import * as msgs from "../services/messages.js";
import { dashboard } from "../services/dashboard.js";
import { handleChat } from "../ai/chat.js";
import { PLANNED } from "../ai/planned.js";
import { loadDemo, removeDemo } from "../demo/seed.js";
import { HttpError, asObject, bad, oneOf, reqStr, str } from "../util/validate.js";
import { PERIODS, addDays, isDate, periodRange, type Period } from "../util/time.js";

const publicUser = (u: auth.User) => ({ id: u.id, name: u.name, email: u.email, timezone: u.timezone });

// ---------------- Saúde ----------------
route("GET", "/api/health", { auth: false }, () => ({ json: { ok: true } }));

// ---------------- Autenticação ----------------
route("POST", "/api/auth/register", { auth: false }, (r, app) => {
  const wait = app.limiters.register.check(r.ip);
  if (wait) throw new HttpError(429, "Muitos cadastros deste endereço. Tente mais tarde.", "limite");
  const b = asObject(r.body);
  const user = auth.register(app.opts.db, {
    name: reqStr(b, "name", { max: 60 }),
    email: reqStr(b, "email", { max: 254 }),
    password: typeof b.password === "string" ? b.password : "",
    timezone: str(b, "timezone", { optional: true, max: 60 }),
  });
  const token = auth.createSession(app.opts.db, user.id, app.opts.sessionDays, app.opts.clock.now());
  return { status: 201, json: { user: publicUser(user) }, headers: { "Set-Cookie": sessionCookie(token, { isProd: app.opts.isProd, days: app.opts.sessionDays }) } };
});

route("POST", "/api/auth/login", { auth: false }, (r, app) => {
  const b = asObject(r.body);
  const email = reqStr(b, "email", { max: 254 }).toLowerCase();
  const key = `${r.ip}|${email}`;
  const wait = app.limiters.login.check(key);
  if (wait) throw new HttpError(429, `Muitas tentativas. Tente novamente em ${Math.ceil(wait / 60)} min.`, "limite");
  const user = auth.authenticate(app.opts.db, email, typeof b.password === "string" ? b.password : "");
  app.limiters.login.reset(key);
  const token = auth.createSession(app.opts.db, user.id, app.opts.sessionDays, app.opts.clock.now());
  return { json: { user: publicUser(user) }, headers: { "Set-Cookie": sessionCookie(token, { isProd: app.opts.isProd, days: app.opts.sessionDays }) } };
});

route("POST", "/api/auth/logout", { auth: false }, (r, app) => {
  auth.destroySession(app.opts.db, r.token);
  return { json: { ok: true }, headers: { "Set-Cookie": clearCookie(app.opts.isProd) } };
});

route("GET", "/api/me", {}, (r, app) => ({
  json: {
    user: publicUser(r.user!),
    // Nunca devolvemos a chave — só dizemos qual "cérebro" está ativo.
    ai: { provider: app.opts.llm ? "claude" : "local" },
    planned: Object.values(PLANNED).map((p) => ({ id: p.id, title: p.title, phase: p.phase, needs: p.needs })),
  },
}));

route("PATCH", "/api/me", {}, (r, app) => {
  const b = asObject(r.body);
  const user = auth.updateProfile(app.opts.db, r.user!.id, { name: str(b, "name", { optional: true, max: 60 }), timezone: str(b, "timezone", { optional: true, max: 60 }) });
  return { json: { user: publicUser(user) } };
});

// ---------------- Início ----------------
route("GET", "/api/dashboard", {}, (r) => ({ json: dashboard(r.ctx()) }));

// ---------------- Conversa (Flow) ----------------
route("POST", "/api/chat", {}, async (r, app) => {
  const wait = app.limiters.chat.check(r.user!.id);
  if (wait) throw new HttpError(429, "Calma, uma mensagem de cada vez. Tente de novo em instantes.", "limite");
  const b = asObject(r.body);
  const turn = await handleChat(r.ctx(), reqStr(b, "text", { max: 2000 }), { llm: app.opts.llm });
  return { json: turn };
});
route("GET", "/api/chat/history", {}, (r) => ({ json: { messages: msgs.history(r.ctx(), 80) } }));
route("DELETE", "/api/chat/history", {}, (r) => {
  msgs.clearHistory(r.ctx());
  return { json: { ok: true } };
});

// ---------------- Finanças ----------------
function periodParam(r: { url: URL }, fallback: Period = "mes"): Period {
  const p = r.url.searchParams.get("period") ?? fallback;
  if (!PERIODS.includes(p as Period)) throw bad("Período inválido.");
  return p as Period;
}

route("GET", "/api/finance/summary", {}, (r) => {
  const ctx = r.ctx();
  const period = periodParam(r);
  const range = periodRange(period, ctx.now.date);
  const income = fin.realIncome(ctx, range);
  const expense = fin.realExpenses(ctx, range);
  return {
    json: {
      period, range,
      balanceCents: fin.balance(ctx),
      incomeCents: income,
      expenseCents: expense,
      resultCents: income - expense,
      byCategory: fin.expensesByCategory(ctx, range),
      compare: period === "mes" ? fin.monthOverMonth(ctx) : null,
      projection: fin.projection(ctx),
    },
  };
});

route("GET", "/api/finance/transactions", {}, (r) => {
  const ctx = r.ctx();
  const period = periodParam(r, "tudo");
  const kindRaw = r.url.searchParams.get("kind");
  const kind = kindRaw ? oneOf({ kind: kindRaw }, "kind", ["expense", "income"] as const) : undefined;
  const limit = Math.min(Math.max(Number(r.url.searchParams.get("limit") ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(r.url.searchParams.get("offset") ?? 0) || 0, 0);
  const items = fin.listTransactions(ctx, { range: periodRange(period, ctx.now.date), kind, limit: limit + 1, offset });
  return { json: { items: items.slice(0, limit), hasMore: items.length > limit, today: ctx.now.date } };
});

// ---------------- Agenda ----------------
route("GET", "/api/agenda", {}, (r) => {
  const ctx = r.ctx();
  const from = r.url.searchParams.get("from") ?? ctx.now.date;
  const to = r.url.searchParams.get("to") ?? addDays(from, 6);
  if (!isDate(from) || !isDate(to)) throw bad("Datas inválidas.");
  return { json: { items: ag.agenda(ctx, from, to), undated: ag.undatedTasks(ctx), overdue: ag.overdueTasks(ctx), today: ctx.now.date } };
});

route("POST", "/api/tasks/:id/done", {}, (r) => {
  const b = asObject(r.body ?? {});
  const done = b.done !== false;
  if (!ag.setTaskDone(r.ctx(), r.params.id!, done)) throw new HttpError(404, "Tarefa não encontrada.", "nao_encontrado");
  return { json: { ok: true } };
});
route("POST", "/api/reminders/:id/done", {}, (r) => {
  const b = asObject(r.body ?? {});
  if (!ag.setReminderDone(r.ctx(), r.params.id!, b.done !== false)) throw new HttpError(404, "Lembrete não encontrado.", "nao_encontrado");
  return { json: { ok: true } };
});

// Remoção genérica — usada pelo "Desfazer" depois que a Veyra registra algo.
route("DELETE", "/api/records/:kind/:id", {}, (r) => {
  const kind = oneOf({ kind: r.params.kind }, "kind", ["transaction", "task", "reminder", "event"] as const);
  if (!ag.deleteRecord(r.ctx(), kind, r.params.id!)) throw new HttpError(404, "Registro não encontrado.", "nao_encontrado");
  return { json: { ok: true } };
});

// ---------------- Hábitos ----------------
route("GET", "/api/habits", {}, (r) => ({ json: { habits: hb.listHabits(r.ctx()) } }));

// ---------------- Dados de demonstração ----------------
route("POST", "/api/demo", {}, (r) => {
  loadDemo(r.ctx());
  return { json: { ok: true } };
});
route("DELETE", "/api/demo", {}, (r) => {
  removeDemo(r.ctx());
  return { json: { ok: true } };
});
