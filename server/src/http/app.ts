import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { DB } from "../db/index.js";
import { HttpError } from "../util/validate.js";
import { userFromSession, type User } from "../services/auth.js";
import { makeCtx, type Ctx } from "../services/context.js";
import { RateLimiter } from "./rateLimit.js";
import type { Clock } from "../util/time.js";
import type { Llm } from "../ai/claude.js";

export const COOKIE = "veyra_session";

export interface AppOptions {
  db: DB;
  clock: Clock;
  llm?: Llm;
  isProd: boolean;
  allowedOrigins: string[];
  trustProxy: boolean;
  sessionDays: number;
  webDist?: string;
  /** Limites configuráveis (os testes usam valores baixos). */
  limits?: { login?: number; register?: number; chat?: number; api?: number };
}

export interface Req {
  raw: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  ip: string;
  user: User | null;
  token: string | undefined;
  ctx(): Ctx; // exige usuário autenticado
}

export interface Reply {
  status?: number;
  json?: unknown;
  headers?: Record<string, string | string[]>;
}
export type Handler = (r: Req, app: AppState) => Reply | Promise<Reply>;

export interface AppState {
  opts: AppOptions;
  limiters: { login: RateLimiter; register: RateLimiter; chat: RateLimiter; api: RateLimiter };
}

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  auth: boolean;
  handler: Handler;
}
const routes: Route[] = [];

export function route(method: string, path: string, opts: { auth?: boolean }, handler: Handler): void {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:([a-z]+)/gi, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, auth: opts.auth ?? true, handler });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string, opts: { isProd: boolean; days: number }): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${opts.days * 86400}${opts.isProd ? "; Secure" : ""}`;
}
export function clearCookie(isProd: boolean): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isProd ? "; Secure" : ""}`;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

const SECURITY_HEADERS = (isProd: boolean): Record<string, string> => ({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(self)",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  ...(isProd ? { "Strict-Transport-Security": "max-age=15552000; includeSubDomains" } : {}),
});

const MAX_BODY = 64 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Requisição grande demais.", "grande_demais");
    chunks.push(c as Buffer);
  }
  if (!size) return undefined;
  const type = req.headers["content-type"] ?? "";
  if (!type.includes("application/json")) throw new HttpError(415, "Envie JSON.", "tipo_invalido");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido.", "json_invalido");
  }
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xf = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xf) ? xf[0] : xf)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

export function createApp(opts: AppOptions): { server: Server; state: AppState } {
  const l = opts.limits ?? {};
  const state: AppState = {
    opts,
    limiters: {
      login: new RateLimiter(l.login ?? 10, 15 * 60_000),
      register: new RateLimiter(l.register ?? 8, 60 * 60_000),
      chat: new RateLimiter(l.chat ?? 40, 60_000),
      api: new RateLimiter(l.api ?? 600, 60_000),
    },
  };
  const distRoot = opts.webDist ? resolve(opts.webDist) : undefined;

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS(opts.isProd), ...headers });
    res.end(payload);
  };

  const serveStatic = (req: IncomingMessage, res: ServerResponse, pathname: string): boolean => {
    if (!distRoot || !existsSync(distRoot)) return false;
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(distRoot, safe);
    if (!file.startsWith(distRoot + sep) && file !== distRoot) return false;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (extname(safe)) return false; // arquivo que não existe -> 404
      file = join(distRoot, "index.html"); // rota do app (SPA)
      if (!existsSync(file)) return false;
    }
    const ext = extname(file);
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ...SECURITY_HEADERS(opts.isProd),
    });
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
    return true;
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      const ip = clientIp(req, opts.trustProxy);

      if (!url.pathname.startsWith("/api/")) {
        if (serveStatic(req, res, url.pathname)) return;
        return send(res, 404, { error: "Não encontrado.", code: "nao_encontrado" });
      }

      const wait = state.limiters.api.check(ip);
      if (wait) return send(res, 429, { error: "Muitas requisições. Aguarde um instante.", code: "limite" }, { "Retry-After": String(wait) });

      // Proteção CSRF para métodos que alteram estado: cabeçalho customizado + checagem de Origin.
      if (method !== "GET" && method !== "HEAD") {
        if (req.headers["x-requested-with"] !== "veyra") throw new HttpError(403, "Requisição não autorizada.", "csrf");
        const origin = req.headers.origin;
        if (origin) {
          const same = origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
          if (!same && !opts.allowedOrigins.includes(origin)) throw new HttpError(403, "Origem não permitida.", "origem");
        }
      }

      const token = parseCookies(req.headers.cookie)[COOKIE];
      const user = userFromSession(opts.db, token, opts.clock.now()) ?? null;

      let matched: { r: Route; params: Record<string, string> } | undefined;
      let pathExists = false;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        pathExists = true;
        if (r.method !== method) continue;
        matched = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])) };
        break;
      }
      if (!matched) return send(res, pathExists ? 405 : 404, { error: pathExists ? "Método não permitido." : "Não encontrado.", code: "nao_encontrado" });
      if (matched.r.auth && !user) return send(res, 401, { error: "Faça login para continuar.", code: "nao_autenticado" });

      const body = method === "GET" || method === "HEAD" ? undefined : await readJson(req);
      const request: Req = {
        raw: req, res, url, params: matched.params, body, ip, user, token,
        ctx: () => {
          if (!user) throw new HttpError(401, "Faça login para continuar.", "nao_autenticado");
          return makeCtx(opts.db, user.id, opts.clock);
        },
      };
      const reply = await matched.r.handler(request, state);
      send(res, reply.status ?? 200, reply.json, reply.headers);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code });
      console.error("[erro]", e);
      send(res, 500, { error: "Algo deu errado do nosso lado. Tente novamente.", code: "interno" });
    }
  });
  return { server, state };
}
