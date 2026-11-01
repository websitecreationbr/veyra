// Escolhe o provedor de IA a partir das variáveis de ambiente. Todas as chaves ficam só no servidor.
// Gratuitos (com cotas): Google Gemini (AI Studio), Groq, OpenRouter (modelos ":free"). Pago (opcional): Anthropic.
import { anthropicLlm, type Llm } from "./claude.js";
import { openAiCompatibleLlm } from "./openai.js";

export interface AiProvider { name: string; model: string; llm: Llm }

const PRESETS = {
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-latest", keyVar: "GEMINI_API_KEY" },
  groq: { base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyVar: "GROQ_API_KEY" },
  openrouter: { base: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free", keyVar: "OPENROUTER_API_KEY" },
} as const;

type Env = Record<string, string | undefined>;

/** Devolve o provedor configurado ou undefined (sem chave = modo local, que funciona sem nuvem). */
export function resolveAi(env: Env, fetchImpl?: typeof fetch): AiProvider | undefined {
  const explicit = (env.AI_PROVIDER ?? "").toLowerCase();
  const pick =
    explicit ||
    (env.GEMINI_API_KEY ? "gemini" : env.GROQ_API_KEY ? "groq" : env.OPENROUTER_API_KEY ? "openrouter" : env.AI_API_KEY && env.AI_BASE_URL ? "custom" : env.ANTHROPIC_API_KEY ? "anthropic" : "");
  if (!pick) return undefined;

  if (pick === "anthropic") {
    const key = env.ANTHROPIC_API_KEY || env.AI_API_KEY;
    if (!key) return undefined;
    const model = env.AI_MODEL || env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
    return { name: "anthropic", model, llm: anthropicLlm(key, model, fetchImpl) };
  }
  if (pick === "custom") {
    if (!env.AI_API_KEY || !env.AI_BASE_URL || !env.AI_MODEL) return undefined;
    return { name: "custom", model: env.AI_MODEL, llm: openAiCompatibleLlm({ baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL, fetchImpl }) };
  }
  const p = PRESETS[pick as keyof typeof PRESETS];
  if (!p) return undefined;
  const key = env[p.keyVar] || env.AI_API_KEY;
  if (!key) return undefined;
  const model = env.AI_MODEL || p.model;
  return { name: pick, model, llm: openAiCompatibleLlm({ baseUrl: env.AI_BASE_URL || p.base, apiKey: key, model, fetchImpl }) };
}
