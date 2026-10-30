// Função serverless da Vercel: recebe TODAS as requisições /api/* (ver vercel.json) e usa o mesmo
// tratador do servidor local. Um banco (pool) por instância "quente"; migrações aplicadas na 1ª requisição.
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { openDb, type Db } from "./db/index.js";
import { createHandler } from "./http/app.js";
import "./routes/index.js";
import { anthropicLlm } from "./ai/claude.js";
import { systemClock } from "./util/time.js";

type Handle = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
let ready: Promise<Handle> | undefined;

function boot(): Promise<Handle> {
  return (async () => {
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL não está configurada. Crie um banco PostgreSQL e defina a variável na Vercel (veja o README).");
    }
    const db: Db = await openDb({ databaseUrl: config.databaseUrl, ssl: config.databaseSsl, poolMax: config.pgPoolMax });
    const llm = config.anthropicKey ? anthropicLlm(config.anthropicKey, config.anthropicModel) : undefined;
    const { handle } = createHandler({
      db, clock: systemClock, llm,
      isProd: true, // na Vercel é sempre HTTPS: cookie Secure + HSTS
      allowedOrigins: config.allowedOrigins,
      trustProxy: true, // atrás da Vercel o IP real vem em x-forwarded-for
      sessionDays: config.sessionDays,
    });
    return handle;
  })();
}

function fail(res: ServerResponse, status: number, code: string, error: string) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error, code }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    ready ??= boot();
    const handle = await ready;
    await handle(req, res);
  } catch (e) {
    ready = undefined; // tenta de novo na próxima requisição (ex.: banco que estava fora do ar)
    // Detalhe técnico só nos logs da Vercel — nunca para o navegador (pode conter host/usuário).
    console.error("[veyra] falha ao iniciar/atender:", (e as Error).message);
    const missing = /DATABASE_URL/.test((e as Error).message);
    fail(res, 503, missing ? "banco_nao_configurado" : "banco_indisponivel",
      missing ? "O servidor ainda não está configurado (banco de dados ausente)." : "Não foi possível acessar o banco de dados agora. Tente novamente em instantes.");
  }
}
