import type { Ctx } from "../services/context.js";

/** Referência a um registro criado (permite "Desfazer" no app). */
export interface RecordRef {
  kind: "transaction" | "task" | "reminder" | "event";
  id: string;
}

export interface ToolResult {
  ok: boolean;
  /** "write" altera dados; "read" só consulta. Define como a resposta é montada. */
  mode: "write" | "read";
  /** Texto completo para o usuário (leituras) ou detalhe quando é a única ação (escritas). */
  text: string;
  /** Linha compacta usada quando há várias ações na mesma mensagem. */
  line?: string;
  /** Dados estruturados devolvidos à IA (Claude) para ela redigir a resposta. */
  data?: unknown;
  record?: RecordRef;
}

export interface Tool {
  name: string;
  description: string;
  /** JSON Schema enviado ao modelo. */
  input_schema: Record<string, unknown>;
  run(ctx: Ctx, input: unknown): ToolResult;
}

/** Funcionalidades previstas no roadmap que ainda NÃO existem. Respondemos honestamente em vez de simular. */
export interface PlannedFeature {
  id: string;
  title: string;
  phase: string;
  needs: string;
}
