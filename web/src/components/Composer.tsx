import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { useApp } from "../state/app";

/**
 * Campo "Fale com a Veyra...". Texto funciona; voz ainda NÃO existe (Fase 6) —
 * o botão do microfone diz isso com clareza em vez de fingir que grava.
 */
export function Composer({ onSubmit, autoFocus, disabled }: { onSubmit: (text: string) => void; autoFocus?: boolean; disabled?: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const { toast } = useApp();

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
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <textarea ref={ref} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="Fale com a Veyra..." aria-label="Mensagem para a Veyra" maxLength={2000} enterKeyHint="send" />
      <button type="button" className="composer-mic" aria-label="Falar por voz (indisponível)" onClick={() => toast("Comandos por voz ainda não estão disponíveis — chegam na Fase 6.", "info")}>
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
