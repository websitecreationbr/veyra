import { useEffect, useRef } from "react";
import { Composer, SuggestionChips, SUGGESTIONS } from "../components/Composer";
import { MessageView, Typing } from "../components/Message";
import { Loading } from "../components/ui";
import { Logo } from "../components/Icon";
import { useApp } from "../state/app";

export function Flow() {
  const { messages, chatLoaded, sending, loadChat, send } = useApp();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!chatLoaded) void loadChat(); }, [chatLoaded, loadChat]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: messages.length > 2 ? "smooth" : "auto" }); }, [messages, sending]);

  return (
    <div className="flow">
      <header className="flow-head">
        <Logo size={26} />
        <div>
          <h1>Veyra</h1>
          <p>O que você precisa?</p>
        </div>
      </header>

      <div className="flow-scroll" role="log" aria-live="polite" aria-label="Conversa com a Veyra">
        <div className="flow-inner">
          {!chatLoaded && <Loading text="Carregando a conversa..." />}
          {chatLoaded && messages.length === 0 && (
            <div className="flow-empty">
              <p className="lead">Você fala. A Veyra entende. A Veyra faz.</p>
              <p className="muted">Escreva do seu jeito — pode juntar várias coisas numa frase só.</p>
              <SuggestionChips onPick={(t) => void send(t)} items={SUGGESTIONS} />
            </div>
          )}
          {messages.map((m) => <MessageView key={m.id} msg={m} />)}
          {sending && <Typing />}
          <div ref={endRef} />
        </div>
      </div>

      <div className="flow-composer">
        <Composer onSubmit={(t) => void send(t)} autoFocus disabled={sending} />
      </div>
    </div>
  );
}
