import { apiFetch } from "./client";
import type { StudyPlanCurrentResponse } from "./types";

export async function getStudyPlan(): Promise<StudyPlanCurrentResponse> {
  return apiFetch<StudyPlanCurrentResponse>("/api/study-plan/current");
}

export async function generateStudyPlan(
  selectedCanvasCourseIds: number[],
): Promise<StudyPlanCurrentResponse> {
  return apiFetch<StudyPlanCurrentResponse>("/api/study-plan/generate", {
    method: "POST",
    body: JSON.stringify({ selected_canvas_course_ids: selectedCanvasCourseIds }),
    headers: { "content-type": "application/json" },
  });
}

export async function setStudyPlanTaskDone(
  taskId: string,
  done: boolean,
): Promise<{ id: string; done: boolean }> {
  return apiFetch<{ id: string; done: boolean }>(
    `/api/study-plan/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ done }),
      headers: { "content-type": "application/json" },
    },
  );
}
