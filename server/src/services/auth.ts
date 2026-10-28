import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { get, run, tx, type DB } from "../db/index.js";
import { HttpError, bad } from "../util/validate.js";
import { seedDefaultCategories } from "./finance.js";
import { isValidTimezone } from "../util/time.js";

export interface User {
  id: string;
  email: string;
  name: string;
  timezone: string;
}

const SCRYPT_N = 16384;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, 64, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString("base64")}$${dk.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !n || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const dk = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n) });
  return timingSafeEqual(dk, expected);
}

// Hash "de mentira" para gastar o mesmo tempo quando o e-mail não existe (evita enumerar contas pelo tempo de resposta).
const DUMMY_HASH = hashPassword("veyra-dummy-password");

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function register(db: DB, input: { email: string; name: string; password: string; timezone?: string }): User {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!EMAIL_RE.test(email) || email.length > 254) throw bad("E-mail inválido.");
  if (name.length < 1 || name.length > 60) throw bad("Informe seu nome (até 60 caracteres).");
  if (input.password.length < 8) throw bad("A senha precisa ter pelo menos 8 caracteres.");
  if (input.password.length > 200) throw bad("Senha muito longa.");
  const tz = input.timezone && isValidTimezone(input.timezone) ? input.timezone : "America/Sao_Paulo";

  if (get(db, "SELECT 1 AS x FROM users WHERE email = ?", email)) {
    throw new HttpError(409, "Este e-mail já está cadastrado.", "email_em_uso");
  }
  const id = randomUUID();
  tx(db, () => {
    run(db, "INSERT INTO users (id, email, name, password_hash) VALUES (?,?,?,?)", id, email, name, hashPassword(input.password));
    run(db, "INSERT INTO settings (user_id, timezone) VALUES (?,?)", id, tz);
    seedDefaultCategories(db, id);
  });
  return { id, email, name, timezone: tz };
}

export function authenticate(db: DB, emailRaw: string, password: string): User {
  const email = emailRaw.trim().toLowerCase();
  const row = get<{ id: string; email: string; name: string; password_hash: string }>(
    db,
    "SELECT id, email, name, password_hash FROM users WHERE email = ?",
    email,
  );
  const ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new HttpError(401, "E-mail ou senha incorretos.", "credenciais");
  return getUser(db, row.id)!;
}

export function getUser(db: DB, id: string): User | undefined {
  return get<User>(
    db,
    `SELECT u.id, u.email, u.name, s.timezone FROM users u JOIN settings s ON s.user_id = u.id WHERE u.id = ?`,
    id,
  );
}

export function createSession(db: DB, userId: string, days: number, now = new Date()): string {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + days * 86_400_000).toISOString();
  run(db, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)", hashToken(token), userId, expires);
  return token;
}

export function userFromSession(db: DB, token: string | undefined, now = new Date()): User | undefined {
  if (!token) return undefined;
  const row = get<{ user_id: string; expires_at: string }>(
    db,
    "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
    hashToken(token),
  );
  if (!row) return undefined;
  if (row.expires_at <= now.toISOString()) {
    run(db, "DELETE FROM sessions WHERE token_hash = ?", hashToken(token));
    return undefined;
  }
  return getUser(db, row.user_id);
}

export function destroySession(db: DB, token: string | undefined): void {
  if (token) run(db, "DELETE FROM sessions WHERE token_hash = ?", hashToken(token));
}

export function updateProfile(db: DB, userId: string, patch: { name?: string; timezone?: string }): User {
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n || n.length > 60) throw bad("Nome inválido.");
    run(db, "UPDATE users SET name = ? WHERE id = ?", n, userId);
  }
  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) throw bad("Fuso horário inválido.");
    run(db, "UPDATE settings SET timezone = ? WHERE user_id = ?", patch.timezone, userId);
  }
  return getUser(db, userId)!;
}
