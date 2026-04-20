import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { listCourses, updateCourseStatus } from "./courses";
import type { CourseStatus, DeadlinesResponse } from "./types";

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

export function useCourses() {
  return useQuery({
    queryKey: ["courses"],
    queryFn: listCourses,
    retry: false,
  });
}

export function useUpdateCourseStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ canvasCourseId, status }: { canvasCourseId: number; status: CourseStatus }) =>
      updateCourseStatus(canvasCourseId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deadlines"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
    },
  });
}

export function useSetDeadlineSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deadlineId, done }: { deadlineId: string; done: boolean }) =>
      apiFetch<{ id: string; submitted: boolean; manually_submitted: boolean }>(
        `/api/deadlines/${deadlineId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ manually_submitted: done }),
          headers: { "content-type": "application/json" },
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deadlines"] }),
  });
}
