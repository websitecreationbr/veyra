import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret } from "./local.js";
import type { LocalNow } from "../util/time.js";

// Terça-feira, 27/10/2026, 13:52
const NOW: LocalNow = { date: "2026-10-27", time: "13:52", dow: 2 };
const plan = (t: string, pending?: Parameters<typeof interpret>[2]) => interpret(t, NOW, pending);
const call = (t: string, i = 0) => plan(t).calls[i];

test("gasto simples com categoria inferida", () => {
  const c = call("Gastei R$ 47 no mercado.");
  assert.equal(c?.name, "registrar_gasto");
  assert.equal(c?.input.valor_reais, 47);
  assert.equal(c?.input.categoria, "Mercado");
  assert.equal(c?.input.data, undefined); // hoje = padrão
});

test("gasto 'gastei 50 reais no almoço' vira Alimentação", () => {
  const c = call("Gastei 50 reais no almoço.");
  assert.equal(c?.input.valor_reais, 50);
  assert.equal(c?.input.categoria, "Alimentação");
  assert.equal(c?.input.descricao, "Almoço");
});

test("valor brasileiro com milhar e centavos", () => {
  assert.equal(call("paguei R$ 1.250,90 de aluguel")?.input.valor_reais, 1250.9);
  assert.equal(call("paguei R$ 1.250,90 de aluguel")?.input.categoria, "Moradia");
});

test("gasto sem contexto pergunta onde", () => {
  const p = plan("Gastei 30.");
  assert.equal(p.calls.length, 0);
  assert.match(p.ask!.question, /Onde você gastou R\$ 30\?/);
  assert.equal(p.ask!.pending.input.valor_reais, 30);
});

test("resposta à pergunta completa o gasto pendente", () => {
  const p1 = plan("Gastei 30.");
  const p2 = plan("na padaria", p1.ask!.pending);
  assert.equal(p2.calls[0]?.name, "registrar_gasto");
  assert.equal(p2.calls[0]?.input.valor_reais, 30);
  assert.equal(p2.calls[0]?.input.categoria, "Alimentação");
});

test("exemplo principal do produto: receita + despesa + lembrete em uma frase", () => {
  const p = plan("Recebi R$ 1.500 hoje, gastei R$ 80 no mercado e amanhã às 10 me lembra de ligar para o contador.");
  assert.deepEqual(p.calls.map((c) => c.name), ["registrar_receita", "registrar_gasto", "criar_lembrete"]);
  assert.equal(p.calls[0]!.input.valor_reais, 1500);
  assert.equal(p.calls[1]!.input.valor_reais, 80);
  assert.equal(p.calls[1]!.input.categoria, "Mercado");
  assert.equal(p.calls[2]!.input.titulo, "Ligar para o contador");
  assert.equal(p.calls[2]!.input.data, "2026-10-28");
  assert.equal(p.calls[2]!.input.hora, "10:00");
});

test("receita com categoria", () => {
  const c = call("Recebi 4500 de salário");
  assert.equal(c?.name, "registrar_receita");
  assert.equal(c?.input.valor_reais, 4500);
  assert.equal(c?.input.categoria, "Salário");
});

test("lembrete amanhã às 8", () => {
  const c = call("Me lembra amanhã às 8 de pagar a conta.");
  assert.equal(c?.name, "criar_lembrete");
  assert.equal(c?.input.titulo, "Pagar a conta");
  assert.equal(c?.input.data, "2026-10-28");
  assert.equal(c?.input.hora, "08:00");
});

test("lembrete recorrente todo dia às 7", () => {
  const c = call("Todo dia às 7 me lembra de beber água.");
  assert.equal(c?.input.titulo, "Beber água");
  assert.equal(c?.input.recorrencia, "daily");
  assert.equal(c?.input.hora, "07:00");
});

test("evento: marca dentista quinta às 15", () => {
  const c = call("Marca dentista quinta às 15.");
  assert.equal(c?.name, "criar_evento");
  assert.equal(c?.input.titulo, "Dentista");
  assert.equal(c?.input.data, "2026-10-29"); // próxima quinta
  assert.equal(c?.input.hora, "15:00");
});

test("recorrência semanal com dois dias", () => {
  const c = call("Me lembra toda segunda e quarta às 19h de estudar inglês");
  assert.equal(c?.input.recorrencia, "weekly:1,3");
  assert.equal(c?.input.hora, "19:00");
  assert.equal(c?.input.titulo, "Estudar inglês");
});

test("hábito: hoje eu treinei", () => {
  const c = call("Hoje eu treinei.");
  assert.equal(c?.name, "registrar_habito");
  assert.equal(c?.input.habito, "Treino");
});

test("tarefa", () => {
  const c = call("Cria tarefa: renovar o passaporte");
  assert.equal(c?.name, "criar_tarefa");
  assert.equal(c?.input.titulo, "Renovar o passaporte");
});

test("consultas financeiras", () => {
  assert.deepEqual(call("Quanto eu gastei esse mês?")?.input, { periodo: "mes", detalhe: "categorias" });
  assert.deepEqual(call("Quanto gastei com comida?")?.input, { periodo: "mes", categoria: "Alimentação", detalhe: "total" });
  assert.equal(call("Qual meu saldo?")?.name, "consultar_saldo");
  assert.equal(call("Onde estou gastando mais?")?.input.detalhe, "categorias");
  assert.equal(call("Qual foi meu maior gasto?")?.input.detalhe, "maior");
  assert.equal(call("Meu gasto aumentou em relação ao mês passado?")?.input.detalhe, "comparar");
  assert.equal(call("Quanto recebi esse mês?")?.name, "consultar_receitas");
  assert.equal(call("Se eu continuar nesse ritmo, quando meu dinheiro vai acabar?")?.name, "projetar_saldo");
  assert.equal(call("Quanto posso gastar por semana?")?.name, "projetar_saldo");
});

test("consulta de agenda", () => {
  assert.deepEqual(call("O que eu tenho amanhã?")?.input, { periodo: "amanha" });
  assert.deepEqual(call("O que tenho hoje?")?.input, { periodo: "hoje" });
});

test("mercado financeiro, alertas e treinos NÃO são simulados", () => {
  assert.deepEqual(plan("Como está o Ibovespa?").planned, ["mercado"]);
  assert.deepEqual(plan("Quanto está o dólar?").planned, ["mercado"]);
  assert.deepEqual(plan("PETR4 subiu hoje?").planned, ["mercado"]);
  assert.deepEqual(plan("Me avisa quando PETR4 cair mais de 5%.").planned, ["alertas"]);
  assert.deepEqual(plan("Estou evoluindo no supino?").planned, ["treinos"]);
  for (const t of ["Como está o Ibovespa?", "PETR4 subiu hoje?", "Estou evoluindo no supino?"]) assert.equal(plan(t).calls.length, 0);
});

test("treino detalhado marca o hábito e avisa que o detalhe ainda não existe", () => {
  const p = plan("Hoje fiz peito, supino com 30 kg de cada lado, 3 séries de 10.");
  assert.equal(p.calls[0]?.name, "registrar_habito");
  assert.equal(p.calls[0]?.input.habito, "Treino");
  assert.deepEqual(p.planned, ["treinos"]);
});

test("saldo informado", () => {
  const c = call("Meu saldo é 2.840");
  assert.equal(c?.name, "ajustar_saldo");
  assert.equal(c?.input.saldo_reais, 2840);
});

test("horários e dias não viram valores em dinheiro", () => {
  const c = call("gastei 25 no almoço hoje às 12");
  assert.equal(c?.input.valor_reais, 25);
  const e = call("marca reunião dia 30 às 14h");
  assert.equal(e?.name, "criar_evento");
  assert.equal(e?.input.data, "2026-10-30");
  assert.equal(e?.input.hora, "14:00");
});

test("texto não reconhecido não executa nada e orienta", () => {
  const p = plan("blablabla");
  assert.equal(p.calls.length, 0);
  assert.ok(p.reply);
});

test("vários itens na mesma frase, cada um com seu valor", () => {
  const p = plan("tô sem grana, gastei 8 com lanche e 20 de gasolina");
  assert.deepEqual(p.calls.map((c) => [c.input.valor_reais, c.input.categoria]), [[8, "Alimentação"], [20, "Transporte"]]);
  const q = plan("Recebi 100 e gastei 40 em pizza");
  assert.deepEqual(q.calls.map((c) => c.name), ["registrar_receita", "registrar_gasto"]);
});

test("horário com período do dia e lista de dias da semana", () => {
  const c = call("Me lembra de tomar remédio todo dia às 8 da noite");
  assert.equal(c?.input.hora, "20:00");
  assert.equal(c?.input.titulo, "Tomar remédio");
  const e = call("Marca academia segunda, quarta e sexta às 6");
  assert.equal(e?.input.recorrencia, "weekly:1,3,5");
  assert.equal(e?.input.titulo, "Academia");
  assert.equal(e?.input.hora, "06:00");
});

test("concluir tarefa extrai só o título; categoria pelo próprio nome; conversa social", () => {
  assert.deepEqual(call("Concluí a tarefa estudar inglês")?.input, { titulo: "estudar inglês" });
  assert.deepEqual(call("Quanto gastei com transporte esse mês?")?.input, { periodo: "mes", categoria: "Transporte", detalhe: "total" });
  assert.match(plan("oi").reply!, /Como posso ajudar/);
  assert.match(plan("obrigado").reply!, /Por nada/);
});
