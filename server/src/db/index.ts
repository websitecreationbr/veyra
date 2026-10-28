import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrations } from "./migrations.js";

export type DB = DatabaseSync;

/** Abre (e migra) o banco. Use ":memory:" nos testes. */
export function openDb(file: string): DB {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let i = row.user_version; i < migrations.length; i++) {
    const m = migrations[i]!;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Falha na migração ${m.name}: ${(e as Error).message}`);
    }
  }
}

// ---- Helpers tipados (node:sqlite devolve objetos genéricos) ----
type Param = string | number | bigint | null | Uint8Array;
const clean = (p: unknown[]): Param[] => p.map((v) => (v === undefined ? null : (v as Param)));

export function all<T>(db: DB, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...clean(params)) as T[];
}
export function get<T>(db: DB, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...clean(params)) as T | undefined;
}
export function run(db: DB, sql: string, ...params: unknown[]): { changes: number } {
  const r = db.prepare(sql).run(...clean(params));
  return { changes: Number(r.changes) };
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
