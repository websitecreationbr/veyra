// Testes da VEYRA AI 2.0: mercado (fetch falso), provedor de IA, alarmes/calendário (protocolo do aparelho),
// login por token do app Android e CORS. Rodam em SQLite e, com TEST_DATABASE_URL, em PostgreSQL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "./http/app.js";
import "./routes/index.js";
import { createMarketService, describeMarket, MarketError } from "./services/market.js";
import { interpret } from "./ai/local.js";
import { parseClock } from "./ai/special.js";
import { toOpenAiMessages, fromOpenAiResponse, openAiCompatibleLlm } from "./ai/openai.js";
import { resolveAi } from "./ai/provider.js";
import type { Llm, LlmResponse } from "./ai/claude.js";
import { newTestDb, dropTestSchemas, DIALECT } from "../test/dbs.js";

const NOW = new Date("2026-10-29T17:00:00Z"); // quinta 14:00 em São Paulo
const clock = { now: () => NOW };
const servers = new Set<Server>();
after(async () => { for (const s of servers) { s.closeAllConnections(); s.close(); } await dropTestSchemas(); });

// ------------------------------------------------------------------ mercado
const ts = (iso: string) => String(Math.floor(new Date(iso).getTime() / 1000));
function fakeFetch(routes: Record<string, unknown | (() => unknown)>): typeof fetch {
  return (async (url: string) => {
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    if (!hit) return new Response("nao", { status: 404 });
    const v = routes[hit];
    const body = typeof v === "function" ? (v as () => unknown)() : v;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
const awesomeLast = { USDBRL: { bid: "5.4321", ask: "5.4331", pctChange: "0.45", varBid: "0.0243", timestamp: ts("2026-10-29T16:58:00Z"), create_date: "2026-10-29 13:58:00" } };
const awesomeDaily = [
  { bid: "5.4321", timestamp: ts("2026-10-29T16:58:00Z") },
  { bid: "5.4078", timestamp: ts("2026-10-28T20:59:00Z") },
  { bid: "5.3900", timestamp: ts("2026-10-27T20:59:00Z") },
];

test("dólar: valor, variação, data/hora, fonte e aviso de atraso (AwesomeAPI)", async () => {
  const m = createMarketService({ clock, fetchImpl: fakeFetch({ "json/last/USD-BRL": awesomeLast, "json/daily/USD-BRL": awesomeDaily }) });
  const s = await m.get("dolar");
  assert.equal(s.quote.value, 5.4321);
  assert.equal(s.quote.changePct, 0.45);
  assert.equal(s.quote.previousClose, 5.4078);
  assert.equal(s.quote.previousDate, "2026-10-28");
  assert.equal(s.quote.stale, false);
  const t = describeMarket(s);
  assert.match(t, /R\$ 5,4321/);
  assert.match(t, /Subiu 0,45%/);
  assert.match(t, /29\/10 às 13:58/);
  assert.match(t, /Fonte: AwesomeAPI/);
  assert.match(t, /atraso/);
  assert.match(describeMarket(s, "ontem"), /28\/10.*5,4078/);
  assert.match(describeMarket(s, "historico"), /27\/10 · R\$ 5,3900/);
});

test("dólar: cai para o PTAX do Banco Central e avisa que NÃO é tempo real", async () => {
  const ptax = { value: [
    { cotacaoCompra: 5.40, dataHoraCotacao: "2026-10-28 13:06:11.5" },
    { cotacaoCompra: 5.41, dataHoraCotacao: "2026-10-29 10:05:00.1" },
    { cotacaoCompra: 5.43, dataHoraCotacao: "2026-10-29 13:05:00.1" },
  ] };
  const m = createMarketService({ clock, fetchImpl: fakeFetch({ "json/last": () => new Response("x", { status: 503 }), olinda: ptax }) });
  const s = await m.get("dolar");
  assert.equal(s.quote.value, 5.43); // último boletim do dia
  assert.equal(s.quote.previousClose, 5.4);
  assert.match(s.quote.source, /Banco Central/);
  assert.match(s.quote.delayNote, /NÃO é cotação em tempo real/);
});

test("Ibovespa: brapi; cotação antiga (fim de semana) é marcada como último valor, não tempo real", async () => {
  const brapi = { results: [{ symbol: "^BVSP", regularMarketPrice: 131234.5, regularMarketChange: -1080.2, regularMarketChangePercent: -0.82, regularMarketPreviousClose: 132314.7, regularMarketTime: "2026-10-29T20:00:00.000Z",
    historicalDataPrice: [{ date: Number(ts("2026-10-27T20:00:00Z")), close: 131900 }, { date: Number(ts("2026-10-28T20:00:00Z")), close: 132314.7 }] }] };
  const later = { now: () => new Date("2026-10-31T15:00:00Z") }; // sábado
  const s = await createMarketService({ clock: later, fetchImpl: fakeFetch({ "brapi.dev": brapi }) }).get("ibovespa");
  assert.equal(s.quote.stale, true);
  const t = describeMarket(s, "variacao");
  assert.match(t, /Em queda 0,82%/);
  assert.match(t, /Último valor disponível \(não é tempo real\)/);
  assert.match(t, /131\.235 pontos|131\.234 pontos/);
});

test("Ibovespa: brapi fora → Yahoo; tudo fora → erro honesto (nunca valor inventado)", async () => {
  const yahoo = { chart: { result: [{ meta: { regularMarketPrice: 130000, regularMarketTime: Number(ts("2026-10-29T16:50:00Z")), chartPreviousClose: 131000 }, timestamp: [Number(ts("2026-10-28T19:00:00Z"))], indicators: { quote: [{ close: [131000] }] } }] } };
  const ok = await createMarketService({ clock, fetchImpl: fakeFetch({ "brapi.dev": () => new Response("", { status: 429 }), "yahoo": yahoo }) }).get("ibovespa");
  assert.equal(ok.quote.value, 130000);
  assert.match(ok.quote.source, /Yahoo/);
  assert.ok(Math.abs(ok.quote.changePct! - -0.76) < 0.01);
  await assert.rejects(createMarketService({ clock, fetchImpl: fakeFetch({}) }).get("ibovespa"), MarketError);
  await assert.rejects(createMarketService({ clock, fetchImpl: fakeFetch({ "json/last": { USDBRL: { bid: "abc" } } }) }).get("dolar"), MarketError);
});

test("mercado: cache de 60 s evita chamadas repetidas", async () => {
  let n = 0;
  const m = createMarketService({ clock, fetchImpl: fakeFetch({ "json/last/USD-BRL": () => (n++, awesomeLast), "json/daily": awesomeDaily }) });
  await m.get("dolar"); await m.get("dolar");
  assert.equal(n, 1);
});

// ------------------------------------------------------------------ interpretador local
const LNOW = { date: "2026-10-29", time: "14:00", dow: 4 };
const plan = (t: string, pending?: Parameters<typeof interpret>[2], opts?: Parameters<typeof interpret>[3]) => interpret(t, LNOW, pending, opts);

test("relógio: 'quatro da tarde' = 16:00; 'às 4' é ambíguo; 7h = manhã; relativo", () => {
  assert.deepEqual(parseClock("coloca um alarme para as quatro da tarde", LNOW), { kind: "ok", hora: "16:00" });
  assert.deepEqual(parseClock("alarme as 16h", LNOW), { kind: "ok", hora: "16:00" });
  assert.deepEqual(parseClock("alarme as 4", LNOW), { kind: "ambiguous", opcoes: ["04:00", "16:00"] });
  assert.deepEqual(parseClock("alarme para as 7h", LNOW), { kind: "ok", hora: "07:00" });
  assert.deepEqual(parseClock("alarme as 7 e meia da noite", LNOW), { kind: "ok", hora: "19:30" });
  assert.deepEqual(parseClock("me acorda daqui a 30 minutos", LNOW), { kind: "ok", hora: "14:30" });
  assert.deepEqual(parseClock("alarme meia-noite", LNOW), { kind: "ok", hora: "00:00" });
  assert.deepEqual(parseClock("alarme", LNOW), { kind: "none" });
});

test("alarme local: pedido direto, ambiguidade resolvida em duas etapas e limites honestos", () => {
  assert.deepEqual(plan("Veyra, coloca um alarme para as quatro da tarde.").calls, [{ name: "definir_alarme", input: { hora: "16:00" } }]);
  assert.deepEqual(plan("alarme para as 7h todos os dias").calls, [{ name: "definir_alarme", input: { hora: "07:00", dias: ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] } }]);
  const amb = plan("coloca um alarme as 4");
  assert.equal(amb.calls.length, 0);
  assert.match(amb.ask!.question, /4h da manhã ou da tarde/);
  assert.deepEqual(plan("da tarde", amb.ask!.pending).calls, [{ name: "definir_alarme", input: { hora: "16:00" } }]);
  const none = plan("coloca um alarme");
  assert.match(none.ask!.question, /Para que horas/);
  assert.deepEqual(plan("às 6h30", none.ask!.pending).calls, [{ name: "definir_alarme", input: { hora: "06:30" } }]);
  assert.match(plan("cancela meu alarme das 7").reply!, /não consigo ver, alterar nem cancelar/);
});

test("mercado local: asset, detalhe e perguntas de acompanhamento pelo assunto anterior", () => {
  assert.deepEqual(plan("Veyra, quanto está o dólar?").calls[0]!.input, { ativo: "dolar", detalhe: "cotacao" });
  assert.deepEqual(plan("O Ibovespa caiu quantos por cento?").calls[0]!.input, { ativo: "ibovespa", detalhe: "variacao" });
  assert.deepEqual(plan("Ele subiu ou caiu hoje?", undefined, { topic: { market: "dolar" } }).calls[0]!.input, { ativo: "dolar", detalhe: "variacao" });
  assert.deepEqual(plan("E ontem?", undefined, { topic: { market: "ibovespa" } }).calls[0]!.input, { ativo: "ibovespa", detalhe: "ontem" });
  assert.equal(plan("E ontem?").calls.length, 0); // sem assunto anterior, não inventa
  assert.deepEqual(plan("Gastei 20 no mercado").calls[0]!.name, "registrar_gasto"); // "mercado" categoria ≠ cotação
  assert.deepEqual(plan("bitcoin subiu?").planned, ["mercado_outros"]);
});

test("conversa social local: saudações e 'como você está' (e honestidade sobre o resto)", () => {
  assert.match(plan("Olá, Veyra!").reply!, /^Olá!/);
  assert.match(plan("Bom dia!").reply!, /^Bom dia!/);
  assert.match(plan("Como você está?").reply!, /Tudo bem por aqui/);
  assert.match(plan("Me explica o que é inteligência artificial.").reply!, /IA em nuvem precisa estar ativada/);
});

// ------------------------------------------------------------------ provedor de IA
test("provedor de IA: escolha por variáveis, presets gratuitos e nada sem chave", () => {
  assert.equal(resolveAi({}), undefined);
  assert.equal(resolveAi({ GEMINI_API_KEY: "k" })!.name, "gemini");
  assert.equal(resolveAi({ GROQ_API_KEY: "k" })!.name, "groq");
  assert.equal(resolveAi({ ANTHROPIC_API_KEY: "k" })!.name, "anthropic");
  assert.equal(resolveAi({ AI_PROVIDER: "groq", GROQ_API_KEY: "k", AI_MODEL: "x" })!.model, "x");
  assert.equal(resolveAi({ AI_PROVIDER: "gemini" }), undefined); // sem chave
});

test("adaptador OpenAI: tradução de mensagens/ferramentas e de volta (inclui assinatura extra do Gemini)", async () => {
  const msgs = toOpenAiMessages("SYS", [
    { role: "user", content: "oi" },
    { role: "assistant", content: [{ type: "text", text: "vou ver" }, { type: "tool_use", id: "c1", name: "consultar_saldo", input: {}, extra: { google: { thought_signature: "sig" } } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "{\"ok\":true}" }] },
  ]) as any[];
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[2].tool_calls[0].function.name, "consultar_saldo");
  assert.deepEqual(msgs[2].tool_calls[0].extra_content, { google: { thought_signature: "sig" } });
  assert.deepEqual(msgs[3], { role: "tool", tool_call_id: "c1", content: "{\"ok\":true}" });

  const r = fromOpenAiResponse({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "x", function: { name: "registrar_gasto", arguments: "{\"valor_reais\":35}" }, extra_content: { a: 1 } }, { function: { name: "consultar_saldo", arguments: "" } }] } }] });
  const uses = r.content.filter((b) => b.type === "tool_use") as any[];
  assert.equal(uses.length, 2);
  assert.deepEqual(uses[0].input, { valor_reais: 35 });
  assert.deepEqual(uses[0].extra, { a: 1 });
  assert.ok(uses[1].id); // id gerado quando o provedor não manda
  assert.throws(() => fromOpenAiResponse({}), /inesperada/);

  let seen: any;
  const llm = openAiCompatibleLlm({ baseUrl: "https://x.test/v1/", apiKey: "SEGREDO", model: "m", fetchImpl: (async (u: string, init: any) => { seen = { u, init }; return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Olá!" } }] })); }) as typeof fetch });
  const out = await llm({ system: "s", messages: [{ role: "user", content: "oi" }], tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }] });
  assert.equal(seen.u, "https://x.test/v1/chat/completions");
  assert.equal(seen.init.headers.authorization, "Bearer SEGREDO");
  assert.equal(JSON.parse(seen.init.body).tools[0].function.name, "t");
  assert.deepEqual(out.content, [{ type: "text", text: "Olá!" }]);
  const bad = openAiCompatibleLlm({ baseUrl: "https://x.test", apiKey: "SEGREDO", model: "m", fetchImpl: (async () => new Response("chave SEGREDO inválida", { status: 401 })) as typeof fetch });
  await assert.rejects(bad({ system: "s", messages: [], tools: [] }), (e: Error) => !/SEGREDO/.test(e.message));
});

// ------------------------------------------------------------------ HTTP: token do app, CORS, aparelho
async function boot(opts: Partial<Parameters<typeof createApp>[0]> = {}) {
  const db = await newTestDb();
  const market = createMarketService({ clock, fetchImpl: fakeFetch({ "json/last/USD-BRL": awesomeLast, "json/daily": awesomeDaily }) });
  const { server } = createApp({ db, clock, market, isProd: false, allowedOrigins: [], trustProxy: false, sessionDays: 30, ...opts });
  servers.add(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, db, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
type Hdr = Record<string, string>;
async function call(base: string, method: string, path: string, body?: unknown, headers: Hdr = {}) {
  const h: Hdr = { ...headers };
  if (method !== "GET" && method !== "OPTIONS") h["x-requested-with"] = "veyra";
  if (body !== undefined) h["content-type"] = "application/json";
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, headers: res.headers };
}
const APP = { origin: "https://localhost", "x-veyra-client": "app" };

test(`[${DIALECT}] app Android: cadastro/login devolvem token; cookie NÃO é usado; Bearer funciona`, async () => {
  const app = await boot();
  const reg = await call(app.url, "POST", "/api/auth/register", { name: "Ana", email: "ana@a.com", password: "senha-segura-123" }, APP);
  assert.equal(reg.status, 201, reg.text);
  assert.ok(reg.json.token.length > 30);
  assert.equal(reg.headers.get("set-cookie"), null);
  assert.equal(reg.headers.get("access-control-allow-origin"), "https://localhost");
  assert.equal(reg.headers.get("access-control-allow-credentials"), null);
  const auth = { ...APP, authorization: `Bearer ${reg.json.token}` };
  assert.equal((await call(app.url, "GET", "/api/me", undefined, auth)).status, 200);
  assert.equal((await call(app.url, "GET", "/api/me", undefined, { ...APP, authorization: "Bearer " + "x".repeat(43) })).status, 401);
  assert.equal((await call(app.url, "GET", "/api/me", undefined, APP)).status, 401);
  // token no corpo do login também; logout invalida
  const login = await call(app.url, "POST", "/api/auth/login", { email: "ana@a.com", password: "senha-segura-123" }, APP);
  const a2 = { ...APP, authorization: `Bearer ${login.json.token}` };
  assert.equal((await call(app.url, "POST", "/api/auth/logout", {}, a2)).status, 200);
  assert.equal((await call(app.url, "GET", "/api/me", undefined, a2)).status, 401);
  // site (navegador) continua com cookie e SEM token no corpo
  const web = await call(app.url, "POST", "/api/auth/login", { email: "ana@a.com", password: "senha-segura-123" });
  assert.match(web.headers.get("set-cookie")!, /HttpOnly/);
  assert.equal(web.json.token, undefined);
  await app.close();
});

test(`[${DIALECT}] CORS: preflight só para origens do app; origem estranha é bloqueada; cookie cross-origin é ignorado`, async () => {
  const app = await boot();
  const ok = await call(app.url, "OPTIONS", "/api/chat", undefined, { origin: "https://localhost", "access-control-request-method": "POST" });
  assert.equal(ok.status, 204);
  assert.match(ok.headers.get("access-control-allow-headers")!, /authorization/);
  const evil = await call(app.url, "OPTIONS", "/api/chat", undefined, { origin: "https://evil.example" });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  assert.equal((await call(app.url, "POST", "/api/auth/login", { email: "a@a.com", password: "x" }, { origin: "https://evil.example" })).status, 403);
  // cookie válido vindo de origem do app (cross-origin) não autentica
  const web = await call(app.url, "POST", "/api/auth/register", { name: "W", email: "w@a.com", password: "senha-segura-123" });
  const cookie = web.headers.get("set-cookie")!.split(";")[0]!;
  assert.equal((await call(app.url, "GET", "/api/me", undefined, { origin: "https://localhost", cookie })).status, 401);
  assert.equal((await call(app.url, "GET", "/api/me", undefined, { cookie })).status, 200);
  await app.close();
});

async function signupApp(app: { url: string }, email: string, caps = "alarm,calendar") {
  const r = await call(app.url, "POST", "/api/auth/register", { name: "T", email, password: "senha-segura-123" }, APP);
  return { ...APP, authorization: `Bearer ${r.json.token}`, "x-veyra-capabilities": caps } as Hdr;
}

test(`[${DIALECT}] alarme (sem IA): servidor valida, app executa, só então a Veyra afirma — e sem promessa falsa`, async () => {
  const app = await boot();
  const h = await signupApp(app, "alarm@a.com");
  const t1 = await call(app.url, "POST", "/api/chat", { text: "Veyra, coloca um alarme para as quatro da tarde" }, h);
  assert.equal(t1.status, 200, t1.text);
  assert.equal(t1.json.assistant, null); // ainda não afirmou nada
  assert.deepEqual(t1.json.device.calls.map((c: any) => [c.action, c.params.hora]), [["alarm.set", "16:00"]]);
  const hist = await call(app.url, "GET", "/api/chat/history", undefined, h);
  assert.equal(hist.json.messages.length, 1); // só a fala do usuário

  const done = await call(app.url, "POST", "/api/chat/continue", { continuationId: t1.json.device.continuationId, results: [{ callId: t1.json.device.calls[0].callId, result: { ok: true } }] }, h);
  assert.equal(done.status, 200, done.text);
  assert.match(done.json.assistant.text, /Pedi ao app Relógio .*16:00/);
  assert.doesNotMatch(done.json.assistant.text, /alarme (foi )?criado/i);
  // uso único
  assert.equal((await call(app.url, "POST", "/api/chat/continue", { continuationId: t1.json.device.continuationId, results: [] }, h)).status, 410);

  // permissão negada vira texto verdadeiro
  const t2 = await call(app.url, "POST", "/api/chat", { text: "alarme às 6h30" }, h);
  const denied = await call(app.url, "POST", "/api/chat/continue", { continuationId: t2.json.device.continuationId, results: [{ callId: t2.json.device.calls[0].callId, result: { ok: false, error: "permissao_negada" } }] }, h);
  assert.match(denied.json.assistant.text, /negou a permissão/);
  await app.close();
});

test(`[${DIALECT}] navegador (sem recursos do aparelho): alarme e calendário do celular são recusados com honestidade`, async () => {
  const app = await boot();
  const r = await call(app.url, "POST", "/api/auth/register", { name: "B", email: "b@a.com", password: "senha-segura-123" });
  const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  const t = await call(app.url, "POST", "/api/chat", { text: "coloca um alarme às 16h" }, { cookie });
  assert.equal(t.json.device, undefined);
  assert.match(t.json.assistant.text, /só funcionam no aplicativo Android/);
  await app.close();
});

test(`[${DIALECT}] continuação é do dono: outro usuário não consegue usá-la`, async () => {
  const app = await boot();
  const a = await signupApp(app, "a1@a.com"), b = await signupApp(app, "b1@a.com");
  const t = await call(app.url, "POST", "/api/chat", { text: "alarme às 18h" }, a);
  const steal = await call(app.url, "POST", "/api/chat/continue", { continuationId: t.json.device.continuationId, results: [{ callId: t.json.device.calls[0].callId, result: { ok: true } }] }, b);
  assert.equal(steal.status, 410);
  assert.equal((await call(app.url, "POST", "/api/chat/continue", { continuationId: t.json.device.continuationId, results: [{ callId: t.json.device.calls[0].callId, result: { ok: true } }] }, a)).status, 200);
  await app.close();
});

test(`[${DIALECT}] mercado pelo chat (sem IA): consulta real e pergunta de acompanhamento "e ontem?"`, async () => {
  const app = await boot();
  const h = await signupApp(app, "mk@a.com");
  const a = await call(app.url, "POST", "/api/chat", { text: "Veyra, quanto está o dólar?" }, h);
  assert.match(a.json.assistant.text, /R\$ 5,4321/);
  assert.match(a.json.assistant.text, /Fonte: AwesomeAPI/);
  const b = await call(app.url, "POST", "/api/chat", { text: "Ele subiu ou caiu hoje?" }, h);
  assert.match(b.json.assistant.text, /Subiu 0,45%/);
  const c = await call(app.url, "POST", "/api/chat", { text: "E ontem?" }, h);
  assert.match(c.json.assistant.text, /28\/10.*5,4078/);
  await app.close();
});

test(`[${DIALECT}] mercado indisponível: erro honesto, sem número`, async () => {
  const market = createMarketService({ clock, fetchImpl: fakeFetch({}) });
  const app = await boot({ market });
  const h = await signupApp(app, "mk2@a.com");
  const a = await call(app.url, "POST", "/api/chat", { text: "quanto está o Ibovespa?" }, h);
  assert.match(a.json.assistant.text, /Não consegui consultar o Ibovespa/);
  assert.doesNotMatch(a.json.assistant.text, /\d{2,3}\.\d{3}/);
  await app.close();
});

// IA em nuvem com ferramentas do aparelho (LLM falso): pausa, retoma e nunca executa fora da lista
function scripted(steps: ((req: Parameters<Llm>[0]) => LlmResponse)[]): { llm: Llm; seen: Parameters<Llm>[0][] } {
  const seen: Parameters<Llm>[0][] = [];
  let i = 0;
  return { seen, llm: async (req) => { seen.push(JSON.parse(JSON.stringify(req))); const s = steps[i++]; if (!s) throw new Error("passos acabaram"); return s(req); } };
}

test(`[${DIALECT}] IA + calendário do celular: consulta no aparelho, retoma e responde; excluir é cancelável; ferramenta fora da lista é recusada`, async () => {
  const s = scripted([
    () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "consultar_calendario", input: { de: "2026-10-30" } }, { type: "tool_use", id: "t2", name: "consultar_saldo", input: {} }] }),
    () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Amanhã você tem Dentista às 15h." }] }),
    () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t3", name: "excluir_evento_calendario", input: { id_evento: "42", titulo: "Dentista" } }, { type: "tool_use", id: "t4", name: "apagar_tudo", input: {} }] }),
    () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Ok, não excluí." }] }),
  ]);
  const app = await boot({ llm: s.llm });
  const h = await signupApp(app, "cal@a.com");

  const t1 = await call(app.url, "POST", "/api/chat", { text: "O que tenho marcado amanhã?" }, h);
  assert.equal(t1.json.assistant, null);
  assert.deepEqual(t1.json.device.calls.map((c: any) => [c.action, c.params.de, c.params.ate]), [["calendar.query", "2026-10-30", "2026-10-30"]]);
  assert.ok(s.seen[0]!.tools.some((t: any) => t.name === "consultar_calendario")); // oferecido porque o app declarou "calendar"
  const ev = { id: "42", title: "Dentista", start: "2026-10-30T15:00", end: "2026-10-30T16:00", allDay: false };
  const d1 = await call(app.url, "POST", "/api/chat/continue", { continuationId: t1.json.device.continuationId, results: [{ callId: "t1", result: { ok: true, events: [ev] } }] }, h);
  assert.equal(d1.status, 200, d1.text);
  assert.match(d1.json.assistant.text, /Dentista/);
  const lastUser = s.seen[1]!.messages[s.seen[1]!.messages.length - 1] as any;
  assert.deepEqual(lastUser.content.map((b: any) => b.tool_use_id), ["t2", "t1"]); // saldo (servidor) + calendário (aparelho)
  assert.match(lastUser.content[1].content, /Dentista/);

  const t2 = await call(app.url, "POST", "/api/chat", { text: "Exclui o dentista" }, h);
  assert.equal(t2.json.device.calls.length, 1); // "apagar_tudo" nunca chega ao aparelho
  assert.equal(t2.json.device.calls[0].action, "calendar.delete");
  const d2 = await call(app.url, "POST", "/api/chat/continue", { continuationId: t2.json.device.continuationId, results: [{ callId: "t3", result: { ok: false, cancelled: true } }] }, h);
  assert.match(d2.json.assistant.text, /não excluí/i);
  const req3 = s.seen[3]!.messages[s.seen[3]!.messages.length - 1] as any;
  assert.match(req3.content.map((b: any) => b.content).join(" "), /você cancelou, então nada foi feito/);
  assert.match(req3.content.map((b: any) => b.content).join(" "), /não está disponível aqui/);
  await app.close();
});

test(`[${DIALECT}] IA no navegador: ferramentas do aparelho nem são oferecidas ao modelo`, async () => {
  const s = scripted([() => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Olá! Tudo bem por aqui 😊" }] })]);
  const app = await boot({ llm: s.llm });
  const r = await call(app.url, "POST", "/api/auth/register", { name: "N", email: "n@a.com", password: "senha-segura-123" });
  const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  const a = await call(app.url, "POST", "/api/chat", { text: "Olá, Veyra!" }, { cookie });
  assert.match(a.json.assistant.text, /Olá/);
  const names = s.seen[0]!.tools.map((t: any) => t.name);
  assert.ok(names.includes("consultar_mercado") && !names.includes("definir_alarme") && !names.includes("consultar_calendario"));
  assert.match(s.seen[0]!.system, /NÃO há acesso a alarmes/);
  assert.match(s.seen[0]!.system, /nunca invente|Nunca invente/);
  await app.close();
});

test(`[${DIALECT}] validação no servidor: horário/ID inválidos vindos da IA não chegam ao aparelho`, async () => {
  const s = scripted([
    () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "x1", name: "definir_alarme", input: { hora: "25:99" } }, { type: "tool_use", id: "x2", name: "excluir_evento_calendario", input: { id_evento: "1; DROP TABLE", titulo: "x" } }] }),
    () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Não consegui." }] }),
  ]);
  const app = await boot({ llm: s.llm });
  const h = await signupApp(app, "val@a.com");
  const t = await call(app.url, "POST", "/api/chat", { text: "faz algo" }, h);
  assert.equal(t.json.device, undefined);
  assert.match(t.json.assistant.text, /Não consegui/);
  await app.close();
});
