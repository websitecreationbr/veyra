import { cleanParams, UniqueViolation, type Db } from "./types.js";

// Interfaces mínimas — compatíveis com o Pool/Client do pacote "pg". Assim o adaptador é testável
// sem rede e o driver real só é carregado em createPgPool().
export interface PgResult { rows: any[]; rowCount: number | null }
export interface PgQueryable { query(text: string, values?: unknown[]): Promise<PgResult> }
export interface PgClient extends PgQueryable { release(err?: unknown): void }
export interface PgPool extends PgQueryable { connect(): Promise<PgClient>; end(): Promise<void> }

/** "SELECT ... WHERE a = ? AND b = ?" → "... a = $1 AND b = $2". (O SQL do projeto nunca usa "?" dentro de texto.) */
export function toPositional(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function mapError(e: unknown): never {
  if ((e as { code?: string })?.code === "23505") throw new UniqueViolation((e as Error).message);
  throw e;
}

class PgConn implements Db {
  readonly dialect = "postgres" as const;
  constructor(protected q: PgQueryable) {}
  async all<T>(sql: string, ...p: unknown[]): Promise<T[]> {
    try { return (await this.q.query(toPositional(sql), cleanParams(p))).rows as T[]; } catch (e) { return mapError(e); }
  }
  async get<T>(sql: string, ...p: unknown[]): Promise<T | undefined> {
    return (await this.all<T>(sql, ...p))[0];
  }
  async run(sql: string, ...p: unknown[]): Promise<{ changes: number }> {
    try { return { changes: (await this.q.query(toPositional(sql), cleanParams(p))).rowCount ?? 0 }; } catch (e) { return mapError(e); }
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return fn(this); // já dentro de uma transação
  }
  async close(): Promise<void> {}
}

export class PostgresDb extends PgConn {
  constructor(private pool: PgPool) { super(pool); }
  override async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      const out = await fn(new PgConn(client));
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { broken = true; } // se o ROLLBACK falhar, a conexão está ruim: descarta do pool
      return mapError(e);
    } finally {
      client.release(broken ? new Error("conexão descartada") : undefined);
    }
  }
  override async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface PgOptions {
  url: string;
  /** "disable" | "no-verify" | undefined(padrão: verificar certificado se o host não for local) */
  ssl?: string;
  max?: number;
  /** options de conexão extras (ex.: "-c search_path=meu_schema", usado nos testes). */
  options?: string;
}

const isLocal = (url: string) => /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url) || /^postgres(ql)?:\/\/(localhost|127\.0\.0\.1)/.test(url);

/** Cria o Pool real (pacote "pg"). Só é chamado em produção ou quando há DATABASE_URL. */
export async function createPgPool(o: PgOptions): Promise<PgPool> {
  let mod: any;
  try {
    mod = await import("pg");
  } catch {
    throw new Error('O pacote "pg" não está instalado. Rode "npm install" (ele faz parte das dependências do servidor).');
  }
  const pg = mod.default ?? mod;
  // BIGINT (int8) e NUMERIC chegam como string por padrão; nossos valores cabem com folga em Number.
  pg.types.setTypeParser(20, (v: string) => Number(v));
  pg.types.setTypeParser(1700, (v: string) => Number(v));

  let ssl: unknown;
  if (o.ssl === "disable") ssl = false;
  else if (o.ssl === "no-verify") ssl = { rejectUnauthorized: false };
  else if (/[?&]sslmode=/.test(o.url)) ssl = undefined; // o próprio pg interpreta o sslmode da URL
  else ssl = isLocal(o.url) ? false : { rejectUnauthorized: true };

  return new pg.Pool({
    connectionString: o.url,
    ssl,
    max: o.max ?? 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ...(o.options ? { options: o.options } : {}),
  }) as PgPool;
}
