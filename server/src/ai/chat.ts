import type { Ctx } from "../services/context.js";
import { executeTool } from "./tools.js";
import { interpret, type Pending, type Plan } from "./local.js";
import { plannedReply } from "./planned.js";
import { runClaude, type ExecutedCall, type Llm, type LlmMessage } from "./claude.js";
import { history, lastPending, saveMessage, type ActionChip, type ChatMessage } from "../services/messages.js";
import type { ToolResult } from "./types.js";
import { bad } from "../util/validate.js";

export interface ChatDeps {
  /** Cliente do Claude; ausente = interpretador local. */
  llm?: Llm;
}

export interface ChatTurn {
  user: ChatMessage;
  assistant: ChatMessage;
  provider: "claude" | "local";
  /** true quando a nuvem falhou e o interpretador local assumiu. */
  degraded: boolean;
}

/** Monta a resposta de texto a partir dos resultados das ferramentas (modo local e fallback). */
export function composeReply(executed: ExecutedCall[], extras: { planned?: string[]; notes?: string[]; ask?: string } = {}): string {
  const ok = executed.filter((e) => e.result.ok);
  const failed = executed.filter((e) => !e.result.ok);
  const writes = ok.filter((e) => e.result.mode === "write");
  const reads = ok.filter((e) => e.result.mode === "read");
  const parts: string[] = [];

  if (writes.length === 1 && !reads.length) {
    const w = writes[0]!;
    parts.push(`${w.result.record?.kind === "transaction" || w.name === "registrar_habito" ? "Registrado." : "Pronto."}\n\n${w.result.text}`);
  } else if (writes.length >= 1) {
    parts.push(`Tudo certo.\n\n${writes.map((w) => w.result.line ?? w.result.text.split("\n")[0]).join("\n")}`);
  }
  for (const r of reads) parts.push(r.result.text);
  if (failed.length) parts.push(failed.map((f) => f.result.text).join("\n"));
  for (const p of extras.planned ?? []) parts.push(plannedReply(p));
  for (const n of extras.notes ?? []) parts.push(n);
  if (extras.ask) parts.push(extras.ask);
  return parts.join("\n\n") || "Pronto.";
}

const chip = (e: ExecutedCall): ActionChip => ({
  tool: e.name,
  ok: e.result.ok,
  line: e.result.line ?? e.result.text.split("\n")[0] ?? e.name,
  record: e.result.record,
});

function runPlan(ctx: Ctx, plan: Plan): { text: string; executed: ExecutedCall[] } {
  const executed: ExecutedCall[] = plan.calls.map((c) => ({ name: c.name, input: c.input, result: executeTool(ctx, c.name, c.input) as ToolResult }));
  if (plan.reply && !executed.length && !plan.ask && !plan.planned.length) return { text: plan.reply, executed };
  const text = composeReply(executed, { planned: plan.planned, notes: plan.reply ? [plan.reply] : [], ask: plan.ask?.question });
  return { text, executed };
}

export async function handleChat(ctx: Ctx, rawText: string, deps: ChatDeps): Promise<ChatTurn> {
  const text = rawText.trim();
  if (!text) throw bad("Escreva algo para a Veyra.");
  if (text.length > 2000) throw bad("Mensagem muito longa (máximo 2000 caracteres).");

  const pending = lastPending(ctx);
  const prior = history(ctx, 12);
  const user = saveMessage(ctx, { role: "user", text });

  let reply = "";
  let executed: ExecutedCall[] = [];
  let pendingOut: Pending | null = null;
  let provider: "claude" | "local" = "local";
  let degraded = false;

  if (deps.llm) {
    const done: ExecutedCall[] = [];
    try {
      const llmHistory: LlmMessage[] = toLlmHistory(prior);
      const out = await runClaude(ctx, llmHistory, text, deps.llm, (e) => done.push(e));
      reply = out.text;
      executed = out.executed;
      provider = "claude";
    } catch (e) {
      console.error("[claude] falhou:", (e as Error).message);
      degraded = true;
      if (done.length) {
        // Já executamos ações reais: NÃO repetir. Só montar a resposta com o que foi feito.
        executed = done;
        reply = composeReply(done, { notes: ["(Tive um problema de conexão com a IA, mas as ações acima foram executadas.)"] });
      }
    }
  }

  if (provider === "local" && !executed.length) {
    const plan = interpret(text, ctx.now, pending);
    const r = runPlan(ctx, plan);
    reply = r.text;
    executed = r.executed;
    pendingOut = plan.ask?.pending ?? null;
    if (degraded) reply += "\n\n(A IA em nuvem está indisponível agora; usei o modo local.)";
  }

  const assistant = saveMessage(ctx, { role: "assistant", text: reply, actions: executed.map(chip), pending: pendingOut });
  return { user, assistant, provider, degraded };
}

function toLlmHistory(prior: ChatMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of prior) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content as string}\n${m.text}`;
    else out.push({ role: m.role, content: m.text });
  }
  while (out[0]?.role === "assistant") out.shift(); // a API exige começar por "user"
  if (out[out.length - 1]?.role === "user") out.pop(); // será seguido pela nova mensagem do usuário
  return out;
}
