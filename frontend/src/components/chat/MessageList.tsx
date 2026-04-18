import { useEffect, useRef } from "react";
import type { ChatMessageItem, Citation } from "../../api/types";
import { MessageContent } from "./MessageContent";

interface Props {
  messages: ChatMessageItem[];
  streaming: { content: string; citations: Citation[] } | null;
  onCitationClick: (n: number) => void;
}

export function MessageList({ messages, streaming, onCitationClick }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming?.content]);

  return (
    <div className="space-y-3 overflow-y-auto flex-1 pr-2">
      {messages.map((m) => (
        <div
          key={m.id}
          className={
            "rounded-feature border-2 border-black p-3 max-w-[85%] " +
            (m.role === "user" ? "ml-auto bg-cream" : "bg-white")
          }
        >
          {m.role === "user" ? (
            <p className="whitespace-pre-wrap text-sm">{m.content}</p>
          ) : (
            <MessageContent content={m.content} onCitationClick={onCitationClick} />
          )}
          {m.error && (
            <div className="mt-2 text-xs text-pomegranate-500">Stream errored mid-reply.</div>
          )}
        </div>
      ))}
      {streaming && (
        <div className="rounded-feature border-2 border-black bg-white p-3 max-w-[85%]">
          <MessageContent content={streaming.content + "▍"} onCitationClick={onCitationClick} />
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
