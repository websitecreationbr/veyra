// Limitador de taxa simples em memória (janela fixa). Suficiente para uma instância única;
// para várias instâncias, troque por Redis mantendo esta mesma interface.

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}

  /** Retorna 0 se liberado, ou os segundos até poder tentar de novo. */
  check(key: string): number {
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

  reset(key: string) {
    this.hits.delete(key);
  }

  private gc(t: number) {
    if (this.hits.size < 5000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}
