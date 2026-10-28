// Tipos espelham as respostas da API (server/src). Valores de dinheiro sempre em centavos.

export interface User { id: string; name: string; email: string; timezone: string }
export interface PlannedFeature { id: string; title: string; phase: string; needs: string }

export interface RecordRef { kind: "transaction" | "task" | "reminder" | "event"; id: string }
export interface ActionChip { tool: string; ok: boolean; line: string; record?: RecordRef }
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions: ActionChip[];
  createdAt: string;
  awaitingAnswer?: boolean;
  failed?: boolean;
}

export interface AgendaItem {
  key: string; id: string; kind: "event" | "reminder" | "task";
  title: string; date: string; time: string | null; endTime?: string | null; location?: string;
  recurrence: string | null; priority: "baixa" | "normal" | "alta"; done: boolean; source: "user" | "demo";
}

export interface Dashboard {
  today: string;
  balanceCents: number;
  monthExpenseCents: number;
  monthIncomeCents: number;
  hasTransactions: boolean;
  agendaToday: AgendaItem[];
  overdueCount: number;
  habit: { id: string; name: string; streak: number; doneToday: boolean } | null;
  demoActive: boolean;
}

export interface Transaction {
  id: string; kind: "expense" | "income"; amountCents: number; description: string; date: string;
  category: { id: string; name: string; icon: string } | null; source: "user" | "demo";
}
export interface CategoryTotal { name: string; icon: string; totalCents: number; share: number }
export interface FinanceSummary {
  period: string;
  range: { from: string; to: string; label: string };
  balanceCents: number; incomeCents: number; expenseCents: number; resultCents: number;
  byCategory: CategoryTotal[];
  compare: { currentCents: number; previousCents: number; changePct: number | null } | null;
  projection: { enough: boolean; balanceCents: number; monthlySpendCents?: number; monthsLeft?: number; weeklyBudgetCents?: number; basisDays?: number };
}
export interface TransactionsPage { items: Transaction[]; hasMore: boolean; today: string }
export interface AgendaResponse { items: AgendaItem[]; undated: AgendaItem[]; overdue: AgendaItem[]; today: string }
export interface Habit {
  id: string; name: string; icon: string; currentStreak: number; bestStreak: number; doneToday: boolean;
  last7: boolean[]; frequency30: number; totalDays: number;
}
