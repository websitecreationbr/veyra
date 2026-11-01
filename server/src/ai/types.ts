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

/** Ações que o app Android sabe executar no aparelho. É uma LISTA FECHADA: a IA não consegue pedir nada fora dela. */
export type DeviceAction = "alarm.set" | "calendar.query" | "calendar.create" | "calendar.update" | "calendar.delete";
export type DeviceCapability = "alarm" | "calendar";

/** Resposta do aparelho a uma ação (dados NÃO confiáveis: vêm do celular e podem conter texto de terceiros). */
export interface DeviceResult {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
  [k: string]: unknown;
}

export interface DeviceSpec {
  capability: DeviceCapability;
  action: DeviceAction;
  /** Valida e normaliza os parâmetros no servidor ANTES de mandar ao aparelho (lança erro 400 se inválidos). */
  prepare(ctx: Ctx, input: unknown): Record<string, unknown>;
  /** Transforma a resposta do aparelho em texto verdadeiro para o usuário/IA. */
  describe(ctx: Ctx, params: Record<string, unknown>, result: DeviceResult): ToolResult;
}

export interface Tool {
  name: string;
  description: string;
  /** JSON Schema enviado ao modelo. */
  input_schema: Record<string, unknown>;
  run(ctx: Ctx, input: unknown): Promise<ToolResult>;
  /** Presente = ferramenta executada no APARELHO (não no servidor). */
  device?: DeviceSpec;
}

/** Funcionalidades previstas no roadmap que ainda NÃO existem. Respondemos honestamente em vez de simular. */
export interface PlannedFeature {
  id: string;
  title: string;
  phase: string;
  needs: string;
}
