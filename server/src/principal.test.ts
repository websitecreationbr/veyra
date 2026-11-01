// Testes do fluxo principal pedido para a publicação — rodam em SQLite (padrão) e em PostgreSQL real
// (TEST_DATABASE_URL). Cobrem: cadastro, validações, e-mail duplicado (inclusive simultâneo), login,
// logout, persistência, gasto, saldo e isolamento entre usuários.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./http/app.js";
import { openDb, type DB } from "./db/index.js";
import "./routes/index.js";
import { migrations } from "./db/migrations.js";
import { newTestDb, reopenTestDb, dropTestSchemas, DIALECT } from "../test/dbs.js";

const clock = { now: () => new Date("2026-10-27T16:52:00Z") };
const tmp = mkdtempSync(join(tmpdir(), "veyra-principal-"));
const servers = new Set<Server>();
after(async () => {
  await Promise.all(
    [...servers].map(
      (s) =>
        new Promise<void>((resolve) => {
          if (!s.listening) {
            resolve();
            return;
          }
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );

  await dropTestSchemas();

  rmSync(tmp, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
});
async function boot(db: DB) {
  const { server } = createApp({ db, clock, isProd: false, allowedOrigins: [], trustProxy: false, sessionDays: 30 });
  servers.add(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

class Browser {
  cookie = "";
  constructor(public url: string) {}
  async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (method !== "GET") headers["x-requested-with"] = "veyra";
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(this.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0]!.endsWith("=") ? "" : set.split(";")[0]!;
    const text = await res.text();
    let json: any; try { json = text ? JSON.parse(text) : undefined; } catch { /* */ }
    return { status: res.status, json, text, setCookie: set };
  }
}

test(`[${DIALECT}] /api/health confirma o banco`, async () => {
  const app = await boot(await newTestDb());
  const r = await new Browser(app.url).call("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, db: DIALECT });
  await app.close();
});

test(`[${DIALECT}] FLUXO PRINCIPAL: cadastro → login → gasto → saldo → logout → login → dados salvos`, async () => {
  const db = await newTestDb();
  const app = await boot(db);
  const b = new Browser(app.url);

  // 1. Cadastro
  const reg = await b.call("POST", "/api/auth/register", { name: "Arthur", email: "Arthur@Teste.com", password: "senha-segura-123" });
  assert.equal(reg.status, 201, reg.text);
  assert.equal(reg.json.user.email, "arthur@teste.com");
  assert.match(reg.setCookie!, /HttpOnly/);
  assert.match(reg.setCookie!, /SameSite=Lax/);
  assert.doesNotMatch(reg.text, /senha-segura|password|hash/i);

  // conta realmente gravada no banco, com senha em hash (nunca em texto)
  const row = await db.get<{ email: string; password_hash: string }>("SELECT email, password_hash FROM users WHERE email = ?", "arthur@teste.com");
  assert.ok(row);
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes("senha-segura-123"));

  // entrou no app
  assert.equal((await b.call("GET", "/api/me")).status, 200);

  // 2. Registrar gasto (pela conversa) e 3. consultar saldo
  const gasto = await b.call("POST", "/api/chat", { text: "Gastei R$ 47 no mercado" });
  assert.equal(gasto.status, 200, gasto.text);
  assert.equal(gasto.json.assistant.actions[0].tool, "registrar_gasto");
  assert.equal((await b.call("GET", "/api/dashboard")).json.balanceCents, -4700);
  const saldo = await b.call("POST", "/api/chat", { text: "Qual é o meu saldo?" });
  assert.match(saldo.json.assistant.text, /−|-/); // saldo negativo de R$ 47,00
  assert.match(saldo.json.assistant.text, /47,00/);

  // 4. Logout (o cookie é apagado e o token deixa de valer)
  const oldCookie = b.cookie;
  const out = await b.call("POST", "/api/auth/logout", {});
  assert.equal(out.status, 200);
  assert.equal(b.cookie, "");
  const replay = new Browser(app.url); replay.cookie = oldCookie;
  assert.equal((await replay.call("GET", "/api/me")).status, 401);
  assert.equal((await b.call("GET", "/api/dashboard")).status, 401);

  // 5. Login novamente e 6. dados salvos
  const login = await b.call("POST", "/api/auth/login", { email: "arthur@teste.com", password: "senha-segura-123" });
  assert.equal(login.status, 200, login.text);
  const dash = (await b.call("GET", "/api/dashboard")).json;
  assert.equal(dash.balanceCents, -4700);
  const tx = (await b.call("GET", "/api/finance/transactions")).json.items;
  assert.equal(tx.length, 1);
  assert.equal(tx[0].category.name, "Mercado");
  assert.equal(tx[0].amountCents, 4700);
  assert.equal((await b.call("GET", "/api/chat/history")).json.messages.length, 4);
  await app.close();
});

test(`[${DIALECT}] cadastro: e-mail inválido, senha curta, campos ausentes`, async () => {
  const db = await newTestDb();
  const app = await boot(db);
  const b = new Browser(app.url);
  for (const email of ["semarroba", "a@b", "a b@c.com", ""]) {
    const r = await b.call("POST", "/api/auth/register", { name: "X", email, password: "senha-segura-123" });
    assert.equal(r.status, 400, `email ${email}: ${r.text}`);
  }
  const short = await b.call("POST", "/api/auth/register", { name: "X", email: "x@x.com", password: "1234567" });
  assert.equal(short.status, 400);
  assert.match(short.json.error, /8 caracteres/);
  assert.equal((await b.call("POST", "/api/auth/register", { email: "x@x.com", password: "senha-segura-123" })).status, 400);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users"))!.n, 0); // nada foi gravado
  await app.close();
});

test(`[${DIALECT}] cadastro: e-mail duplicado (também em maiúsculas e em tentativas simultâneas)`, async () => {
  const db = await newTestDb();
  const app = await boot(db);
  const body = { name: "A", email: "dup@a.com", password: "senha-segura-123" };
  assert.equal((await new Browser(app.url).call("POST", "/api/auth/register", body)).status, 201);
  const again = await new Browser(app.url).call("POST", "/api/auth/register", { ...body, email: "DUP@a.com" });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, "email_em_uso");

  // corrida: duas requisições ao mesmo tempo com o mesmo e-mail → exatamente uma vence, nenhuma dá 500
  const race = await Promise.all([1, 2, 3].map(() => new Browser(app.url).call("POST", "/api/auth/register", { ...body, email: "race@a.com" })));
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409, 409]);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE email = ?", "race@a.com"))!.n, 1);
  await app.close();
});

test(`[${DIALECT}] login: senha certa, senha errada e e-mail inexistente`, async () => {
  const db = await newTestDb();
  const app = await boot(db);
  await new Browser(app.url).call("POST", "/api/auth/register", { name: "A", email: "l@a.com", password: "senha-segura-123" });
  const ok = await new Browser(app.url).call("POST", "/api/auth/login", { email: "L@a.com", password: "senha-segura-123" });
  assert.equal(ok.status, 200);
  const wrong = await new Browser(app.url).call("POST", "/api/auth/login", { email: "l@a.com", password: "errada-errada" });
  const ghost = await new Browser(app.url).call("POST", "/api/auth/login", { email: "nao@existe.com", password: "senha-segura-123" });
  assert.equal(wrong.status, 401);
  assert.equal(ghost.status, 401);
  assert.equal(wrong.json.error, ghost.json.error); // não revela se o e-mail existe
  assert.equal(wrong.setCookie, null);
  await app.close();
});

test(`[${DIALECT}] persistência: reiniciar o servidor mantém conta, sessão e dados`, async () => {
  const file = join(tmp, "p.db");
  const db1 = await newTestDb(file);
  const app1 = await boot(db1);
  const b = new Browser(app1.url);
  await b.call("POST", "/api/auth/register", { name: "P", email: "p@a.com", password: "senha-segura-123" });
  await b.call("POST", "/api/chat", { text: "Recebi 3000 de salário" });
  await b.call("POST", "/api/chat", { text: "Gastei 100 no mercado" });
  await app1.close();
  await db1.close();

 const db2 = await reopenTestDb(db1, file);
const app2 = await boot(db2);
  const b2 = new Browser(app2.url); b2.cookie = b.cookie;
  assert.equal((await b2.call("GET", "/api/dashboard")).json.balanceCents, 290000);
  const l = await new Browser(app2.url).call("POST", "/api/auth/login", { email: "p@a.com", password: "senha-segura-123" });
  assert.equal(l.status, 200);
  await app2.close();
  await db2.close();
});

test(`[${DIALECT}] dois usuários: cada um vê só os próprios dados`, async () => {
  const app = await boot(await newTestDb());
  const a = new Browser(app.url), c = new Browser(app.url);
  await a.call("POST", "/api/auth/register", { name: "A", email: "a@i.com", password: "senha-segura-123" });
  await c.call("POST", "/api/auth/register", { name: "C", email: "c@i.com", password: "senha-segura-123" });
  await a.call("POST", "/api/chat", { text: "Gastei 500 no mercado" });
  assert.equal((await a.call("GET", "/api/dashboard")).json.balanceCents, -50000);
  assert.equal((await c.call("GET", "/api/dashboard")).json.balanceCents, 0);
  assert.equal((await c.call("GET", "/api/finance/transactions")).json.items.length, 0);
  assert.equal((await c.call("GET", "/api/chat/history")).json.messages.length, 0);
  await app.close();
});

test(`[${DIALECT}] limite de tentativas de login é guardado no banco`, async () => {
  const db = await newTestDb();
  const app = await boot(db);
  await new Browser(app.url).call("POST", "/api/auth/register", { name: "A", email: "r@a.com", password: "senha-segura-123" });
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await new Browser(app.url).call("POST", "/api/auth/login", { email: "r@a.com", password: "errada-errada" })).status;
  assert.equal(last, 429);
  assert.ok((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM rate_limits"))!.n >= 1);
  await app.close();
});

test("SQLite: um banco criado pela versão anterior (só migração 001) é atualizado sem perder dados", { skip: DIALECT !== "sqlite" }, async () => {
  const file = join(tmp, "antigo.db");
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(migrations[0]!.sql);
  raw.exec("PRAGMA user_version = 1");
  raw.exec("INSERT INTO users (id,email,name,password_hash) VALUES ('u1','velho@a.com','Velho','x')");
  raw.exec("INSERT INTO settings (user_id) VALUES ('u1')");
  raw.exec("INSERT INTO transactions (id,user_id,kind,amount_cents,occurred_on) VALUES ('t1','u1','expense',1000,'2026-10-01'),('t2','u1','expense',2000,'2026-10-01')");
  raw.exec("INSERT INTO messages (id,user_id,role,content) VALUES ('m1','u1','user','oi'),('m2','u1','assistant','olá')");
  raw.close();

  const db = await openDb({ sqliteFile: file });
  assert.equal((await db.get<{ user_version: number }>("PRAGMA user_version"))!.user_version, migrations.length);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM transactions"))!.n, 2);
  const msgs = await db.all<{ id: string; seq: number }>("SELECT id, seq FROM messages ORDER BY seq");
  assert.deepEqual(msgs.map((m) => m.id), ["m1", "m2"]); // ordem preservada pelo preenchimento do seq
  assert.ok((await db.all("SELECT * FROM rate_limits")).length === 0);
  await db.close();
});

test(`[${DIALECT}] migrar duas vezes (ou em paralelo) é seguro`, async () => {
  const db = await newTestDb();
  const { migrate } = await import("./db/index.js");
  await migrate(db);
  await Promise.all([migrate(db), migrate(db)]);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users"))!.n, 0);
});
