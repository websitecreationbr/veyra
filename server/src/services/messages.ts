import { randomUUID } from "node:crypto";
import { all, get, run } from "../db/index.js";
import type { Ctx } from "./context.js";
import type { RecordRef } from "../ai/types.js";
import type { Pending } from "../ai/local.js";

export interface ActionChip {
  tool: string;
  ok: boolean;
  line: string;
  record?: RecordRef;
  /** Parâmetros da consulta (só para consultas de mercado: serve para entender "e ontem?"). */
  input?: unknown;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions: ActionChip[];
  createdAt: string;
  awaitingAnswer?: boolean;
}

interface Row {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions: string | null;
  pending: string | null;
  created_at: string;
}
const toMsg = (r: Row): ChatMessage => ({
  id: r.id,
  role: r.role,
  text: r.content,
  actions: r.actions ? (JSON.parse(r.actions) as ActionChip[]) : [],
  createdAt: r.created_at,
  awaitingAnswer: !!r.pending,
});

export async function saveMessage(ctx: Ctx, m: { role: "user" | "assistant"; text: string; actions?: ActionChip[]; pending?: Pending | null }): Promise<ChatMessage> {
  const id = randomUUID();
  await run(ctx.db,
    `INSERT INTO messages (id, user_id, role, content, actions, pending, seq)
     VALUES (?,?,?,?,?,?, (SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE user_id = ?))`,
    id, ctx.userId, m.role, m.text, m.actions?.length ? JSON.stringify(m.actions) : null, m.pending ? JSON.stringify(m.pending) : null, ctx.userId);
  return toMsg((await get<Row>(ctx.db, "SELECT * FROM messages WHERE user_id = ? AND id = ?", ctx.userId, id))!);
}

export async function history(ctx: Ctx, limit = 60): Promise<ChatMessage[]> {
  const rows = await all<Row>(ctx.db, "SELECT * FROM (SELECT * FROM messages WHERE user_id = ? ORDER BY seq DESC LIMIT ?) m ORDER BY seq", ctx.userId, limit);
  return rows.map(toMsg);
}

/** Se a última mensagem da Veyra fez uma pergunta de acompanhamento, devolve o contexto dela. */
export async function lastPending(ctx: Ctx): Promise<Pending | undefined> {
  const last = await get<Row>(ctx.db, "SELECT * FROM messages WHERE user_id = ? ORDER BY seq DESC LIMIT 1", ctx.userId);
  if (last?.role === "assistant" && last.pending) return JSON.parse(last.pending) as Pending;
  return undefined;
}

export async function clearHistory(ctx: Ctx): Promise<void> {
  await run(ctx.db, "DELETE FROM messages WHERE user_id = ?", ctx.userId);
}

/** Assunto da última resposta (para perguntas de acompanhamento como "ele subiu ou caiu hoje?"). */
export async function lastTopic(ctx: Ctx): Promise<{ market?: "dolar" | "ibovespa" }> {
  const last = await get<Row>(ctx.db, "SELECT * FROM messages WHERE user_id = ? AND role = 'assistant' ORDER BY seq DESC LIMIT 1", ctx.userId);
  if (!last?.actions) return {};
  try {
    const chips = JSON.parse(last.actions) as ActionChip[];
    const m = chips.find((c) => c.tool === "consultar_mercado" && c.ok);
    const a = (m?.input as { ativo?: string } | undefined)?.ativo;
    return a === "dolar" || a === "ibovespa" ? { market: a } : {};
  } catch {
    return {};
  }
}
