// Interpretador local de português (sem nuvem, sem chave).
// Ele NÃO conversa livremente: transforma frases comuns em chamadas de ferramenta, exatamente o mesmo
// formato que o modelo em nuvem produz. Quando há ANTHROPIC_API_KEY, o Claude assume e entende frases livres;
// este módulo continua como fallback e como base dos testes.

import { addDays, addMonths, dayOfWeek, daysBetween, endOfMonth, isDate, type LocalNow } from "../util/time.js";
import { parseBrMoney } from "../util/money.js";
import { capitalize } from "../util/text.js";
import { planSpecial, type SpecialOpts } from "./special.js";

export interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}
export type Pending =
  | { tool: "registrar_gasto"; input: Record<string, unknown> }
  /** Alarme à espera do horário (opcoes vazio) ou de "manhã ou tarde?" (duas opções HH:mm). */
  | { tool: "definir_alarme"; input: { opcoes: string[]; dias?: string[] } };
export interface Plan {
  calls: PlannedCall[];
  /** Pergunta de acompanhamento (faltou informação essencial). */
  ask?: { question: string; pending: Pending };
  /** Funcionalidades previstas, mas ainda indisponíveis, que o usuário pediu. */
  planned: string[];
  /** Texto fixo (ajuda / não entendi). */
  reply?: string;
}

/** Minúsculas e sem acentos, preservando o comprimento (para alinhar índices com o texto original). */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const DOW_IDX: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const DOW_RE = "(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?";

// ---------------------------------------------------------------------------------------------
// Buffer "dobrado + original" para extrair trechos sem perder o texto bonito
// ---------------------------------------------------------------------------------------------
class Text {
  constructor(public o: string, public f: string = fold(o)) {}
  /** Apaga (troca por espaços) o trecho [a,b) nos dois buffers. */
  blank(a: number, b: number) {
    const sp = " ".repeat(b - a);
    this.o = this.o.slice(0, a) + sp + this.o.slice(b);
    this.f = this.f.slice(0, a) + sp + this.f.slice(b);
  }
  /** Procura no texto dobrado; se achar, apaga o trecho e devolve os grupos. */
  take(re: RegExp): RegExpExecArray | null {
    const m = re.exec(this.f);
    if (m) this.blank(m.index, m.index + m[0].length);
    return m;
  }
  get clean(): string {
    return this.o.replace(/\s+/g, " ").replace(/^[\s,.;:!-]+|[\s,.;:!-]+$/g, "").trim();
  }
}

// ---------------------------------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------------------------------
const MONEY_RE = /(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+\.\d{1,2})(\s*(?:reais|real|conto|contos|pila|pilas|mil)\b)?/g;

/** Procura um valor em reais no texto. Ignora horários, dias, datas, kg etc. Apaga o trecho encontrado. */
function takeMoney(t: Text): number | null {
  let best: { a: number; b: number; cents: number; score: number } | null = null;
  for (const m of t.f.matchAll(MONEY_RE)) {
    const a = m.index!;
    const b = a + m[0].length;
    const before = t.f.slice(Math.max(0, a - 6), a);
    const after = t.f.slice(b, b + 6);
    const hasMarker = !!m[1] || !!m[3];
    if (!hasMarker) {
      if (/(?:\bas|\ba|\bdia|\bdo|\bde|\bem|\bpor)\s+$/.test(before) && /\b(as|dia)\s+$/.test(before)) continue; // "às 10", "dia 15"
      if (/^\s*(?:h\b|hs\b|horas?\b|:|\/|kg\b|%|x\b|series|reps|min)/.test(after)) continue; // 10h, 3x, 30kg
      if (/\d\/$/.test(before)) continue;
    }
    let raw = m[2]!;
    const unit = (m[3] ?? "").trim();
    let cents = parseBrMoney(raw);
    if (cents === null) continue;
    if (unit === "mil") cents *= 1000;
    const score = (m[1] ? 2 : 0) + (m[3] ? 1 : 0);
    if (!best || score > best.score) best = { a, b, cents, score };
  }
  if (!best) return null;
  t.blank(best.a, best.b);
  return best.cents;
}

// ---------------------------------------------------------------------------------------------
// Datas, horas e recorrência
// ---------------------------------------------------------------------------------------------
interface When {
  date?: string;
  time?: string;
  recurrence?: string;
}

function weekdayList(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/segunda|terca|quarta|quinta|sexta|sabado|domingo/g)) out.push(DOW_IDX[m[0]]!);
  return [...new Set(out)].sort();
}

function nextWeekday(now: LocalNow, dow: number, hasLaterTime: boolean): string {
  let diff = (dow - now.dow + 7) % 7;
  if (diff === 0 && !hasLaterTime) diff = 7;
  return addDays(now.date, diff);
}

function takeWhen(t: Text, now: LocalNow): When {
  const w: When = {};

  // --- recorrência (antes de data, para "toda segunda" não virar "segunda")
  let m: RegExpExecArray | null;
  if ((m = t.take(/\btodo\s+dia\s+(\d{1,2})\b(?:\s+do\s+mes)?/))) w.recurrence = `monthly:${Math.min(31, Math.max(1, +m[1]!))}`;
  else if ((m = t.take(/\b(?:todo\s+mes)\b(?:\s+(?:no\s+)?dia\s+(\d{1,2}))?/))) w.recurrence = `monthly:${m[1] ? Math.min(31, +m[1]) : +now.date.slice(8)}`;
  else if (t.take(/\b(?:de\s+segunda\s+a\s+sexta(?:-feira)?|dias\s+uteis|em\s+dias\s+uteis)\b/)) w.recurrence = "weekdays";
  else if (t.take(/\b(?:todo\s+dia|todos\s+os\s+dias|diariamente|todo\s+santo\s+dia)\b/)) w.recurrence = "daily";
  else if ((m = t.take(new RegExp(`\\btod[ao]s?(?:\\s+as)?\\s+((?:${DOW_RE}s?(?:\\s*(?:,|e)\\s*)?)+)`)))) {
    const days = weekdayList(m[1]!);
    if (days.length) w.recurrence = `weekly:${days.join(",")}`;
  } else if (t.take(/\btoda\s+semana\b/)) w.recurrence = "weekly:auto";

  // lista de dias ("segunda, quarta e sexta") equivale a recorrência semanal
  if (!w.recurrence && (m = t.take(new RegExp(`\\b(${DOW_RE}s?(?:(?:\\s*,\\s*|\\s+e\\s+)${DOW_RE}s?)+)\\b`)))) {
    const days = weekdayList(m[1]!);
    if (days.length > 1) w.recurrence = `weekly:${days.join(",")}`;
  }

  // --- horário
  const parseTime = (h: number, min: number, period?: string): string | undefined => {
    if (period && /tarde|noite/.test(period) && h < 12) h += 12;
    if (period && /madrugada/.test(period) && h === 12) h = 0;
    if (h > 23 || min > 59) return undefined;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  };
  if (t.take(/\bmeio[- ]?dia\b/)) w.time = "12:00";
  else if (t.take(/\bmeia[- ]?noite\b/)) w.time = "00:00";
  else if ((m = t.take(/\bas\s+(\d{1,2})(?:\s*(?::|h)\s*(\d{2}))?(?:\s*(?:horas?|hs?)\b)?(?:\s+da\s+(manha|tarde|noite|madrugada))?/))) w.time = parseTime(+m[1]!, m[2] ? +m[2] : 0, m[3]);
  else if ((m = t.take(/\b(\d{1,2})\s*h(?:\s*(\d{2}))?\b(?:\s+da\s+(manha|tarde|noite|madrugada))?/))) w.time = parseTime(+m[1]!, m[2] ? +m[2] : 0, m[3]);
  else if ((m = t.take(/\b(\d{1,2}):(\d{2})\b/))) w.time = parseTime(+m[1]!, +m[2]!);

  // --- data
  if (t.take(/\bdepois\s+de\s+amanha\b/)) w.date = addDays(now.date, 2);
  else if (t.take(/\bamanha\b/)) w.date = addDays(now.date, 1);
  else if (t.take(/\banteontem\b/)) w.date = addDays(now.date, -2);
  else if (t.take(/\bontem\b/)) w.date = addDays(now.date, -1);
  else if (t.take(/\bhoje\b/)) w.date = now.date;
  else if ((m = t.take(/\bem\s+(\d{1,3})\s+dias?\b/))) w.date = addDays(now.date, +m[1]!);
  else if ((m = t.take(new RegExp(`\\b(?:(?:n[ao]|nesta|nessa|na\\s+proxima|proxima)\\s+)?(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?\\b`)))) {
    const later = !!w.time && w.time > now.time;
    w.date = nextWeekday(now, DOW_IDX[m[1]!]!, later);
  } else if ((m = t.take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +now.date.slice(0, 4);
    let d = `${y}-${String(+m[2]!).padStart(2, "0")}-${String(+m[1]!).padStart(2, "0")}`;
    if (!m[3] && isDate(d) && d < now.date) d = `${y + 1}${d.slice(4)}`;
    if (isDate(d)) w.date = d;
  } else if ((m = t.take(/\bdia\s+(\d{1,2})\b/))) {
    const day = +m[1]!;
    if (day >= 1 && day <= 31) {
      const here = `${now.date.slice(0, 8)}${String(Math.min(day, +endOfMonth(now.date).slice(8))).padStart(2, "0")}`;
      if (here >= now.date) w.date = here;
      else {
        const nm = addMonths(now.date.slice(0, 8) + "01", 1);
        w.date = `${nm.slice(0, 8)}${String(Math.min(day, +endOfMonth(nm).slice(8))).padStart(2, "0")}`;
      }
    }
  }

  if (w.recurrence === "weekly:auto") w.recurrence = `weekly:${dayOfWeek(w.date ?? now.date)}`;
  if (w.recurrence && !w.date) w.date = now.date;
  return w;
}

// ---------------------------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------------------------
const EXPENSE_CATEGORIES: [string, RegExp][] = [
  ["Mercado", /\b(mercado|supermercado|feira|acougue|hortifruti|atacadao|sacolao)\b/],
  ["Transporte", /\b(transporte|uber|99|taxi|onibus|metro|gasolina|combustivel|etanol|diesel|estacionamento|pedagio|passagem|oficina|mecanico|ipva)\b/],
  ["Moradia", /\b(moradia|aluguel|condominio|luz|energia|agua|internet|gas|iptu|reforma)\b/],
  ["Saúde", /\b(saude|farmacia|remedio|remedios|medico|dentista|consulta|exame|hospital|plano de saude|psicologo|terapia|academia)\b/],
  ["Educação", /\b(educacao|curso|livro|livros|faculdade|escola|mensalidade|aula|udemy|material escolar)\b/],
  ["Lazer", /\b(lazer|cinema|show|netflix|spotify|jogo|jogos|viagem|festa|balada|ingresso|streaming|passeio|bar|cerveja|hbo|disney)\b/],
  ["Compras", /\b(compras|roupa|roupas|tenis|sapato|camisa|loja|shopping|presente|eletronico|celular|amazon|shein|mercado livre)\b/],
  ["Alimentação", /\b(alimentacao|comida|almoco|jantar|janta|lanche|restaurante|ifood|cafe|pizza|hamburguer|sorvete|comida|refeicao|marmita|padaria|acai|sushi|churrasco)\b/],
  ["Contas", /\b(conta|contas|boleto|fatura|cartao|imposto|taxa|seguro|multa)\b/],
];
const INCOME_CATEGORIES: [string, RegExp][] = [
  ["Salário", /\b(salario|pagamento|holerite|13o|decimo terceiro|ferias)\b/],
  ["Freelance", /\b(freela|freelance|projeto|cliente|servico|bico)\b/],
  ["Investimentos", /\b(dividendo|dividendos|rendimento|rendimentos|juros|lucro|cdb|tesouro)\b/],
];
function inferCategory(table: [string, RegExp][], folded: string): string | undefined {
  return table.find(([, re]) => re.test(folded))?.[0];
}

// ---------------------------------------------------------------------------------------------
// Gatilhos de cada tipo de ação
// ---------------------------------------------------------------------------------------------
type ClauseKind = "gasto" | "receita" | "lembrete" | "evento" | "tarefa" | "concluir" | "habito" | "treino" | "saldo";

const HABIT_VERBS: { re: RegExp; habit: string }[] = [
  { re: /\btreinei\b/, habit: "Treino" },
  { re: /\b(?:fui|fui na|fui a)\s+(?:a\s+)?academia\b/, habit: "Treino" },
  { re: /\bestudei\b/, habit: "Estudar" },
  { re: /\bcorri\b/, habit: "Correr" },
  { re: /\bmeditei\b/, habit: "Meditar" },
  { re: /\b(?:bebi|tomei)\s+(?:\d+\s*(?:l|litros?)\s+de\s+|muita\s+)?agua\b/, habit: "Beber água" },
  { re: /\bdormi\s+cedo\b/, habit: "Dormir cedo" },
  { re: /\bli\s+(?:hoje|ontem|um|uma|o|a|\d+|capitulo|livro|paginas?)\b/, habit: "Ler" },
  { re: /\b(?:li)\s*$/, habit: "Ler" },
];

const TRIGGERS: { kind: ClauseKind; re: string }[] = [
  { kind: "saldo", re: "meu\\s+saldo\\s+(?:atual\\s+)?(?:e|eh|esta\\s+em|ta\\s+em|agora\\s+e)\\b" },
  { kind: "gasto", re: "(?:gastei|paguei|comprei|torrei|despesa\\s+de)\\b" },
  { kind: "receita", re: "(?:recebi|ganhei|vendi)\\b" },
  { kind: "lembrete", re: "(?:me\\s+lembr[ae]|lembra(?:\\s+me)?|lembrete|me\\s+avis[ae]|nao\\s+me\\s+deixe\\s+esquecer)\\b" },
  { kind: "evento", re: "(?:marca|marcar|agendar|agende|marque)\\b" },
  { kind: "tarefa", re: "(?:cria(?:r)?\\s+(?:uma\\s+)?tarefa|nova\\s+tarefa|tarefa\\s*:|anota(?:r)?|preciso(?:\\s+de)?|tenho\\s+que|adiciona(?:r)?\\s+(?:uma\\s+)?tarefa)\\b" },
  { kind: "concluir", re: "(?:conclui|concluir|terminei|finalizei|completei|ja\\s+fiz)\\b" },
  { kind: "treino", re: "fiz\\s+(?:treino|peito|costas|perna|pernas|ombro|ombros|biceps|triceps|abdomen|cardio|supino|agachamento)\\b" },
  ...HABIT_VERBS.map((h) => ({ kind: "habito" as const, re: h.re.source })),
];
const TRIGGER_RE = new RegExp(TRIGGERS.map((t, i) => `(?<k${i}>${t.re})`).join("|"), "g");

interface Clause {
  kind: ClauseKind;
  text: Text;
}

function kindOfMatch(m: RegExpMatchArray): ClauseKind {
  for (let i = 0; i < TRIGGERS.length; i++) if (m.groups?.[`k${i}`] !== undefined) return TRIGGERS[i]!.kind;
  return "tarefa";
}

// Um prefixo de data/hora ("amanhã às 10") que ficou grudado no fim da cláusula anterior pertence à próxima.
const TRAILING_WHEN = new RegExp(
  `(?:,\\s*|\\s+e\\s+)((?:(?:depois\\s+de\\s+)?amanha|hoje|(?:n[ao]\\s+)?${DOW_RE})?(?:\\s+(?:as|a)\\s+\\d{1,2}(?:(?::|h)\\d{0,2})?)?)\\s*$`,
);

function splitClauses(orig: string): Clause[] {
  const f = fold(orig);
  const hits = [...f.matchAll(TRIGGER_RE)].map((m) => ({ index: m.index!, kind: kindOfMatch(m) }));
  if (!hits.length) return [];
  const cuts = hits.map((h, i) => ({ start: i === 0 ? 0 : h.index, kind: h.kind, trig: h.index }));
  const pieces = cuts.map((c, i) => ({ kind: c.kind, a: c.start, b: i + 1 < cuts.length ? cuts[i + 1]!.start : orig.length }));

  for (let i = 0; i + 1 < pieces.length; i++) {
    const next = pieces[i + 1]!;
    if (next.kind !== "lembrete" && next.kind !== "evento" && next.kind !== "tarefa") continue;
    const seg = f.slice(pieces[i]!.a, pieces[i]!.b);
    const m = TRAILING_WHEN.exec(seg);
    if (m && m[1] && m[1].trim()) {
      const cut = pieces[i]!.a + m.index;
      pieces[i]!.b = cut;
      const sepLen = /^(?:,\s*|\s+e\s+)/.exec(m[0])![0].length;
      next.a = cut + sepLen;
    }
  }
  const out: Clause[] = [];
  for (const p of pieces) {
    const seg = orig.slice(p.a, p.b);
    if (p.kind !== "gasto" && p.kind !== "receita") {
      out.push({ kind: p.kind, text: new Text(seg) });
      continue;
    }
    // "gastei 8 com lanche e 20 de gasolina" -> dois gastos (cada item começa com um valor)
    const verb = p.kind === "gasto" ? "gastei " : "recebi ";
    const parts = seg.split(/(?:,\s+|\s+e\s+)(?=(?:r\$\s*)?\d)/i);
    parts.forEach((part, idx) => out.push({ kind: p.kind, text: new Text(idx === 0 ? part : verb + part) }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Construção das chamadas por tipo de cláusula
// ---------------------------------------------------------------------------------------------
const LEADING_FILLER = /^(?:(?:de|do|da|dos|das|que|pra|para|pro|a|o|um|uma|meu|minha|na|no|em|com)\s+)+/i;

function cleanTitle(s: string, opts: { stripPrepositions?: boolean } = {}): string {
  let t = s.replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, "");
  if (opts.stripPrepositions) {
    const stripped = t.replace(/^(?:(?:de|que|pra|para)\s+)+/i, "");
    if (stripped) t = stripped;
  }
  return capitalize(t);
}

function expenseDescription(verb: string, rest: string): string | undefined {
  const r = rest.replace(/\s+/g, " ").trim();
  if (!r) return undefined;
  if (verb === "comprei") {
    const m = /^(?:um|uma|uns|umas|o|a|os|as)?\s*(.+?)(?:\s+(?:por|de|no valor)\b.*)?$/i.exec(r);
    const d = m?.[1]?.trim();
    if (d) return d;
  }
  const m = /(?:^|\s)(?:n[oa]s?|em|com|de|do|da|para|pra|pro|por|numa?|num)\s+(.+)$/i.exec(r);
  const d = (m?.[1] ?? "").replace(/^(?:um|uma|o|a|os|as|meu|minha)\s+/i, "").trim();
  return d || undefined;
}

function buildGasto(c: Clause, now: LocalNow): { call?: PlannedCall; ask?: Plan["ask"] } {
  const t = c.text;
  const verb = /comprei/.test(t.f) ? "comprei" : "gastei";
  const catSource = t.f;
  const cents = takeMoney(t);
  const when = takeWhen(t, now);
  // remove o verbo para sobrar só o "o que"
  t.take(/\b(?:gastei|paguei|comprei|torrei|despesa\s+de)\b/);
  const category = inferCategory(EXPENSE_CATEGORIES, catSource);
  const desc = expenseDescription(verb, t.clean.replace(/^(?:hoje|eu|ontem)\s+/i, ""));
  if (!cents) return { ask: { question: "Quanto foi o gasto?", pending: { tool: "registrar_gasto", input: {} } } };
  const input: Record<string, unknown> = { valor_reais: cents / 100 };
  if (when.date) input.data = when.date;
  if (category) input.categoria = category;
  if (desc) input.descricao = capitalize(desc.replace(/[.,;!?]+$/, ""));
  if (!category && !desc) {
    return { ask: { question: `Onde você gastou ${formatAskAmount(cents)}?`, pending: { tool: "registrar_gasto", input } } };
  }
  return { call: { name: "registrar_gasto", input } };
}

function formatAskAmount(cents: number): string {
  return "R$ " + (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ","));
}

function buildReceita(c: Clause, now: LocalNow): PlannedCall | { error: string } {
  const t = c.text;
  const source = t.f;
  const cents = takeMoney(t);
  const when = takeWhen(t, now);
  t.take(/\b(?:recebi|ganhei|vendi)\b/);
  if (!cents) return { error: "Quanto você recebeu?" };
  const input: Record<string, unknown> = { valor_reais: cents / 100 };
  if (when.date) input.data = when.date;
  const category = inferCategory(INCOME_CATEGORIES, source);
  if (category) input.categoria = category;
  const m = /(?:^|\s)(?:de|do|da|pelo|pela|com|por)\s+(.+)$/i.exec(t.clean.replace(/^(?:hoje|eu|ontem)\s+/i, ""));
  const desc = m?.[1]?.trim();
  if (desc) input.descricao = capitalize(desc);
  return { name: "registrar_receita", input };
}

function buildLembrete(c: Clause, now: LocalNow): PlannedCall | { error: string } {
  const t = c.text;
  t.take(/\b(?:me\s+lembr[ae]|lembra(?:\s+me)?|lembrete|me\s+avis[ae]|nao\s+me\s+deixe\s+esquecer)\b/);
  const when = takeWhen(t, now);
  const title = cleanTitle(t.clean.replace(/^(?:eu|me|hoje)\s+/i, ""), { stripPrepositions: true });
  if (!title) return { error: "O que você quer que eu lembre?" };
  const input: Record<string, unknown> = { titulo: title };
  if (when.date) input.data = when.date;
  if (when.time) input.hora = when.time;
  if (when.recurrence) input.recorrencia = when.recurrence;
  if (/\burgente|importante\b/.test(fold(title))) input.prioridade = "alta";
  return { name: "criar_lembrete", input };
}

function buildEvento(c: Clause, now: LocalNow): PlannedCall | { error: string } {
  const t = c.text;
  t.take(/\b(?:marca|marcar|agendar|agende|marque)\b/);
  const when = takeWhen(t, now);
  const title = cleanTitle(t.clean.replace(LEADING_FILLER, ""));
  if (!title) return { error: "O que você quer marcar?" };
  const input: Record<string, unknown> = { titulo: title };
  if (when.date) input.data = when.date;
  if (when.time) input.hora = when.time;
  if (when.recurrence) input.recorrencia = when.recurrence;
  return { name: "criar_evento", input };
}

function buildTarefa(c: Clause, now: LocalNow): PlannedCall | { error: string } {
  const t = c.text;
  t.take(/\b(?:cria(?:r)?\s+(?:uma\s+)?tarefa|nova\s+tarefa|tarefa\s*:|adiciona(?:r)?\s+(?:uma\s+)?tarefa|anota(?:r)?|preciso(?:\s+de)?|tenho\s+que)\b/);
  const when = takeWhen(t, now);
  const title = cleanTitle(t.clean.replace(/^(?:de|que|para|pra)\s+/i, ""));
  if (!title) return { error: "Qual é a tarefa?" };
  const input: Record<string, unknown> = { titulo: title };
  if (when.date) input.data = when.date;
  if (when.time) input.hora = when.time;
  return { name: "criar_tarefa", input };
}

// ---------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------
function periodOf(f: string): string | undefined {
  if (/\bhoje\b/.test(f)) return "hoje";
  if (/\bontem\b/.test(f)) return "ontem";
  if (/\bmes passado\b|\bultimo mes\b/.test(f)) return "mes_passado";
  if (/\b(esta|essa|nesta|nessa) semana\b|\bsemana\b/.test(f)) return "semana";
  if (/\b(30 dias|ultimos 30)\b/.test(f)) return "30_dias";
  if (/\b(este|esse|neste|nesse) ano\b|\bno ano\b/.test(f)) return "ano";
  if (/\b(este|esse|neste|nesse)? ?mes\b/.test(f)) return "mes";
  return undefined;
}

const QUESTION_START = /^(?:quanto|qual|quais|onde|como|quando|o que|que horas|me (?:diz|diga|fala|mostra|mostre|conta)|mostra|mostre|lista|listar|resumo|saldo|tenho (?:algo|compromisso|alguma|reuniao)|estou|meu (?:saldo|gasto|dia)|minha agenda|se eu|por que|ja)\b/;

const TICKER_RE = /\b[a-z]{4}\d{1,2}\b/;
const MARKET_RE = /\b(ibovespa|ibov|dolar|euro|bitcoin|bolsa|cotacao|acoes?|mercado financeiro|como esta o mercado|selic)\b/;

export const HELP_TEXT =
  "Eu registro e consulto sua vida por conversa. Por exemplo:\n\n" +
  "💸 “Gastei 47 no mercado” · “Recebi 1.500 de salário”\n" +
  "📊 “Quanto gastei esse mês?” · “Qual meu saldo?”\n" +
  "🔔 “Amanhã às 8 me lembra de pagar a conta”\n" +
  "📅 “Marca dentista quinta às 15” · “O que tenho hoje?”\n" +
  "✅ “Hoje eu treinei” · “Cria tarefa: estudar inglês”\n\n" +
  "Posso juntar várias coisas numa frase só.";

function planQuery(orig: string, f: string, now: LocalNow): Plan {
  const plan: Plan = { calls: [], planned: [] };
  const period = periodOf(f);

  if (/\b(o que voce faz|ajuda|como funciona|o que (?:voce )?consegue|pode fazer)\b/.test(f)) return { ...plan, reply: HELP_TEXT };
  if (/^(oi|ola|opa|e ai|bom dia|boa tarde|boa noite|hey|hello)\b[\s!.,]*$/.test(f)) return { ...plan, reply: "Oi! Como posso ajudar?" };
  if (/^(obrigad[oa]|valeu|brigad[oa]|thanks|show|beleza|ok|certo)\b[\s!.,]*$/.test(f)) return { ...plan, reply: "Por nada! Se precisar de algo, é só falar." };

  if (/\balerta|me avisa quando|avise quando/.test(f) && (MARKET_RE.test(f) || TICKER_RE.test(f) || /\bpassar de\b/.test(f))) return { ...plan, planned: ["alertas"] };
  if (MARKET_RE.test(f) || (TICKER_RE.test(f) && /\b(subiu|caiu|cotacao|esta|como)\b/.test(f))) return { ...plan, planned: ["mercado"] };
  if (/\b(supino|agachamento|series|carga|evoluindo|evolucao)\b/.test(f) || (/\btreino\b/.test(f) && /\b(quanto|quantos|historico|evolu)/.test(f))) return { ...plan, planned: ["treinos"] };

  if (/\b(resumo do dia|resumo da manha|resumo da noite|meu dia|como esta meu dia|como foi meu dia)\b/.test(f)) {
    plan.calls.push({ name: "consultar_agenda", input: { periodo: "hoje" } }, { name: "consultar_saldo", input: {} });
    plan.calls.push({ name: "consultar_gastos", input: { periodo: "semana", detalhe: "total" } });
    return plan;
  }

  if (/\b(quando|quanto tempo).*(acab|zer|dur)|vai acabar|continuar (?:nesse|neste) ritmo|quanto posso gastar|por semana\b|duraria|durar\b/.test(f)) return { ...plan, calls: [{ name: "projetar_saldo", input: {} }] };
  if (/\bsaldo\b|\bquanto (?:eu )?tenho\b|\bquanto sobrou\b.*\bconta\b/.test(f) && !/\bgast/.test(f)) return { ...plan, calls: [{ name: "consultar_saldo", input: {} }] };
  if (/\b(aumentou|diminuiu|subiu|em relacao|comparad|comparando|mais que no mes passado|menos que no mes passado)\b/.test(f) && /\b(gasto|gastos|gastei|despesa)\b/.test(f)) return { ...plan, calls: [{ name: "consultar_gastos", input: { periodo: "mes", detalhe: "comparar" } }] };
  if (/\bmaior (gasto|despesa|compra)\b/.test(f)) return { ...plan, calls: [{ name: "consultar_gastos", input: { periodo: period ?? "mes", detalhe: "maior" } }] };
  if (/\b(economizei|sobrou|recebi|ganhei|entrou)\b/.test(f) && /\bquanto\b/.test(f)) return { ...plan, calls: [{ name: "consultar_receitas", input: { periodo: period ?? "mes" } }] };

  if (/\b(gast|despes|gasto)/.test(f)) {
    const input: Record<string, unknown> = { periodo: period ?? "mes" };
    const cat = inferCategory(EXPENSE_CATEGORIES, f);
    const wordCat = /\b(comida|alimentacao|restaurante)\b/.test(f) ? "Alimentação" : cat;
    if (wordCat && !/\bonde\b/.test(f)) input.categoria = wordCat;
    input.detalhe = /\bonde\b|\bem que\b|\bmaiores\b/.test(f) ? "categorias" : input.categoria ? "total" : "categorias";
    return { ...plan, calls: [{ name: "consultar_gastos", input }] };
  }

  if (/\b(habito|habitos|sequencia|streak)\b/.test(f)) return { ...plan, calls: [{ name: "consultar_habitos", input: {} }] };

  if (/\b(agenda|compromisso|compromissos|o que (?:eu )?tenho|tenho algo|que horas|lembretes?|tarefas?|reuniao|hoje tenho|amanha tenho)\b/.test(f)) {
    const p = /\bamanha\b/.test(f) ? "amanha" : /\bsemana\b/.test(f) ? "semana" : /\bmes\b/.test(f) ? "mes" : /\bproximos dias\b/.test(f) ? "proximos_7_dias" : "hoje";
    return { ...plan, calls: [{ name: "consultar_agenda", input: { periodo: p } }] };
  }
  void orig; void now;
  return { ...plan, reply: "Ainda não entendi esse pedido. Tente algo como “quanto gastei esse mês?”, “gastei 30 no almoço” ou “marca dentista quinta às 15”. Diga “ajuda” para ver mais exemplos.\n\nPara conversar sobre outros assuntos (explicações, ideias, planos), a IA em nuvem precisa estar ativada neste servidor — sem ela eu entendo só comandos de finanças, agenda, hábitos, alarmes e cotações." };
}

// ---------------------------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------------------------
export function interpret(rawText: string, now: LocalNow, pending?: Pending, opts: SpecialOpts = {}): Plan {
  const orig = rawText.normalize("NFC").replace(/\s+/g, " ").trim();
  const f = fold(orig);
  const plan: Plan = { calls: [], planned: [] };
  if (!orig) return { ...plan, reply: "Pode falar — estou ouvindo." };

  // Alarmes, cotações (dólar/Ibovespa) e conversa social.
  const special = planSpecial(orig, f, now, pending, opts);
  if (special) return special;

  const hasTrigger = new RegExp(TRIGGER_RE.source, "").test(f);
  // "Meu saldo é 2.840" é uma afirmação (ajusta o saldo), apesar de começar como "meu saldo…".
  const statesBalance = /\bmeu\s+saldo\s+(?:atual\s+)?(?:e|eh|esta\s+em|ta\s+em|agora\s+e)\s+(?:r\$\s*)?\d/.test(f);
  const isQuestion = !statesBalance && (orig.endsWith("?") || QUESTION_START.test(f));

  // Resposta a uma pergunta de acompanhamento ("Onde você gastou R$ 30?")
  if (pending?.tool === "registrar_gasto" && !hasTrigger && !isQuestion && orig.length <= 80) {
    const input = { ...pending.input };
    if (input.valor_reais === undefined) {
      const t = new Text(orig);
      const cents = takeMoney(t);
      if (cents) input.valor_reais = cents / 100;
      else return { ...plan, ask: { question: "Quanto foi o gasto?", pending } };
      const desc = t.clean;
      if (desc) { input.descricao = capitalize(desc); const c = inferCategory(EXPENSE_CATEGORIES, fold(desc)); if (c) input.categoria = c; }
      return { ...plan, calls: [{ name: "registrar_gasto", input }] };
    }
    const answer = orig.replace(/^(?:foi\s+)?(?:(?:n[oa]s?|em|com|de|do|da|para|pra)\s+)+/i, "").replace(/[.!]+$/, "");
    if (answer) {
      input.descricao = capitalize(answer);
      const c = inferCategory(EXPENSE_CATEGORIES, fold(answer));
      if (c) input.categoria = c;
      return { ...plan, calls: [{ name: "registrar_gasto", input }] };
    }
  }

  // Consultas têm prioridade sobre comandos ("quanto gastei" contém "gastei").
  if (isQuestion && !/^(?:ja)\b/.test(f)) return planQuery(orig, f, now);

  // Funcionalidades futuras citadas dentro de um comando.
  if (/\b(me avisa|avise|alerta)\b.*\b(quando|se)\b/.test(f) && (MARKET_RE.test(f) || TICKER_RE.test(f))) return { ...plan, planned: ["alertas"] };

  const clauses = splitClauses(orig);
  if (!clauses.length) {
    if (MARKET_RE.test(f) || TICKER_RE.test(f)) return { ...plan, planned: ["mercado"] };
    return planQuery(orig, f, now);
  }

  const errors: string[] = [];
  for (const c of clauses) {
    switch (c.kind) {
      case "gasto": {
        const r = buildGasto(c, now);
        if (r.call) plan.calls.push(r.call);
        else if (r.ask) plan.ask = plan.ask ?? r.ask;
        break;
      }
      case "receita": {
        const r = buildReceita(c, now);
        "error" in r ? errors.push(r.error) : plan.calls.push(r);
        break;
      }
      case "lembrete": {
        const r = buildLembrete(c, now);
        "error" in r ? errors.push(r.error) : plan.calls.push(r);
        break;
      }
      case "evento": {
        const r = buildEvento(c, now);
        "error" in r ? errors.push(r.error) : plan.calls.push(r);
        break;
      }
      case "tarefa": {
        const r = buildTarefa(c, now);
        "error" in r ? errors.push(r.error) : plan.calls.push(r);
        break;
      }
      case "concluir": {
        const cm = /\b(?:conclui|concluir|terminei|finalizei|completei|ja fiz)\b\s*/.exec(c.text.f);
        const rest = (cm ? c.text.o.slice(cm.index + cm[0].length) : "").replace(/\s+/g, " ").trim().replace(/^(?:a\s+tarefa\s+|tarefa\s+|o\s+|a\s+)/i, "").replace(/[.!]+$/, "");
        if (rest) plan.calls.push({ name: "concluir_tarefa", input: { titulo: rest } });
        else errors.push("Qual tarefa você concluiu?");
        break;
      }
      case "habito": {
        const hv = HABIT_VERBS.find((h) => h.re.test(c.text.f));
        const w = takeWhen(c.text, now);
        const input: Record<string, unknown> = { habito: hv?.habit ?? "Hábito" };
        if (w.date) input.data = w.date;
        plan.calls.push({ name: "registrar_habito", input });
        if (/\b(kg|series|serie|repeticoes|reps|supino|agachamento)\b/.test(c.text.f)) plan.planned.push("treinos");
        break;
      }
      case "treino": {
        plan.calls.push({ name: "registrar_habito", input: { habito: "Treino" } });
        plan.planned.push("treinos");
        break;
      }
      case "saldo": {
        const t = new Text(c.text.o);
        const cents = takeMoney(t);
        if (cents !== null) plan.calls.push({ name: "ajustar_saldo", input: { saldo_reais: cents / 100 } });
        else errors.push("Qual é o seu saldo?");
        break;
      }
    }
  }
  plan.planned = [...new Set(plan.planned)];
  if (errors.length && !plan.calls.length && !plan.ask) return { ...plan, reply: errors[0]! };
  if (errors.length) plan.reply = errors.join(" ");
  void daysBetween;
  return plan;
}
