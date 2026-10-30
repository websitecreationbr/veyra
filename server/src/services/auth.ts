import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { get, run, tx, UniqueViolation, type DB } from "../db/index.js";
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

export async function register(db: DB, input: { email: string; name: string; password: string; timezone?: string }): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!EMAIL_RE.test(email) || email.length > 254) throw bad("E-mail inválido.");
  if (name.length < 1 || name.length > 60) throw bad("Informe seu nome (até 60 caracteres).");
  if (input.password.length < 8) throw bad("A senha precisa ter pelo menos 8 caracteres.");
  if (input.password.length > 200) throw bad("Senha muito longa.");
  const tz = input.timezone && isValidTimezone(input.timezone) ? input.timezone : "America/Sao_Paulo";

  const emailTaken = () => new HttpError(409, "Este e-mail já está cadastrado.", "email_em_uso");
  if (await get(db, "SELECT 1 AS x FROM users WHERE email = ?", email)) throw emailTaken();
  const id = randomUUID();
  const passwordHash = hashPassword(input.password);
  try {
    await tx(db, async (t) => {
      await run(t, "INSERT INTO users (id, email, name, password_hash) VALUES (?,?,?,?)", id, email, name, passwordHash);
      await run(t, "INSERT INTO settings (user_id, timezone) VALUES (?,?)", id, tz);
      await seedDefaultCategories(t, id);
    });
  } catch (e) {
    // Dois cadastros simultâneos com o mesmo e-mail: o banco (UNIQUE) decide quem ganha.
    if (e instanceof UniqueViolation) throw emailTaken();
    throw e;
  }
  return { id, email, name, timezone: tz };
}

export async function authenticate(db: DB, emailRaw: string, password: string): Promise<User> {
  const email = emailRaw.trim().toLowerCase();
  const row = await get<{ id: string; email: string; name: string; password_hash: string }>(
    db,
    "SELECT id, email, name, password_hash FROM users WHERE email = ?",
    email,
  );
  const ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new HttpError(401, "E-mail ou senha incorretos.", "credenciais");
  return (await getUser(db, row.id))!;
}

export async function getUser(db: DB, id: string): Promise<User | undefined> {
  return get<User>(
    db,
    `SELECT u.id, u.email, u.name, s.timezone FROM users u JOIN settings s ON s.user_id = u.id WHERE u.id = ?`,
    id,
  );
}

export async function createSession(db: DB, userId: string, days: number, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + days * 86_400_000).toISOString();
  await run(db, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)", hashToken(token), userId, expires);
  return token;
}

export async function userFromSession(db: DB, token: string | undefined, now = new Date()): Promise<User | undefined> {
  if (!token) return undefined;
  const row = await get<{ user_id: string; expires_at: string }>(
    db,
    "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
    hashToken(token),
  );
  if (!row) return undefined;
  if (row.expires_at <= now.toISOString()) {
    await run(db, "DELETE FROM sessions WHERE token_hash = ?", hashToken(token));
    return undefined;
  }
  return getUser(db, row.user_id);
}

export async function destroySession(db: DB, token: string | undefined): Promise<void> {
  if (token) await run(db, "DELETE FROM sessions WHERE token_hash = ?", hashToken(token));
}

export async function updateProfile(db: DB, userId: string, patch: { name?: string; timezone?: string }): Promise<User> {
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n || n.length > 60) throw bad("Nome inválido.");
    await run(db, "UPDATE users SET name = ? WHERE id = ?", n, userId);
  }
  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) throw bad("Fuso horário inválido.");
    await run(db, "UPDATE settings SET timezone = ? WHERE user_id = ?", patch.timezone, userId);
  }
  return (await getUser(db, userId))!;
}
