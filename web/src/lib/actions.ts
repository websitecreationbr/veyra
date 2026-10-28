import { api, ApiError } from "./api";
import type { AgendaItem } from "./types";

/** Conclui/reabre tarefa ou lembrete. Retorna true se deu certo. */
export async function toggleDone(item: AgendaItem): Promise<boolean> {
  const path = item.kind === "task" ? `/api/tasks/${item.id}/done` : `/api/reminders/${item.id}/done`;
  await api("POST", path, { done: !item.done });
  return true;
}

export const errText = (e: unknown, fallback = "Algo deu errado. Tente novamente.") => (e instanceof ApiError ? e.message : fallback);
