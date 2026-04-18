import { describe, it, expect } from "vitest";
import { readSSE } from "./streaming";

function mockResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

describe("readSSE", () => {
  it("yields events split on double newline", async () => {
    const body = [
      "event: token\ndata: {\"text\":\"Hi \"}\n\n",
      "event: token\ndata: {\"text\":\"world\"}\n\n",
      "event: done\ndata: {\"message_id\":\"m1\",\"citations\":[]}\n\n",
    ];
    const out: { event: string; data: string }[] = [];
    for await (const ev of readSSE(mockResponse(body))) out.push(ev);
    expect(out.map((e) => e.event)).toEqual(["token", "token", "done"]);
    expect(JSON.parse(out[0].data).text).toBe("Hi ");
    expect(JSON.parse(out[2].data).message_id).toBe("m1");
  });

  it("handles chunks split across packets", async () => {
    const body = ["event: tok", "en\ndata: {\"text\":\"x\"}\n\n"];
    const out: { event: string; data: string }[] = [];
    for await (const ev of readSSE(mockResponse(body))) out.push(ev);
    expect(out[0].event).toBe("token");
    expect(JSON.parse(out[0].data).text).toBe("x");
  });

  it("defaults event name to 'message' when only data:", async () => {
    const body = ["data: hello\n\n"];
    const out: { event: string; data: string }[] = [];
    for await (const ev of readSSE(mockResponse(body))) out.push(ev);
    expect(out[0].event).toBe("message");
    expect(out[0].data).toBe("hello");
  });
});
