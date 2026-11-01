import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { useApp } from "../state/app";
import { cancelListen, listen, speechAvailable } from "../lib/native";

/**
 * Campo "Fale com a Veyra...". Texto e voz. A voz usa o reconhecimento do Android (app) ou do navegador:
 * pede permissão, mostra que está ouvindo, mostra erros em português e pode ser cancelada.
 * O que foi ouvido é ENVIADO como mensagem normal (mesmo caminho do texto: IA → ferramentas → ações).
 */
export function Composer({ onSubmit, autoFocus, disabled }: { onSubmit: (text: string) => void; autoFocus?: boolean; disabled?: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const { toast } = useApp();
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || disabled) return;
    onSubmit(t);
    setText("");
  };
  const mic = async () => {
    if (listening) { await cancelListen(); return; }
    if (disabled || thinking) return;
    if (!speechAvailable()) { toast("Este navegador não tem reconhecimento de voz. Use o app Android ou o Chrome, ou digite.", "info"); return; }
    setListening(true);
    const r = await listen("pt-BR");
    setListening(false);
    if (r.ok) {
      setThinking(true);
      onSubmit(r.text);
      setTimeout(() => setThinking(false), 600);
    } else if (!r.cancelled) toast(r.error, "error");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <textarea ref={ref} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="Fale com a Veyra..." aria-label="Mensagem para a Veyra" maxLength={2000} enterKeyHint="send" />
      {listening && <span className="composer-listening" role="status">Ouvindo… toque para cancelar</span>}
      <button type="button" className={`composer-mic${listening ? " is-listening" : ""}`} aria-label={listening ? "Cancelar gravação" : "Falar por voz"} aria-pressed={listening} onClick={() => void mic()}>
        <Icon name="mic" />
      </button>
      <button type="submit" className="composer-send" disabled={!text.trim() || disabled} aria-label="Enviar">
        <Icon name="send" size={18} />
      </button>
    </form>
  );
}

export const SUGGESTIONS = [
  "Gastei 47 no mercado",
  "Recebi 1.500 de salário",
  "Amanhã às 8 me lembra de pagar a conta",
  "Marca dentista quinta às 15",
  "Hoje eu treinei",
  "Quanto gastei esse mês?",
];

export function SuggestionChips({ onPick, items = SUGGESTIONS.slice(0, 4) }: { onPick: (t: string) => void; items?: string[] }) {
  return (
    <div className="chips" role="list" aria-label="Sugestões">
      {items.map((s) => (
        <button key={s} role="listitem" className="chip" onClick={() => onPick(s)}>{s}</button>
      ))}
    </div>
  );
}
