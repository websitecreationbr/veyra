import { useMemo, useState } from "react";
import { Button, Card, EmptyState, ErrorState, Loading, Sheet } from "../components/ui";
import { TransactionRow } from "../components/Rows";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { errText } from "../lib/actions";
import { brl, brlShort, humanDate, signed } from "../lib/format";
import type { FinanceSummary, Transaction, TransactionsPage } from "../lib/types";
import { useApp } from "../state/app";
import { useRouter } from "../state/router";

const PERIODS = [
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mês" },
  { id: "ano", label: "Ano" },
] as const;

export function Finance() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("mes");
  const [limit, setLimit] = useState(30);
  const [open, setOpen] = useState<Transaction | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { bump, toast } = useApp();
  const { navigate } = useRouter();

  const sum = useApi<FinanceSummary>(`/api/finance/summary?period=${period}`);
  const txs = useApi<TransactionsPage>(`/api/finance/transactions?period=${period}&limit=${limit}`);

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of txs.data?.items ?? []) m.set(t.date, [...(m.get(t.date) ?? []), t]);
    return [...m.entries()];
  }, [txs.data]);

  const remove = async () => {
    if (!open) return;
    try {
      await api("DELETE", `/api/records/transaction/${open.id}`);
      toast("Transação removida.");
      setOpen(null); setConfirm(false); bump();
    } catch (e) { toast(errText(e), "error"); }
  };

  const s = sum.data;
  return (
    <div className="page">
      <header className="page-head">
        <h1>Finanças</h1>
        <div className="segmented" role="tablist" aria-label="Período">
          {PERIODS.map((p) => (
            <button key={p.id} role="tab" aria-selected={period === p.id} className={period === p.id ? "is-on" : ""} onClick={() => { setPeriod(p.id); setLimit(30); }}>{p.label}</button>
          ))}
        </div>
      </header>

      {sum.loading && <Loading />}
      {sum.error && !s && <ErrorState onRetry={sum.reload} />}

      {s && (
        <>
          <Card className="balance">
            <span className="label">Saldo atual</span>
            <span className={`balance-value ${s.balanceCents < 0 ? "neg" : ""}`}>{brl(s.balanceCents)}</span>
            <dl className="stats">
              <div><dt>Entradas</dt><dd className="pos">{brlShort(s.incomeCents)}</dd></div>
              <div><dt>Saídas</dt><dd className="neg">{brlShort(s.expenseCents)}</dd></div>
              <div><dt>Resultado</dt><dd className={s.resultCents < 0 ? "neg" : "pos"}>{s.resultCents < 0 ? "−" : "+"} {brlShort(Math.abs(s.resultCents))}</dd></div>
            </dl>
          </Card>

          {s.byCategory.length > 0 && (
            <Card aria-label="Para onde foi">
              <h2 className="section-title">Para onde foi</h2>
              <ul className="bars">
                {s.byCategory.slice(0, 5).map((c) => (
                  <li key={c.name}>
                    <div className="bar-top"><span>{c.icon} {c.name}</span><span>{brlShort(c.totalCents)}</span></div>
                    <div className="bar" role="img" aria-label={`${Math.round(c.share * 100)}% dos gastos`}><i style={{ width: `${Math.max(3, Math.round(c.share * 100))}%` }} /></div>
                  </li>
                ))}
              </ul>
              {s.compare && s.compare.changePct !== null && (
                <p className="compare">
                  {Math.abs(Math.round(s.compare.changePct)) === 0 ? "Gastos praticamente iguais ao mesmo período do mês passado." : `${Math.abs(Math.round(s.compare.changePct))}% ${s.compare.changePct > 0 ? "a mais" : "a menos"} que no mesmo período do mês passado.`}
                </p>
              )}
            </Card>
          )}

          <Card aria-label="Projeção">
            <h2 className="section-title">Quanto tempo o saldo dura</h2>
            {s.projection.enough && s.projection.monthlySpendCents ? (
              <>
                <p className="para">
                  {s.projection.balanceCents <= 0
                    ? "Seu saldo já está zerado ou negativo."
                    : s.projection.monthsLeft! < 1
                      ? <>No ritmo atual (≈ {brlShort(s.projection.monthlySpendCents)}/mês), cerca de <strong>{Math.max(1, Math.round(s.projection.monthsLeft! * 30))} dias</strong>.</>
                      : <>No ritmo atual (≈ {brlShort(s.projection.monthlySpendCents)}/mês), cerca de <strong>{(Math.round(s.projection.monthsLeft! * 2) / 2).toString().replace(".", ",")} meses</strong>.</>}
                </p>
                <p className="muted small">Estimativa com base nos seus últimos {s.projection.basisDays} dias — não é uma garantia.</p>
              </>
            ) : (
              <p className="muted">Registre despesas por pelo menos 7 dias e eu estimo quanto tempo seu saldo dura.</p>
            )}
          </Card>
        </>
      )}

      <Card aria-label="Histórico" className="history">
        <h2 className="section-title">Histórico</h2>
        {txs.loading && <Loading />}
        {txs.error && !txs.data && <ErrorState onRetry={txs.reload} />}
        {txs.data && groups.length === 0 && (
          <EmptyState title="Você ainda não possui transações." text="Registre falando: “gastei 30 no almoço” ou “recebi 1.500”."
            action={<Button variant="primary" onClick={() => navigate("/flow")}>Falar com a Veyra</Button>} />
        )}
        {groups.map(([date, items]) => (
          <div key={date} className="day-group">
            <h3 className="day-title">{humanDate(date, txs.data!.today)}</h3>
            {items.map((t) => <TransactionRow key={t.id} tx={t} onOpen={(x) => { setOpen(x); setConfirm(false); }} />)}
          </div>
        ))}
        {txs.data?.hasMore && <Button className="btn-block" onClick={() => setLimit((l) => l + 30)}>Ver mais</Button>}
      </Card>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.description || open?.category?.name || "Transação"}>
        {open && (
          <>
            <p className={`sheet-amount ${open.kind === "income" ? "pos" : "neg"}`}>{signed(open.amountCents, open.kind)}</p>
            <dl className="detail">
              <div><dt>Categoria</dt><dd>{open.category ? `${open.category.icon} ${open.category.name}` : "Sem categoria"}</dd></div>
              <div><dt>Data</dt><dd>{humanDate(open.date, txs.data?.today ?? open.date)}</dd></div>
              {open.source === "demo" && <div><dt>Origem</dt><dd>Dado de demonstração</dd></div>}
            </dl>
            <div className="sheet-actions">
              {!confirm ? (
                <Button variant="danger" onClick={() => setConfirm(true)}>Remover</Button>
              ) : (
                <>
                  <Button variant="danger" onClick={() => void remove()}>Confirmar remoção</Button>
                  <Button onClick={() => setConfirm(false)}>Cancelar</Button>
                </>
              )}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
