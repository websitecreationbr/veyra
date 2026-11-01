// Cotações REAIS de dólar comercial e Ibovespa. Nada é inventado: cada resposta traz valor, variação, data/hora da
// cotação, fonte e aviso de atraso. Se nenhuma fonte responder, a consulta FALHA (não devolvemos valor antigo como atual).
//
// Dólar:    1) AwesomeAPI (quase tempo real)  2) Banco Central — PTAX (oficial, boletim diário)
// Ibovespa: 1) brapi.dev                      2) Yahoo Finance (gráfico público)
// ATENÇÃO: os formatos de resposta abaixo seguem a documentação pública de cada serviço, mas não puderam ser
// validados na rede real durante o desenvolvimento — rode `npm run check:live` para conferir no seu ambiente.

import type { Clock } from "../util/time.js";

export type Asset = "dolar" | "ibovespa";
export const ASSETS: readonly Asset[] = ["dolar", "ibovespa"];

export interface Quote {
  asset: Asset;
  label: string;
  value: number;
  unit: "BRL" | "pontos";
  changeAbs: number | null;
  changePct: number | null;
  previousClose: number | null;
  previousDate: string | null;
  /** Momento da cotação (ISO, UTC). */
  asOf: string;
  source: string;
  /** Como interpretar a defasagem desta fonte. */
  delayNote: string;
  /** true quando a cotação tem mais de 30 min (mercado fechado, fim de semana…): NÃO é tempo real. */
  stale: boolean;
}
export interface Snapshot {
  quote: Quote;
  /** Fechamentos recentes, do mais antigo ao mais novo (dias úteis). */
  history: { date: string; close: number }[];
}
export interface MarketService {
  get(asset: Asset): Promise<Snapshot>;
}
export class MarketError extends Error {}

type FetchLike = typeof fetch;
export interface MarketOptions {
  clock: Clock;
  fetchImpl?: FetchLike;
  brapiToken?: string;
  awesomeToken?: string;
  cacheMs?: number;
  timeoutMs?: number;
}

const BR_OFFSET = "-03:00"; // o Brasil não tem horário de verão desde 2019
const brLocalToIso = (s: string) => new Date(s.trim().replace(" ", "T").replace(/\.\d+$/, "") + BR_OFFSET).toISOString();
const brDate = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

function build(a: Asset, p: { value: number; prev: number | null; prevDate: string | null; pct?: number | null; abs?: number | null; asOf: string; source: string; delayNote: string; now: Date }): Quote {
  const dec = a === "dolar" ? 4 : 0;
  const abs = p.abs ?? (p.prev !== null ? p.value - p.prev : null);
  const pct = p.pct ?? (p.prev ? ((p.value - p.prev) / p.prev) * 100 : null);
  return {
    asset: a, label: a === "dolar" ? "Dólar comercial" : "Ibovespa", value: round(p.value, dec === 0 ? 2 : 4), unit: a === "dolar" ? "BRL" : "pontos",
    changeAbs: abs === null ? null : round(abs, dec === 0 ? 2 : 4), changePct: pct === null ? null : round(pct, 2),
    previousClose: p.prev, previousDate: p.prevDate, asOf: p.asOf, source: p.source, delayNote: p.delayNote,
    stale: p.now.getTime() - new Date(p.asOf).getTime() > 30 * 60_000,
  };
}

export function createMarketService(o: MarketOptions): MarketService {
  const f = o.fetchImpl ?? fetch;
  const ttl = o.cacheMs ?? 60_000;
  const cache = new Map<Asset, { at: number; snap: Snapshot }>();

  const getJson = async (url: string, headers: Record<string, string> = {}): Promise<any> => {
    const res = await f(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; VeyraBot/2.0)", ...headers }, signal: AbortSignal.timeout(o.timeoutMs ?? 8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  // ---------- Dólar ----------
  async function dolarAwesome(now: Date): Promise<Snapshot> {
    const tk = o.awesomeToken ? `?token=${encodeURIComponent(o.awesomeToken)}` : "";
    const last = (await getJson(`https://economia.awesomeapi.com.br/json/last/USD-BRL${tk}`))?.USDBRL;
    const value = num(last?.bid), ts = num(last?.timestamp);
    if (value === null || value <= 0 || ts === null) throw new Error("resposta inesperada da AwesomeAPI");
    const asOf = new Date(ts * 1000).toISOString();
    let history: Snapshot["history"] = [];
    try {
      const daily = (await getJson(`https://economia.awesomeapi.com.br/json/daily/USD-BRL/10${tk ? tk.replace("?", "&") : ""}`)) as any[];
      const byDate = new Map<string, number>();
      for (const d of Array.isArray(daily) ? daily : []) {
        const b = num(d?.bid), t = num(d?.timestamp);
        if (b !== null && t !== null) { const day = brDate(new Date(t * 1000).toISOString()); if (!byDate.has(day)) byDate.set(day, b); }
      }
      history = [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
    } catch { /* histórico é opcional */ }
    const today = brDate(asOf);
    const prev = [...history].reverse().find((h) => h.date < today) ?? null;
    return {
      quote: build("dolar", { value, prev: prev?.close ?? null, prevDate: prev?.date ?? null, pct: num(last?.pctChange), abs: num(last?.varBid), asOf, source: "AwesomeAPI (cotação de compra)", delayNote: "Cotação de mercado atualizada continuamente; pode ter alguns minutos de atraso.", now }),
      history,
    };
  }

  async function dolarPtax(now: Date): Promise<Snapshot> {
    const mdy = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
    const brNow = new Date(now.getTime() - 3 * 3600_000);
    const start = new Date(brNow.getTime() - 14 * 86_400_000);
    const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${mdy(start)}'&@dataFinalCotacao='${mdy(brNow)}'&$orderby=dataHoraCotacao%20asc&$format=json`;
    const rows = ((await getJson(url))?.value ?? []) as any[];
    const lastPerDay = new Map<string, { v: number; at: string }>();
    for (const r of rows) {
      const v = num(r?.cotacaoCompra);
      if (v === null || typeof r?.dataHoraCotacao !== "string") continue;
      lastPerDay.set(r.dataHoraCotacao.slice(0, 10), { v, at: brLocalToIso(r.dataHoraCotacao) }); // ascendente: o último boletim do dia vence
    }
    const days = [...lastPerDay].sort((a, b) => a[0].localeCompare(b[0]));
    if (!days.length) throw new Error("PTAX sem dados no período");
    const [date, cur] = days[days.length - 1]!;
    const prev = days.length > 1 ? days[days.length - 2]! : null;
    return {
      quote: build("dolar", { value: cur.v, prev: prev ? prev[1].v : null, prevDate: prev ? prev[0] : null, asOf: cur.at, source: "Banco Central do Brasil — PTAX (compra)", delayNote: "Boletim oficial do Banco Central (referência diária). NÃO é cotação em tempo real: reflete o último boletim divulgado.", now }),
      history: days.map(([d, v]) => ({ date: d, close: v.v })),
    };
    void date;
  }

  // ---------- Ibovespa ----------
  async function ibovBrapi(now: Date): Promise<Snapshot> {
    const headers: Record<string, string> = o.brapiToken ? { authorization: `Bearer ${o.brapiToken}` } : {};
    const r = (await getJson("https://brapi.dev/api/quote/%5EBVSP?range=10d&interval=1d", headers))?.results?.[0];
    const value = num(r?.regularMarketPrice);
    if (value === null || value <= 0 || typeof r?.regularMarketTime !== "string") throw new Error("resposta inesperada da brapi");
    const asOf = new Date(r.regularMarketTime).toISOString();
    const history: Snapshot["history"] = (Array.isArray(r?.historicalDataPrice) ? r.historicalDataPrice : [])
      .map((h: any) => ({ date: num(h?.date) !== null ? brDate(new Date(num(h.date)! * 1000).toISOString()) : "", close: num(h?.close) }))
      .filter((h: any) => h.date && h.close !== null)
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
    const today = brDate(asOf);
    const prevH = [...history].reverse().find((h) => h.date < today) ?? null;
    const prev = num(r?.regularMarketPreviousClose) ?? prevH?.close ?? null;
    return {
      quote: build("ibovespa", { value, prev, prevDate: prevH?.date ?? null, pct: num(r?.regularMarketChangePercent), abs: num(r?.regularMarketChange), asOf, source: "brapi.dev (B3)", delayNote: "Dados com atraso (a fonte gratuita atualiza em até ~30 minutos). Não é tempo real.", now }),
      history,
    };
  }

  async function ibovYahoo(now: Date): Promise<Snapshot> {
    const res = (await getJson("https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP?range=10d&interval=1d"))?.chart?.result?.[0];
    const value = num(res?.meta?.regularMarketPrice), ts = num(res?.meta?.regularMarketTime);
    if (value === null || value <= 0 || ts === null) throw new Error("resposta inesperada do Yahoo");
    const asOf = new Date(ts * 1000).toISOString();
    const stamps: unknown[] = res?.timestamp ?? [], closes: unknown[] = res?.indicators?.quote?.[0]?.close ?? [];
    const history: Snapshot["history"] = [];
    stamps.forEach((t, i) => { const c = num(closes[i]), tt = num(t); if (c !== null && tt !== null) history.push({ date: brDate(new Date(tt * 1000).toISOString()), close: c }); });
    const today = brDate(asOf);
    const prevH = [...history].reverse().find((h) => h.date < today) ?? null;
    const prev = prevH?.close ?? num(res?.meta?.chartPreviousClose) ?? null;
    return {
      quote: build("ibovespa", { value, prev, prevDate: prevH?.date ?? null, asOf, source: "Yahoo Finance (B3)", delayNote: "Dados com atraso (tipicamente ~15 minutos ou mais). Não é tempo real.", now }),
      history,
    };
  }

  const chains: Record<Asset, ((now: Date) => Promise<Snapshot>)[]> = { dolar: [dolarAwesome, dolarPtax], ibovespa: [ibovBrapi, ibovYahoo] };

  return {
    async get(asset) {
      const now = o.clock.now();
      const hit = cache.get(asset);
      if (hit && now.getTime() - hit.at < ttl) return hit.snap;
      const errors: string[] = [];
      for (const fn of chains[asset]) {
        try {
          const snap = await fn(now);
          cache.set(asset, { at: now.getTime(), snap });
          return snap;
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
      console.error(`[mercado] ${asset} indisponível:`, errors.join(" | "));
      throw new MarketError(`Não consegui consultar ${asset === "dolar" ? "o dólar" : "o Ibovespa"} agora (as fontes não responderam).`);
    },
  };
}

// ---------- Texto para o usuário ----------
const nf = (n: number, d: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtVal = (q: Pick<Quote, "asset" | "value">, v = q.value) => (q.asset === "dolar" ? `R$ ${nf(v, 4)}` : `${nf(v, 0)} pontos`);
const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
const fmtWhen = (iso: string) => {
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("day")}/${g("month")} às ${g("hour")}:${g("minute")}`;
};
export const pctText = (p: number) => `${nf(Math.abs(p), 2)}%`;

export type MarketDetail = "cotacao" | "variacao" | "ontem" | "historico";

export function describeMarket(s: Snapshot, detail: MarketDetail = "cotacao"): string {
  const q = s.quote;
  const dir = q.changePct === null ? null : q.changePct > 0 ? "alta" : q.changePct < 0 ? "queda" : "estável";
  const when = q.stale ? "Último valor disponível (não é tempo real)" : "Atualizado";
  const foot = `${when}: ${fmtWhen(q.asOf)} · Fonte: ${q.source}\n${q.delayNote}`;
  const var_ = q.changePct === null ? "Não consegui obter a variação desta fonte."
    : dir === "estável" ? `Sem variação em relação ao fechamento anterior${q.previousDate ? ` (${dm(q.previousDate)})` : ""}.`
    : `${q.asset === "dolar" ? (dir === "alta" ? "Subiu" : "Caiu") : (dir === "alta" ? "Em alta" : "Em queda")} ${pctText(q.changePct)}${q.changeAbs !== null ? ` (${q.changeAbs > 0 ? "+" : "−"}${q.asset === "dolar" ? `R$ ${nf(Math.abs(q.changeAbs), 4)}` : `${nf(Math.abs(q.changeAbs), 0)} pts`})` : ""} em relação ao fechamento anterior${q.previousDate ? ` (${dm(q.previousDate)})` : ""}${q.stale ? "" : ", no dia"}.`;

  if (detail === "ontem") {
    const h = s.history.filter((x) => x.date < brDate(q.asOf));
    const y = h[h.length - 1], d2 = h[h.length - 2];
    if (!y) return `Não encontrei o fechamento anterior nesta fonte.\n${foot}`;
    const chg = d2 ? ((y.close - d2.close) / d2.close) * 100 : null;
    return `Em ${dm(y.date)} (último dia útil antes da cotação atual) ${q.label.toLowerCase() === "ibovespa" ? "o Ibovespa" : "o dólar"} fechou em ${fmtVal(q, y.close)}${chg !== null ? `, ${chg > 0 ? "alta" : chg < 0 ? "queda" : "variação zero"}${chg !== 0 ? ` de ${pctText(chg)}` : ""} sobre ${dm(d2!.date)}` : ""}.\n${foot}`;
  }
  if (detail === "historico") {
    const rows = s.history.slice(-6).map((h) => `${dm(h.date)} · ${fmtVal(q, h.close)}`).join("\n");
    return `${q.label} — fechamentos recentes:\n${rows || "Sem histórico nesta fonte."}\n\nAgora: ${fmtVal(q)}.\n${foot}`;
  }
  if (detail === "variacao") return `${var_}\n${q.label}: ${fmtVal(q)}.\n${foot}`;
  return `${q.label}: ${fmtVal(q)}.\n${var_}\n${foot}`;
}
