import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { useApp } from "../state/app";

export interface Resource<T> { data: T | null; error: string | null; loading: boolean; reload(): void }

/**
 * Carrega um GET e recarrega sozinho quando os dados mudam (version do AppProvider).
 * Mantém o dado anterior na tela durante o recarregamento — sem piscar.
 */
export function useApi<T>(path: string | null): Resource<T> {
  const { version } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setError(null);
    api<T>("GET", path)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e instanceof ApiError ? e.message : "Erro inesperado."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [path, version, tick]);

  const reload = useCallback(() => { setLoading(true); setTick((t) => t + 1); }, []);
  return { data, error, loading: loading && data === null, reload };
}
