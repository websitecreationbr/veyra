// Interpretador local — parte "nova": alarmes, mercado financeiro e conversa social.
// (As consultas/lançamentos de finanças e agenda continuam em local.ts.) Tudo aqui é determinístico, sem nuvem.

import type { LocalNow } from "../util/time.js";
import type { Pending, Plan } from "./local.js";

export interface SpecialOpts {
  /** Assunto da última resposta (para "e ontem?", "ele subiu ou caiu?"). */
  topic?: { market?: "dolar" | "ibovespa" };
  capabilities?: Set<string>;
}

const NUM_WORDS: Record<string, number> = { uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50 };
const NW = Object.keys(NUM_WORDS).join("|");
const hh = (n: number) => String(n).padStart(2, "0");
const toHora = (h: number, m: number) => `${hh(h)}:${hh(m)}`;

export type Clock12 = { kind: "ok"; hora: string } | { kind: "ambiguous"; opcoes: [string, string] } | { kind: "none" };

/** Extrai um horário de um texto já sem acentos/minúsculo. 1–4h sem período são ambíguos; 5–11h sem período = manhã (padrão de despertador). */
export function parseClock(f: string, now: LocalNow): Clock12 {
  const rel = new RegExp(`\\b(?:daqui a|em)\\s+(\\d{1,3}|${NW})\\s+(minutos?|min|horas?|h)\\b`).exec(f);
  if (rel) {
    const n = /^\d/.test(rel[1]!) ? Number(rel[1]) : NUM_WORDS[rel[1]!]!;
    const add = /^h/.test(rel[2]!) ? n * 60 : n;
    const [ch, cm] = now.time.split(":").map(Number) as [number, number];
    const t = (ch * 60 + cm + add) % 1440;
    return { kind: "ok", hora: toHora(Math.floor(t / 60), t % 60) };
  }
  if (/\bmeio[- ]?dia\b/.test(f)) return { kind: "ok", hora: "12:00" };
  if (/\bmeia[- ]?noite\b/.test(f)) return { kind: "ok", hora: "00:00" };

  let h: number | undefined, m = 0, explicit24 = false;
  let x = /\b(\d{1,2}):(\d{2})\b/.exec(f);
  if (x) { h = Number(x[1]); m = Number(x[2]); explicit24 = h >= 13 || x[1]!.length === 2 && h === 0; }
  else if ((x = /\b(\d{1,2})\s*(?:h|hs|horas?)\s*(\d{2})?\b/.exec(f))) { h = Number(x[1]); m = x[2] ? Number(x[2]) : 0; explicit24 = h >= 13 || h === 0; }
  else if ((x = new RegExp(`\\b(?:as|a|para as|pra as)\\s+(\\d{1,2}|${NW})(?:\\s+e\\s+(meia|quinze|trinta|quarenta e cinco|\\d{1,2}))?\\b`).exec(f))) {
    h = /^\d/.test(x[1]!) ? Number(x[1]) : NUM_WORDS[x[1]!]!;
    const mm = x[2];
    m = !mm ? 0 : mm === "meia" ? 30 : mm === "quarenta e cinco" ? 45 : Number(mm);
  } else if ((x = new RegExp(`\\bpara\\s+(\\d{1,2})\\b`).exec(f))) h = Number(x[1]);
  if (h === undefined || h < 0 || h > 23 || m < 0 || m > 59) return { kind: "none" };
  if (explicit24 || h >= 13 || h === 0) return { kind: "ok", hora: toHora(h, m) };

  const am = /\b(manha|madrugada|cedo)\b/.test(f), pm = /\b(tarde|noite)\b/.test(f);
  if (am) return { kind: "ok", hora: toHora(h === 12 ? 0 : h, m) };
  if (pm) return { kind: "ok", hora: toHora(h === 12 ? (/\bnoite\b/.test(f) ? 0 : 12) : h + 12, m) };
  if (h === 12) return { kind: "ok", hora: toHora(12, m) };
  if (h >= 5) return { kind: "ok", hora: toHora(h, m) }; // 5h–11h: manhã
  return { kind: "ambiguous", opcoes: [toHora(h, m), toHora(h + 12, m)] };
}

const ALL_DAYS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
function parseDays(f: string): string[] {
  if (/\b(todo dia|todos os dias|diariamente|todo santo dia)\b/.test(f)) return ALL_DAYS;
  if (/\b(dias uteis|de segunda a sexta|segunda a sexta)\b/.test(f)) return ["segunda", "terca", "quarta", "quinta", "sexta"];
  const out: string[] = [];
  for (const d of ALL_DAYS) if (new RegExp(`\\btodas? (?:as |os )?${d}`).test(f)) out.push(d);
  return out;
}

const ALARM_RE = /\b(alarme|despertador)\b|\bme (?:acorda|desperta)\b|\bacorda(?:r)? (?:eu|me)\b/;
const ASSETS: { re: RegExp; asset: "dolar" | "ibovespa" }[] = [
  { re: /\b(dolar|dolares|usd|dolar comercial)\b/, asset: "dolar" },
  { re: /\b(ibovespa|ibov|bovespa|b3)\b|\bbolsa( de valores)?\b/, asset: "ibovespa" },
];
const OTHER_MARKET = /\b(euro|bitcoin|btc|ethereum|selic|cdi|ipca|nasdaq|dow jones|s&p|ouro|petroleo|acoes?|fii|fiis|[a-z]{4}\d{1,2})\b/;

function marketDetail(f: string): string {
  if (/\b(ontem|anteontem)\b/.test(f)) return "ontem";
  if (/\b(subiu|caiu|variou|variacao|por cento|percentual|alta|queda|fechou|abriu|%)\b/.test(f) || /\bhoje\b.*\b(subiu|caiu)\b/.test(f)) return "variacao";
  if (/\b(historico|ultimos dias|ultimos|semana|evolucao|ultimos 5)\b/.test(f)) return "historico";
  return "cotacao";
}

export function planSpecial(orig: string, f: string, now: LocalNow, pending: Pending | undefined, opts: SpecialOpts = {}): Plan | undefined {
  const plan: Plan = { calls: [], planned: [] };

  // ---------- Resposta a "4h da manhã ou da tarde?" / "Para que horas?" ----------
  if (pending?.tool === "definir_alarme" && orig.length <= 60) {
    const { opcoes } = pending.input;
    if (opcoes.length === 2) {
      let hora: string | undefined;
      if (/\b(manha|madrugada|cedo|am)\b/.test(f)) hora = opcoes[0];
      else if (/\b(tarde|noite|pm)\b/.test(f)) hora = opcoes[1];
      else if (new RegExp(`\\b0?${Number(opcoes[1]!.slice(0, 2))}\\b`).test(f)) hora = opcoes[1];
      else if (new RegExp(`\\b0?${Number(opcoes[0]!.slice(0, 2))}\\b`).test(f)) hora = opcoes[0];
      if (hora) return { ...plan, calls: [{ name: "definir_alarme", input: { hora, ...(pending.input.dias?.length ? { dias: pending.input.dias } : {}) } }] };
    } else {
      const c = parseClock(f, now);
      if (c.kind === "ok") return { ...plan, calls: [{ name: "definir_alarme", input: { hora: c.hora, ...(pending.input.dias?.length ? { dias: pending.input.dias } : {}) } }] };
      if (c.kind === "ambiguous") return { ...plan, ask: { question: `${Number(c.opcoes[0].slice(0, 2))}h da manhã ou da tarde/noite?`, pending: { tool: "definir_alarme", input: { opcoes: c.opcoes, dias: pending.input.dias } } } };
    }
  }

  // ---------- Alarmes ----------
  if (ALARM_RE.test(f)) {
    if (/\b(cancel|apag|delet|remov|exclu|desativ|desligu)/.test(f) || /\b(quais|que|meus|ver|lista|listar|mostra)\b.*\balarmes?\b/.test(f)) {
      return { ...plan, reply: "Eu só consigo PEDIR novos alarmes ao app Relógio do Android — não consigo ver, alterar nem cancelar alarmes existentes. Para isso, abra o app Relógio do celular." };
    }
    const dias = parseDays(f);
    const c = parseClock(f, now);
    if (c.kind === "ok") return { ...plan, calls: [{ name: "definir_alarme", input: { hora: c.hora, ...(dias.length ? { dias } : {}) } }] };
    if (c.kind === "ambiguous") return { ...plan, ask: { question: `${Number(c.opcoes[0].slice(0, 2))}h da manhã ou da tarde/noite?`, pending: { tool: "definir_alarme", input: { opcoes: c.opcoes, dias } } } };
    return { ...plan, ask: { question: "Para que horas você quer o alarme?", pending: { tool: "definir_alarme", input: { opcoes: [], dias } } } };
  }

  // ---------- Mercado financeiro ----------
  const marketish = ASSETS.some((a) => a.re.test(f)) || OTHER_MARKET.test(f) || /\b(mercado financeiro|como esta o mercado|cotacao|cotacoes)\b/.test(f);
  if (marketish && /\b(alerta|me avisa|avise|avisar)\b/.test(f)) return { ...plan, planned: ["alertas"] };
  if (marketish && !/\b(gastei|paguei|comprei|recebi|registr)/.test(f) && !/\bsupermercado\b/.test(f)) {
    const hits = ASSETS.filter((a) => a.re.test(f)).map((a) => a.asset);
    if (hits.length) {
      const d = marketDetail(f);
      const calls = [...new Set(hits)].map((asset) => ({ name: "consultar_mercado", input: { ativo: asset, detalhe: d } }));
      return { ...plan, calls, planned: OTHER_MARKET.test(f) ? ["mercado_outros"] : [] };
    }
    if (/\b(mercado financeiro|como esta o mercado|cotacoes)\b/.test(f)) {
      return { ...plan, calls: [{ name: "consultar_mercado", input: { ativo: "dolar" } }, { name: "consultar_mercado", input: { ativo: "ibovespa" } }] };
    }
    return { ...plan, planned: ["mercado_outros"] };
  }
  // Pergunta de acompanhamento sobre o último ativo conversado ("Ele subiu ou caiu hoje?", "E ontem?")
  const topic = opts.topic?.market;
  if (topic && f.length <= 50 && /\b(ontem|subiu|caiu|variou|variacao|por cento|historico|ultimos dias|e hoje|quanto (?:esta|ta|foi|fechou)|e agora)\b/.test(f)
    && !/\b(gast|saldo|receita|agenda|compromisso|habito|lembr|tarefa)/.test(f)) {
    return { ...plan, calls: [{ name: "consultar_mercado", input: { ativo: topic, detalhe: marketDetail(f) } }] };
  }

  // ---------- Conversa social ----------
  const hi = /^(?:(oi|ola|opa|e ai|ei|hey|hello|bom dia|boa tarde|boa noite)\b)[\s,!.]*(?:veyra)?[\s,!.]*$/.exec(f);
  if (hi) {
    const g = hi[1]!;
    const lead = g === "bom dia" ? "Bom dia!" : g === "boa tarde" ? "Boa tarde!" : g === "boa noite" ? "Boa noite!" : "Olá!";
    return { ...plan, reply: `${lead} Sou a Veyra. Como posso ajudar?` };
  }
  if (/^(?:veyra[, ]*)?(?:como (?:voce )?(?:esta|vai|anda)|tudo (?:bem|certo)|como (?:voce )?se sente)\b[\s?!.]*(?:veyra)?[\s?!.]*$/.test(f)) {
    return { ...plan, reply: "Tudo bem por aqui, obrigada por perguntar! 😊 Sou uma IA, então não sinto cansaço, mas estou pronta para ajudar. E você, como está?" };
  }
  if (/^(?:veyra[, ]*)?(?:quem (?:e|eh) voce|qual (?:e )?(?:o )?seu nome|o que (?:e|eh) (?:a )?veyra|voce (?:e|eh) quem)\b/.test(f)) {
    return { ...plan, reply: "Sou a Veyra, sua assistente pessoal: registro seus gastos, consulto saldo, cuido da agenda e dos hábitos e, no app Android, posso pedir alarmes e olhar seu calendário. Diga “ajuda” para ver exemplos." };
  }
  return undefined;
}
