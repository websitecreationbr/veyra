import type { AgendaItem, Transaction } from "../lib/types";
import { describeRecurrence, humanDate, signed } from "../lib/format";
import { Icon } from "./Icon";

export function TransactionRow({ tx, onOpen }: { tx: Transaction; onOpen?: (t: Transaction) => void }) {
  const title = tx.description || tx.category?.name || (tx.kind === "income" ? "Receita" : "Despesa");
  const sub = tx.description && tx.category && tx.category.name.toLowerCase() !== tx.description.toLowerCase() ? tx.category.name : tx.kind === "income" ? "Entrada" : "";
  return (
    <button className="row" onClick={() => onOpen?.(tx)} aria-label={`${title}, ${signed(tx.amountCents, tx.kind)}`}>
      <span className="row-icon" aria-hidden="true">{tx.category?.icon ?? "•"}</span>
      <span className="row-main">
        <span className="row-title">{title}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      <span className={`amount ${tx.kind === "income" ? "pos" : "neg"}`}>{signed(tx.amountCents, tx.kind)}</span>
    </button>
  );
}

const KIND_ICON = { event: "calendar", reminder: "bell", task: "circle" } as const;

export function AgendaRow({ item, today, showDate, onToggle }: { item: AgendaItem; today: string; showDate?: boolean; onToggle?: (i: AgendaItem) => void }) {
  const toggleable = (item.kind === "task" || (item.kind === "reminder" && !item.recurrence)) && !!onToggle;
  return (
    <div className={`agenda-row ${item.done ? "is-done" : ""}`}>
      {toggleable ? (
        <button className={`check ${item.done ? "is-on" : ""}`} role="checkbox" aria-checked={item.done} aria-label={`Concluir ${item.title}`} onClick={() => onToggle!(item)}>
          {item.done && <Icon name="check" size={14} />}
        </button>
      ) : (
        <span className="agenda-kind" aria-hidden="true"><Icon name={KIND_ICON[item.kind]} size={16} /></span>
      )}
      <span className="agenda-time">{item.time ?? (item.kind === "task" ? "" : "dia todo")}</span>
      <span className="row-main">
        <span className="row-title">{item.title}</span>
        <span className="row-sub">
          {showDate && item.date ? `${humanDate(item.date, today)}` : ""}
          {showDate && item.date && (item.recurrence || item.location) ? " · " : ""}
          {item.recurrence ? <><Icon name="repeat" size={12} /> {describeRecurrence(item.recurrence)}</> : null}
          {item.recurrence && item.location ? " · " : ""}
          {item.location}
        </span>
      </span>
      {item.priority === "alta" && <span className="tag tag-alert">Alta</span>}
    </div>
  );
}
