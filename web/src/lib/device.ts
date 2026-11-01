/**
 * Executa no aparelho as ações que o servidor pediu (lista fechada). Nunca executa nada fora dela,
 * nunca inventa resultado: se o recurso não existe ou o usuário cancela, devolve isso ao servidor.
 */
export interface DeviceCall { callId: string; action: string; params: Record<string, unknown> }
export interface DeviceApi {
  setAlarm(o: { hora: string; rotulo?: string; dias?: string[] }): Promise<Record<string, unknown>>;
  calendarQuery(o: { de: string; ate: string }): Promise<Record<string, unknown>>;
  calendarCreate(o: Record<string, unknown>): Promise<Record<string, unknown>>;
  calendarUpdate(o: Record<string, unknown>): Promise<Record<string, unknown>>;
  calendarDelete(o: { id_evento: string }): Promise<Record<string, unknown>>;
}
export type Result = { ok: boolean; [k: string]: unknown };

export async function runDeviceCalls(
  calls: DeviceCall[],
  api: DeviceApi | null,
  confirm: (message: string) => boolean | Promise<boolean>,
): Promise<{ callId: string; result: Result }[]> {
  const out: { callId: string; result: Result }[] = [];
  for (const c of calls.slice(0, 10)) {
    out.push({ callId: c.callId, result: await one(c, api, confirm) });
  }
  return out;
}

async function one(c: DeviceCall, api: DeviceApi | null, confirm: (m: string) => boolean | Promise<boolean>): Promise<Result> {
  if (!api) return { ok: false, error: "indisponivel" };
  const p = c.params ?? {};
  try {
    let r: Record<string, unknown>;
    switch (c.action) {
      case "alarm.set": r = await api.setAlarm({ hora: String(p.hora), rotulo: String(p.rotulo ?? ""), dias: (p.dias as string[]) ?? [] }); break;
      case "calendar.query": r = await api.calendarQuery({ de: String(p.de), ate: String(p.ate) }); break;
      case "calendar.create": r = await api.calendarCreate(p); break;
      case "calendar.update": r = await api.calendarUpdate(p); break;
      case "calendar.delete": {
        const ok = await confirm(`Excluir “${String(p.titulo ?? "este evento")}” do calendário do celular?`);
        if (!ok) return { ok: false, cancelled: true };
        r = await api.calendarDelete({ id_evento: String(p.id_evento) });
        break;
      }
      default: return { ok: false, error: "acao_desconhecida" };
    }
    return { ...r, ok: r.ok === true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 80) : "erro" };
  }
}
