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
  // Only default to JSON content-type when the body is a string (not FormData, etc.).
  const defaultHeaders: Record<string, string> = {};
  if (typeof body === "string") {
    defaultHeaders["Content-Type"] = "application/json";
  }
  const resp = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      ...defaultHeaders,
      ...(headers ?? {}),
    },
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
