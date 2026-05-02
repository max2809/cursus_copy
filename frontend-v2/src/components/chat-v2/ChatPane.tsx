import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  createSession,
  getSession,
  listSessions,
  streamMessage,
} from "../../api/chat";
import type { ChatMode } from "../../api/chat";
import type {
  ChatMessageItem,
  Citation,
  SessionDetail,
  SessionSummary,
} from "../../api/types";
import { CitationDrawer } from "./CitationDrawer";
import { MarkdownWithCites } from "./MarkdownWithCites";
import {
  IconAttach,
  IconBook,
  IconCards,
  IconChat,
  IconClose,
  IconCopy,
  IconDown,
  IconPlus,
  IconQuiz,
  IconRefresh,
  IconSend,
  IconThumb,
} from "../../design/icons";

interface Props {
  canvasCourseId: number;
  courseName: string;
  onCollapse?: () => void;
  userInitials?: string;
}

const MODES: { id: ChatMode; label: string; hint: string; Icon: (p: any) => JSX.Element }[] = [
  { id: "tutor", label: "Tutor", hint: "Socratic explanation with citations", Icon: IconChat },
  { id: "quiz", label: "Quiz me", hint: "Practice MCQ", Icon: IconQuiz },
  { id: "flashcards", label: "Make flashcards", hint: "Turn this into flashcards", Icon: IconCards },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ChatPane({
  canvasCourseId,
  courseName,
  onCollapse,
  userInitials = "You",
}: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [streaming, setStreaming] = useState<{ content: string; citations: Citation[] } | null>(null);
  const [mode, setMode] = useState<ChatMode>("tutor");
  const [input, setInput] = useState("");
  const [drawer, setDrawer] = useState<Citation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load sessions when course changes
  useEffect(() => {
    listSessions(canvasCourseId).then((r) => {
      setSessions(r.sessions);
      setSessionId(r.sessions[0]?.id ?? null);
      setDetail(null);
    });
  }, [canvasCourseId]);

  // Load session detail when session changes
  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    getSession(canvasCourseId, sessionId).then(setDetail);
  }, [canvasCourseId, sessionId]);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if user is near bottom
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (gap < 220) {
      el.scrollTop = el.scrollHeight;
    } else {
      setShowJump(true);
    }
  }, [detail?.messages?.length, streaming?.content]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJump(gap > 220);
  };

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setError(null);
    let sid = sessionId;
    if (!sid) {
      const s = await createSession(canvasCourseId);
      sid = s.id;
      setSessionId(sid);
      setSessions((prev) => [s, ...prev]);
      setDetail({ ...s, messages: [] });
    }
    const optimistic: ChatMessageItem = {
      id: `opt-${Date.now()}`,
      role: "user",
      content: trimmed,
      citations_json: null,
      error: false,
      created_at: new Date().toISOString(),
    };
    setDetail((d) => (d ? { ...d, messages: [...d.messages, optimistic] } : d));
    setInput("");
    setStreaming({ content: "", citations: [] });

    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;

    await streamMessage(
      canvasCourseId,
      sid!,
      trimmed,
      mode,
      {
        onToken: (t) =>
          setStreaming((prev) => (prev ? { ...prev, content: prev.content + t } : prev)),
        onDone: () => {
          setStreaming(null);
          getSession(canvasCourseId, sid!).then(setDetail);
        },
        onError: (msg) => {
          setStreaming(null);
          setError(msg);
        },
      },
      ac.signal
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    handleSend(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  }

  async function handleNewChat() {
    const s = await createSession(canvasCourseId);
    setSessions((prev) => [s, ...prev]);
    setSessionId(s.id);
    setDetail({ ...s, messages: [] });
    setSessionMenuOpen(false);
    setError(null);
  }

  function openCite(n: number) {
    const messages = detail?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.citations_json) {
        const hit = m.citations_json.find((c) => c.marker === n);
        if (hit) {
          setDrawer(hit);
          return;
        }
      }
    }
    const streamCites = streaming?.citations;
    if (streamCites) {
      const hit = streamCites.find((c) => c.marker === n);
      if (hit) setDrawer(hit);
    }
  }

  async function retryLast() {
    const messages = detail?.messages ?? [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setError(null);
    handleSend(lastUser.content);
  }

  const messages = detail?.messages ?? [];
  const hasMessages = messages.length > 0 || !!streaming;
  const isEmpty = !hasMessages && !error;

  const prompts: { icon: JSX.Element; label: string; hint: string }[] = [
    {
      icon: <IconBook />,
      label: "Explain a concept",
      hint: `Walk me through the hardest idea from the latest ${courseName} lecture`,
    },
    {
      icon: <IconQuiz />,
      label: "Quiz me",
      hint: `Test me on recent ${courseName} material with 5 questions`,
    },
    {
      icon: <IconCards />,
      label: "Make flashcards",
      hint: `Turn the most recent ${courseName} lecture into 10 flashcards`,
    },
  ];

  return (
    <div className="chat-pane">
      <div className="mode-bar" style={{ position: "relative" }}>
        {MODES.map((m) => {
          const Icon = m.Icon;
          return (
            <button
              key={m.id}
              className="mode-pill"
              data-active={mode === m.id}
              onClick={() => setMode(m.id)}
              title={m.hint}
              type="button"
            >
              <Icon /> {m.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          className="iconbtn"
          title="New chat"
          onClick={handleNewChat}
          type="button"
        >
          <IconPlus />
        </button>
        {sessions.length > 0 && (
          <button
            className="iconbtn"
            title="Session history"
            onClick={() => setSessionMenuOpen((v) => !v)}
            type="button"
          >
            <IconChat />
          </button>
        )}
        {onCollapse && (
          <button
            className="iconbtn"
            title="Hide chat"
            onClick={onCollapse}
            type="button"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 3l-5 5 5 5" />
            </svg>
          </button>
        )}
        {sessionMenuOpen && sessions.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 8,
              background: "var(--bg-elev)",
              border: "1px solid var(--hair)",
              borderRadius: "var(--r-md)",
              boxShadow: "var(--shadow-md)",
              minWidth: 240,
              maxHeight: 320,
              overflowY: "auto",
              padding: 4,
              zIndex: 20,
            }}
            onMouseLeave={() => setSessionMenuOpen(false)}
          >
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSessionId(s.id);
                  setSessionMenuOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 10px",
                  fontSize: 13,
                  border: "none",
                  background:
                    s.id === sessionId ? "var(--accent-soft)" : "transparent",
                  color: s.id === sessionId ? "var(--accent)" : "var(--ink)",
                  borderRadius: "var(--r-sm)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.title || "Untitled"}
                </div>
                <div style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                  {new Date(s.updated_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {isEmpty ? (
        <div className="chat-empty">
          <div className="empty-greeting">Ask me about {courseName}</div>
          <div className="empty-sub">
            Pick a starter or type your own question. Cursus has your Canvas materials indexed.
          </div>
          <div className="empty-prompts">
            {prompts.map((p, i) => (
              <button
                key={i}
                className="empty-prompt"
                type="button"
                onClick={() => handleSend(p.hint)}
              >
                <div className="ep-icon">{p.icon}</div>
                <div className="ep-text">
                  <div className="ep-label">{p.label}</div>
                  <div className="ep-hint">"{p.hint}"</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="messages" ref={scrollRef} onScroll={onScroll}>
          <div className="day-sep">
            Today · {MODES.find((m) => m.id === mode)!.label} mode
          </div>

          {messages.map((m) => (
            <MessageRow
              key={m.id}
              msg={m}
              userInitials={userInitials}
              onCiteClick={openCite}
              onSuggest={(text) => handleSend(text)}
            />
          ))}

          {streaming && (
            <div className="msg">
              <div className="msg-avatar ai">
                <span>C</span>
              </div>
              <div className="msg-body">
                <div className="msg-meta">
                  <span className="who">Cursus</span>
                  <span>thinking…</span>
                  <span className="mode-tag">{MODES.find((m) => m.id === mode)!.label}</span>
                </div>
                <div className="bubble">
                  {streaming.content ? (
                    <MarkdownWithCites
                      content={streaming.content + "▍"}
                      onCiteClick={openCite}
                    />
                  ) : (
                    <div className="typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="msg error-msg">
              <div className="msg-avatar ai">
                <span>C</span>
              </div>
              <div className="msg-body">
                <div className="msg-meta">
                  <span className="who">Cursus</span>
                  <span>just now</span>
                </div>
                <div className="bubble error-bubble">
                  <div className="error-icon">
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width={16}
                      height={16}
                    >
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 5v3.5M8 11h.01" />
                    </svg>
                  </div>
                  <div className="error-body">
                    <div className="error-title">Couldn't generate a response</div>
                    <div className="error-detail">{error}</div>
                    <div className="error-actions">
                      <button className="error-btn primary" type="button" onClick={retryLast}>
                        <IconRefresh /> Try again
                      </button>
                      <button className="error-btn" type="button" onClick={() => setError(null)}>
                        <IconClose /> Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showJump && hasMessages && (
        <button className="jump-btn" type="button" onClick={scrollToBottom}>
          <IconDown /> Latest
        </button>
      )}

      <form className="composer" onSubmit={onSubmit}>
        <div className="composer-inner">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Ask about ${courseName}…`}
            disabled={!!streaming}
          />
          <div className="composer-row">
            <button type="button" className="composer-chip" disabled title="Coming soon">
              <IconAttach /> Attach
            </button>
            <button type="button" className="composer-chip" disabled title="Coming soon">
              <IconBook /> Cite chapter
            </button>
            <div className="grow" />
            <span
              style={{
                fontSize: 10.5,
                color: "var(--ink-3)",
                fontFamily: "var(--font-mono)",
                marginRight: 6,
              }}
            >
              {mode.toUpperCase()}
            </span>
            <button
              type="submit"
              className="send-btn"
              disabled={!input.trim() || !!streaming}
            >
              Send <IconSend />
            </button>
          </div>
        </div>
      </form>

      <CitationDrawer citation={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

function MessageRow({
  msg,
  userInitials,
  onCiteClick,
  onSuggest,
}: {
  msg: ChatMessageItem;
  userInitials: string;
  onCiteClick: (n: number) => void;
  onSuggest: (t: string) => void;
}) {
  void onSuggest;
  const time = formatTime(msg.created_at);
  if (msg.role === "user") {
    return (
      <div className="msg user">
        <div className="msg-avatar user">{userInitials}</div>
        <div className="msg-body">
          <div className="msg-meta">
            <span className="who">You</span>
            <span>{time}</span>
          </div>
          <div className="bubble">
            <p style={{ whiteSpace: "pre-wrap" }}>{msg.content}</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="msg">
      <div className="msg-avatar ai">
        <span>C</span>
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="who">Cursus</span>
          <span>{time}</span>
        </div>
        <div className="bubble">
          <MarkdownWithCites content={msg.content} onCiteClick={onCiteClick} />
          {msg.error && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-3)" }}>
              Stream errored mid-reply.
            </div>
          )}
        </div>
        <div className="msg-actions">
          <button
            className="msg-action"
            type="button"
            onClick={() => navigator.clipboard?.writeText(msg.content)}
          >
            <IconCopy /> Copy
          </button>
          <button className="msg-action" type="button" disabled>
            <IconThumb />
          </button>
        </div>
      </div>
    </div>
  );
}
