import { get, type DB } from "../db/index.js";
import { DEFAULT_TZ, localNow, type Clock, type LocalNow } from "../util/time.js";

/** Tudo que um serviço/ferramenta precisa saber sobre "quem está pedindo e quando". */
export interface Ctx {
  db: DB;
  userId: string;
  tz: string;
  clock: Clock;
  now: LocalNow;
}

export function makeCtx(db: DB, userId: string, clock: Clock): Ctx {
  const s = get<{ timezone: string }>(db, "SELECT timezone FROM settings WHERE user_id = ?", userId);
  const tz = s?.timezone ?? DEFAULT_TZ;
  return { db, userId, tz, clock, now: localNow(clock, tz) };
}
