import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";
import { useApp } from "../state/app";

// ---- Card ----
export function Card({ children, className = "", as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article"; "aria-label"?: string }) {
  return <Tag className={`card ${className}`} {...rest}>{children}</Tag>;
}

// ---- Button ----
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger"; size?: "md" | "sm"; busy?: boolean };
export function Button({ variant = "quiet", size = "md", busy, className = "", children, disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Spinner small /> : null}
      {children}
    </button>
  );
}

// ---- Input ----
export function Field({ label, hint, error, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={!!error || undefined} aria-describedby={hint || error ? `${id}-d` : undefined} {...rest} />
      {(hint || error) && <p id={`${id}-d`} className={error ? "field-error" : "field-hint"}>{error ?? hint}</p>}
    </div>
  );
}

// ---- Estados ----
export function Spinner({ small }: { small?: boolean }) {
  return <span className={`spinner ${small ? "spinner-sm" : ""}`} role="status" aria-label="Carregando" />;
}
export function Loading({ text = "Carregando seus dados..." }: { text?: string }) {
  return <div className="state" role="status"><Spinner /><p>{text}</p></div>;
}
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {text && <p className="state-text">{text}</p>}
      {action}
    </div>
  );
}
export function ErrorState({ text = "Não conseguimos carregar seus dados. Tente novamente.", onRetry }: { text?: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <Icon name="alert" />
      <p className="state-text">{text}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>Tentar de novo</Button>}
    </div>
  );
}
export function Skeleton({ h = 20, w = "100%" }: { h?: number; w?: string }) {
  return <span className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

// ---- Folha (modal inferior no celular, central no desktop) ----
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <div className="sheet-grip" aria-hidden="true" />
        <h2 id={titleId} className="sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ---- Avisos ----
export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismissToast(t.id)}>
          {t.tone === "ok" && <Icon name="check" size={16} />}
          {t.tone === "error" && <Icon name="alert" size={16} />}
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}
