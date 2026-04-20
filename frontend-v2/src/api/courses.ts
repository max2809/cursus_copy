import { apiFetch } from "./client";
import type { CourseStatus, CourseSummary } from "./types";

export async function listCourses(): Promise<CourseSummary[]> {
  return apiFetch<CourseSummary[]>("/api/courses");
}

export async function updateCourseStatus(
  canvasCourseId: number,
  status: CourseStatus,
): Promise<CourseSummary> {
  return apiFetch<CourseSummary>(`/api/courses/${canvasCourseId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
    headers: { "content-type": "application/json" },
  });
}
