import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccount, submitPat } from "./onboarding";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

describe("onboarding API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits the Canvas domain with the PAT", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: true }));

    await submitPat({
      pat: "7289~token",
      canvas_base_url: "canvas.other.edu",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/onboarding/pat");
    expect(JSON.parse(init?.body as string)).toEqual({
      pat: "7289~token",
      canvas_base_url: "canvas.other.edu",
    });
  });

  it("fetches the authenticated account state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        email: "person@example.edu",
        canvas_base_url: "canvas.other.edu",
        has_pat: true,
      }),
    );

    await expect(getAccount()).resolves.toEqual({
      email: "person@example.edu",
      canvas_base_url: "canvas.other.edu",
      has_pat: true,
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/api/auth/me");
  });
});
