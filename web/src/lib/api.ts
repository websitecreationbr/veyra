export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "erro") {
    super(message);
  }
}

/** Todas as chamadas passam por aqui: cookie de sessão (HttpOnly) + cabeçalho anti-CSRF. Nenhuma chave de API existe no front. */
export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "x-requested-with": "veyra", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Não foi possível conectar ao servidor. Verifique sua conexão e tente de novo.", "rede");
  }
  let data: unknown = undefined;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { /* resposta não-JSON */ }
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string };
    if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("veyra:unauthorized"));
    throw new ApiError(res.status, d.error ?? "Algo deu errado. Tente novamente.", d.code);
  }
  return data as T;
}
