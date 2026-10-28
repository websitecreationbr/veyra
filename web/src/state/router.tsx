import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode, type MouseEvent } from "react";

// Roteador mínimo (History API). O servidor devolve index.html para qualquer rota do app.
export const ROUTES = ["/", "/flow", "/financas", "/agenda", "/mais"] as const;
export type RoutePath = (typeof ROUTES)[number];

interface RouterCtx { path: RoutePath; navigate: (to: RoutePath) => void }
const Ctx = createContext<RouterCtx | null>(null);

const normalize = (p: string): RoutePath => ((ROUTES as readonly string[]).includes(p) ? (p as RoutePath) : "/");

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<RoutePath>(() => normalize(window.location.pathname));
  useEffect(() => {
    const on = () => setPath(normalize(window.location.pathname));
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const navigate = useCallback((to: RoutePath) => {
    if (to !== window.location.pathname) window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo({ top: 0 });
  }, []);
  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouter(): RouterCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("RouterProvider ausente");
  return c;
}

/** <a> de verdade (abre em nova aba, acessível) que navega sem recarregar. */
export function Link({ to, children, className, ...rest }: { to: RoutePath; children: ReactNode; className?: string; "aria-label"?: string; "aria-current"?: "page" | undefined }) {
  const { navigate } = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={onClick} className={className} {...rest}>{children}</a>;
}
