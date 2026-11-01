/**
 * Ponte com o Android. No app (Capacitor) fala com o plugin nativo "VeyraNative" (Java, pasta android-native/).
 * No navegador usa o que o navegador oferece (Web Speech) e recusa o resto com honestidade.
 * Não depende do pacote @capacitor/core: o Capacitor injeta `window.Capacitor` no WebView.
 */
import { isNativeApp } from "./config";

export interface NativeResult { ok: boolean; error?: string; cancelled?: boolean; [k: string]: unknown }

interface Plugin {
  capabilities(): Promise<{ speech: boolean; tts: boolean; alarm: boolean; calendar: boolean }>;
  listen(o: { lang: string }): Promise<{ ok: boolean; text?: string; error?: string }>;
  cancelListen(): Promise<unknown>;
  speak(o: { text: string; lang: string }): Promise<NativeResult>;
  stopSpeaking(): Promise<unknown>;
  setAlarm(o: { hora: string; rotulo?: string; dias?: string[] }): Promise<NativeResult>;
  calendarQuery(o: { de: string; ate: string }): Promise<NativeResult>;
  calendarCreate(o: Record<string, unknown>): Promise<NativeResult>;
  calendarUpdate(o: Record<string, unknown>): Promise<NativeResult>;
  calendarDelete(o: { id_evento: string }): Promise<NativeResult>;
}

type W = Window & { Capacitor?: { Plugins?: Record<string, unknown> }; webkitSpeechRecognition?: any; SpeechRecognition?: any };
const w = () => window as W;

export const plugin = (): Plugin | null => (isNativeApp() ? ((w().Capacitor?.Plugins?.VeyraNative as Plugin | undefined) ?? null) : null);

/** Recursos do aparelho que o app declara ao servidor (o servidor só oferece à IA o que está aqui). */
export const deviceCapabilities = (): string[] => (plugin() ? ["alarm", "calendar"] : []);

// ---- Voz (entrada) ----
const SR = () => w().SpeechRecognition ?? w().webkitSpeechRecognition;
export const speechAvailable = (): boolean => !!plugin() || !!SR();
let webRec: any = null;

export async function listen(lang = "pt-BR"): Promise<{ ok: true; text: string } | { ok: false; error: string; cancelled?: boolean }> {
  const p = plugin();
  if (p) {
    const r = await p.listen({ lang });
    if (r.ok && r.text) return { ok: true, text: r.text };
    return { ok: false, error: friendlySpeechError(r.error), cancelled: r.error === "cancelado" };
  }
  const Rec = SR();
  if (!Rec) return { ok: false, error: "Este navegador não tem reconhecimento de voz. No app Android ou no Chrome funciona." };
  return new Promise((resolve) => {
    const rec = new Rec();
    webRec = rec;
    let done = false;
    const finish = (v: { ok: true; text: string } | { ok: false; error: string; cancelled?: boolean }) => { if (!done) { done = true; webRec = null; resolve(v); } };
    rec.lang = lang; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e: any) => { const t = String(e.results?.[0]?.[0]?.transcript ?? "").trim(); finish(t ? { ok: true, text: t } : { ok: false, error: friendlySpeechError("sem_fala") }); };
    rec.onerror = (e: any) => finish({ ok: false, error: friendlySpeechError(String(e.error ?? "")), cancelled: e.error === "aborted" });
    rec.onend = () => finish({ ok: false, error: friendlySpeechError("sem_fala") });
    try { rec.start(); } catch { finish({ ok: false, error: friendlySpeechError("ocupado") }); }
  });
}
export async function cancelListen(): Promise<void> {
  const p = plugin();
  if (p) { try { await p.cancelListen(); } catch { /* */ } return; }
  try { webRec?.abort(); } catch { /* */ }
}

export function friendlySpeechError(code?: string): string {
  switch (code) {
    case "permissao_negada": case "not-allowed": case "service-not-allowed":
      return "Sem permissão para usar o microfone. Libere em Configurações → Apps → Veyra AI → Permissões.";
    case "sem_fala": case "no-speech": return "Não ouvi nada. Toque no microfone e fale de novo.";
    case "nao_entendi": return "Não consegui entender. Tente falar mais perto e devagar.";
    case "rede": case "network": return "O reconhecimento de voz precisa de internet neste aparelho (ou do pacote de voz offline em português). Digite sua mensagem.";
    case "indisponivel": return "Este aparelho não tem reconhecimento de voz instalado. Instale/atualize o app “Google” (ou o serviço de voz do aparelho) ou digite.";
    case "ocupado": return "O microfone está em uso. Tente de novo em instantes.";
    case "audio": case "audio-capture": return "Não consegui acessar o microfone do aparelho.";
    case "cancelado": case "aborted": return "Gravação cancelada.";
    default: return "A captura de voz falhou. Tente de novo ou digite.";
  }
}

// ---- Voz (saída) ----
export const ttsAvailable = (): boolean => !!plugin() || "speechSynthesis" in window;
/** Remove marcação e emojis para a fala soar natural. */
export const speakable = (s: string): string =>
  s.replace(/[*_`#>]+/g, "").replace(/\p{Extended_Pictographic}/gu, "").replace(/\s*\n\s*/g, ". ").replace(/\s{2,}/g, " ").trim().slice(0, 1200);

export async function speak(text: string, lang = "pt-BR"): Promise<void> {
  const t = speakable(text);
  if (!t) return;
  const p = plugin();
  if (p) { try { await p.speak({ text: t, lang }); } catch { /* falha de voz não deve quebrar o chat */ } return; }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t); u.lang = lang;
    window.speechSynthesis.speak(u);
  }
}
export async function stopSpeaking(): Promise<void> {
  const p = plugin();
  if (p) { try { await p.stopSpeaking(); } catch { /* */ } return; }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
