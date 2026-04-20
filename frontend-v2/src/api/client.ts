const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Set to false to skip response.json() (for 204 / non-JSON responses). */
  parseJson?: boolean;
}

export async function apiFetch<T>(
  path: string,
  opts?: ApiFetchOptions,
): Promise<T> {
  const { parseJson = true, headers, body, ...init } = opts ?? {};
  // Only default to JSON content-type when body is a string AND the caller hasn't
  // already set it (case-insensitive check — duplicating this header breaks FastAPI).
  const callerHeaders = headers ?? {};
  const hasContentType = Object.keys(callerHeaders as Record<string, string>)
    .some((k) => k.toLowerCase() === "content-type");
  const mergedHeaders: Record<string, string> = { ...callerHeaders as Record<string, string> };
  if (typeof body === "string" && !hasContentType) {
    mergedHeaders["Content-Type"] = "application/json";
  }
  const resp = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: mergedHeaders,
    body,
    ...init,
  });
  if (!resp.ok) {
    let errBody: unknown = null;
    try {
      errBody = await resp.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(resp.status, errBody);
  }
  if (!parseJson || resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}
