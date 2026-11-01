import { useState } from "react";
import { Button, Card, ErrorState, Field, Loading } from "../components/ui";
import { Icon } from "../components/Icon";
import { useAuth } from "../state/auth";
import { useApp } from "../state/app";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { errText } from "../lib/actions";
import type { Dashboard, Habit } from "../lib/types";
import { setVoiceReplies, voiceReplies } from "../lib/config";
import { speak, stopSpeaking, ttsAvailable } from "../lib/native";

const ZONES: [string, string][] = [
  ["America/Sao_Paulo", "Brasília (São Paulo, Rio, BH)"], ["America/Bahia", "Bahia"], ["America/Fortaleza", "Fortaleza"], ["America/Recife", "Recife"],
  ["America/Belem", "Belém"], ["America/Manaus", "Manaus"], ["America/Cuiaba", "Cuiabá"], ["America/Rio_Branco", "Rio Branco"], ["America/Noronha", "Fernando de Noronha"], ["Europe/Lisbon", "Lisboa"],
];

export function More() {
  const { user, ai, planned, logout, updateProfile } = useAuth();
  const { toast, bump, clearChat } = useApp();
  const habits = useApi<{ habits: Habit[] }>("/api/habits");
  const dash = useApi<Dashboard>("/api/dashboard");
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [busyDemo, setBusyDemo] = useState(false);
  const [voice, setVoice] = useState(voiceReplies());

  const saveName = async () => {
    setSaving(true);
    try { await updateProfile({ name }); toast("Nome atualizado."); } catch (e) { toast(errText(e), "error"); } finally { setSaving(false); }
  };
  const setTz = async (timezone: string) => {
    try { await updateProfile({ timezone }); bump(); toast("Fuso horário atualizado."); } catch (e) { toast(errText(e), "error"); }
  };
  const demo = async (on: boolean) => {
    setBusyDemo(true);
    try { await api(on ? "POST" : "DELETE", "/api/demo"); bump(); toast(on ? "Dados de demonstração carregados." : "Dados de demonstração removidos."); }
    catch (e) { toast(errText(e), "error"); } finally { setBusyDemo(false); }
  };
  const zones = ZONES.some(([z]) => z === user?.timezone) ? ZONES : [...ZONES, [user?.timezone ?? "", user?.timezone ?? ""] as [string, string]];

  return (
    <div className="page">
      <header className="page-head"><h1>Mais</h1></header>

      <Card aria-label="Conta">
        <h2 className="section-title">Conta</h2>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void saveName(); }}>
          <Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Button type="submit" busy={saving} disabled={!name.trim() || name.trim() === user?.name}>Salvar</Button>
        </form>
        <p className="muted small">{user?.email}</p>
        <div className="field">
          <label htmlFor="tz">Fuso horário</label>
          <select id="tz" value={user?.timezone} onChange={(e) => void setTz(e.target.value)}>
            {zones.map(([z, label]) => <option key={z} value={z}>{label}</option>)}
          </select>
          <p className="field-hint">Define o que é “hoje” e “amanhã” para a Veyra.</p>
        </div>
      </Card>

      <Card aria-label="Como a Veyra entende você">
        <h2 className="section-title">Como a Veyra entende você</h2>
        {ai === "cloud" ? (
          <p><span className="tag tag-ok">IA em nuvem ativa</span> Frases livres, várias ações por mensagem. Se a conexão falhar, o modo local assume.</p>
        ) : (
          <p><span className="tag">Modo local</span> Entendo os comandos mais comuns em português (gastos, receitas, lembretes, agenda, hábitos). Para frases livres, o administrador pode ativar a IA em nuvem no servidor.</p>
        )}
      </Card>

      <Card aria-label="Voz">
        <h2 className="section-title">Voz</h2>
        <label className="switch-row">
          <input type="checkbox" checked={voice} onChange={(e) => { setVoice(e.target.checked); setVoiceReplies(e.target.checked); if (!e.target.checked) void stopSpeaking(); else if (ttsAvailable()) void speak("Respostas faladas ativadas."); }} />
          <span>Ler as respostas em voz alta</span>
        </label>
        <p className="field-hint">{ttsAvailable() ? "Usa a voz do próprio aparelho (gratuita). Toque no microfone na conversa para falar com a Veyra." : "Este navegador não tem voz sintetizada."}</p>
      </Card>

      <Card aria-label="Hábitos">
        <h2 className="section-title">Hábitos</h2>
        {habits.loading && <Loading />}
        {habits.error && !habits.data && <ErrorState onRetry={habits.reload} />}
        {habits.data && habits.data.habits.length === 0 && <p className="muted">Nenhum hábito ainda. Diga “hoje eu treinei” ou “estudei hoje” e eu começo a acompanhar.</p>}
        {habits.data?.habits.map((h) => (
          <div key={h.id} className="habit">
            <div className="habit-top"><strong>{h.name}</strong><span className="muted"><Icon name="flame" size={14} className="flame" /> {h.currentStreak} {h.currentStreak === 1 ? "dia" : "dias"} · melhor {h.bestStreak}</span></div>
            <div className="week" role="img" aria-label={`Últimos 7 dias: ${h.last7.filter(Boolean).length} de 7`}>{h.last7.map((on, i) => <i key={i} className={on ? "on" : ""} />)}</div>
            <p className="muted small">{Math.round(h.frequency30 * 100)}% dos últimos 30 dias</p>
          </div>
        ))}
      </Card>

      <Card aria-label="Em breve">
        <h2 className="section-title">Ainda não disponível</h2>
        <p className="muted small">Planejado no roadmap, mas <strong>não funciona hoje</strong>. A Veyra avisa se você pedir.</p>
        <ul className="planned">
          {planned.map((p) => (
            <li key={p.id}>
              <span className="planned-title">{p.title}</span>
              <span className="tag">{p.phase}</span>
              <span className="muted small">Falta {p.needs}.</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-label="Dados">
        <h2 className="section-title">Dados</h2>
        {dash.data?.demoActive ? (
          <>
            <p className="para">Dados de demonstração estão ativos nesta conta. Remover não afeta o que você registrou.</p>
            <Button variant="danger" busy={busyDemo} onClick={() => void demo(false)}>Remover dados de demonstração</Button>
          </>
        ) : (
          <>
            <p className="para">Quer ver o app cheio? Carregue exemplos marcados como demonstração — dá para remover depois com um toque.</p>
            <Button busy={busyDemo} onClick={() => void demo(true)}>Carregar dados de demonstração</Button>
          </>
        )}
        <hr />
        <Button onClick={() => void clearChat()}>Apagar histórico da conversa</Button>
      </Card>

      <Button className="btn-block" onClick={() => void logout()}><Icon name="logout" size={18} /> Sair</Button>
      <p className="version">Veyra 0.1 · Fase 1</p>
    </div>
  );
}
