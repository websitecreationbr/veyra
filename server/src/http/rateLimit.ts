import type { Db } from "../db/index.js";

/** Retorna 0 se liberado, ou os segundos até poder tentar de novo. */
export interface Limiter {
  check(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

/** Em memória (janela fixa) — usado só para o limite geral da API: rápido, mas por instância. */
export class MemoryLimiter implements Limiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}

  async check(key: string): Promise<number> {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      this.gc(t);
      return 0;
    }
    h.count++;
    return h.count > this.max ? Math.ceil((h.resetAt - t) / 1000) : 0;
  }
  async reset(key: string): Promise<void> {
    this.hits.delete(key);
  }
  private gc(t: number) {
    if (this.hits.size < 5000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

/**
 * Guardado no banco (tabela rate_limits): vale para todas as instâncias — essencial na Vercel, onde cada
 * requisição pode cair numa função diferente e a memória não é compartilhada. Usado em login, cadastro e chat.
 */
export class DbLimiter implements Limiter {
  constructor(private db: Db, private name: string, private max: number, private windowMs: number, private now: () => number = Date.now) {}

  async check(key: string): Promise<number> {
    const t = this.now();
    const k = `${this.name}:${key}`;
    // Upsert atômico: abre uma janela nova se a anterior expirou; senão, soma 1.
    const row = await this.db.get<{ hits: number; reset_at: number }>(
      `INSERT INTO rate_limits (k, hits, reset_at) VALUES (?, 1, ?)
       ON CONFLICT (k) DO UPDATE SET
         hits = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`,
      k, t + this.windowMs, t, t, t + this.windowMs,
    );
    if (Math.random() < 0.02) await this.db.run("DELETE FROM rate_limits WHERE reset_at <= ?", t).catch(() => undefined);
    if (!row) return 0;
    return Number(row.hits) > this.max ? Math.ceil((Number(row.reset_at) - t) / 1000) : 0;
  }

  async reset(key: string): Promise<void> {
    await this.db.run("DELETE FROM rate_limits WHERE k = ?", `${this.name}:${key}`);
  }
}
