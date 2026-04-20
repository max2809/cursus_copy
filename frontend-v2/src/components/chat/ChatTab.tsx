import { useEffect, useRef, useState } from "react";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  streamMessage,
} from "../../api/chat";
import type {
  ChatMessageItem,
  Citation,
  SessionDetail,
  SessionSummary,
} from "../../api/types";
import { MessageList } from "./MessageList";
import { SessionStrip } from "./SessionStrip";
import { SourcesPanel } from "./SourcesPanel";
import { ChatInput } from "./ChatInput";

interface Props {
  canvasCourseId: number;
  courseName: string;
}

export function ChatTab({ canvasCourseId, courseName }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [streaming, setStreaming] = useState<{ content: string; citations: Citation[] } | null>(null);
  const [activeCitations, setActiveCitations] = useState<Citation[]>([]);
  const cardRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listSessions(canvasCourseId).then((r) => {
      setSessions(r.sessions);
      if (r.sessions.length > 0) setSessionId(r.sessions[0].id);
    });
  }, [canvasCourseId]);

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      setActiveCitations([]);
      return;
    }
    getSession(canvasCourseId, sessionId).then((d) => {
      setDetail(d);
      const last = [...d.messages].reverse().find((m) => m.role === "assistant");
      setActiveCitations((last?.citations_json ?? []) as Citation[]);
    });
  }, [canvasCourseId, sessionId]);

  async function handleSend(text: string) {
    let sid = sessionId;
    if (!sid) {
      const s = await createSession(canvasCourseId);
      sid = s.id;
      setSessionId(sid);
      setSessions((prev) => [s, ...prev]);
    }
    const userMsg: ChatMessageItem = {
      id: `optimistic-${Date.now()}`,
      role: "user",
      content: text,
      citations_json: null,
      error: false,
      created_at: new Date().toISOString(),
    };
    setDetail((d) => (d ? { ...d, messages: [...d.messages, userMsg] } : d));
    setStreaming({ content: "", citations: [] });

    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;

    await streamMessage(
      canvasCourseId,
      sid!,
      text,
      {
        onToken: (t) =>
          setStreaming((prev) => (prev ? { ...prev, content: prev.content + t } : prev)),
        onDone: (payload) => {
          const cits = (payload.citations ?? []) as Citation[];
          setActiveCitations(cits);
          setStreaming(null);
          getSession(canvasCourseId, sid!).then(setDetail);
        },
        onError: (msg) => {
          setStreaming(null);
          setDetail((d) =>
            d
              ? {
                  ...d,
                  messages: [
                    ...d.messages,
                    {
                      id: `err-${Date.now()}`,
                      role: "assistant",
                      content: `Error: ${msg}`,
                      citations_json: null,
                      error: true,
                      created_at: new Date().toISOString(),
                    } as ChatMessageItem,
                  ],
                }
              : d
          );
        },
      },
      ac.signal
    );
  }

  function handleCitationClick(n: number) {
    const el = cardRefs.current.get(n);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-black");
      setTimeout(() => el.classList.remove("ring-2", "ring-black"), 900);
    }
  }

  async function handleNewChat() {
    const s = await createSession(canvasCourseId);
    setSessions((prev) => [s, ...prev]);
    setSessionId(s.id);
    setDetail({ ...s, messages: [] });
    setActiveCitations([]);
  }

  // kept for future UI affordance — not currently wired
  void deleteSession;

  const messages = detail?.messages ?? [];
  const isEmpty = messages.length === 0 && !streaming;

  return (
    <div className="flex flex-col h-[70vh]">
      <SessionStrip
        sessions={sessions}
        activeId={sessionId}
        onPick={setSessionId}
        onNew={handleNewChat}
      />
      <div className="grid md:grid-cols-[2fr_1fr] gap-4 flex-1 mt-2 min-h-0">
        <div className="flex flex-col min-h-0">
          {isEmpty ? (
            <WelcomeCard courseName={courseName} onPick={handleSend} />
          ) : (
            <MessageList
              messages={messages}
              streaming={streaming}
              onCitationClick={handleCitationClick}
            />
          )}
          <ChatInput
            onSubmit={handleSend}
            disabled={!!streaming}
            placeholder={`Ask about ${courseName}…`}
          />
        </div>
        <div className="hidden md:block overflow-y-auto">
          <SourcesPanel citations={activeCitations} cardRefs={cardRefs} />
        </div>
      </div>
    </div>
  );
}

function WelcomeCard({
  courseName,
  onPick,
}: {
  courseName: string;
  onPick: (t: string) => void;
}) {
  const examples = [
    `What's on the next exam for ${courseName}?`,
    "Summarize the latest lecture.",
    "Explain the hardest concept in simpler words.",
  ];
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="rounded-feature border-2 border-black bg-white p-6 max-w-md">
        <h3 className="font-medium text-lg mb-2">Ask me about {courseName}.</h3>
        <p className="text-sm opacity-70 mb-4">Try one of these:</p>
        <div className="flex flex-col gap-2">
          {examples.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick(e)}
              className="text-left text-sm rounded-pill border-2 border-black bg-oat-light px-3 py-1.5"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
