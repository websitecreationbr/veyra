// Adaptador para provedores "compatíveis com OpenAI" (POST /chat/completions): Google Gemini, Groq, OpenRouter…
// Traduz o formato interno (blocos no estilo Anthropic) para o do OpenAI e a resposta de volta.

import type { Block, Llm, LlmMessage, LlmResponse } from "./claude.js";

interface OaiToolCall { id?: string; type?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }

export function toOpenAiMessages(system: string, messages: LlmMessage[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === "assistant") {
      const text = m.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n");
      const uses = m.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      out.push({
        role: "assistant",
        content: text || null,
        ...(uses.length ? { tool_calls: uses.map((u) => ({ id: u.id, type: "function", function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) }, ...(u.extra ? { extra_content: u.extra } : {}) })) } : {}),
      });
    } else {
      for (const b of m.content) {
        if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
        else if (b.type === "text") out.push({ role: "user", content: b.text });
      }
    }
  }
  return out;
}

export function fromOpenAiResponse(json: any): LlmResponse {
  const choice = json?.choices?.[0];
  const msg = choice?.message;
  if (!msg) throw new Error("resposta inesperada do provedor de IA");
  const content: Block[] = [];
  if (typeof msg.content === "string" && msg.content.trim()) content.push({ type: "text", text: msg.content });
  const calls: OaiToolCall[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  calls.forEach((c, i) => {
    let input: unknown = {};
    try { input = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch { input = {}; }
    if (!c.function?.name) return;
    content.push({ type: "tool_use", id: c.id || `call_${i}_${Math.random().toString(36).slice(2, 8)}`, name: c.function.name, input, ...(c.extra_content ? { extra: c.extra_content } : {}) });
  });
  return { content, stop_reason: String(choice?.finish_reason ?? "stop") };
}

export function openAiCompatibleLlm(o: { baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch; headers?: Record<string, string> }): Llm {
  const f = o.fetchImpl ?? fetch;
  const url = o.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  return async ({ system, messages, tools }) => {
    const oaiTools = (tools as { name: string; description: string; input_schema: unknown }[]).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}`, ...(o.headers ?? {}) },
      body: JSON.stringify({ model: o.model, messages: toOpenAiMessages(system, messages), tools: oaiTools, tool_choice: "auto", temperature: 0.6, max_tokens: 1024 }),
      signal: AbortSignal.timeout(28_000),
    });
    if (!res.ok) throw new Error(`Provedor de IA respondeu ${res.status}`); // o corpo pode conter detalhes: não é repassado ao usuário
    return fromOpenAiResponse(await res.json());
  };
}
