import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === "1",
  webDist: resolve(root, "../web/dist"),
  sessionDays: 30,
};
