import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./client";

describe("resolveApiBaseUrl", () => {
  it("uses the configured API base URL without trailing slashes", () => {
    expect(
      resolveApiBaseUrl({
        VITE_API_BASE_URL: "https://api.example.com///",
        DEV: false,
      }),
    ).toBe("https://api.example.com");
  });

  it("uses localhost only during local dev", () => {
    expect(resolveApiBaseUrl({ DEV: true })).toBe("http://localhost:8000");
  });

  it("throws outside dev when VITE_API_BASE_URL is missing", () => {
    expect(() => resolveApiBaseUrl({ DEV: false })).toThrow(
      "VITE_API_BASE_URL is required outside development",
    );
  });
});
