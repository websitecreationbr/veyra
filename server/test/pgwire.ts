// CLIENTE POSTGRES SÓ PARA TESTES. Fala o protocolo nativo (Parse/Bind/Execute, como o pacote "pg") para que os
// testes rodem contra um PostgreSQL de verdade neste ambiente, onde não dá para instalar o "pg".
// Em produção o app usa o pacote "pg" (server/src/db/postgres.ts → createPgPool). Não é importado pelo app.
import net from "node:net";
import { createHash } from "node:crypto";
import type { PgClient, PgPool, PgResult } from "../src/db/postgres.js";

class Conn {
  private sock!: net.Socket;
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  closed = false;
  constructor(private o: { host: string; port: number; user: string; database: string; password?: string; searchPath?: string }) {}

  async open(): Promise<void> {
    this.sock = net.connect(this.o.port, this.o.host);
    this.sock.on("data", (d) => { this.buf = Buffer.concat([this.buf, d as Buffer]); this.waiters.splice(0).forEach((w) => w()); });
    this.sock.on("close", () => { this.closed = true; this.waiters.splice(0).forEach((w) => w()); });
    this.sock.on("error", () => { this.closed = true; this.waiters.splice(0).forEach((w) => w()); });
    await new Promise<void>((r, j) => { this.sock.once("connect", r); this.sock.once("error", j); });
    const params = ["user", this.o.user, "database", this.o.database, ...(this.o.searchPath ? ["options", `-c search_path=${this.o.searchPath}`] : [])];
    const body = Buffer.concat([...params.map((p) => Buffer.from(p + "\0")), Buffer.from("\0")]);
    const head = Buffer.alloc(8); head.writeInt32BE(body.length + 8, 0); head.writeInt32BE(196608, 4);
    this.sock.write(Buffer.concat([head, body]));
    for (;;) {
      const m = await this.read();
      if (m.t === "R") {
        const kind = m.b.readInt32BE(0);
        if (kind === 3) this.send("p", Buffer.from((this.o.password ?? "") + "\0"));
        else if (kind === 5) {
          const md5 = (s: Buffer | string) => createHash("md5").update(s).digest("hex");
          this.send("p", Buffer.from("md5" + md5(Buffer.concat([Buffer.from(md5((this.o.password ?? "") + this.o.user)), m.b.subarray(4, 8)])) + "\0"));
        } else if (kind !== 0) throw new Error(`autenticação não suportada no cliente de teste (${kind}); use trust/md5`);
      } else if (m.t === "E") throw pgError(m.b);
      else if (m.t === "Z") return;
    }
  }
  private send(type: string, body: Buffer) {
    const h = Buffer.alloc(5); h.write(type, 0); h.writeInt32BE(body.length + 4, 1);
    this.sock.write(Buffer.concat([h, body]));
  }
  private async read(): Promise<{ t: string; b: Buffer }> {
    for (;;) {
      if (this.buf.length >= 5) {
        const len = this.buf.readInt32BE(1);
        if (this.buf.length >= len + 1) {
          const t = String.fromCharCode(this.buf[0]!);
          const b = this.buf.subarray(5, len + 1);
          this.buf = this.buf.subarray(len + 1);
          return { t, b: Buffer.from(b) };
        }
      }
      if (this.closed) throw new Error("conexão encerrada");
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  query(text: string, values: unknown[] = []): Promise<PgResult> {
    const run = () => this.exec(text, values);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private async exec(text: string, values: unknown[]): Promise<PgResult> {
    const cstr = (s: string) => Buffer.from(s + "\0");
    if (values.length === 0) this.send("Q", cstr(text)); // protocolo simples (permite vários comandos), como o pg
    else {
      const parse = Buffer.concat([cstr(""), cstr(text), i16(0)]);
      const binds: Buffer[] = [cstr(""), cstr(""), i16(0), i16(values.length)];
      for (const v of values) {
        if (v === null || v === undefined) binds.push(i32(-1));
        else { const s = Buffer.from(typeof v === "object" ? JSON.stringify(v) : String(v)); binds.push(i32(s.length), s); }
      }
      binds.push(i16(0));
      this.send("P", parse);
      this.send("B", Buffer.concat(binds));
      this.send("D", Buffer.concat([Buffer.from("P"), cstr("")]));
      this.send("E", Buffer.concat([cstr(""), i32(0)]));
      this.send("S", Buffer.alloc(0));
    }
    let cols: { name: string; oid: number }[] = [];
    const rows: any[] = [];
    let rowCount: number | null = null;
    let err: Error | undefined;
    for (;;) {
      const m = await this.read();
      if (m.t === "T") {
        const n = m.b.readInt16BE(0); let o = 2; cols = [];
        for (let i = 0; i < n; i++) {
          const e = m.b.indexOf(0, o); const name = m.b.toString("utf8", o, e); o = e + 1;
          cols.push({ name, oid: m.b.readInt32BE(o + 6) }); o += 18;
        }
      } else if (m.t === "D") {
        const n = m.b.readInt16BE(0); let o = 2; const row: any = {};
        for (let i = 0; i < n; i++) {
          const len = m.b.readInt32BE(o); o += 4;
          if (len < 0) row[cols[i]!.name] = null;
          else { row[cols[i]!.name] = decode(m.b.toString("utf8", o, o + len), cols[i]!.oid); o += len; }
        }
        rows.push(row);
      } else if (m.t === "C") {
        const tag = m.b.toString("utf8", 0, m.b.length - 1).split(" "); const last = Number(tag[tag.length - 1]);
        rowCount = Number.isFinite(last) ? last : null;
      } else if (m.t === "E") err = pgError(m.b);
      else if (m.t === "Z") break;
    }
    if (err) throw err;
    return { rows, rowCount };
  }
  close() { try { this.send("X", Buffer.alloc(0)); } catch { /* */ } this.sock.destroy(); }
}

const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };

// Mesmo comportamento dos parsers que o app registra no pg: int2/int4/int8/float/numeric → Number; bool → boolean.
function decode(s: string, oid: number): unknown {
  if ([20, 21, 23, 700, 701, 1700].includes(oid)) return Number(s);
  if (oid === 16) return s === "t";
  return s;
}

function pgError(b: Buffer): Error {
  const f: Record<string, string> = {};
  let o = 0;
  while (o < b.length && b[o] !== 0) { const k = String.fromCharCode(b[o]!); const e = b.indexOf(0, o + 1); f[k] = b.toString("utf8", o + 1, e); o = e + 1; }
  return Object.assign(new Error(f.M ?? "erro do PostgreSQL"), { code: f.C, severity: f.S, detail: f.D });
}

export interface WirePoolOptions { host?: string; port?: number; user?: string; database: string; password?: string; searchPath?: string; max?: number }

export class WirePool implements PgPool {
  private idle: Conn[] = [];
  private all = new Set<Conn>();
  private waiting: ((c: Conn) => void)[] = [];
  constructor(private o: WirePoolOptions) {}

  private async acquire(): Promise<Conn> {
    const c = this.idle.pop();
    if (c && !c.closed) return c;
    if (this.all.size >= (this.o.max ?? 3)) return new Promise((r) => this.waiting.push(r));
    const n = new Conn({ host: this.o.host ?? "127.0.0.1", port: this.o.port ?? 5432, user: this.o.user ?? "veyra", database: this.o.database, password: this.o.password, searchPath: this.o.searchPath });
    this.all.add(n);
    try { await n.open(); } catch (e) { this.all.delete(n); throw e; }
    return n;
  }
  private give(c: Conn) {
    const w = this.waiting.shift();
    if (w) w(c); else this.idle.push(c);
  }
  async query(text: string, values?: unknown[]): Promise<PgResult> {
    const c = await this.acquire();
    try { return await c.query(text, values); } finally { this.give(c); }
  }
  async connect(): Promise<PgClient> {
    const c = await this.acquire();
    return { query: (t, v) => c.query(t, v), release: () => this.give(c) };
  }
  async end(): Promise<void> {
    for (const c of this.all) c.close();
    this.all.clear(); this.idle = [];
  }
}
