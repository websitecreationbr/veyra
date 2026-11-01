// Testes da lógica do app (sem navegador): execução de ações do aparelho, endereço do servidor, textos de erro de voz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDeviceCalls, type DeviceApi } from "./device.js";
import { normalizeServerUrl } from "./config.js";
import { friendlySpeechError, speakable } from "./native.js";

const fake = (log: string[], over: Partial<DeviceApi> = {}): DeviceApi => ({
  setAlarm: async (o) => (log.push(`alarm ${o.hora}`), { ok: true }),
  calendarQuery: async (o) => (log.push(`q ${o.de}..${o.ate}`), { ok: true, events: [{ id: "1", title: "Dentista" }] }),
  calendarCreate: async () => ({ ok: false, conflict: true, conflicts: [{ id: "9", title: "X" }] }),
  calendarUpdate: async () => ({ ok: true }),
  calendarDelete: async (o) => (log.push(`del ${o.id_evento}`), { ok: true }),
  ...over,
});

test("ações do aparelho: executa cada pedido e devolve o resultado real", async () => {
  const log: string[] = [];
  const r = await runDeviceCalls([
    { callId: "a", action: "alarm.set", params: { hora: "16:00", dias: [] } },
    { callId: "b", action: "calendar.query", params: { de: "2026-10-30", ate: "2026-10-30" } },
    { callId: "c", action: "calendar.create", params: { titulo: "x" } },
  ], fake(log), () => true);
  assert.deepEqual(log, ["alarm 16:00", "q 2026-10-30..2026-10-30"]);
  assert.equal(r[0]!.result.ok, true);
  assert.equal((r[1]!.result.events as unknown[]).length, 1);
  assert.equal(r[2]!.result.ok, false);
  assert.equal(r[2]!.result.conflict, true);
});

test("excluir pede confirmação; se o usuário recusar, NADA é apagado", async () => {
  const log: string[] = [];
  const msgs: string[] = [];
  const no = await runDeviceCalls([{ callId: "d", action: "calendar.delete", params: { id_evento: "5", titulo: "Dentista" } }], fake(log), (m) => (msgs.push(m), false));
  assert.deepEqual(no[0]!.result, { ok: false, cancelled: true });
  assert.deepEqual(log, []);
  assert.match(msgs[0]!, /Excluir “Dentista”/);
  const yes = await runDeviceCalls([{ callId: "d", action: "calendar.delete", params: { id_evento: "5", titulo: "Dentista" } }], fake(log), () => true);
  assert.equal(yes[0]!.result.ok, true);
  assert.deepEqual(log, ["del 5"]);
});

test("sem plugin nativo, ação desconhecida ou erro do plugin viram falha honesta (nunca sucesso falso)", async () => {
  assert.deepEqual((await runDeviceCalls([{ callId: "a", action: "alarm.set", params: { hora: "07:00" } }], null, () => true))[0]!.result, { ok: false, error: "indisponivel" });
  const log: string[] = [];
  assert.equal((await runDeviceCalls([{ callId: "a", action: "formatar.celular", params: {} }], fake(log), () => true))[0]!.result.error, "acao_desconhecida");
  const boom = fake(log, { setAlarm: async () => { throw new Error("falhou feio"); } });
  const r = (await runDeviceCalls([{ callId: "a", action: "alarm.set", params: { hora: "07:00" } }], boom, () => true))[0]!.result;
  assert.equal(r.ok, false);
  assert.match(String(r.error), /falhou/);
  // resultado sem ok=true explícito não conta como sucesso
  const sloppy = fake(log, { setAlarm: async () => ({}) });
  assert.equal((await runDeviceCalls([{ callId: "a", action: "alarm.set", params: { hora: "07:00" } }], sloppy, () => true))[0]!.result.ok, false);
});

test("endereço do servidor: exige https (http só em rede local), remove barras", () => {
  assert.equal(normalizeServerUrl("veyra.vercel.app/"), "https://veyra.vercel.app");
  assert.equal(normalizeServerUrl(" https://veyra.vercel.app// "), "https://veyra.vercel.app");
  assert.equal(normalizeServerUrl("http://192.168.0.10:3000"), "http://192.168.0.10:3000");
  assert.equal(normalizeServerUrl("http://exemplo.com"), null);
  assert.equal(normalizeServerUrl(""), null);
  assert.equal(normalizeServerUrl("https://"), null);
});

test("voz: erros em português e texto falado limpo", () => {
  assert.match(friendlySpeechError("permissao_negada"), /Permissões/);
  assert.match(friendlySpeechError("sem_fala"), /Não ouvi nada/);
  assert.match(friendlySpeechError("rede"), /internet/);
  assert.match(friendlySpeechError("???"), /falhou/);
  assert.equal(speakable("**Dólar** hoje 💵\nR$ 5,43"), "Dólar hoje . R$ 5,43".replace(" .", "."));
});
