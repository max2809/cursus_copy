import { API_BASE_URL, apiFetch } from "./client";
import type { Citation, SessionDetail, SessionListResponse, SessionSummary } from "./types";
import { readSSE } from "./streaming";

export type ChatMode = "tutor" | "quiz" | "flashcards";

export async function listSessions(canvasCourseId: number): Promise<SessionListResponse> {
  return apiFetch<SessionListResponse>(`/api/courses/${canvasCourseId}/chat/sessions`);
}

export async function createSession(
  canvasCourseId: number,
  title?: string,
): Promise<SessionSummary> {
  return apiFetch<SessionSummary>(`/api/courses/${canvasCourseId}/chat/sessions`, {
    method: "POST",
    body: JSON.stringify({ title: title ?? null }),
    headers: { "content-type": "application/json" },
  });
}

export async function getSession(
  canvasCourseId: number,
  sessionId: string,
): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(
    `/api/courses/${canvasCourseId}/chat/sessions/${sessionId}`,
  );
}

export async function deleteSession(
  canvasCourseId: number,
  sessionId: string,
): Promise<void> {
  await apiFetch<void>(`/api/courses/${canvasCourseId}/chat/sessions/${sessionId}`, {
    method: "DELETE",
    parseJson: false,
  });
}

export interface ChatStreamCallbacks {
  onToken: (text: string) => void;
  onDone: (payload: { message_id: string; citations: Citation[] }) => void;
  onError: (message: string) => void;
}

export async function streamMessage(
  canvasCourseId: number,
  sessionId: string,
  content: string,
  mode: ChatMode,
  cb: ChatStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${API_BASE_URL}/api/courses/${canvasCourseId}/chat/sessions/${sessionId}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    body: JSON.stringify({ content, mode }),
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    credentials: "include",
    signal,
  });
  if (!resp.ok) {
    cb.onError(`HTTP ${resp.status}`);
    return;
  }
  try {
    for await (const ev of readSSE(resp)) {
      if (ev.event === "token") {
        try {
          cb.onToken((JSON.parse(ev.data) as { text: string }).text);
        } catch {
          /* skip malformed */
        }
      } else if (ev.event === "done") {
        try {
          cb.onDone(JSON.parse(ev.data));
        } catch {
          cb.onDone({ message_id: "", citations: [] });
        }
      } else if (ev.event === "error") {
        try {
          cb.onError((JSON.parse(ev.data) as { message: string }).message);
        } catch {
          cb.onError("stream error");
        }
      }
    }
  } catch (e) {
    cb.onError(String(e));
  }
}
