import type { Tool, ToolResult } from "./types.js";
import type { Ctx } from "../services/context.js";
import * as fin from "../services/finance.js";
import * as ag from "../services/agenda.js";
import * as hb from "../services/habits.js";
import { brl, brlShort, parseBrMoney, reaisToCents } from "../util/money.js";
import {
  PERIODS, addDays, daysBetween, describeRecurrence, humanDate, humanDateInline, isDate, isRecurrence, isTime, periodRange, startOfWeek, type Period,
} from "../util/time.js";
import { HttpError, asObject, bad, oneOf, reqStr, str } from "../util/validate.js";
import { norm } from "../util/text.js";
import { MarketError, ASSETS, describeMarket, type Asset, type MarketDetail } from "../services/market.js";
import type { DeviceResult } from "./types.js";

// ---------- helpers de entrada ----------
type Obj = Record<string, unknown>;

/** Aceita número (reais) ou texto ("1.500,50") vindo do modelo ou do interpretador local. */
function moneyCents(o: Obj, key: string): number {
  const v = o[key];
  let cents: number | null = null;
  if (typeof v === "number" && Number.isFinite(v)) cents = reaisToCents(v);
  else if (typeof v === "string") cents = parseBrMoney(v);
  if (!cents || cents <= 0) throw bad("Não entendi o valor. Quanto foi?");
  return cents;
}
function optDate(o: Obj, key = "data"): string | undefined {
  const v = str(o, key, { optional: true, max: 10 });
  if (v !== undefined && !isDate(v)) throw bad("Data inválida (use AAAA-MM-DD).");
  return v;
}
function optTime(o: Obj, key = "hora"): string | undefined {
  const v = str(o, key, { optional: true, max: 5 });
  if (v !== undefined && !isTime(v)) throw bad("Horário inválido (use HH:mm).");
  return v;
}
function optRecurrence(o: Obj): string | undefined {
  const v = str(o, "recorrencia", { optional: true, max: 30 });
  if (v !== undefined && !isRecurrence(v)) throw bad("Recorrência inválida.");
  return v;
}
const PRIORITIES = ["baixa", "normal", "alta"] as const;

const when = (ctx: Ctx, date: string | null, time: string | null): string => {
  const d = date ? humanDate(date, ctx.now.date) : "Sem data";
  return time ? `${d} · ${time}` : d;
};

// ---------- Finanças: escrita ----------
const registrarGasto: Tool = {
  name: "registrar_gasto",
  description:
    "Registra uma despesa do usuário. Use quando ele disser que gastou/pagou/comprou algo. Infira a categoria pelo contexto (almoço→Alimentação, uber→Transporte, farmácia→Saúde…). Se o valor existir mas não houver NENHUM contexto do que foi o gasto, pergunte antes em vez de chamar.",
  input_schema: {
    type: "object",
    properties: {
      valor_reais: { type: "number", description: "Valor em reais (ex.: 47.5)." },
      categoria: { type: "string", description: "Ex.: Mercado, Alimentação, Transporte, Moradia, Contas, Saúde, Lazer, Educação, Compras, Outros." },
      descricao: { type: "string", description: "Texto curto do que foi (ex.: Almoço)." },
      data: { type: "string", description: "AAAA-MM-DD. Omita para hoje." },
    },
    required: ["valor_reais"],
  },
  async run(ctx, input) {
    const o = asObject(input, "entrada");
    const t = await fin.addTransaction(ctx, { kind: "expense", amountCents: moneyCents(o, "valor_reais"), category: str(o, "categoria", { optional: true, max: 40 }), description: str(o, "descricao", { optional: true, max: 120 }), date: optDate(o) });
    const label = t.description && norm(t.description) !== norm(t.category?.name ?? "") ? `${t.description}` : t.category?.name ?? "Despesa";
    const sub = t.description && t.category && norm(t.description) !== norm(t.category.name) ? `${t.category.name} · ` : "";
    return {
      ok: true, mode: "write",
      text: `${label} · ${brl(t.amountCents)}\n${sub}${humanDate(t.date, ctx.now.date)}`,
      line: `− ${brlShort(t.amountCents)} · ${t.category?.name ?? label}`,
      data: { id: t.id, valor: brl(t.amountCents), categoria: t.category?.name, data: t.date },
      record: { kind: "transaction", id: t.id },
    };
  },
};

const registrarReceita: Tool = {
  name: "registrar_receita",
  description: "Registra uma receita/entrada de dinheiro (salário, freela, venda, presente, rendimento). Use quando o usuário disser que recebeu/ganhou dinheiro.",
  input_schema: {
    type: "object",
    properties: {
      valor_reais: { type: "number" },
      categoria: { type: "string", description: "Ex.: Salário, Freelance, Investimentos, Outras receitas." },
      descricao: { type: "string" },
      data: { type: "string", description: "AAAA-MM-DD. Omita para hoje." },
    },
    required: ["valor_reais"],
  },
  async run(ctx, input) {
    const o = asObject(input, "entrada");
    const t = await fin.addTransaction(ctx, { kind: "income", amountCents: moneyCents(o, "valor_reais"), category: str(o, "categoria", { optional: true, max: 40 }), description: str(o, "descricao", { optional: true, max: 120 }), date: optDate(o) });
    const generic = !t.category || t.category.name === "Outras receitas";
    return {
      ok: true, mode: "write",
      text: `${t.description || t.category?.name || "Receita"} · ${brl(t.amountCents)}\n${humanDate(t.date, ctx.now.date)}`,
      line: generic ? `+ ${brlShort(t.amountCents)} registrados` : `+ ${brlShort(t.amountCents)} · ${t.category!.name}`,
      data: { id: t.id, valor: brl(t.amountCents), categoria: t.category?.name, data: t.date },
      record: { kind: "transaction", id: t.id },
    };
  },
};

const ajustarSaldo: Tool = {
  name: "ajustar_saldo",
  description: "Define o saldo atual do usuário (ex.: 'meu saldo é 2.000'). Cria um lançamento de ajuste transparente para que o saldo fique igual ao valor informado.",
  input_schema: { type: "object", properties: { saldo_reais: { type: "number" } }, required: ["saldo_reais"] },
  async run(ctx, input) {
    const o = asObject(input, "entrada");
    const v = o.saldo_reais;
    const target = typeof v === "number" ? reaisToCents(v) : typeof v === "string" ? parseBrMoney(v) : null;
    if (target === null || target < 0) throw bad("Não entendi o saldo informado.");
    const r = await fin.adjustBalance(ctx, target);
    if (!r.tx) return { ok: true, mode: "write", text: `Seu saldo já é ${brl(target)}.`, line: `Saldo já é ${brl(target)}`, data: { saldo: brl(target) } };
    return {
      ok: true, mode: "write",
      text: `Saldo atualizado para ${brl(target)}\nAjuste de ${r.diffCents > 0 ? "+" : "−"} ${brl(Math.abs(r.diffCents))}`,
      line: `💰 Saldo definido em ${brl(target)}`,
      data: { saldo: brl(target) },
      record: { kind: "transaction", id: r.tx.id },
    };
  },
};

// ---------- Finanças: consulta ----------
const consultarSaldo: Tool = {
  name: "consultar_saldo",
  description: "Consulta o saldo atual do usuário (tudo que entrou menos tudo que saiu até hoje).",
  input_schema: { type: "object", properties: {} },
  async run(ctx) {
    const b = await fin.balance(ctx);
    const month = periodRange("mes", ctx.now.date);
    const t = await fin.totals(ctx, month);
    const none = (await fin.totals(ctx, periodRange("tudo", ctx.now.date))).count === 0;
    if (none) return { ok: true, mode: "read", text: "Seu saldo é R$ 0,00 — você ainda não tem lançamentos. Diga “meu saldo é 2.000” ou “recebi 1.500” para começar.", data: { saldo: brl(0), vazio: true } };
    return {
      ok: true, mode: "read",
      text: `Seu saldo atual é ${brl(b)}.\n\nEste mês: entraram ${brl(t.income)} e saíram ${brl(t.expense)}.`,
      data: { saldo: brl(b), entradas_mes: brl(t.income), saidas_mes: brl(t.expense) },
    };
  },
};

function pctText(pct: number | null): string {
  if (pct === null) return "";
  const r = Math.round(Math.abs(pct));
  if (r === 0) return "Isso é praticamente igual ao mesmo período do mês passado.";
  return `Isso representa ${r}% ${pct > 0 ? "a mais" : "a menos"} que no mesmo período do mês passado.`;
}

const consultarGastos: Tool = {
  name: "consultar_gastos",
  description:
    "Analisa as despesas do usuário com dados reais. detalhe: 'total' (soma), 'categorias' (ranking por categoria — use para 'onde estou gastando mais'), 'maior' (maior gasto individual), 'comparar' (este mês vs. mês passado).",
  input_schema: {
    type: "object",
    properties: {
      periodo: { type: "string", enum: PERIODS, description: "Padrão: mes." },
      categoria: { type: "string", description: "Filtra por categoria (ex.: Alimentação para 'comida')." },
      detalhe: { type: "string", enum: ["total", "categorias", "maior", "comparar"], description: "Padrão: categorias." },
    },
  },
  async run(ctx, input) {
    const o = asObject(input ?? {}, "entrada");
    const period = (oneOf(o, "periodo", PERIODS, true) ?? "mes") as Period;
    const detail = oneOf(o, "detalhe", ["total", "categorias", "maior", "comparar"] as const, true) ?? "categorias";
    const catName = str(o, "categoria", { optional: true, max: 40 });
    const range = periodRange(period, ctx.now.date);
    const empty = (what: string): ToolResult => ({ ok: true, mode: "read", text: `Não encontrei ${what} ${range.label}.`, data: { vazio: true } });

    if (detail === "comparar") {
      const m = await fin.monthOverMonth(ctx);
      if (m.previousCents === 0) return { ok: true, mode: "read", text: m.currentCents === 0 ? "Ainda não há gastos neste mês nem no anterior para comparar." : `Você gastou ${brl(m.currentCents)} este mês. Não há gastos no mês passado para comparar.`, data: { atual: brl(m.currentCents) } };
      return { ok: true, mode: "read", text: `Este mês você gastou ${brl(m.currentCents)}; no mesmo período do mês passado foram ${brl(m.previousCents)}.\n\n${pctText(m.changePct)}`, data: { atual: brl(m.currentCents), anterior: brl(m.previousCents), variacao_pct: Math.round(m.changePct ?? 0) } };
    }

    if (detail === "maior") {
      const b = await fin.biggestExpense(ctx, range);
      if (!b) return empty("gastos");
      return { ok: true, mode: "read", text: `Seu maior gasto ${range.label} foi ${b.description || b.category?.name || "uma despesa"}: ${brl(b.amountCents)} (${humanDateInline(b.date, ctx.now.date)}).`, data: { valor: brl(b.amountCents), descricao: b.description, categoria: b.category?.name, data: b.date } };
    }

    if (catName) {
      const rows = await fin.listTransactions(ctx, { range, kind: "expense", category: catName, limit: 200 });
      const cat = (await fin.listCategories(ctx, "expense")).find((c) => norm(c.name) === norm(catName));
      if (!cat) return { ok: true, mode: "read", text: `Não encontrei a categoria “${catName}”. Suas categorias de gasto: ${(await fin.listCategories(ctx, "expense")).map((c) => c.name).join(", ")}.`, data: { categoria_inexistente: true } };
      const total = rows.reduce((a, r) => a + r.amountCents, 0);
      if (!rows.length) return empty(`gastos com ${cat.name}`);
      return { ok: true, mode: "read", text: `Você gastou ${brl(total)} com ${cat.name} ${range.label}${rows.length > 1 ? ` (${rows.length} lançamentos)` : ""}.`, data: { categoria: cat.name, total: brl(total), lancamentos: rows.length } };
    }

    const cats = await fin.expensesByCategory(ctx, range);
    const total = await fin.realExpenses(ctx, range);
    if (!cats.length) return empty("gastos");
    if (detail === "total") return { ok: true, mode: "read", text: `Você gastou ${brl(total)} ${range.label}.`, data: { total: brl(total) } };

    const top = cats.slice(0, 3);
    const lines = top.map((c) => `${c.icon} ${c.name} — ${brlShort(c.totalCents)}`).join("\n");
    const cmp = period === "mes" ? pctText((await fin.monthOverMonth(ctx)).changePct) : "";
    return {
      ok: true, mode: "read",
      text: `Você gastou ${brlShort(total)} ${range.label}.\n\nSeus maiores gastos foram:\n\n${lines}${cmp ? `\n\n${cmp}` : ""}`,
      data: { total: brl(total), categorias: cats.slice(0, 6).map((c) => ({ nome: c.name, total: brl(c.totalCents), parte_pct: Math.round(c.share * 100) })) },
    };
  },
};

const consultarReceitas: Tool = {
  name: "consultar_receitas",
  description: "Consulta quanto o usuário recebeu (entradas) em um período e quanto sobrou (economizou).",
  input_schema: { type: "object", properties: { periodo: { type: "string", enum: PERIODS } } },
  async run(ctx, input) {
    const o = asObject(input ?? {}, "entrada");
    const period = (oneOf(o, "periodo", PERIODS, true) ?? "mes") as Period;
    const range = periodRange(period, ctx.now.date);
    const inc = await fin.realIncome(ctx, range);
    const exp = await fin.realExpenses(ctx, range);
    if (inc === 0 && exp === 0) return { ok: true, mode: "read", text: `Não há lançamentos ${range.label}.`, data: { vazio: true } };
    const res = inc - exp;
    return {
      ok: true, mode: "read",
      text: `Você recebeu ${brl(inc)} ${range.label} e gastou ${brl(exp)}.\n\n${res >= 0 ? `Sobraram ${brl(res)}.` : `Você gastou ${brl(-res)} a mais do que recebeu.`}`,
      data: { recebido: brl(inc), gasto: brl(exp), resultado: brl(res) },
    };
  },
};

const projetarSaldo: Tool = {
  name: "projetar_saldo",
  description: "Estima por quanto tempo o saldo dura no ritmo atual de gastos e quanto o usuário pode gastar por semana até o fim do mês. É uma ESTIMATIVA — sempre apresente como tal.",
  input_schema: { type: "object", properties: {} },
  async run(ctx) {
    const p = await fin.projection(ctx);
    if (!p.enough || !p.monthlySpendCents) {
      return { ok: true, mode: "read", text: "Ainda não tenho histórico suficiente para estimar seu ritmo de gastos (preciso de pelo menos 7 dias com despesas registradas).", data: { historico_insuficiente: true } };
    }
    const m = p.monthsLeft!;
    let dur: string;
    if (p.balanceCents <= 0) dur = "Seu saldo já está zerado ou negativo.";
    else if (m < 1) dur = `Mantendo sua média atual de gastos (${brl(p.monthlySpendCents)}/mês), seu saldo duraria aproximadamente ${Math.max(1, Math.round(m * 30))} dias.`;
    else dur = `Mantendo sua média atual de gastos (${brl(p.monthlySpendCents)}/mês), seu saldo duraria aproximadamente ${(Math.round(m * 2) / 2).toString().replace(".", ",")} ${Math.round(m * 2) / 2 === 1 ? "mês" : "meses"}.`;
    const week = p.balanceCents > 0 ? `\n\nPara chegar ao fim do mês, você poderia gastar até ${brl(p.weeklyBudgetCents!)} por semana.` : "";
    return {
      ok: true, mode: "read",
      text: `${dur}${week}\n\nÉ uma estimativa baseada nos seus últimos ${p.basisDays} dias de dados — não uma garantia.`,
      data: { estimativa: true, saldo: brl(p.balanceCents), gasto_mensal_medio: brl(p.monthlySpendCents), meses_restantes: Math.round(m * 10) / 10, limite_semanal: brl(p.weeklyBudgetCents!) },
    };
  },
};

// ---------- Agenda ----------
const criarTarefa: Tool = {
  name: "criar_tarefa",
  description: "Cria uma tarefa (algo a fazer, sem hora marcada obrigatória). Para 'me lembra de…' use criar_lembrete.",
  input_schema: {
    type: "object",
    properties: { titulo: { type: "string" }, data: { type: "string", description: "AAAA-MM-DD (opcional)." }, hora: { type: "string", description: "HH:mm (opcional)." }, prioridade: { type: "string", enum: PRIORITIES } },
    required: ["titulo"],
  },
  async run(ctx, input) {
    const o = asObject(input, "entrada");
    const t = await ag.addTask(ctx, { title: reqStr(o, "titulo", { max: 140 }), date: optDate(o), time: optTime(o), priority: oneOf(o, "prioridade", PRIORITIES, true) });
    return { ok: true, mode: "write", text: `✅ ${t.title}\n${when(ctx, t.date, t.time)}`, line: `✅ Tarefa: ${t.title}${t.date ? ` · ${humanDateInline(t.date, ctx.now.date)}` : ""}`, data: { id: t.id, titulo: t.title, data: t.date }, record: { kind: "task", id: t.id } };
  },
};

const concluirTarefa: Tool = {
  name: "concluir_tarefa",
  description: "Marca como concluída uma tarefa aberta, identificada por parte do título.",
  input_schema: { type: "object", properties: { titulo: { type: "string" } }, required: ["titulo"] },
  async run(ctx, input) {
    const o = asObject(input, "entrada");
    const r = await ag.completeTaskByTitle(ctx, reqStr(o, "titulo", { max: 140 }));
    if (!r) return { ok: false, mode: "write", text: "Não encontrei uma tarefa aberta com esse nome." };
    if (r === "ambiguous") return { ok: false, mode: "write", text: "Encontrei mais de uma tarefa parecida. Qual delas?" };
    return { ok: true, mode: "write", text: `✅ Concluída: ${r.title}`, line: `✅ Concluída: ${r.title}`, data: { titulo: r.title } };
  },
};

const criarLembrete: Tool = {
  name: "criar_lembrete",
  description: "Cria um lembrete ('me lembra de…'), único ou recorrente. recorrencia: daily | weekdays | weekly:1,3 (0=domingo) | monthly:15. Ainda NÃO dispara notificação no celular — fica registrado e aparece na Agenda e no Início.",
  input_schema: {
    type: "object",
    properties: {
      titulo: { type: "string", description: "O que lembrar, no imperativo curto (ex.: Pagar a conta)." },
      data: { type: "string", description: "AAAA-MM-DD da primeira ocorrência. Omita para hoje." },
      hora: { type: "string", description: "HH:mm" },
      recorrencia: { type: "string" },
      prioridade: { type: "string", enum: PRIORITIES },
    },
    required: ["titulo"],
  },
  async run(ctx, input) {
    const o = asObject(input, "entrada");
    const r = await ag.addReminder(ctx, { title: reqStr(o, "titulo", { max: 140 }), date: optDate(o), time: optTime(o), recurrence: optRecurrence(o), priority: oneOf(o, "prioridade", PRIORITIES, true) });
    const rec = r.recurrence ? `${describeRecurrence(r.recurrence)}${r.time ? ` às ${r.time}` : ""}` : null;
    const whenTxt = rec ?? `${humanDateInline(r.date, ctx.now.date)}${r.time ? ` às ${r.time}` : ""}`;
    return {
      ok: true, mode: "write",
      text: `🔔 ${r.title}\n${rec ? rec[0]!.toUpperCase() + rec.slice(1) : when(ctx, r.date, r.time)}`,
      line: `🔔 Lembrete criado para ${whenTxt}`,
      data: { id: r.id, titulo: r.title, quando: whenTxt },
      record: { kind: "reminder", id: r.id },
    };
  },
};

const criarEvento: Tool = {
  name: "criar_evento",
  description: "Cria um compromisso na agenda ('marca dentista quinta às 15'), único ou recorrente.",
  input_schema: {
    type: "object",
    properties: { titulo: { type: "string" }, data: { type: "string", description: "AAAA-MM-DD. Omita para hoje." }, hora: { type: "string", description: "HH:mm" }, hora_fim: { type: "string" }, local: { type: "string" }, recorrencia: { type: "string" } },
    required: ["titulo"],
  },
  async run(ctx, input) {
    const o = asObject(input, "entrada");
    const e = await ag.addEvent(ctx, { title: reqStr(o, "titulo", { max: 140 }), date: optDate(o), time: optTime(o), endTime: optTime(o, "hora_fim"), location: str(o, "local", { optional: true, max: 120 }), recurrence: optRecurrence(o) });
    const rec = e.recurrence ? describeRecurrence(e.recurrence) : null;
    return {
      ok: true, mode: "write",
      text: `📅 ${e.title}\n${rec ? `${rec[0]!.toUpperCase()}${rec.slice(1)}${e.time ? ` · ${e.time}` : ""}` : when(ctx, e.date, e.time)}`,
      line: `📅 ${e.title} · ${rec ?? humanDateInline(e.date, ctx.now.date)}${e.time ? ` às ${e.time}` : ""}`,
      data: { id: e.id, titulo: e.title, data: e.date, hora: e.time },
      record: { kind: "event", id: e.id },
    };
  },
};

const AGENDA_PERIODS = ["hoje", "amanha", "semana", "proximos_7_dias", "mes"] as const;
const consultarAgenda: Tool = {
  name: "consultar_agenda",
  description: "Lista compromissos, lembretes e tarefas do usuário em um período.",
  input_schema: { type: "object", properties: { periodo: { type: "string", enum: AGENDA_PERIODS, description: "Padrão: hoje." } } },
  async run(ctx, input) {
    const o = asObject(input ?? {}, "entrada");
    const p = oneOf(o, "periodo", AGENDA_PERIODS, true) ?? "hoje";
    const today = ctx.now.date;
    const range = p === "hoje" ? { from: today, to: today, label: "hoje" }
      : p === "amanha" ? { from: addDays(today, 1), to: addDays(today, 1), label: "amanhã" }
      : p === "semana" ? { from: startOfWeek(today), to: addDays(startOfWeek(today), 6), label: "esta semana" }
      : p === "proximos_7_dias" ? { from: today, to: addDays(today, 6), label: "nos próximos 7 dias" }
      : { ...periodRange("mes", today) };
    const items = (await ag.agenda(ctx, range.from, range.to)).filter((i) => !i.done);
    if (!items.length) return { ok: true, mode: "read", text: `Você não tem nada na agenda ${range.label}.`, data: { vazio: true } };
    const single = range.from === range.to;
    const lines = items.map((i) => {
      const icon = i.kind === "reminder" ? "🔔 " : i.kind === "task" ? "✅ " : "";
      const day = single ? "" : `${humanDate(i.date, today)} · `;
      return `${day}${i.time ? `${i.time} — ` : ""}${icon}${i.title}`;
    });
    return { ok: true, mode: "read", text: `${single ? `${range.label[0]!.toUpperCase()}${range.label.slice(1)} você` : `Em ${range.label.replace(/^nos? /, "")} você`} tem ${items.length} ${items.length === 1 ? "item" : "itens"}:\n\n${lines.join("\n")}`, data: { itens: items.map((i) => ({ tipo: i.kind, titulo: i.title, data: i.date, hora: i.time })) } };
  },
};

// ---------- Hábitos ----------
const registrarHabito: Tool = {
  name: "registrar_habito",
  description: "Marca um hábito como feito hoje (ou em outra data) — treinar, estudar, ler, correr, beber água… Cria o hábito se ele ainda não existir.",
  input_schema: { type: "object", properties: { habito: { type: "string", description: "Nome curto (ex.: Treino, Estudar, Ler)." }, data: { type: "string" } }, required: ["habito"] },
  async run(ctx, input) {
    const o = asObject(input, "entrada");
    const r = await hb.logHabit(ctx, reqStr(o, "habito", { max: 40 }), optDate(o));
    const h = (await hb.listHabits(ctx)).find((x) => x.id === r.habit.id)!;
    const seq = h.currentStreak > 1 ? `${h.currentStreak} dias seguidos` : "primeiro dia da sequência";
    return {
      ok: true, mode: "write",
      text: r.alreadyLogged ? `${h.name} já estava marcado. ${seq}.` : `✅ ${h.name}\n${seq}${h.currentStreak === h.bestStreak && h.currentStreak > 1 ? " · melhor sequência!" : ""}`,
      line: `✅ ${h.name} · ${seq}`,
      data: { habito: h.name, sequencia_atual: h.currentStreak, melhor_sequencia: h.bestStreak, ja_estava_marcado: r.alreadyLogged },
    };
  },
};

const consultarHabitos: Tool = {
  name: "consultar_habitos",
  description: "Mostra sequência atual, melhor sequência e frequência dos hábitos do usuário.",
  input_schema: { type: "object", properties: {} },
  async run(ctx) {
    const hs = await hb.listHabits(ctx);
    if (!hs.length) return { ok: true, mode: "read", text: "Você ainda não tem hábitos. Diga “hoje eu treinei” e eu começo a acompanhar.", data: { vazio: true } };
    const lines = hs.map((h) => `${h.doneToday ? "✅" : "▫️"} ${h.name} — ${h.currentStreak} ${h.currentStreak === 1 ? "dia" : "dias"} seguidos (melhor: ${h.bestStreak}) · ${Math.round(h.frequency30 * 100)}% nos últimos 30 dias`);
    return { ok: true, mode: "read", text: lines.join("\n"), data: hs.map((h) => ({ habito: h.name, sequencia: h.currentStreak, melhor: h.bestStreak, feito_hoje: h.doneToday, frequencia_30d_pct: Math.round(h.frequency30 * 100) })) };
  },
};

// ---------- Mercado financeiro (dados reais, com fonte e horário) ----------
const MARKET_DETAILS = ["cotacao", "variacao", "ontem", "historico"] as const;
const consultarMercado: Tool = {
  name: "consultar_mercado",
  description:
    "Consulta a cotação REAL do dólar comercial (ativo=dolar) ou do Ibovespa (ativo=ibovespa): valor, variação do dia, fechamento anterior e histórico recente, com data/hora e fonte. Use para 'quanto está o dólar', 'o Ibovespa subiu?', 'e ontem?'. Só existem esses dois ativos; para outros (ações, euro, bitcoin, Selic) diga que ainda não há suporte.",
  input_schema: {
    type: "object",
    properties: {
      ativo: { type: "string", enum: ["dolar", "ibovespa"] },
      detalhe: { type: "string", enum: [...MARKET_DETAILS], description: "cotacao (padrão) | variacao (subiu/caiu hoje, %) | ontem | historico (últimos dias)" },
    },
    required: ["ativo"],
  },
  async run(ctx, input) {
    const o = asObject(input, "entrada");
    const ativo = oneOf(o, "ativo", ASSETS);
    const detalhe = (oneOf(o, "detalhe", MARKET_DETAILS, true) ?? "cotacao") as MarketDetail;
    if (!ctx.market) return { ok: false, mode: "read", text: "A consulta de mercado não está ativada neste servidor." };
    try {
      const snap = await ctx.market.get(ativo as Asset);
      const q = snap.quote;
      return {
        ok: true, mode: "read",
        text: describeMarket(snap, detalhe),
        data: {
          ativo: q.label, valor: q.value, unidade: q.unit, variacao_pct: q.changePct, variacao_abs: q.changeAbs,
          fechamento_anterior: q.previousClose, data_fechamento_anterior: q.previousDate,
          atualizado_em: q.asOf, fonte: q.source, aviso_de_atraso: q.delayNote, tempo_real: !q.stale,
          historico: snap.history.slice(-6),
        },
      };
    } catch (e) {
      if (e instanceof MarketError) return { ok: false, mode: "read", text: e.message + " Tente novamente em instantes." };
      throw e;
    }
  },
};

// ---------- Ferramentas do APARELHO (alarme e calendário) ----------
// O servidor só VALIDA e ENVIA o pedido; quem executa é o app Android, com a permissão do usuário. O resultado volta
// do aparelho e só então a Veyra afirma algo. A IA não consegue pedir ações fora desta lista.
const pad2 = (n: number) => String(n).padStart(2, "0");
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const fmtEv = (e: { title?: unknown; start?: unknown; end?: unknown; location?: unknown; allDay?: unknown; id?: unknown }) => {
  const s = String(e.start ?? ""), en = String(e.end ?? "");
  const day = s.slice(0, 10), t = s.slice(11, 16);
  const when = e.allDay ? "dia inteiro" : `${t}${en.length >= 16 && en.slice(0, 10) === day ? `–${en.slice(11, 16)}` : ""}`;
  return `${day.slice(8)}/${day.slice(5, 7)} · ${when} · ${String(e.title ?? "(sem título)").slice(0, 80)}${e.location ? ` (${String(e.location).slice(0, 60)})` : ""}`;
};
const deviceFail = (r: DeviceResult, what: string): { ok: false; mode: "write"; text: string } => ({
  ok: false, mode: "write",
  text:
    r.cancelled ? `${what}: você cancelou, então nada foi feito.`
    : r.error === "permissao_negada" ? `${what}: o Android negou a permissão. Libere em Configurações → Apps → Veyra AI → Permissões e peça de novo.`
    : r.error === "sem_app" ? `${what}: não encontrei um aplicativo no celular para isso.`
    : r.error === "indisponivel" ? `${what}: este recurso não está disponível neste aparelho.`
    : `${what}: não consegui concluir no aparelho${typeof r.error === "string" ? ` (${r.error.slice(0, 80)})` : ""}.`,
});

const definirAlarme: Tool = {
  name: "definir_alarme",
  description:
    "Pede ao app Relógio do Android para criar um alarme (intent oficial). NÃO é possível confirmar que o alarme foi salvo nem ler alarmes existentes: diga sempre que você 'pediu ao Relógio'. Converta o horário para 24h (ex.: 'quatro da tarde' = 16:00). Se o período do dia for ambíguo ('às 4'), PERGUNTE antes de chamar.",
  input_schema: {
    type: "object",
    properties: {
      hora: { type: "string", description: "HH:mm em 24h." },
      rotulo: { type: "string", description: "Nome do alarme (opcional)." },
      dias: { type: "array", items: { type: "string", enum: ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] }, description: "Repetição semanal (opcional)." },
    },
    required: ["hora"],
  },
  async run() { return { ok: false, mode: "write", text: "Este recurso só funciona no aplicativo Android." }; },
  device: {
    capability: "alarm", action: "alarm.set",
    prepare(_ctx, input) {
      const o = asObject(input, "entrada");
      const hora = reqStr(o, "hora", { max: 5 });
      if (!isTime(hora)) throw bad("Horário inválido (use HH:mm).");
      const dias = Array.isArray(o.dias) ? o.dias : [];
      if (dias.some((d) => typeof d !== "string" || !DIAS.includes(d))) throw bad("Dias inválidos.");
      return { hora, minutos: toMin(hora), rotulo: (str(o, "rotulo", { optional: true, max: 60 }) ?? "").trim(), dias: [...new Set(dias as string[])] };
    },
    describe(_ctx, p, r) {
      if (!r.ok) return deviceFail(r, `Alarme das ${p.hora}`);
      return {
        ok: true, mode: "write",
        text: `Pedi ao app Relógio para criar o alarme das ${p.hora}${(p.dias as string[]).length ? ` (${(p.dias as string[]).join(", ")})` : ""}. O Android pode pedir sua confirmação lá — não consigo verificar se ele foi salvo.`,
        line: `⏰ Alarme das ${p.hora} solicitado ao Relógio`,
        data: { status: "solicitado_ao_relogio", hora: p.hora },
      };
    },
  },
};

const calEvents = (r: DeviceResult) => (Array.isArray(r.events) ? (r.events as Record<string, unknown>[]) : []);
const datePair = (o: Obj) => {
  const de = reqStr(o, "de", { max: 10 }), ate = str(o, "ate", { optional: true, max: 10 }) ?? de;
  if (!isDate(de) || !isDate(ate) || ate < de) throw bad("Período inválido.");
  if (daysBetween(de, ate) > 62) throw bad("Período grande demais (máximo ~2 meses).");
  return { de, ate };
};

const consultarCalendario: Tool = {
  name: "consultar_calendario",
  description: "Lê os eventos do calendário do CELULAR (permissão do usuário) entre duas datas. Use para 'o que tenho amanhã?', 'tenho algo às 16h?' e para achar o id de um evento antes de alterar/excluir.",
  input_schema: { type: "object", properties: { de: { type: "string", description: "AAAA-MM-DD" }, ate: { type: "string", description: "AAAA-MM-DD (opcional; padrão = de)" } }, required: ["de"] },
  async run() { return { ok: false, mode: "read", text: "Este recurso só funciona no aplicativo Android." }; },
  device: {
    capability: "calendar", action: "calendar.query",
    prepare(_ctx, input) { return datePair(asObject(input, "entrada")); },
    describe(ctx, p, r) {
      if (!r.ok) return { ...deviceFail(r, "Consulta ao calendário"), mode: "read" };
      const ev = calEvents(r);
      const span = p.de === p.ate ? humanDate(String(p.de), ctx.now.date) : `${p.de} a ${p.ate}`;
      return {
        ok: true, mode: "read",
        text: ev.length ? `No calendário do celular (${span}):\n${ev.slice(0, 20).map(fmtEv).join("\n")}${r.truncated ? "\n… (há mais eventos)" : ""}` : `Não há eventos no calendário do celular (${span}).`,
        data: { periodo: span, eventos: ev.slice(0, 30), truncado: !!r.truncated },
      };
    },
  },
};

const criarEventoCalendario: Tool = {
  name: "criar_evento_calendario",
  description: "Cria um evento no calendário do CELULAR. O aparelho verifica conflitos de horário: se houver, NADA é criado e os conflitos voltam — pergunte ao usuário e, se ele confirmar, chame de novo com ignorar_conflito=true.",
  input_schema: {
    type: "object",
    properties: {
      titulo: { type: "string" }, data: { type: "string", description: "AAAA-MM-DD" }, hora: { type: "string", description: "HH:mm (24h)" },
      duracao_min: { type: "integer", description: "Padrão 60." }, hora_fim: { type: "string", description: "HH:mm (alternativa à duração)" },
      local: { type: "string" }, notas: { type: "string" }, ignorar_conflito: { type: "boolean" },
    },
    required: ["titulo", "data", "hora"],
  },
  async run() { return { ok: false, mode: "write", text: "Este recurso só funciona no aplicativo Android." }; },
  device: {
    capability: "calendar", action: "calendar.create",
    prepare(_ctx, input) {
      const o = asObject(input, "entrada");
      const data = reqStr(o, "data", { max: 10 }), hora = reqStr(o, "hora", { max: 5 });
      if (!isDate(data)) throw bad("Data inválida.");
      if (!isTime(hora)) throw bad("Horário inválido (use HH:mm).");
      let dur = typeof o.duracao_min === "number" ? Math.round(o.duracao_min) : 60;
      const fim = str(o, "hora_fim", { optional: true, max: 5 });
      if (fim !== undefined) {
        if (!isTime(fim) || toMin(fim) <= toMin(hora)) throw bad("Horário final inválido.");
        dur = toMin(fim) - toMin(hora);
      }
      if (dur < 5 || dur > 1440) throw bad("Duração inválida.");
      return { titulo: reqStr(o, "titulo", { max: 140 }).trim(), data, hora, duracao_min: dur, local: (str(o, "local", { optional: true, max: 120 }) ?? "").trim(), notas: (str(o, "notas", { optional: true, max: 500 }) ?? "").trim(), ignorar_conflito: o.ignorar_conflito === true };
    },
    describe(ctx, p, r) {
      if (r.conflict) {
        const c = calEvents({ ok: true, events: r.conflicts });
        return { ok: false, mode: "write", text: `Conflito de horário: já existe${c.length > 1 ? "m" : ""} no calendário:\n${c.slice(0, 5).map(fmtEv).join("\n")}\nNada foi criado. Quer marcar mesmo assim?`, data: { conflito: true, conflitos: c.slice(0, 5) } };
      }
      if (!r.ok) return deviceFail(r, `Evento “${p.titulo}”`);
      return {
        ok: true, mode: "write",
        text: `${p.titulo} · ${p.hora}\n${humanDate(String(p.data), ctx.now.date)} (no calendário do celular)`,
        line: `📅 ${p.titulo} · ${humanDateInline(String(p.data), ctx.now.date)} ${p.hora}`,
        data: { id_evento: r.id ?? null, titulo: p.titulo, data: p.data, hora: p.hora },
      };
    },
  },
};

const atualizarEventoCalendario: Tool = {
  name: "atualizar_evento_calendario",
  description: "Altera título, data ou horário de um evento do calendário do CELULAR. Obtenha antes o id_evento com consultar_calendario.",
  input_schema: {
    type: "object",
    properties: { id_evento: { type: "string" }, titulo: { type: "string" }, data: { type: "string" }, hora: { type: "string" }, hora_fim: { type: "string" } },
    required: ["id_evento"],
  },
  async run() { return { ok: false, mode: "write", text: "Este recurso só funciona no aplicativo Android." }; },
  device: {
    capability: "calendar", action: "calendar.update",
    prepare(_ctx, input) {
      const o = asObject(input, "entrada");
      const id = reqStr(o, "id_evento", { max: 40 });
      if (!/^\d{1,18}$/.test(id)) throw bad("Identificador de evento inválido.");
      const out: Record<string, unknown> = { id_evento: id };
      const titulo = str(o, "titulo", { optional: true, max: 140 });
      const data = str(o, "data", { optional: true, max: 10 }), hora = str(o, "hora", { optional: true, max: 5 }), fim = str(o, "hora_fim", { optional: true, max: 5 });
      if (data !== undefined && !isDate(data)) throw bad("Data inválida.");
      if (hora !== undefined && !isTime(hora)) throw bad("Horário inválido.");
      if (fim !== undefined && !isTime(fim)) throw bad("Horário final inválido.");
      if (titulo === undefined && data === undefined && hora === undefined && fim === undefined) throw bad("Diga o que mudar.");
      Object.assign(out, titulo !== undefined && { titulo: titulo.trim() }, data !== undefined && { data }, hora !== undefined && { hora }, fim !== undefined && { hora_fim: fim });
      return out;
    },
    describe(_ctx, p, r) {
      if (!r.ok) return deviceFail(r, "Alteração do evento");
      return { ok: true, mode: "write", text: "Evento atualizado no calendário do celular.", line: "📅 Evento atualizado", data: { id_evento: p.id_evento } };
    },
  },
};

const excluirEventoCalendario: Tool = {
  name: "excluir_evento_calendario",
  description: "Exclui um evento do calendário do CELULAR. O app SEMPRE pede confirmação ao usuário na tela antes de apagar. Obtenha antes o id_evento com consultar_calendario.",
  input_schema: { type: "object", properties: { id_evento: { type: "string" }, titulo: { type: "string", description: "Título do evento (mostrado na confirmação)" } }, required: ["id_evento", "titulo"] },
  async run() { return { ok: false, mode: "write", text: "Este recurso só funciona no aplicativo Android." }; },
  device: {
    capability: "calendar", action: "calendar.delete",
    prepare(_ctx, input) {
      const o = asObject(input, "entrada");
      const id = reqStr(o, "id_evento", { max: 40 });
      if (!/^\d{1,18}$/.test(id)) throw bad("Identificador de evento inválido.");
      return { id_evento: id, titulo: reqStr(o, "titulo", { max: 140 }).trim() };
    },
    describe(_ctx, p, r) {
      if (!r.ok) return deviceFail(r, `Exclusão de “${p.titulo}”`);
      return { ok: true, mode: "write", text: `“${p.titulo}” foi excluído do calendário do celular.`, line: `🗑️ “${p.titulo}” excluído`, data: { id_evento: p.id_evento } };
    },
  },
};

export const TOOLS: Tool[] = [
  registrarGasto, registrarReceita, ajustarSaldo, consultarSaldo, consultarGastos, consultarReceitas, projetarSaldo,
  criarTarefa, concluirTarefa, criarLembrete, criarEvento, consultarAgenda, registrarHabito, consultarHabitos,
  consultarMercado,
  definirAlarme, consultarCalendario, criarEventoCalendario, atualizarEventoCalendario, excluirEventoCalendario,
];
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Ferramentas oferecidas nesta conversa: as do servidor + as do aparelho que o app declarou suportar. */
export function toolsFor(ctx: Ctx): Tool[] {
  return TOOLS.filter((t) => !t.device || ctx.capabilities.has(t.device.capability));
}

export function getTool(name: string): Tool | undefined {
  return BY_NAME.get(name);
}

export async function executeTool(ctx: Ctx, name: string, input: unknown): Promise<ToolResult> {
  const tool = BY_NAME.get(name);
  if (!tool) return { ok: false, mode: "read", text: `A função “${name}” não existe.` };
  if (tool.device) return { ok: false, mode: "write", text: "Esta ação precisa ser executada no aparelho." };
  try {
    return await tool.run(ctx, input);
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, mode: "write", text: e.message };
    console.error(`[tool:${name}]`, e);
    return { ok: false, mode: "write", text: "Algo deu errado ao executar essa ação." };
  }
}

