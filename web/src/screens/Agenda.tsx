import { useMemo, useState } from "react";
import { Button, Card, EmptyState, ErrorState, Loading } from "../components/ui";
import { AgendaRow } from "../components/Rows";
import { Icon } from "../components/Icon";
import { useApi } from "../lib/useApi";
import { errText, toggleDone } from "../lib/actions";
import { addDays, addMonths, cap, dayNum, dowOf, endOfMonth, humanDate, longDate, monthName, startOfMonth, startOfWeek } from "../lib/format";
import type { AgendaItem, AgendaResponse, Dashboard } from "../lib/types";
import { useApp } from "../state/app";
import { useRouter } from "../state/router";

type Mode = "hoje" | "semana" | "mes";
const MODES: { id: Mode; label: string }[] = [{ id: "hoje", label: "Hoje" }, { id: "semana", label: "Semana" }, { id: "mes", label: "Mês" }];
const DOW_HEAD = ["S", "T", "Q", "Q", "S", "S", "D"]; // segunda → domingo

export function Agenda() {
  const [mode, setMode] = useState<Mode>("hoje");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const { bump, toast } = useApp();
  const { navigate } = useRouter();

  const dash = useApi<Dashboard>("/api/dashboard");
  const today = dash.data?.today ?? null;
  const base = anchor ?? today;

  const range = useMemo(() => {
    if (!base || !today) return null;
    if (mode === "hoje") return { from: today, to: today };
    if (mode === "semana") { const f = startOfWeek(base); return { from: f, to: addDays(f, 6) }; }
    const f = startOfWeek(startOfMonth(base));
    return { from: f, to: addDays(f, 41) };
  }, [mode, base, today]);

  const ag = useApi<AgendaResponse>(range ? `/api/agenda?from=${range.from}&to=${range.to}` : null);

  const toggle = async (i: AgendaItem) => { try { await toggleDone(i); bump(); } catch (e) { toast(errText(e), "error"); } };
  const byDay = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const i of ag.data?.items ?? []) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return m;
  }, [ag.data]);

  const step = (dir: 1 | -1) => {
    if (!base) return;
    setPicked(null);
    setAnchor(mode === "semana" ? addDays(base, 7 * dir) : addMonths(base, dir));
  };

  const failed = (ag.error && !ag.data) || (dash.error && !dash.data);
  const A = ag.data;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Agenda</h1>
        <div className="segmented" role="tablist" aria-label="Visualização">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? "is-on" : ""} onClick={() => { setMode(m.id); setAnchor(null); setPicked(null); }}>{m.label}</button>
          ))}
        </div>
      </header>

      {failed && <ErrorState onRetry={() => { dash.reload(); ag.reload(); }} />}
      {!failed && (!A || !today) && <Loading />}

      {A && today && base && (
        <>
          {mode !== "hoje" && (
            <div className="range-nav">
              <button className="icon-btn" onClick={() => step(-1)} aria-label={mode === "semana" ? "Semana anterior" : "Mês anterior"}><Icon name="chevronLeft" /></button>
              <span className="range-label">{mode === "mes" ? `${cap(monthName(base))} de ${base.slice(0, 4)}` : `${humanDate(startOfWeek(base), today)} – ${humanDate(addDays(startOfWeek(base), 6), today)}`}</span>
              <button className="icon-btn" onClick={() => step(1)} aria-label={mode === "semana" ? "Próxima semana" : "Próximo mês"}><Icon name="chevronRight" /></button>
            </div>
          )}

          {mode === "hoje" && (
            <>
              {A.overdue.length > 0 && (
                <Card aria-label="Atrasadas" className="card-warn">
                  <h2 className="section-title warn">Atrasadas</h2>
                  <div className="list">{A.overdue.map((i) => <AgendaRow key={i.key} item={i} today={today} showDate onToggle={toggle} />)}</div>
                </Card>
              )}
              <Card aria-label="Hoje">
                <h2 className="section-title">{cap(longDate(today))}</h2>
                {(byDay.get(today) ?? []).length === 0
                  ? <EmptyState title="Nada marcado para hoje." text="Crie falando: “marca dentista quinta às 15” ou “me lembra de pagar a conta amanhã às 8”." action={<Button variant="primary" onClick={() => navigate("/flow")}>Falar com a Veyra</Button>} />
                  : <div className="list">{byDay.get(today)!.map((i) => <AgendaRow key={i.key} item={i} today={today} onToggle={toggle} />)}</div>}
              </Card>
              {A.undated.length > 0 && (
                <Card aria-label="Sem data">
                  <h2 className="section-title">Sem data</h2>
                  <div className="list">{A.undated.map((i) => <AgendaRow key={i.key} item={i} today={today} onToggle={toggle} />)}</div>
                </Card>
              )}
            </>
          )}

          {mode === "semana" && (
            <Card aria-label="Semana">
              {Array.from({ length: 7 }, (_, n) => addDays(startOfWeek(base), n)).map((d) => {
                const items = byDay.get(d) ?? [];
                return (
                  <div key={d} className={`day-group ${d === today ? "is-today" : ""}`}>
                    <h3 className="day-title">{humanDate(d, today)}{d === today ? "" : ""}</h3>
                    {items.length === 0 ? <p className="free">Livre</p> : <div className="list">{items.map((i) => <AgendaRow key={i.key} item={i} today={today} onToggle={toggle} />)}</div>}
                  </div>
                );
              })}
            </Card>
          )}

          {mode === "mes" && (
            <>
              <Card className="month" aria-label="Calendário">
                <div className="month-grid" role="grid" aria-label={`${monthName(base)} de ${base.slice(0, 4)}`}>
                  {DOW_HEAD.map((h, i) => <span key={i} className="month-dow" role="columnheader">{h}</span>)}
                  {Array.from({ length: 42 }, (_, n) => addDays(startOfWeek(startOfMonth(base)), n)).filter((d, n) => n < 35 || d <= endOfMonth(base)).map((d) => {
                    const inMonth = d.slice(0, 7) === base.slice(0, 7);
                    const n = (byDay.get(d) ?? []).length;
                    const sel = (picked ?? today) === d;
                    return (
                      <button key={d} role="gridcell" className={`cell ${inMonth ? "" : "out"} ${d === today ? "is-today" : ""} ${sel ? "is-sel" : ""}`} onClick={() => setPicked(d)} aria-label={`${longDate(d)}${n ? `, ${n} ${n === 1 ? "item" : "itens"}` : ""}`} aria-pressed={sel}>
                        <span>{dayNum(d)}</span>
                        <i className="dots" aria-hidden="true">{Array.from({ length: Math.min(n, 3) }, (_, k) => <b key={k} />)}</i>
                      </button>
                    );
                  })}
                </div>
              </Card>
              <Card aria-label="Dia selecionado">
                {(() => {
                  const d = picked ?? today;
                  const items = byDay.get(d) ?? [];
                  return (
                    <>
                      <h2 className="section-title">{cap(longDate(d))}</h2>
                      {items.length === 0 ? <p className="free">Livre</p> : <div className="list">{items.map((i) => <AgendaRow key={i.key} item={i} today={today} onToggle={toggle} />)}</div>}
                    </>
                  );
                })()}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
void dowOf;
