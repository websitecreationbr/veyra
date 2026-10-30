import { resolve } from "node:path";
import { migrations } from "./migrations.js";
import { pgMigrations } from "./migrations.pg.js";
import { createPgPool, PostgresDb, type PgOptions } from "./postgres.js";
import { openSqlite, sqliteUserVersion } from "./sqlite.js";
import type { Db } from "./types.js";

export type { Db, Dialect } from "./types.js";
export { UniqueViolation } from "./types.js";
export type DB = Db;

export interface OpenOptions {
  /** URL do PostgreSQL (ex.: postgres://usuario:senha@host:5432/banco). Se informada, tem prioridade sobre o SQLite. */
  databaseUrl?: string;
  ssl?: string;
  poolMax?: number;
  /** Arquivo do SQLite (desenvolvimento local) ou ":memory:". */
  sqliteFile?: string;
}

/** Abre o banco certo (PostgreSQL se houver DATABASE_URL, senão SQLite) e aplica as migrações pendentes. */
export async function openDb(opts: OpenOptions | string): Promise<Db> {
  const o: OpenOptions = typeof opts === "string" ? { sqliteFile: opts } : opts;
  let db: Db;
  if (o.databaseUrl) {
    const pgo: PgOptions = { url: o.databaseUrl, ssl: o.ssl, max: o.poolMax };
    db = new PostgresDb(await createPgPool(pgo));
  } else {
    db = await openSqlite(o.sqliteFile ?? resolve(".data", "veyra.db"));
  }
  try {
    await migrate(db);
  } catch (e) {
    await db.close().catch(() => undefined);
    throw e;
  }
  return db;
}

/** Aplica as migrações pendentes. Pode ser chamada com qualquer Db (os testes usam isso com pools próprios). */
export async function migrate(db: Db): Promise<void> {
  if (db.dialect === "sqlite") {
    const current = await sqliteUserVersion(db);
    for (let i = current; i < migrations.length; i++) {
      const m = migrations[i]!;
      try {
        await db.tx(async (t) => {
          await t.run(m.sql);
          await t.run(`PRAGMA user_version = ${i + 1}`);
        });
      } catch (e) {
        throw new Error(`Falha na migração ${m.name}: ${(e as Error).message}`);
      }
    }
    return;
  }
  // PostgreSQL: tudo numa transação com trava consultiva — duas instâncias subindo ao mesmo tempo não se atropelam.
  await db.tx(async (t) => {
    await t.run("SELECT pg_advisory_xact_lock(727274)");
    await t.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    const done = new Set((await t.all<{ version: number }>("SELECT version FROM schema_migrations")).map((r) => Number(r.version)));
    for (let i = 0; i < pgMigrations.length; i++) {
      if (done.has(i + 1)) continue;
      const m = pgMigrations[i]!;
      try {
        await t.run(m.sql);
      } catch (e) {
        throw new Error(`Falha na migração ${m.name}: ${(e as Error).message}`);
      }
      await t.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)", i + 1, m.name, new Date().toISOString());
    }
  });
}

// ---- Atalhos (mantêm o código dos serviços curto): all(db, sql, ...), get(...), run(...), tx(...) ----
export const all = <T>(db: Db, sql: string, ...p: unknown[]) => db.all<T>(sql, ...p);
export const get = <T>(db: Db, sql: string, ...p: unknown[]) => db.get<T>(sql, ...p);
export const run = (db: Db, sql: string, ...p: unknown[]) => db.run(sql, ...p);
export const tx = <T>(db: Db, fn: (t: Db) => Promise<T>) => db.tx(fn);
