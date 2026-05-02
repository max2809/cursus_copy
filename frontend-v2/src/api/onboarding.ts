import { apiFetch } from "./client";

export interface SubmitPatPayload {
  pat: string;
  canvas_base_url: string;
}

export interface AccountResponse {
  email: string;
  canvas_base_url: string;
  has_pat: boolean;
}

export function submitPat(payload: SubmitPatPayload) {
  return apiFetch<{ ok: true }>("/api/onboarding/pat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getAccount() {
  return apiFetch<AccountResponse>("/api/auth/me");
}
