import { useState, type FormEvent } from "react";
import { Logo } from "../components/Icon";
import { Button, Field } from "../components/ui";
import { useAuth } from "../state/auth";
import { errText } from "../lib/actions";

export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "register" && password.length < 8) { setError("A senha precisa ter pelo menos 8 caracteres."); return; }
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(name, email, password);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand"><Logo size={40} /><span>Veyra</span></div>
        <h1>Seu dia. Suas finanças. Sua rotina. Em uma conversa.</h1>
        <p className="auth-sub">Você fala. A Veyra entende. A Veyra faz.</p>

        <div className="segmented" role="tablist" aria-label="Entrar ou criar conta">
          <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-on" : ""} onClick={() => { setMode("login"); setError(""); }}>Entrar</button>
          <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "is-on" : ""} onClick={() => { setMode("register"); setError(""); }}>Criar conta</button>
        </div>

        <form onSubmit={submit} noValidate>
          {mode === "register" && <Field label="Seu nome" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required maxLength={60} />}
          <Field label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required />
          <Field label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required hint={mode === "register" ? "Mínimo de 8 caracteres." : undefined} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button variant="primary" type="submit" busy={busy} className="btn-block">{mode === "login" ? "Entrar" : "Criar conta"}</Button>
        </form>
      </div>
    </main>
  );
}
