import { apiBase, getToken, isNativeApp } from "./config";
import { deviceCapabilities } from "./native";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "erro") {
    super(message);
  }
}

/**
 * Todas as chamadas passam por aqui. Site: cookie de sessão (HttpOnly) + cabeçalho anti-CSRF.
 * App Android: token Bearer + declaração dos recursos do aparelho. Nenhuma chave de API existe no front.
 */
export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const native = isNativeApp();
    const token = getToken();
    const caps = native ? deviceCapabilities() : [];
    res = await fetch(apiBase() + path, {
      method,
      credentials: native ? "omit" : "same-origin",
      headers: {
        "x-requested-with": "veyra",
        ...(native ? { "x-veyra-client": "app", ...(caps.length ? { "x-veyra-capabilities": caps.join(",") } : {}) } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Não foi possível conectar ao servidor. Verifique sua conexão e tente de novo.", "rede");
  }
  let data: unknown = undefined;
  let notJson = false;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { notJson = true; }
  }
  // A API da Veyra SEMPRE responde JSON. Se veio HTML/texto, quem respondeu foi outra coisa (ex.: hospedagem sem a API
  // publicada, rota inexistente, página de erro da plataforma) — diga isso, em vez de uma mensagem genérica.
  if (notJson) {
    console.error(`[veyra] ${method} ${path} → HTTP ${res.status} com resposta que não é JSON (a API não está respondendo neste endereço).`);
    throw new ApiError(res.status, `O servidor da Veyra não respondeu como esperado (erro ${res.status}). Isso indica um problema na publicação, não nos seus dados. Tente de novo em instantes.`, "api_indisponivel");
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string };
    if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("veyra:unauthorized"));
    throw new ApiError(res.status, d.error ?? "Algo deu errado. Tente novamente.", d.code);
  }
  return data as T;
}
