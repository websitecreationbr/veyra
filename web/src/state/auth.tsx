import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { PlannedFeature, User } from "../lib/types";

type Status = "loading" | "anon" | "authed";
interface AuthCtx {
  status: Status;
  user: User | null;
  ai: "claude" | "local";
  planned: PlannedFeature[];
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  updateProfile(patch: { name?: string; timezone?: string }): Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

interface MeResponse { user: User; ai: { provider: "claude" | "local" }; planned: PlannedFeature[] }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [ai, setAi] = useState<"claude" | "local">("local");
  const [planned, setPlanned] = useState<PlannedFeature[]>([]);

  const loadMe = useCallback(async () => {
    try {
      const me = await api<MeResponse>("GET", "/api/me");
      setUser(me.user); setAi(me.ai.provider); setPlanned(me.planned); setStatus("authed");
    } catch {
      setUser(null); setStatus("anon");
    }
  }, []);

  useEffect(() => { void loadMe(); }, [loadMe]);
  useEffect(() => {
    const on = () => { setUser(null); setStatus("anon"); };
    window.addEventListener("veyra:unauthorized", on);
    return () => window.removeEventListener("veyra:unauthorized", on);
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    status, user, ai, planned,
    async login(email, password) {
      await api("POST", "/api/auth/login", { email, password });
      await loadMe();
    },
    async register(name, email, password) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api("POST", "/api/auth/register", { name, email, password, timezone });
      await loadMe();
    },
    async logout() {
      try { await api("POST", "/api/auth/logout", {}); } finally { setUser(null); setStatus("anon"); window.history.replaceState({}, "", "/"); }
    },
    async updateProfile(patch) {
      const r = await api<{ user: User }>("PATCH", "/api/me", patch);
      setUser(r.user);
    },
  }), [status, user, ai, planned, loadMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("AuthProvider ausente");
  return c;
}
