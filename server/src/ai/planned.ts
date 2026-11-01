import type { PlannedFeature } from "./types.js";

// Nada aqui "finge" funcionar. Quando o usuário pede algo desta lista, a Veyra diz claramente que ainda não existe.
// Para ativar uma função: implemente o serviço, crie a ferramenta em tools.ts e remova a entrada daqui.

export const PLANNED: Record<string, PlannedFeature> = {
  mercado_outros: {
    id: "mercado_outros",
    title: "Cotações de outros ativos (ações, euro, bitcoin, Selic) — hoje só dólar e Ibovespa",
    phase: "Fase 5",
    needs: "ampliar o serviço de cotações para esses ativos",
  },
  alertas: {
    id: "alertas",
    title: "Alertas de mercado",
    phase: "Fase 5",
    needs: "um serviço de monitoramento em segundo plano com notificações",
  },
  treinos: {
    id: "treinos",
    title: "Registro e evolução de treinos",
    phase: "Fase 4",
    needs: "as ferramentas de treino (a estrutura do banco já está pronta)",
  },
  whatsapp: {
    id: "whatsapp",
    title: "Conversa pelo WhatsApp",
    phase: "Fase 6",
    needs: "uma conta na WhatsApp Business Cloud API e um webhook público",
  },
  notificacoes: {
    id: "notificacoes",
    title: "Notificações push e lembretes que tocam no horário",
    phase: "Fase 6",
    needs: "PWA com Web Push (chaves VAPID) e um agendador no servidor",
  },
  calendario: {
    id: "calendario",
    title: "Conexão direta com a conta do Google Calendar (o calendário DO CELULAR já funciona no app Android)",
    phase: "Fase 6",
    needs: "OAuth com Google Calendar",
  },
  resumos: {
    id: "resumos",
    title: "Resumos automáticos da manhã e da noite",
    phase: "Fase 6",
    needs: "o agendador de notificações (por enquanto, peça “como está meu dia?” e eu respondo na hora)",
  },
};

export function plannedReply(id: keyof typeof PLANNED | string): string {
  const f = PLANNED[id];
  if (!f) return "Ainda não consigo fazer isso.";
  return `${f.title} ainda não está disponível — está planejado para a ${f.phase}. Para ativar, falta ${f.needs}.`;
}
