import { get, type DB } from "../db/index.js";
import { DEFAULT_TZ, localNow, type Clock, type LocalNow } from "../util/time.js";

/** Tudo que um serviço/ferramenta precisa saber sobre "quem está pedindo e quando". */
export interface Ctx {
  db: DB;
  userId: string;
  tz: string;
  clock: Clock;
  now: LocalNow;
  /** Cotações (dólar/Ibovespa); ausente nos testes que não precisam. */
  market?: import("./market.js").MarketService;
  /** Recursos do aparelho disponíveis nesta conversa (alarm, calendar). Vazio no navegador. */
  capabilities: Set<string>;
}

export async function makeCtx(
  db: DB, userId: string, clock: Clock,
  extra: { market?: import("./market.js").MarketService; capabilities?: Set<string> } = {},
): Promise<Ctx> {
  const s = await get<{ timezone: string }>(db, "SELECT timezone FROM settings WHERE user_id = ?", userId);
  const tz = s?.timezone ?? DEFAULT_TZ;
  return { db, userId, tz, clock, now: localNow(clock, tz), market: extra.market, capabilities: extra.capabilities ?? new Set() };
}
