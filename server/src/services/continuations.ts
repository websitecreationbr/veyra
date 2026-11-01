// Conversas pausadas: a IA pediu uma ação no aparelho (alarme/calendário) e o app ainda vai responder.
// O estado fica no banco (a Vercel não guarda memória entre requisições), preso ao usuário e de USO ÚNICO.
import { randomBytes } from "node:crypto";
import { get, run } from "../db/index.js";
import type { Ctx } from "./context.js";
import { HttpError } from "../util/validate.js";

const TTL_MS = 10 * 60_000;
const MAX_STATE = 200_000;

export async function saveContinuation(ctx: Ctx, state: unknown): Promise<string> {
  const json = JSON.stringify(state);
  if (json.length > MAX_STATE) throw new HttpError(413, "Conversa grande demais para continuar.", "grande_demais");
  const id = randomBytes(18).toString("base64url");
  const now = ctx.clock.now();
  await run(ctx.db, "DELETE FROM chat_continuations WHERE user_id = ? AND expires_at <= ?", ctx.userId, now.toISOString());
  await run(ctx.db, "INSERT INTO chat_continuations (id, user_id, state, expires_at) VALUES (?,?,?,?)", id, ctx.userId, json, new Date(now.getTime() + TTL_MS).toISOString());
  return id;
}

/** Lê e APAGA (uso único). Só o dono enxerga; expirada/inexistente/de outro usuário = 410. */
export async function takeContinuation<T>(ctx: Ctx, id: string): Promise<T> {
  const gone = () => new HttpError(410, "Essa ação do aparelho expirou. Peça de novo.", "expirada");
  const row = await get<{ state: string; expires_at: string }>(ctx.db, "SELECT state, expires_at FROM chat_continuations WHERE id = ? AND user_id = ?", id, ctx.userId);
  if (!row) throw gone();
  const del = await run(ctx.db, "DELETE FROM chat_continuations WHERE id = ? AND user_id = ?", id, ctx.userId);
  if (del.changes === 0 || row.expires_at <= ctx.clock.now().toISOString()) throw gone();
  return JSON.parse(row.state) as T;
}
