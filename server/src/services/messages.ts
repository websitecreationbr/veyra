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

export function saveMessage(ctx: Ctx, m: { role: "user" | "assistant"; text: string; actions?: ActionChip[]; pending?: Pending | null }): ChatMessage {
  const id = randomUUID();
  run(ctx.db, "INSERT INTO messages (id, user_id, role, content, actions, pending) VALUES (?,?,?,?,?,?)",
    id, ctx.userId, m.role, m.text, m.actions?.length ? JSON.stringify(m.actions) : null, m.pending ? JSON.stringify(m.pending) : null);
  return toMsg(get<Row>(ctx.db, "SELECT * FROM messages WHERE id = ?", id)!);
}

export function history(ctx: Ctx, limit = 60): ChatMessage[] {
  return all<Row>(ctx.db, "SELECT * FROM (SELECT rowid AS rid, * FROM messages WHERE user_id = ? ORDER BY rowid DESC LIMIT ?) ORDER BY rid", ctx.userId, limit).map(toMsg);
}

/** Se a última mensagem da Veyra fez uma pergunta de acompanhamento, devolve o contexto dela. */
export function lastPending(ctx: Ctx): Pending | undefined {
  const last = get<Row>(ctx.db, "SELECT * FROM messages WHERE user_id = ? ORDER BY rowid DESC LIMIT 1", ctx.userId);
  if (last?.role === "assistant" && last.pending) return JSON.parse(last.pending) as Pending;
  return undefined;
}

export function clearHistory(ctx: Ctx): void {
  run(ctx.db, "DELETE FROM messages WHERE user_id = ?", ctx.userId);
}
