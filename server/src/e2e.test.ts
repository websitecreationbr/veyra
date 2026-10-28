import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { openDb, type DB } from "./db/index.js";
import { createApp, type AppOptions } from "./http/app.js";
import "./routes/index.js";
import type { Llm } from "./ai/claude.js";
import type { Clock } from "./util/time.js";

// Terça, 27/10/2026 13:52 em São Paulo
const clock: Clock = { now: () => new Date("2026-10-27T16:52:00Z") };
const tmp = mkdtempSync(join(tmpdir(), "veyra-test-"));
const openServers = new Set<Server>();
after(() => {
  for (const s of openServers) { s.closeAllConnections(); s.close(); }
  rmSync(tmp, { recursive: true, force: true });
});

interface Started {
  server: Server;
  url: string;
  db: DB;
  close(): Promise<void>;
}
async function start(extra: Partial<AppOptions> = {}, db: DB = openDb(":memory:")): Promise<Started> {
  const { server } = createApp({ db, clock, isProd: false, allowedOrigins: [], trustProxy: false, sessionDays: 30, ...extra });
  openServers.add(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, db, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

/** Cliente com "cookie jar" — simula um navegador. */
class Client {
  cookie = "";
  constructor(public base: string) {}
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers };
    if (method !== "GET") h["x-requested-with"] = headers["x-requested-with"] ?? "veyra";
    if (body !== undefined) h["content-type"] = "application/json";
    if (this.cookie) h.cookie = this.cookie;
    const res = await fetch(this.base + path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0]!.endsWith("=") ? "" : set.split(";")[0]!;
    const text = await res.text();
    let json: any = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* ignore */ }
    return { status: res.status, json, headers: res.headers, text };
  }
  get = (p: string) => this.call("GET", p);
  post = (p: string, b?: unknown) => this.call("POST", p, b ?? {});
  del = (p: string) => this.call("DELETE", p);
}

async function signup(app: Started, email: string, name = "Arthur", password = "senha-segura-123") {
  const c = new Client(app.url);
  const r = await c.post("/api/auth/register", { name, email, password });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return c;
}
const say = async (c: Client, text: string) => {
  const r = await c.post("/api/chat", { text });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.assistant as { text: string; actions: { line: string; record?: { kind: string; id: string } }[] };
};

// ---------------------------------------------------------------------------------------------
test("cadastro, sessão por cookie HttpOnly e /api/me", async () => {
  const app = await start();
  const c = new Client(app.url);
  const r = await c.post("/api/auth/register", { name: "Arthur", email: "Arthur@Exemplo.com", password: "senha-segura-123" });
  assert.equal(r.status, 201);
  const cookie = r.headers.get("set-cookie")!;
  assert.match(cookie, /veyra_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(r.json.user.email, "arthur@exemplo.com"); // normalizado
  assert.equal(r.json.user.password_hash, undefined);

  const me = await c.get("/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.json.user.name, "Arthur");
  assert.equal(me.json.ai.provider, "local");
  assert.ok(me.json.planned.length > 0);

  const dup = await new Client(app.url).post("/api/auth/register", { name: "X", email: "arthur@exemplo.com", password: "outra-senha-123" });
  assert.equal(dup.status, 409);

  const weak = await new Client(app.url).post("/api/auth/register", { name: "X", email: "x@y.com", password: "123" });
  assert.equal(weak.status, 400);
  const badEmail = await new Client(app.url).post("/api/auth/register", { name: "X", email: "naoemail", password: "senha-segura-123" });
  assert.equal(badEmail.status, 400);
  await app.close();
});

test("rotas privadas exigem login; logout invalida a sessão", async () => {
  const app = await start();
  const anon = new Client(app.url);
  for (const p of ["/api/dashboard", "/api/me", "/api/finance/summary", "/api/agenda", "/api/chat/history"]) {
    assert.equal((await anon.get(p)).status, 401, p);
  }
  const c = await signup(app, "a@a.com");
  assert.equal((await c.get("/api/dashboard")).status, 200);
  const old = c.cookie;
  await c.post("/api/auth/logout");
  const replay = new Client(app.url);
  replay.cookie = old;
  assert.equal((await replay.get("/api/dashboard")).status, 401); // token antigo não vale mais
  await app.close();
});

test("login: credenciais erradas, mensagem genérica e limite de tentativas", async () => {
  const app = await start({ limits: { login: 3 } });
  await signup(app, "login@a.com");
  const c = new Client(app.url);
  const wrongPw = await c.post("/api/auth/login", { email: "login@a.com", password: "errada-errada" });
  const noUser = await c.post("/api/auth/login", { email: "naoexiste@a.com", password: "errada-errada" });
  assert.equal(wrongPw.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPw.json.error, noUser.json.error); // não revela se o e-mail existe
  await c.post("/api/auth/login", { email: "login@a.com", password: "x-x-x-x-x-x" });
  await c.post("/api/auth/login", { email: "login@a.com", password: "y-y-y-y-y-y" });
  const blocked = await c.post("/api/auth/login", { email: "login@a.com", password: "senha-segura-123" });
  assert.equal(blocked.status, 429);
  await app.close();

  const app2 = await start();
  await signup(app2, "ok@a.com");
  const ok = await new Client(app2.url).post("/api/auth/login", { email: "OK@a.com", password: "senha-segura-123" });
  assert.equal(ok.status, 200);
  await app2.close();
});

test("proteção CSRF/Origin e validação de corpo", async () => {
  const app = await start();
  const c = await signup(app, "csrf@a.com");
  const noHeader = await c.call("POST", "/api/chat", { text: "oi" }, { "x-requested-with": "" });
  assert.equal(noHeader.status, 403);
  const evil = await c.call("POST", "/api/chat", { text: "oi" }, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  const badJson = await c.call("POST", "/api/chat", "{not json");
  assert.equal(badJson.status, 400);
  const big = await c.call("POST", "/api/chat", JSON.stringify({ text: "a".repeat(70_000) }));
  assert.equal(big.status, 413);
  const empty = await c.post("/api/chat", { text: "   " });
  assert.equal(empty.status, 400);
  await app.close();
});

test("headers de segurança presentes", async () => {
  const app = await start();
  const r = await new Client(app.url).get("/api/health");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.match(r.headers.get("content-security-policy")!, /default-src 'self'/);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
test("Flow: registrar gasto por conversa, consultar saldo e desfazer", async () => {
  const app = await start();
  const c = await signup(app, "flow@a.com");

  const a1 = await say(c, "Gastei R$ 47 no mercado.");
  assert.match(a1.text, /^Registrado\./);
  assert.match(a1.text, /Mercado · R\$ 47,00\nHoje/);
  assert.equal(a1.actions.length, 1);

  const dash = (await c.get("/api/dashboard")).json;
  assert.equal(dash.balanceCents, -4700);
  assert.equal(dash.monthExpenseCents, 4700);

  const saldo = await say(c, "Qual meu saldo?");
  assert.match(saldo.text, /R\$ -47,00|-R\$ 47,00|−R\$ 47,00/);

  // desfazer pelo chip
  const rec = a1.actions[0]!.record!;
  assert.equal((await c.del(`/api/records/${rec.kind}/${rec.id}`)).status, 200);
  assert.equal((await c.get("/api/dashboard")).json.balanceCents, 0);
  assert.equal((await c.del(`/api/records/${rec.kind}/${rec.id}`)).status, 404);
  await app.close();
});

test("Flow: várias ações em uma frase (exemplo principal do produto)", async () => {
  const app = await start();
  const c = await signup(app, "multi@a.com");
  const a = await say(c, "Recebi R$ 1.500 hoje, gastei R$ 80 no mercado e amanhã às 10 me lembra de ligar para o contador.");
  assert.match(a.text, /^Tudo certo\./);
  assert.equal(a.actions.length, 3);
  assert.match(a.text, /\+ R\$ 1\.500/);
  assert.match(a.text, /− R\$ 80 · Mercado/);
  assert.match(a.text, /🔔 Lembrete criado para amanhã às 10:00/);

  assert.equal((await c.get("/api/dashboard")).json.balanceCents, 142000);
  const ag = (await c.get("/api/agenda?from=2026-10-28&to=2026-10-28")).json;
  assert.equal(ag.items.length, 1);
  assert.equal(ag.items[0].title, "Ligar para o contador");
  assert.equal(ag.items[0].time, "10:00");

  const q = await say(c, "Quanto eu gastei esse mês?");
  assert.match(q.text, /R\$ 80/);
  assert.match(q.text, /Mercado — R\$ 80/);
  await app.close();
});

test("Flow: pergunta de acompanhamento só quando falta contexto", async () => {
  const app = await start();
  const c = await signup(app, "ask@a.com");
  const q = await say(c, "Gastei 30.");
  assert.match(q.text, /Onde você gastou R\$ 30\?/);
  assert.equal(q.actions.length, 0);
  assert.equal((await c.get("/api/dashboard")).json.balanceCents, 0); // nada registrado ainda

  const done = await say(c, "na padaria");
  assert.match(done.text, /^Registrado\./);
  assert.equal((await c.get("/api/dashboard")).json.balanceCents, -3000);

  const direct = await say(c, "Gastei 30 no almoço");
  assert.match(direct.text, /^Registrado\./); // com contexto, não pergunta
  await app.close();
});

test("Flow: agenda, recorrência e hábitos", async () => {
  const app = await start();
  const c = await signup(app, "agenda@a.com");
  await say(c, "Marca dentista quinta às 15.");
  await say(c, "Todo dia às 7 me lembra de beber água.");
  const h = await say(c, "Hoje eu treinei.");
  assert.match(h.text, /Treino/);

  const week = (await c.get("/api/agenda?from=2026-10-27&to=2026-11-02")).json;
  const dentist = week.items.filter((i: any) => i.title === "Dentista");
  assert.equal(dentist.length, 1);
  assert.equal(dentist[0].date, "2026-10-29");
  assert.equal(dentist[0].time, "15:00");
  const water = week.items.filter((i: any) => i.title === "Beber água");
  assert.equal(water.length, 7); // recorrência diária expandida na semana

  const today = await say(c, "O que tenho hoje?");
  assert.match(today.text, /07:00 — 🔔 Beber água/);
  assert.equal((await c.get("/api/dashboard")).json.habit.name, "Treino");
  await app.close();
});

test("Honestidade: mercado, alertas e treinos detalhados NÃO são simulados", async () => {
  const app = await start();
  const c = await signup(app, "honest@a.com");
  for (const [msg, feature] of [
    ["Como está o Ibovespa?", "Cotações de mercado"],
    ["Quanto está o dólar?", "Cotações de mercado"],
    ["PETR4 subiu hoje?", "Cotações de mercado"],
    ["Me avisa quando o dólar passar de R$ 5,50.", "Alertas de mercado"],
    ["Estou evoluindo no supino?", "treinos"],
  ] as const) {
    const a = await say(c, msg);
    assert.match(a.text, new RegExp(`${feature}.*ainda não está disponível`, "is"), msg);
    assert.equal(a.actions.length, 0, msg);
    assert.doesNotMatch(a.text, /\d+,\d{2}/, `${msg}: não pode inventar números`);
  }
  await app.close();
});

test("projeção de saldo: R$ 3.000 com média de R$ 1.200/mês ≈ 2,5 meses (como estimativa)", async () => {
  const app = await start();
  const c = await signup(app, "proj@a.com");
  await say(c, "Meu saldo é 4.200");
  // 1.200 de gastos distribuídos em 30 dias
  const { makeCtx } = await import("./services/context.js");
  const { addTransaction } = await import("./services/finance.js");
  const { addDays } = await import("./util/time.js");
  const { get } = await import("./db/index.js");
  const uid = get<{ id: string }>(app.db, "SELECT id FROM users WHERE email = ?", "proj@a.com")!.id;
  const ctx = makeCtx(app.db, uid, clock);
  for (let i = 0; i < 30; i++) addTransaction(ctx, { kind: "expense", amountCents: 4000, category: "Mercado", date: addDays(ctx.now.date, -i) });
  const a = await say(c, "Se eu continuar nesse ritmo, quando meu dinheiro vai acabar?");
  assert.match(a.text, /R\$ 1\.200,00\/mês/);
  assert.match(a.text, /aproximadamente 2,5 meses/);
  assert.match(a.text, /estimativa/i);
  await app.close();
});

test("comparação com o mês passado usa dados reais", async () => {
  const app = await start();
  const c = await signup(app, "cmp@a.com");
  await say(c, "Gastei 100 no mercado ontem");
  const { makeCtx } = await import("./services/context.js");
  const { addTransaction } = await import("./services/finance.js");
  const { get } = await import("./db/index.js");
  const ctx = makeCtx(app.db, get<{ id: string }>(app.db, "SELECT id FROM users WHERE email = ?", "cmp@a.com")!.id, clock);
  addTransaction(ctx, { kind: "expense", amountCents: 8000, category: "Mercado", date: "2026-09-10" });
  const a = await say(c, "Meu gasto aumentou em relação ao mês passado?");
  assert.match(a.text, /R\$ 100,00/);
  assert.match(a.text, /R\$ 80,00/);
  assert.match(a.text, /25% a mais/);
  await app.close();
});

test("validação: valores absurdos e inválidos são recusados", async () => {
  const app = await start();
  const c = await signup(app, "val@a.com");
  const huge = await say(c, "Gastei 999999999999 no mercado");
  assert.match(huge.text, /alto demais/);
  assert.equal(huge.actions[0]?.ok, false);
  assert.equal((await c.get("/api/dashboard")).json.balanceCents, 0);
  const bad = await c.get("/api/finance/summary?period=drop_table");
  assert.equal(bad.status, 400);
  const badDate = await c.get("/api/agenda?from=2026-13-45");
  assert.equal(badDate.status, 400);
  const huge2 = await c.get("/api/agenda?from=2020-01-01&to=2026-01-01");
  assert.equal(huge2.status, 400);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
test("ISOLAMENTO: uma conta nunca enxerga nem altera dados de outra", async () => {
  const app = await start();
  const a = await signup(app, "a@iso.com", "Ana");
  const b = await signup(app, "b@iso.com", "Beto");

  const ra = await say(a, "Gastei 500 no mercado");
  await say(a, "Marca reunião secreta amanhã às 9");
  await say(a, "Hoje eu treinei");
  await say(a, "Cria tarefa: segredo da Ana");
  const rec = ra.actions[0]!.record!;

  // B não vê nada de A
  const dash = (await b.get("/api/dashboard")).json;
  assert.equal(dash.balanceCents, 0);
  assert.equal(dash.habit, null);
  assert.equal((await b.get("/api/finance/transactions")).json.items.length, 0);
  const agB = (await b.get("/api/agenda?from=2026-10-27&to=2026-11-30")).json;
  assert.equal(agB.items.length, 0);
  assert.equal(agB.undated.length, 0);
  assert.equal((await b.get("/api/chat/history")).json.messages.length, 0);
  assert.equal((await b.get("/api/habits")).json.habits.length, 0);
  const sb = await say(b, "Qual meu saldo?");
  assert.match(sb.text, /R\$ 0,00/);
  const qb = await say(b, "Quanto gastei esse mês?");
  assert.doesNotMatch(qb.text, /500/);

  // B não consegue apagar o registro de A (404, não 403: nem revela que existe)
  assert.equal((await b.del(`/api/records/${rec.kind}/${rec.id}`)).status, 404);
  assert.equal((await a.get("/api/dashboard")).json.balanceCents, -50000);

  // categorias criadas por A não aparecem para B
  const { makeCtx } = await import("./services/context.js");
  const { addTransaction, listCategories } = await import("./services/finance.js");
  const { get } = await import("./db/index.js");
  const idOf = (email: string) => get<{ id: string }>(app.db, "SELECT id FROM users WHERE email = ?", email)!.id;
  addTransaction(makeCtx(app.db, idOf("a@iso.com"), clock), { kind: "expense", amountCents: 2000, category: "Pet" });
  assert.ok(listCategories(makeCtx(app.db, idOf("a@iso.com"), clock)).some((c) => c.name === "Pet"));
  assert.ok(!listCategories(makeCtx(app.db, idOf("b@iso.com"), clock)).some((c) => c.name === "Pet"));

  // B tenta concluir tarefa de A pelo id
  const tasksA = (await a.get("/api/agenda?from=2026-10-27&to=2026-10-27")).json.undated as { id: string }[];
  assert.equal((await b.post(`/api/tasks/${tasksA[0]!.id}/done`, {})).status, 404);
  await app.close();
});

test("PERSISTÊNCIA: dados sobrevivem a reiniciar o servidor", async () => {
  const file = join(tmp, "persist", "veyra.db");
  const app1 = await start({}, openDb(file));
  const c1 = await signup(app1, "persist@a.com", "Persistente");
  await say(c1, "Recebi 3000 de salário");
  await say(c1, "Gastei 47 no mercado");
  await say(c1, "Amanhã às 8 me lembra de pagar a conta");
  const cookie = c1.cookie;
  await app1.close();
  app1.db.close();

  // "reinicia": abre o mesmo arquivo em uma nova instância
  const app2 = await start({}, openDb(file));
  const c2 = new Client(app2.url);
  c2.cookie = cookie; // a sessão também persiste
  const dash = await c2.get("/api/dashboard");
  assert.equal(dash.status, 200);
  assert.equal(dash.json.balanceCents, 295300);
  assert.equal(dash.json.agendaToday.length, 0);
  const hist = (await c2.get("/api/chat/history")).json.messages;
  assert.equal(hist.length, 6);
  const login = await new Client(app2.url).post("/api/auth/login", { email: "persist@a.com", password: "senha-segura-123" });
  assert.equal(login.status, 200);
  await app2.close();
  app2.db.close();
});

test("sessão expira", async () => {
  const app = await start();
  const c = await signup(app, "exp@a.com");
  assert.equal((await c.get("/api/me")).status, 200);
  const { run } = await import("./db/index.js");
  run(app.db, "UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'");
  assert.equal((await c.get("/api/me")).status, 401);
  await app.close();
});

test("dados de demonstração: separados, removíveis e sem tocar nos dados reais", async () => {
  const app = await start();
  const c = await signup(app, "demo@a.com");
  await say(c, "Gastei 10 no mercado");
  assert.equal((await c.get("/api/dashboard")).json.demoActive, false);
  assert.equal((await c.post("/api/demo")).status, 200);
  const on = (await c.get("/api/dashboard")).json;
  assert.equal(on.demoActive, true);
  assert.ok(on.balanceCents > 0 && on.agendaToday.length >= 3 && on.habit.name === "Treino");
  assert.equal((await c.del("/api/demo")).status, 200);
  const off = (await c.get("/api/dashboard")).json;
  assert.equal(off.demoActive, false);
  assert.equal(off.balanceCents, -1000); // só o gasto real ficou
  await app.close();
});

// ---------------------------------------------------------------------------------------------
test("IA em nuvem (Claude com tool-use): executa funções reais; a chave nunca vai ao cliente", async () => {
  const calls: any[] = [];
  const llm: Llm = async (req) => {
    calls.push(req);
    const last = req.messages[req.messages.length - 1]!;
    if (typeof last.content === "string") {
      return { stop_reason: "tool_use", content: [
        { type: "tool_use", id: "t1", name: "registrar_gasto", input: { valor_reais: 25, categoria: "Alimentação", descricao: "Almoço" } },
        { type: "tool_use", id: "t2", name: "criar_lembrete", input: { titulo: "Pagar a conta", data: "2026-10-28", hora: "08:00" } },
      ] };
    }
    const results = (last.content as any[]).map((b) => JSON.parse(b.content));
    assert.ok(results.every((r) => r.ok));
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Tudo certo.\n\n− R$ 25 · Alimentação\n🔔 Lembrete criado para amanhã às 08:00" }] };
  };
  const app = await start({ llm });
  const c = await signup(app, "claude@a.com");
  assert.equal((await c.get("/api/me")).json.ai.provider, "claude");
  assert.doesNotMatch((await c.get("/api/me")).text, /sk-|api[_-]?key/i);

  const a = await say(c, "almocei por 25 e me lembra amanhã às 8 de pagar a conta");
  assert.match(a.text, /Tudo certo/);
  assert.equal(a.actions.length, 2);
  assert.equal((await c.get("/api/dashboard")).json.balanceCents, -2500); // a função REALMENTE gravou
  assert.match(calls[0].system, /2026-10-27/); // data de hoje vai no prompt
  assert.ok(calls[0].tools.some((t: any) => t.name === "registrar_gasto"));
  assert.ok(!calls[0].tools.some((t: any) => /ibovespa|dolar|acao/.test(t.name))); // não anuncia funções que não existem

  // o modelo tenta chamar função inexistente / entrada inválida: nada quebra, nada é gravado
  const llm2: Llm = async (req) => {
    const last = req.messages[req.messages.length - 1]!;
    if (typeof last.content === "string")
      return { stop_reason: "tool_use", content: [
        { type: "tool_use", id: "x1", name: "consultar_ibovespa", input: {} },
        { type: "tool_use", id: "x2", name: "registrar_gasto", input: { valor_reais: "abc" } },
        { type: "tool_use", id: "x3", name: "registrar_gasto", input: { valor_reais: -5 } },
      ] };
    const rs = (last.content as any[]).map((b) => JSON.parse(b.content));
    assert.ok(rs.every((r) => r.ok === false));
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Não consegui fazer isso." }] };
  };
  const app2 = await start({ llm: llm2 });
  const c2 = await signup(app2, "claude2@a.com");
  await say(c2, "faz umas coisas");
  assert.equal((await c2.get("/api/dashboard")).json.balanceCents, 0);
  await app.close();
  await app2.close();
});

test("IA em nuvem fora do ar: cai para o modo local sem duplicar ações", async () => {
  const down: Llm = async () => { throw new Error("rede caiu"); };
  const app = await start({ llm: down });
  const c = await signup(app, "down@a.com");
  const a = await say(c, "Gastei 12 no mercado");
  assert.match(a.text, /Registrado/);
  assert.match(a.text, /modo local/);
  assert.equal((await c.get("/api/dashboard")).json.balanceCents, -1200);

  // falha DEPOIS de executar uma ferramenta: não pode reexecutar localmente
  let step = 0;
  const flaky: Llm = async () => {
    if (step++ === 0) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "k", name: "registrar_gasto", input: { valor_reais: 7, categoria: "Mercado" } }] };
    throw new Error("caiu no meio");
  };
  const app2 = await start({ llm: flaky });
  const c2 = await signup(app2, "flaky@a.com");
  const b = await say(c2, "Gastei 7 no mercado");
  assert.equal((await c2.get("/api/dashboard")).json.balanceCents, -700); // uma vez só
  assert.match(b.text, /ações acima foram executadas/);
  await app.close();
  await app2.close();
});

test("arquivos estáticos: SPA fallback e sem path traversal", async () => {
  const dist = join(tmp, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>VEYRA</title>");
  writeFileSync(join(dist, "assets", "a.js"), "console.log(1)");
  writeFileSync(join(tmp, "segredo.txt"), "SEGREDO");
  const app = await start({ webDist: dist });
  const c = new Client(app.url);
  assert.match((await c.get("/")).text, /VEYRA/);
  assert.match((await c.get("/financas")).text, /VEYRA/); // rota do app
  assert.equal((await c.get("/assets/a.js")).status, 200);
  assert.equal((await c.get("/assets/nao-existe.js")).status, 404);
  for (const p of ["/..%2fsegredo.txt", "/%2e%2e/segredo.txt", "/assets/..%2f..%2fsegredo.txt"]) {
    const r = await c.get(p);
    assert.doesNotMatch(r.text, /SEGREDO/, p);
  }
  await app.close();
});
