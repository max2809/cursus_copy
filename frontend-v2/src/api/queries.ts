import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { DeadlinesResponse } from "./types";

export function useDeadlines() {
  return useQuery({
    queryKey: ["deadlines"],
    queryFn: () => apiFetch<DeadlinesResponse>("/api/deadlines"),
    retry: false,
    // Poll every 3s while the backend is still syncing so courses fill in live.
    // Stops once last_synced_at is set AND `syncing` flips to false.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      if (d.syncing || !d.last_synced_at) return 3000;
      return false;
    },
  });
}

export function useRequestMagicLink() {
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch<{ ok: true }>("/api/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
  });
}

export function useVerifyToken() {
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<{ next: string }>("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
  });
}

export function useSubmitPat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pat: string) =>
      apiFetch<{ ok: true }>("/api/onboarding/pat", {
        method: "POST",
        body: JSON.stringify({ pat }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deadlines"] }),
  });
}

export function useSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: true }>("/api/sync", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deadlines"] }),
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => apiFetch<void>("/api/auth/session", { method: "DELETE" }),
  });
}
