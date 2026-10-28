import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import type { ChatMessage } from "../lib/types";

type Tone = "ok" | "error" | "info";
interface Toast { id: number; text: string; tone: Tone }

interface AppCtx {
  /** Sobe a cada mudança de dados (chat, desfazer, concluir…). Telas recarregam quando muda. */
  version: number;
  bump(): void;
  toast(text: string, tone?: Tone): void;
  toasts: Toast[];
  dismissToast(id: number): void;

  messages: ChatMessage[];
  chatLoaded: boolean;
  sending: boolean;
  loadChat(): Promise<void>;
  send(text: string): Promise<void>;
  retry(id: string): Promise<void>;
  undo(msgId: string, actionIdx: number): Promise<void>;
  undone: Set<string>;
  clearChat(): Promise<void>;
}
const Ctx = createContext<AppCtx | null>(null);

let seq = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const inFlight = useRef(false);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, tone: Tone = "ok") => {
    const id = ++seq;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3200);
  }, []);

  const loadChat = useCallback(async () => {
    try {
      const r = await api<{ messages: ChatMessage[] }>("GET", "/api/chat/history");
      setMessages(r.messages);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Não foi possível carregar a conversa.", "error");
    } finally {
      setChatLoaded(true);
    }
  }, [toast]);

  const deliver = useCallback(async (tempId: string, text: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    try {
      const r = await api<{ user: ChatMessage; assistant: ChatMessage }>("POST", "/api/chat", { text });
      setMessages((m) => [...m.filter((x) => x.id !== tempId), r.user, r.assistant]);
      bump();
    } catch (e) {
      setMessages((m) => m.map((x) => (x.id === tempId ? { ...x, failed: true } : x)));
      toast(e instanceof ApiError ? e.message : "Não foi possível enviar.", "error");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }, [bump, toast]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    const tempId = `tmp-${++seq}`;
    setMessages((m) => [...m, { id: tempId, role: "user", text: t, actions: [], createdAt: new Date().toISOString() }]);
    await deliver(tempId, t);
  }, [deliver]);

  const retry = useCallback(async (id: string) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg) return;
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, failed: false } : x)));
    await deliver(id, msg.text);
  }, [messages, deliver]);

  const undo = useCallback(async (msgId: string, idx: number) => {
    const ref = messages.find((m) => m.id === msgId)?.actions[idx]?.record;
    if (!ref) return;
    try {
      await api("DELETE", `/api/records/${ref.kind}/${ref.id}`);
      setUndone((s) => new Set(s).add(ref.id));
      bump();
      toast("Desfeito.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Não foi possível desfazer.", "error");
    }
  }, [messages, bump, toast]);

  const clearChat = useCallback(async () => {
    await api("DELETE", "/api/chat/history");
    setMessages([]);
    toast("Conversa apagada.");
  }, [toast]);

  const value = useMemo<AppCtx>(() => ({
    version, bump, toast, toasts, dismissToast, messages, chatLoaded, sending, loadChat, send, retry, undo, undone, clearChat,
  }), [version, bump, toast, toasts, dismissToast, messages, chatLoaded, sending, loadChat, send, retry, undo, undone, clearChat]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppProvider ausente");
  return c;
}
