import type { ChatMessage } from "../lib/types";
import { Icon } from "./Icon";
import { Button } from "./ui";
import { useApp } from "../state/app";

const HEADS = /^(Registrado|Tudo certo|Pronto)\.$/;

const KIND_WORD = { transaction: "lançamento", reminder: "lembrete", event: "evento", task: "tarefa" } as const;
/** Rótulo curto do botão "Desfazer" quando há várias ações: "+ R$ 1.500", "− R$ 80", "lembrete"… */
function undoLabel(a: ChatMessage["actions"][number]): string {
  const money = /^[+−]\s*R\$\s*[\d.,]+/.exec(a.line)?.[0];
  return money ?? KIND_WORD[a.record!.kind];
}

function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((l, i) => (
        <span key={i} className={`line ${l.startsWith("+ ") ? "pos" : l.startsWith("− ") ? "neg" : ""}`}>{l || " "}</span>
      ))}
    </>
  );
}

/** Resposta da Veyra. Quando ela executou algo, a confirmação aparece como um "recibo": check + linhas alinhadas. */
function AssistantBody({ msg }: { msg: ChatMessage }) {
  const blocks = msg.text.split("\n\n");
  const executed = msg.actions.some((a) => a.ok && a.record);
  const head = blocks[0] ?? "";
  if (executed && HEADS.test(head)) {
    const rest = blocks.slice(1);
    // Primeiro bloco restante = o recibo; o que vier depois (avisos, consultas) fica como texto normal.
    return (
      <>
        <div className="receipt" role="group" aria-label="Ação executada">
          <div className="receipt-head"><span className="receipt-check"><Icon name="check" size={14} /></span>{head.replace(".", "")}</div>
          {rest[0] && <div className="receipt-lines"><Lines text={rest[0]} /></div>}
        </div>
        {rest.slice(1).map((b, i) => <p key={i} className="para"><Lines text={b} /></p>)}
      </>
    );
  }
  return <>{blocks.map((b, i) => <p key={i} className="para"><Lines text={b} /></p>)}</>;
}

export function MessageView({ msg }: { msg: ChatMessage }) {
  const { undo, undone, retry } = useApp();
  if (msg.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="bubble">{msg.text}</div>
        {msg.failed && (
          <div className="msg-failed" role="alert">
            Não foi enviada. <Button size="sm" onClick={() => void retry(msg.id)}>Tentar de novo</Button>
          </div>
        )}
      </div>
    );
  }
  const undoable = msg.actions.map((a, i) => ({ a, i })).filter(({ a }) => a.ok && a.record);
  return (
    <div className="msg msg-veyra">
      <div className="bubble">
        <AssistantBody msg={msg} />
        {undoable.length > 0 && (
          <div className="undo-row">
            {undoable.map(({ a, i }) => {
              const done = undone.has(a.record!.id);
              return (
                <button key={i} className="undo" disabled={done} onClick={() => void undo(msg.id, i)} aria-label={done ? "Desfeito" : `Desfazer: ${a.line}`}>
                  <Icon name="undo" size={14} />{done ? "Desfeito" : undoable.length > 1 ? `Desfazer ${undoLabel(a)}` : "Desfazer"}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function Typing() {
  return <div className="msg msg-veyra"><div className="bubble typing" role="status" aria-label="A Veyra está pensando"><i /><i /><i /></div></div>;
}
