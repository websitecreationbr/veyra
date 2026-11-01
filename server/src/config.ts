import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { resolveAi } from "./ai/provider.js";

// Pasta "server". (No pacote da Vercel o import.meta.url é fornecido pelo build; se faltar, usa o diretório atual.)
const root = (() => {
  try { return resolve(fileURLToPath(new URL("..", import.meta.url))); } catch { return resolve(process.cwd(), "server"); }
})();

// Carrega server/.env (formato KEY=VALUE) sem dependências. Variáveis já definidas no ambiente têm prioridade.
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const key = m[1]!;
    const val = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined && val !== "") process.env[key] = val;
  }
}
loadDotEnv(resolve(root, ".env"));

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  /** Cookie Secure + HSTS. Padrão: ligado em produção. Use COOKIE_SECURE=0 para testar `npm start` em http://localhost. */
  httpsMode: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "1" : isProd,
  port: Number(process.env.PORT ?? 8787),
  dataDir: resolve(process.env.VEYRA_DATA_DIR ?? resolve(root, ".data")),
  /** PostgreSQL de produção (ex.: Neon/Supabase/Vercel Postgres). Sem isso, usa SQLite local. */
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || "",
  /** "disable" | "no-verify" — só se o seu provedor exigir; o padrão (verificar certificado) é o mais seguro. */
  databaseSsl: process.env.DATABASE_SSL ?? "",
  pgPoolMax: Number(process.env.PG_POOL_MAX ?? 3),
  /** Provedor de IA (gratuito: Gemini/Groq/OpenRouter; pago opcional: Anthropic). Ver ai/provider.ts. */
  ai: resolveAi(process.env),
  brapiToken: process.env.BRAPI_TOKEN ?? "",
  awesomeToken: process.env.AWESOMEAPI_TOKEN ?? "",
  appOrigins: (process.env.APP_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === "1",
  webDist: resolve(root, "../web/dist"),
  sessionDays: 30,
};
