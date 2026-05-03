import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Citation, SessionDetail, SessionSummary } from "../../api/types";
import { ChatPane } from "./ChatPane";

const listSessions = vi.fn();
const getSession = vi.fn();
const createSession = vi.fn();
const streamMessage = vi.fn();

vi.mock("../../api/chat", () => ({
  listSessions: (...args: unknown[]) => listSessions(...args),
  getSession: (...args: unknown[]) => getSession(...args),
  createSession: (...args: unknown[]) => createSession(...args),
  streamMessage: (...args: unknown[]) => streamMessage(...args),
}));

function citation(overrides: Partial<Citation>): Citation {
  return {
    marker: 1,
    chunk_id: null,
    file_id: null,
    deadline_id: null,
    page_hint: null,
    heading_path: null,
    snippet: "snippet",
    source_name: "source.pdf",
    source_kind: "canvas",
    source_url: null,
    ...overrides,
  };
}

const session: SessionSummary = {
  id: "session-1",
  title: "Chat",
  created_at: "2026-05-03T10:00:00Z",
  updated_at: "2026-05-03T10:00:00Z",
};

describe("ChatPane citations", () => {
  beforeEach(() => {
    listSessions.mockReset();
    getSession.mockReset();
    createSession.mockReset();
    streamMessage.mockReset();
  });

  it("opens the citation attached to the clicked assistant message", async () => {
    const detail: SessionDetail = {
      ...session,
      messages: [
        {
          id: "old",
          role: "assistant",
          content: "Older answer [1].",
          citations_json: [
            citation({
              source_name: "old-source.pdf",
              snippet: "older source excerpt",
            }),
          ],
          error: false,
          created_at: "2026-05-03T10:01:00Z",
        },
        {
          id: "new",
          role: "assistant",
          content: "Newer answer [1].",
          citations_json: [
            citation({
              source_name: "new-source.pdf",
              snippet: "newer source excerpt",
            }),
          ],
          error: false,
          created_at: "2026-05-03T10:02:00Z",
        },
      ],
    };
    listSessions.mockResolvedValue({ sessions: [session] });
    getSession.mockResolvedValue(detail);

    const { container } = render(<ChatPane canvasCourseId={42} courseName="Algorithms" />);

    await screen.findByText(/Older answer/);
    await screen.findByText(/Newer answer/);

    const citationButtons = await waitFor(() => {
      const buttons = Array.from(container.querySelectorAll(".cite"));
      expect(buttons).toHaveLength(2);
      return buttons;
    });
    fireEvent.click(citationButtons[0]);

    expect(await screen.findByText("old-source.pdf")).toBeInTheDocument();
    expect(screen.getByText(/older source excerpt/)).toBeInTheDocument();
    expect(screen.queryByText("new-source.pdf")).not.toBeInTheDocument();
  });
});
