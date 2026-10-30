import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { cleanParams, UniqueViolation, type Db } from "./types.js";

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const err = e as { errcode?: number; message?: string };
    if (err.errcode === 2067 || err.errcode === 1555 || /UNIQUE constraint failed/i.test(err.message ?? "")) throw new UniqueViolation(err.message);
    throw e;
  }
}

/** Conexão "crua": executa na hora. Usada dentro de transações. */
class SqliteConn implements Db {
  readonly dialect = "sqlite" as const;
  constructor(protected raw: DatabaseSync) {}
  async all<T>(sql: string, ...p: unknown[]): Promise<T[]> {
    return wrap(() => this.raw.prepare(sql).all(...cleanParams(p)) as T[]);
  }
  async get<T>(sql: string, ...p: unknown[]): Promise<T | undefined> {
    return wrap(() => this.raw.prepare(sql).get(...cleanParams(p)) as T | undefined);
  }
  async run(sql: string, ...p: unknown[]): Promise<{ changes: number }> {
    if (p.length === 0 && sql.includes(";") && /;\s*\S/.test(sql)) {
      wrap(() => this.raw.exec(sql)); // vários comandos (migrações)
      return { changes: 0 };
    }
    return wrap(() => ({ changes: Number(this.raw.prepare(sql).run(...cleanParams(p)).changes) }));
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return fn(this); // transação aninhada: já estamos dentro de uma
  }
  async close(): Promise<void> {}
}

/**
 * Conexão principal. Como o SQLite tem UMA conexão e o código é assíncrono, as operações são enfileiradas:
 * assim, uma transação nunca "engole" comandos de outra requisição que chegou no meio.
 */
class SqliteDb extends SqliteConn {
  private chain: Promise<unknown> = Promise.resolve();
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }
  override all<T>(sql: string, ...p: unknown[]): Promise<T[]> {
    return this.exclusive(() => super.all<T>(sql, ...p));
  }
  override get<T>(sql: string, ...p: unknown[]): Promise<T | undefined> {
    return this.exclusive(() => super.get<T>(sql, ...p));
  }
  override run(sql: string, ...p: unknown[]): Promise<{ changes: number }> {
    return this.exclusive(() => super.run(sql, ...p));
  }
  override tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.raw.exec("BEGIN");
      try {
        const out = await fn(new SqliteConn(this.raw));
        this.raw.exec("COMMIT");
        return out;
      } catch (e) {
        this.raw.exec("ROLLBACK");
        throw e;
      }
    });
  }
  override async close(): Promise<void> {
    await this.chain;
    this.raw.close();
  }
}

export async function openSqlite(file: string): Promise<Db> {
  // import dinâmico: em produção (Postgres) o módulo nativo do SQLite nem é carregado.
  const { DatabaseSync } = await import("node:sqlite");
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return new SqliteDb(raw);
}

export function sqliteUserVersion(db: Db): Promise<number> {
  return db.get<{ user_version: number }>("PRAGMA user_version").then((r) => r?.user_version ?? 0);
}
