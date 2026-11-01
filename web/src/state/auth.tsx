import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import type { PlannedFeature, User } from "../lib/types";
import { setToken } from "../lib/config";

type Status = "loading" | "anon" | "authed";
interface AuthCtx {
  status: Status;
  user: User | null;
  ai: "cloud" | "local";
  market: boolean;
  planned: PlannedFeature[];
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  updateProfile(patch: { name?: string; timezone?: string }): Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

interface MeResponse { user: User; ai: { provider: "cloud" | "local"; market?: boolean }; planned: PlannedFeature[] }
interface SessionResponse { user?: User; token?: string }

const sessionNotStarted = () =>
  new ApiError(401, "Deu certo, mas o navegador não manteve o login. Verifique se os cookies estão liberados para este site e tente entrar.", "sessao");

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [ai, setAi] = useState<"cloud" | "local">("local");
  const [market, setMarket] = useState(false);
  const [planned, setPlanned] = useState<PlannedFeature[]>([]);

  /** Carrega a sessão atual. Devolve true se há usuário logado. */
  const loadMe = useCallback(async (): Promise<boolean> => {
    try {
      const me = await api<MeResponse>("GET", "/api/me");
      setUser(me.user); setAi(me.ai.provider); setMarket(!!me.ai.market); setPlanned(me.planned); setStatus("authed");
      return true;
    } catch {
      setUser(null); setStatus("anon");
      return false;
    }
  }, []);

  useEffect(() => { void loadMe(); }, [loadMe]);
  useEffect(() => {
    const on = () => { setToken(null); setUser(null); setStatus("anon"); };
    window.addEventListener("veyra:unauthorized", on);
    return () => window.removeEventListener("veyra:unauthorized", on);
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    status, user, ai, market, planned,
    async login(email, password) {
      const s = await api<SessionResponse>("POST", "/api/auth/login", { email, password });
      if (s?.token) setToken(s.token);
      if (!(await loadMe())) throw sessionNotStarted();
    },
    async register(name, email, password) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const s = await api<SessionResponse>("POST", "/api/auth/register", { name, email, password, timezone });
      if (s?.token) setToken(s.token);
      if (!(await loadMe())) throw sessionNotStarted();
    },
    async logout() {
      try { await api("POST", "/api/auth/logout", {}); } finally { setToken(null); setUser(null); setStatus("anon"); window.history.replaceState({}, "", "/"); }
    },
    async updateProfile(patch) {
      const r = await api<{ user: User }>("PATCH", "/api/me", patch);
      setUser(r.user);
    },
  }), [status, user, ai, market, planned, loadMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("AuthProvider ausente");
  return c;
}
