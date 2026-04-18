/**
 * Minimal SSE reader over fetch(). No EventSource (no cookie support).
 *
 * Usage:
 *   for await (const evt of readSSE(response)) {
 *     if (evt.event === "token") ...
 *   }
 */
export interface SSEEvent {
  event: string;
  data: string;
}

export async function* readSSE(response: Response): AsyncIterable<SSEEvent> {
  if (!response.body) throw new Error("response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      yield parseBlock(block);
    }
  }
  if (buffer.trim()) yield parseBlock(buffer);
}

function parseBlock(block: string): SSEEvent {
  let event = "message";
  const dataLines: string[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.join("\n") };
}
