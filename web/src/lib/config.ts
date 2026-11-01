/**
 * Configuração de ambiente do front: onde fica a API e como a sessão é guardada.
 *  - Site (navegador): API no mesmo endereço, sessão por cookie HttpOnly. Nada muda.
 *  - App Android (Capacitor): a página roda em https://localhost, então a API precisa de endereço completo
 *    (VITE_API_BASE na compilação, ou informado na tela de entrada) e a sessão usa um token Bearer.
 */
type CapWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } };

const SERVER_KEY = "veyra.server";
const TOKEN_KEY = "veyra.token";
const VOICE_KEY = "veyra.voice";

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* armazenamento indisponível */ } };

export const isNativeApp = (): boolean => {
  try { return !!(window as CapWindow).Capacitor?.isNativePlatform?.(); } catch { return false; }
};

/** Normaliza o endereço do servidor: exige https (ou http só para teste local) e remove barras finais. */
export function normalizeServerUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  s = s.replace(/\/+$/, "");
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    if (u.protocol !== "https:" && !/^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname)) return null;
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch { return null; }
}

const BUILD_BASE = (import.meta.env?.VITE_API_BASE as string | undefined)?.trim() || "";

/** Endereço base da API ("" = mesmo endereço da página, como no site). */
export const apiBase = (): string => (isNativeApp() ? read(SERVER_KEY) || normalizeServerUrl(BUILD_BASE) || "" : BUILD_BASE ? normalizeServerUrl(BUILD_BASE) ?? "" : "");
export const needsServerUrl = (): boolean => isNativeApp() && !apiBase();
export const setServerUrl = (v: string | null) => write(SERVER_KEY, v);
export const getServerUrl = (): string => read(SERVER_KEY) ?? "";

export const getToken = (): string | null => (isNativeApp() ? read(TOKEN_KEY) : null);
export const setToken = (t: string | null) => write(TOKEN_KEY, t);

export const voiceReplies = (): boolean => read(VOICE_KEY) === "1";
export const setVoiceReplies = (on: boolean) => write(VOICE_KEY, on ? "1" : "0");
