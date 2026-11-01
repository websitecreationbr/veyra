import { route, sessionCookie, clearCookie, type AppState, type Req } from "../http/app.js";
import * as auth from "../services/auth.js";
import * as fin from "../services/finance.js";
import * as ag from "../services/agenda.js";
import * as hb from "../services/habits.js";
import * as msgs from "../services/messages.js";
import { dashboard } from "../services/dashboard.js";
import { handleChat, handleContinue } from "../ai/chat.js";
import { PLANNED } from "../ai/planned.js";
import { loadDemo, removeDemo } from "../demo/seed.js";
import { HttpError, asObject, bad, oneOf, reqStr, str } from "../util/validate.js";
import { PERIODS, addDays, isDate, periodRange, type Period } from "../util/time.js";

const publicUser = (u: auth.User) => ({ id: u.id, name: u.name, email: u.email, timezone: u.timezone });

/** Site: cookie HttpOnly. App Android: o token vai no corpo (guardado só no aparelho) e é enviado em Authorization: Bearer. */
function sessionReply(r: Req, app: AppState, user: auth.User, token: string, status: number) {
  if (r.client === "app" || r.raw.headers["x-veyra-client"] === "app") return { status, json: { user: publicUser(user), token } };
  return { status, json: { user: publicUser(user) }, headers: { "Set-Cookie": sessionCookie(token, { isProd: app.opts.isProd, days: app.opts.sessionDays }) } };
}

// ---------------- Saúde ----------------
route("GET", "/api/health", { auth: false }, async (_r, app) => {
  // Confirma que o banco responde — é o primeiro teste a fazer depois de publicar.
  try {
    await app.opts.db.get("SELECT 1 AS ok");
    return { json: { ok: true, db: app.opts.db.dialect } };
  } catch (e) {
    console.error("[health] banco indisponível:", (e as Error).message);
    return { status: 503, json: { ok: false, db: app.opts.db.dialect, error: "Banco de dados indisponível.", code: "banco_indisponivel" } };
  }
});

// ---------------- Autenticação ----------------
route("POST", "/api/auth/register", { auth: false }, async (r, app) => {
  const wait = await app.limiters.register.check(r.ip);
  if (wait) throw new HttpError(429, "Muitos cadastros deste endereço. Tente mais tarde.", "limite");
  const b = asObject(r.body);
  const user = await auth.register(app.opts.db, {
    name: reqStr(b, "name", { max: 60 }),
    email: reqStr(b, "email", { max: 254 }),
    password: typeof b.password === "string" ? b.password : "",
    timezone: str(b, "timezone", { optional: true, max: 60 }),
  });
  const token = await auth.createSession(app.opts.db, user.id, app.opts.sessionDays, app.opts.clock.now());
  return sessionReply(r, app, user, token, 201);
});

route("POST", "/api/auth/login", { auth: false }, async (r, app) => {
  const b = asObject(r.body);
  const email = reqStr(b, "email", { max: 254 }).toLowerCase();
  const key = `${r.ip}|${email}`;
  const wait = await app.limiters.login.check(key);
  if (wait) throw new HttpError(429, `Muitas tentativas. Tente novamente em ${Math.ceil(wait / 60)} min.`, "limite");
  const user = await auth.authenticate(app.opts.db, email, typeof b.password === "string" ? b.password : "");
  await app.limiters.login.reset(key);
  const token = await auth.createSession(app.opts.db, user.id, app.opts.sessionDays, app.opts.clock.now());
  return sessionReply(r, app, user, token, 200);
});

route("POST", "/api/auth/logout", { auth: false }, async (r, app) => {
  await auth.destroySession(app.opts.db, r.token);
  return { json: { ok: true }, headers: { "Set-Cookie": clearCookie(app.opts.isProd) } };
});

route("GET", "/api/me", {}, (r, app) => ({
  json: {
    user: publicUser(r.user!),
    // Nunca devolvemos a chave — só dizemos se há IA em nuvem ("cloud") ou só o modo local.
    ai: { provider: app.opts.llm ? "cloud" : "local", market: !!app.opts.market },
    planned: Object.values(PLANNED).map((p) => ({ id: p.id, title: p.title, phase: p.phase, needs: p.needs })),
  },
}));

route("PATCH", "/api/me", {}, async (r, app) => {
  const b = asObject(r.body);
  const user = await auth.updateProfile(app.opts.db, r.user!.id, { name: str(b, "name", { optional: true, max: 60 }), timezone: str(b, "timezone", { optional: true, max: 60 }) });
  return { json: { user: publicUser(user) } };
});

// ---------------- Início ----------------
route("GET", "/api/dashboard", {}, async (r) => ({ json: await dashboard(await r.ctx()) }));

// ---------------- Conversa (Flow) ----------------
route("POST", "/api/chat", {}, async (r, app) => {
  const wait = await app.limiters.chat.check(r.user!.id);
  if (wait) throw new HttpError(429, "Calma, uma mensagem de cada vez. Tente de novo em instantes.", "limite");
  const b = asObject(r.body);
  const turn = await handleChat(await r.ctx(), reqStr(b, "text", { max: 2000 }), { llm: app.opts.llm });
  return { json: turn };
});
/** O app executou as ações do aparelho (alarme/calendário) e devolve os resultados; a conversa continua. */
route("POST", "/api/chat/continue", {}, async (r, app) => {
  const wait = await app.limiters.chat.check(r.user!.id);
  if (wait) throw new HttpError(429, "Calma, uma mensagem de cada vez. Tente de novo em instantes.", "limite");
  const b = asObject(r.body);
  const continuationId = reqStr(b, "continuationId", { max: 80 });
  if (!Array.isArray(b.results) || b.results.length > 20) throw bad("Resultados inválidos.");
  const results = b.results.map((x: unknown) => {
    const o = asObject(x, "resultado");
    const res = asObject(o.result ?? {}, "resultado");
    if (JSON.stringify(res).length > 20_000) throw bad("Resultado grande demais.");
    return { callId: reqStr(o, "callId", { max: 80 }), result: { ...res, ok: res.ok === true } };
  });
  return { json: await handleContinue(await r.ctx(), continuationId, results, { llm: app.opts.llm }) };
});
route("GET", "/api/chat/history", {}, async (r) => ({ json: { messages: await msgs.history(await r.ctx(), 80) } }));
route("DELETE", "/api/chat/history", {}, async (r) => {
  await msgs.clearHistory(await r.ctx());
  return { json: { ok: true } };
});

// ---------------- Finanças ----------------
function periodParam(r: { url: URL }, fallback: Period = "mes"): Period {
  const p = r.url.searchParams.get("period") ?? fallback;
  if (!PERIODS.includes(p as Period)) throw bad("Período inválido.");
  return p as Period;
}

route("GET", "/api/finance/summary", {}, async (r) => {
  const ctx = await r.ctx();
  const period = periodParam(r);
  const range = periodRange(period, ctx.now.date);
  const income = await fin.realIncome(ctx, range);
  const expense = await fin.realExpenses(ctx, range);
  return {
    json: {
      period, range,
      balanceCents: await fin.balance(ctx),
      incomeCents: income,
      expenseCents: expense,
      resultCents: income - expense,
      byCategory: await fin.expensesByCategory(ctx, range),
      compare: period === "mes" ? await fin.monthOverMonth(ctx) : null,
      projection: await fin.projection(ctx),
    },
  };
});

route("GET", "/api/finance/transactions", {}, async (r) => {
  const ctx = await r.ctx();
  const period = periodParam(r, "tudo");
  const kindRaw = r.url.searchParams.get("kind");
  const kind = kindRaw ? oneOf({ kind: kindRaw }, "kind", ["expense", "income"] as const) : undefined;
  const limit = Math.min(Math.max(Number(r.url.searchParams.get("limit") ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(r.url.searchParams.get("offset") ?? 0) || 0, 0);
  const items = await fin.listTransactions(ctx, { range: periodRange(period, ctx.now.date), kind, limit: limit + 1, offset });
  return { json: { items: items.slice(0, limit), hasMore: items.length > limit, today: ctx.now.date } };
});

// ---------------- Agenda ----------------
route("GET", "/api/agenda", {}, async (r) => {
  const ctx = await r.ctx();
  const from = r.url.searchParams.get("from") ?? ctx.now.date;
  const to = r.url.searchParams.get("to") ?? addDays(from, 6);
  if (!isDate(from) || !isDate(to)) throw bad("Datas inválidas.");
  return { json: { items: await ag.agenda(ctx, from, to), undated: await ag.undatedTasks(ctx), overdue: await ag.overdueTasks(ctx), today: ctx.now.date } };
});

route("POST", "/api/tasks/:id/done", {}, async (r) => {
  const b = asObject(r.body ?? {});
  const done = b.done !== false;
  if (!(await ag.setTaskDone(await r.ctx(), r.params.id!, done))) throw new HttpError(404, "Tarefa não encontrada.", "nao_encontrado");
  return { json: { ok: true } };
});
route("POST", "/api/reminders/:id/done", {}, async (r) => {
  const b = asObject(r.body ?? {});
  if (!(await ag.setReminderDone(await r.ctx(), r.params.id!, b.done !== false))) throw new HttpError(404, "Lembrete não encontrado.", "nao_encontrado");
  return { json: { ok: true } };
});

// Remoção genérica — usada pelo "Desfazer" depois que a Veyra registra algo.
route("DELETE", "/api/records/:kind/:id", {}, async (r) => {
  const kind = oneOf({ kind: r.params.kind }, "kind", ["transaction", "task", "reminder", "event"] as const);
  if (!(await ag.deleteRecord(await r.ctx(), kind, r.params.id!))) throw new HttpError(404, "Registro não encontrado.", "nao_encontrado");
  return { json: { ok: true } };
});

// ---------------- Hábitos ----------------
route("GET", "/api/habits", {}, async (r) => ({ json: { habits: await hb.listHabits(await r.ctx()) } }));

// ---------------- Dados de demonstração ----------------
route("POST", "/api/demo", {}, async (r) => {
  await loadDemo(await r.ctx());
  return { json: { ok: true } };
});
route("DELETE", "/api/demo", {}, async (r) => {
  await removeDemo(await r.ctx());
  return { json: { ok: true } };
});
