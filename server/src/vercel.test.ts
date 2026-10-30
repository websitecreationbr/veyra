// Emulação local da função da Vercel: carrega o arquivo GERADO (api/[...path].js) em outro processo Node,
// do mesmo modo que a Vercel (require + handler(req,res)), com DATABASE_URL apontando para o PostgreSQL de teste.
// NÃO é a Vercel de verdade — só prova que o pacote gerado sobe, migra o banco e atende a API.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { build } from "esbuild";
import { PG_URL, dropTestSchemas } from "../test/dbs.js";
import { WirePool } from "../test/pgwire.js";

const root = resolve(import.meta.dirname, "../..");
const bundle = join(root, "api/[...path].js");
const skip = !PG_URL ? "defina TEST_DATABASE_URL (PostgreSQL)" : !existsSync(bundle) ? "rode npm run build:api" : false;
const tmp = mkdtempSync(join(tmpdir(), "veyra-vercel-"));
const procs: ChildProcess[] = [];
const schemas: string[] = [];
after(async () => {
  for (const p of procs) p.kill();
  if (PG_URL && schemas.length) {
    const u = new URL(PG_URL);
    const admin = new WirePool({ host: u.hostname, port: Number(u.port), user: u.username, database: u.pathname.slice(1), max: 1 });
    for (const s of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await admin.end();
  }
  await dropTestSchemas();
  rmSync(tmp, { recursive: true, force: true });
});

async function startFunction(env: Record<string, string>): Promise<string> {
  // módulo "pg" falso (ver test/vercel/pg-shim.ts) numa pasta própria, achada via NODE_PATH
  await build({ entryPoints: [join(root, "server/test/vercel/pg-shim.ts")], bundle: true, platform: "node", format: "cjs", outfile: join(tmp, "node_modules/pg/index.js"), logLevel: "error" });
  const child = spawn(process.execPath, [join(root, "server/test/vercel/runner.cjs")], {
    env: { PATH: process.env.PATH!, NODE_PATH: join(tmp, "node_modules"), ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  procs.push(child);
  let err = "";
  child.stderr!.on("data", (d) => (err += d));
  const port = await new Promise<number>((res, rej) => {
    child.stdout!.on("data", (d) => { const m = /PORT (\d+)/.exec(String(d)); if (m) res(Number(m[1])); });
    child.on("exit", (c) => rej(new Error(`processo saiu (${c}): ${err}`)));
  });
  return `http://127.0.0.1:${port}`;
}
const call = async (url: string, path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) => {
  const headers: Record<string, string> = {};
  if (init.method && init.method !== "GET") headers["x-requested-with"] = "veyra";
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  const r = await fetch(url + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, json, text, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "", setCookie: r.headers.get("set-cookie") ?? "" };
};

test("função da Vercel (pacote gerado): sobe, migra o banco e atende o fluxo principal", { skip }, async () => {
  const u = new URL(PG_URL);
  const schema = "v_" + randomBytes(4).toString("hex");
  schemas.push(schema);
  const admin = new WirePool({ host: u.hostname, port: Number(u.port), user: u.username, database: u.pathname.slice(1), max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const url = await startFunction({ DATABASE_URL: PG_URL, VEYRA_TEST_SCHEMA: schema });
  const health = await call(url, "/api/health");
  assert.equal(health.status, 200, health.text);
  assert.deepEqual(health.json, { ok: true, db: "postgres" });

  const reg = await call(url, "/api/auth/register", { method: "POST", body: { name: "Arthur", email: "v@a.com", password: "senha-segura-123" } });
  assert.equal(reg.status, 201, reg.text);
  assert.match(reg.setCookie, /Secure/); // na Vercel é sempre HTTPS
  assert.match(reg.setCookie, /HttpOnly/);
  const chat = await call(url, "/api/chat", { method: "POST", body: { text: "Gastei R$ 47 no mercado" }, cookie: reg.cookie });
  assert.equal(chat.status, 200, chat.text);
  assert.equal((await call(url, "/api/dashboard", { cookie: reg.cookie })).json.balanceCents, -4700);
  await call(url, "/api/auth/logout", { method: "POST", body: {}, cookie: reg.cookie });
  assert.equal((await call(url, "/api/me", { cookie: reg.cookie })).status, 401);
  const login = await call(url, "/api/auth/login", { method: "POST", body: { email: "v@a.com", password: "senha-segura-123" } });
  assert.equal(login.status, 200, login.text);
  assert.equal((await call(url, "/api/dashboard", { cookie: login.cookie })).json.balanceCents, -4700);
  // IP real vem de x-forwarded-for (trustProxy) — o limite não mistura clientes diferentes atrás do mesmo proxy
  assert.equal((await call(url, "/api/nao-existe")).status, 404);
  assert.match((await call(url, "/api/nao-existe")).text, /nao_encontrado/);
});

test("função da Vercel sem DATABASE_URL: erro claro em JSON (nunca HTML) e sem vazar detalhes", { skip }, async () => {
  const url = await startFunction({});
  const r = await call(url, "/api/auth/register", { method: "POST", body: { name: "A", email: "a@a.com", password: "senha-segura-123" } });
  assert.equal(r.status, 503);
  assert.equal(r.json.code, "banco_nao_configurado");
  assert.doesNotMatch(r.text, /postgres:\/\/|password/i);
});

test("função da Vercel com banco fora do ar: 503 em JSON, sem expor host/usuário", { skip }, async () => {
  const url = await startFunction({ DATABASE_URL: "postgres://segredo_user:segredo_senha@127.0.0.1:1/nada" });
  const r = await call(url, "/api/health");
  assert.equal(r.status, 503);
  assert.equal(r.json.code, "banco_indisponivel");
  assert.doesNotMatch(r.text, /segredo/);
});
