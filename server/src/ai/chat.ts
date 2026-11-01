import type { Ctx } from "../services/context.js";
import { executeTool, getTool } from "./tools.js";
import { interpret, type Pending, type Plan } from "./local.js";
import { plannedReply } from "./planned.js";
import { resumeClaude, startClaude, describeDevice, type DeviceCall, type ExecutedCall, type Llm, type LlmMessage, type LlmState } from "./claude.js";
import { history, lastPending, lastTopic, saveMessage, type ActionChip, type ChatMessage } from "../services/messages.js";
import { saveContinuation, takeContinuation } from "../services/continuations.js";
import type { DeviceResult, ToolResult } from "./types.js";
import { HttpError, bad } from "../util/validate.js";
import { addDays, endOfMonth } from "../util/time.js";

export interface ChatDeps {
  /** Cliente da IA em nuvem; ausente = interpretador local. */
  llm?: Llm;
}

export interface ChatTurn {
  /** Mensagem do usuário recém-salva (ausente ao retomar uma conversa pausada). */
  user?: ChatMessage;
  /** Resposta final. Nula enquanto o aparelho ainda precisa executar algo (veja `device`). */
  assistant: ChatMessage | null;
  provider: "claude" | "local";
  /** true quando a nuvem falhou e o interpretador local assumiu. */
  degraded: boolean;
  /** Ações a executar NO APARELHO. O app responde em POST /api/chat/continue com este continuationId. */
  device?: { continuationId: string; calls: DeviceCall[] };
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
    const lead = w.result.record?.kind === "transaction" || w.name === "registrar_habito" ? "Registrado." : getTool(w.name)?.device ? "" : "Pronto.";
    parts.push(lead ? `${lead}\n\n${w.result.text}` : w.result.text);
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
  ...(e.name === "consultar_mercado" ? { input: e.input } : {}),
});

// ---------------------------------------------------------------------------------------------
// Modo local (sem IA em nuvem)
// ---------------------------------------------------------------------------------------------
interface LocalState {
  kind: "local";
  executed: ExecutedCall[];
  waiting: { callId: string; name: string; input: unknown; params: Record<string, unknown> }[];
  extras: { planned: string[]; notes: string[]; ask?: string };
  pendingOut: Pending | null;
  degraded: boolean;
}
interface LlmStateBox { kind: "llm"; state: LlmState }

/** Com o calendário do celular ligado, compromissos criados/consultados também passam por ele. */
export function withPhoneCalendar(plan: Plan, ctx: Ctx): Plan {
  if (!ctx.capabilities.has("calendar")) return plan;
  const today = ctx.now.date;
  const extra: Plan["calls"] = [];
  for (const c of plan.calls) {
    if (c.name === "criar_evento" && c.input.hora && !c.input.recorrencia) {
      extra.push({ name: "criar_evento_calendario", input: { titulo: c.input.titulo, data: c.input.data ?? today, hora: c.input.hora, hora_fim: c.input.hora_fim, local: c.input.local } });
    }
    if (c.name === "consultar_agenda") {
      const p = String(c.input.periodo ?? "hoje");
      const [de, ate] = p === "amanha" ? [addDays(today, 1), addDays(today, 1)] : p === "semana" || p === "proximos_7_dias" ? [today, addDays(today, 6)] : p === "mes" ? [today, endOfMonth(today)] : [today, today];
      extra.push({ name: "consultar_calendario", input: { de, ate } });
    }
  }
  return { ...plan, calls: [...plan.calls, ...extra] };
}

async function runPlan(ctx: Ctx, plan: Plan): Promise<{ executed: ExecutedCall[]; waiting: LocalState["waiting"] }> {
  const executed: ExecutedCall[] = [];
  const waiting: LocalState["waiting"] = [];
  let n = 0;
  for (const c of plan.calls) {
    const tool = getTool(c.name);
    if (tool?.device) {
      if (!ctx.capabilities.has(tool.device.capability)) {
        const text = tool.device.capability === "alarm"
          ? "Alarmes só funcionam no aplicativo Android da Veyra (o navegador não tem acesso ao relógio do celular)."
          : "O calendário do celular só funciona no aplicativo Android da Veyra, com a permissão liberada em Mais.";
        executed.push({ name: c.name, input: c.input, result: { ok: false, mode: "write", text } });
        continue;
      }
      try {
        const params = tool.device.prepare(ctx, c.input);
        waiting.push({ callId: `loc_${++n}`, name: c.name, input: c.input, params });
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        executed.push({ name: c.name, input: c.input, result: { ok: false, mode: "write", text: e.message } });
      }
      continue;
    }
    executed.push({ name: c.name, input: c.input, result: (await executeTool(ctx, c.name, c.input)) as ToolResult });
  }
  return { executed, waiting };
}

const deviceCalls = (waiting: { callId: string; name: string; params: Record<string, unknown> }[]): DeviceCall[] =>
  waiting.map((w) => ({ callId: w.callId, name: w.name, action: getTool(w.name)!.device!.action, params: w.params }));

async function pause(ctx: Ctx, box: LocalState | LlmStateBox, calls: DeviceCall[], provider: "claude" | "local", degraded: boolean, user?: ChatMessage): Promise<ChatTurn> {
  const continuationId = await saveContinuation(ctx, box);
  return { user, assistant: null, provider, degraded, device: { continuationId, calls } };
}

export async function handleChat(ctx: Ctx, rawText: string, deps: ChatDeps): Promise<ChatTurn> {
  const text = rawText.trim();
  if (!text) throw bad("Escreva algo para a Veyra.");
  if (text.length > 2000) throw bad("Mensagem muito longa (máximo 2000 caracteres).");

  const pending = await lastPending(ctx);
  const topic = await lastTopic(ctx);
  const prior = await history(ctx, 12);
  const user = await saveMessage(ctx, { role: "user", text });

  let reply = "";
  let executed: ExecutedCall[] = [];
  let provider: "claude" | "local" = "local";
  let degraded = false;

  if (deps.llm) {
    const done: ExecutedCall[] = [];
    try {
      const out = await startClaude(ctx, toLlmHistory(prior), text, deps.llm, (e) => done.push(e));
      if (out.kind === "device") return pause(ctx, { kind: "llm", state: out.state }, out.calls, "claude", false, user);
      reply = out.text;
      executed = out.executed;
      provider = "claude";
    } catch (e) {
      console.error("[ia] falhou:", (e as Error).message);
      degraded = true;
      if (done.length) {
        // Já executamos ações reais: NÃO repetir. Só montar a resposta com o que foi feito.
        executed = done;
        reply = composeReply(done, { notes: ["(Tive um problema de conexão com a IA, mas as ações acima foram executadas.)"] });
      }
    }
  }

  let pendingOut: Pending | null = null;
  if (provider === "local" && !executed.length) {
    const plan = withPhoneCalendar(interpret(text, ctx.now, pending, { topic, capabilities: ctx.capabilities }), ctx);
    const r = await runPlan(ctx, plan);
    pendingOut = plan.ask?.pending ?? null;
    const extras = { planned: plan.planned, notes: plan.reply && (r.executed.length || r.waiting.length || plan.ask || plan.planned.length) ? [plan.reply] : [], ask: plan.ask?.question };
    if (r.waiting.length) {
      return pause(ctx, { kind: "local", executed: r.executed, waiting: r.waiting, extras: { ...extras, notes: [...extras.notes, ...(degraded ? ["(A IA em nuvem está indisponível agora; usei o modo local.)"] : [])] }, pendingOut, degraded }, deviceCalls(r.waiting), "local", degraded, user);
    }
    executed = r.executed;
    reply = plan.reply && !executed.length && !plan.ask && !plan.planned.length ? plan.reply : composeReply(executed, extras);
    if (degraded) reply += "\n\n(A IA em nuvem está indisponível agora; usei o modo local.)";
  }

  const assistant = await saveMessage(ctx, { role: "assistant", text: reply, actions: executed.map(chip), pending: pendingOut });
  return { user, assistant, provider, degraded };
}

/** O app executou as ações do aparelho: devolve os resultados e a conversa continua de onde parou. */
export async function handleContinue(ctx: Ctx, continuationId: string, results: { callId: string; result: DeviceResult }[], deps: ChatDeps): Promise<ChatTurn> {
  const box = await takeContinuation<LocalState | LlmStateBox>(ctx, continuationId);

  if (box.kind === "local") {
    const executed = [...box.executed];
    for (const w of box.waiting) {
      const r = results.find((x) => x.callId === w.callId)?.result ?? { ok: false, error: "sem_resposta_do_aparelho" };
      executed.push({ name: w.name, input: w.input, result: describeDevice(ctx, w.name, w.params, r) });
    }
    const reply = composeReply(executed, box.extras);
    const assistant = await saveMessage(ctx, { role: "assistant", text: reply, actions: executed.map(chip), pending: box.pendingOut });
    return { assistant, provider: "local", degraded: box.degraded };
  }

  if (!deps.llm) throw new HttpError(410, "A IA não está mais disponível para continuar. Peça de novo.", "expirada");
  const done: ExecutedCall[] = [];
  try {
    const out = await resumeClaude(ctx, box.state, results, deps.llm, (e) => done.push(e));
    if (out.kind === "device") return pause(ctx, { kind: "llm", state: out.state }, out.calls, "claude", false);
    const assistant = await saveMessage(ctx, { role: "assistant", text: out.text, actions: out.executed.map(chip) });
    return { assistant, provider: "claude", degraded: false };
  } catch (e) {
    console.error("[ia] falhou ao continuar:", (e as Error).message);
    // Ações do aparelho JÁ aconteceram: reporta o que foi feito, sem repetir nada.
    const executed = [...box.state.executed, ...done.filter((d) => !box.state.executed.includes(d))];
    const reply = composeReply(executed.length ? executed : [], { notes: ["(Tive um problema de conexão com a IA ao concluir, mas o que aparece acima é o que de fato aconteceu.)"] });
    const assistant = await saveMessage(ctx, { role: "assistant", text: reply, actions: executed.map(chip) });
    return { assistant, provider: "claude", degraded: true };
  }
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
