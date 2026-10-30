// Fábrica de bancos para os testes: SQLite em memória (padrão) ou PostgreSQL real (TEST_DATABASE_URL).
// No Postgres, cada teste ganha um SCHEMA próprio e vazio — isolamento total sem recriar o banco.
import { randomBytes } from "node:crypto";
import { migrate, type Db } from "../src/db/index.js";
import { openSqlite } from "../src/db/sqlite.js";
import { PostgresDb } from "../src/db/postgres.js";
import { WirePool } from "./pgwire.js";

export const PG_URL = process.env.TEST_DATABASE_URL ?? "";
export const DIALECT = PG_URL ? "postgres" : "sqlite";

function parse(url: string) {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) };
}

const schemas: string[] = [];
const pools: WirePool[] = [];

export async function newTestDb(file = ":memory:"): Promise<Db> {
  if (!PG_URL) {
    const db = await openSqlite(file);
    await migrate(db);
    return db;
  }
  const c = parse(PG_URL);
  const schema = "t_" + randomBytes(5).toString("hex");
  const admin = new WirePool({ ...c, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  schemas.push(schema);
  const pool = new WirePool({ ...c, searchPath: schema, max: 4 });
  pools.push(pool);
  const db = new PostgresDb(pool);
  await migrate(db);
  return db;
}

/** Reabre o MESMO banco (simula reiniciar o servidor). SQLite: mesmo arquivo; Postgres: mesmo schema. */
export async function reopenTestDb(prev: Db, file?: string): Promise<Db> {
  if (!PG_URL) {
    const db = await openSqlite(file!);
    await migrate(db);
    return db;
  }
  const schema = schemas[schemas.length - 1]!; // o último criado pelo teste atual
  void prev;
  const pool = new WirePool({ ...parse(PG_URL), searchPath: schema, max: 4 });
  pools.push(pool);
  const db = new PostgresDb(pool);
  await migrate(db);
  return db;
}

export async function dropTestSchemas(): Promise<void> {
  for (const p of pools) await p.end();
  if (!PG_URL || !schemas.length) return;
  const admin = new WirePool({ ...parse(PG_URL), max: 1 });
  for (const s of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  await admin.end();
}
