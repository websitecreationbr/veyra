// Validação mínima de entrada, sem dependências. Toda entrada externa (HTTP e IA) passa por aqui.

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "erro",
  ) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError(400, msg, "entrada_invalida");

type Obj = Record<string, unknown>;

export function asObject(v: unknown, what = "corpo"): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad(`${what} inválido`);
  return v as Obj;
}

export function str(o: Obj, key: string, opts: { max?: number; min?: number; optional?: boolean } = {}): string | undefined {
  const v = o[key];
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return undefined;
    throw bad(`Campo obrigatório: ${key}`);
  }
  if (typeof v !== "string") throw bad(`Campo ${key} deve ser texto`);
  const t = v.trim();
  if (opts.min && t.length < opts.min) throw bad(`Campo ${key} muito curto`);
  if (t.length > (opts.max ?? 500)) throw bad(`Campo ${key} muito longo`);
  if (!t && !opts.optional) throw bad(`Campo obrigatório: ${key}`);
  return t || undefined;
}

export function reqStr(o: Obj, key: string, opts: { max?: number; min?: number } = {}): string {
  return str(o, key, opts) as string;
}

export function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], optional?: false): T;
export function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], optional: true): T | undefined;
export function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], optional = false): T | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (optional) return undefined;
    throw bad(`Campo obrigatório: ${key}`);
  }
  if (typeof v !== "string" || !allowed.includes(v as T)) throw bad(`Valor inválido para ${key}`);
  return v as T;
}

export function num(o: Obj, key: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | undefined {
  const v = o[key];
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return undefined;
    throw bad(`Campo obrigatório: ${key}`);
  }
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  if (!Number.isFinite(n)) throw bad(`Campo ${key} deve ser número`);
  if (opts.min !== undefined && n < opts.min) throw bad(`Campo ${key} abaixo do mínimo`);
  if (opts.max !== undefined && n > opts.max) throw bad(`Campo ${key} acima do máximo`);
  return n;
}

export function reqNum(o: Obj, key: string, opts: { min?: number; max?: number } = {}): number {
  return num(o, key, opts) as number;
}
