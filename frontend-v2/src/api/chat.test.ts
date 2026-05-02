import { afterEach, describe, expect, it, vi } from "vitest";
import { streamMessage } from "./chat";

function sseResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("streamMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the selected chat mode with the message", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(sseResponse("event: done\ndata: {\"message_id\":\"m1\",\"citations\":[]}\n\n"));

    await streamMessage(10, "session-1", "quiz me", "quiz", {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      content: "quiz me",
      mode: "quiz",
    });
  });
});
