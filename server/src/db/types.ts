// Contrato único de acesso a dados. Há dois adaptadores: SQLite (desenvolvimento local) e
// PostgreSQL (produção/Vercel). TODO o SQL do projeto usa "?" como parâmetro e um subconjunto
// compatível com os dois bancos; o adaptador do Postgres converte "?" em $1, $2…

export type Dialect = "sqlite" | "postgres";

export interface Db {
  readonly dialect: Dialect;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  /** Executa fn numa transação. Dentro de fn, use SOMENTE o Db recebido (é ele que está na transação). */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Violação de UNIQUE (ex.: e-mail já cadastrado), igual nos dois bancos. */
export class UniqueViolation extends Error {
  constructor(message = "unique violation") {
    super(message);
    this.name = "UniqueViolation";
  }
}

export type Param = string | number | bigint | null | Uint8Array;
export const cleanParams = (p: unknown[]): Param[] => p.map((v) => (v === undefined ? null : (v as Param)));
