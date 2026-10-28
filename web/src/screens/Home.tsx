import { Card, EmptyState, ErrorState, Loading, Button } from "../components/ui";
import { Composer, SuggestionChips } from "../components/Composer";
import { AgendaRow } from "../components/Rows";
import { Icon } from "../components/Icon";
import { Link, useRouter } from "../state/router";
import { useAuth } from "../state/auth";
import { useApp } from "../state/app";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { errText, toggleDone } from "../lib/actions";
import { brl, brlShort, greeting } from "../lib/format";
import type { AgendaItem, Dashboard } from "../lib/types";

export function Home() {
  const { user } = useAuth();
  const { send, bump, toast } = useApp();
  const { navigate } = useRouter();
  const d = useApi<Dashboard>("/api/dashboard");
  const first = user?.name.split(" ")[0] ?? "";

  const ask = (text: string) => { navigate("/flow"); void send(text); };
  const toggle = async (i: AgendaItem) => { try { await toggleDone(i); bump(); } catch (e) { toast(errText(e), "error"); } };
  const removeDemo = async () => { try { await api("DELETE", "/api/demo"); bump(); toast("Dados de demonstração removidos."); } catch (e) { toast(errText(e), "error"); } };

  return (
    <div className="page home">
      <header className="home-head">
        <h1>{greeting()}, {first} <span aria-hidden="true">👋</span></h1>
        <p className="lead">Como posso ajudar?</p>
      </header>

      <Composer onSubmit={ask} />

      {d.loading && <Loading />}
      {d.error && !d.data && <ErrorState onRetry={d.reload} />}
      {d.data && <HomeBody d={d.data} onToggle={toggle} onAsk={ask} onRemoveDemo={removeDemo} />}
    </div>
  );
}

function HomeBody({ d, onToggle, onAsk, onRemoveDemo }: { d: Dashboard; onToggle: (i: AgendaItem) => void; onAsk: (t: string) => void; onRemoveDemo: () => void }) {
  const open = d.agendaToday.filter((i) => !i.done);
  const count = open.length;
  return (
    <>
      {d.demoActive && (
        <div className="notice" role="note">
          <Icon name="alert" size={18} />
          <span>Você está vendo <strong>dados de demonstração</strong>. Eles não são seus.</span>
          <Button size="sm" onClick={onRemoveDemo}>Remover</Button>
        </div>
      )}

      <Link to="/financas" className="card card-link balance" aria-label={`Seu saldo ${brl(d.balanceCents)}. Abrir finanças`}>
        <span className="label">Seu saldo</span>
        <span className={`balance-value ${d.balanceCents < 0 ? "neg" : ""}`}>{brl(d.balanceCents)}</span>
        {!d.hasTransactions && <span className="hint">Comece dizendo “meu saldo é 2.000” ou “recebi 1.500”.</span>}
      </Link>

      <div className="mini-grid">
        <Link to="/financas" className="card card-link mini">
          <span className="label">Este mês</span>
          <span className="mini-value">{brlShort(d.monthExpenseCents)}</span>
          <span className="mini-sub">gastos</span>
        </Link>
        <Link to="/agenda" className="card card-link mini">
          <span className="label">Hoje</span>
          <span className="mini-value">{count}</span>
          <span className="mini-sub">{count === 1 ? "compromisso" : "compromissos"}</span>
        </Link>
        <Link to="/mais" className="card card-link mini">
          <span className="label">{d.habit?.name ?? "Hábitos"}</span>
          {d.habit ? (
            <>
              <span className="mini-value"><Icon name="flame" size={16} className="flame" /> {d.habit.streak}</span>
              <span className="mini-sub">{d.habit.streak === 1 ? "dia seguido" : "dias seguidos"}</span>
            </>
          ) : (
            <>
              <span className="mini-value">—</span>
              <span className="mini-sub">diga “hoje eu treinei”</span>
            </>
          )}
        </Link>
      </div>

      {d.overdueCount > 0 && (
        <Link to="/agenda" className="notice notice-warn">
          <Icon name="alert" size={18} />
          <span>{d.overdueCount === 1 ? "1 tarefa atrasada" : `${d.overdueCount} tarefas atrasadas`}</span>
          <Icon name="chevronRight" size={16} />
        </Link>
      )}

      <Card aria-label="Hoje" className="today">
        <h2 className="section-title">Hoje</h2>
        {count === 0 ? (
          <EmptyState title="Nada marcado para hoje." text="Diga “marca dentista amanhã às 15” e eu coloco na agenda." />
        ) : (
          <div className="list">{open.map((i) => <AgendaRow key={i.key} item={i} today={d.today} onToggle={onToggle} />)}</div>
        )}
      </Card>

      {!d.hasTransactions && (
        <div className="try">
          <p className="label">Experimente falar</p>
          <SuggestionChips onPick={onAsk} />
        </div>
      )}
    </>
  );
}
