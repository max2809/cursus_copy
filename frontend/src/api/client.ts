const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!resp.ok) {
    let body: unknown = null;
    try { body = await resp.json(); } catch { /* ignore */ }
    throw new ApiError(resp.status, body);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}
