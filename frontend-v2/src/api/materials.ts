import { apiFetch } from "./client";
import type { MaterialItem, MaterialsListResponse } from "./types";

export async function listMaterials(canvasCourseId: number): Promise<MaterialsListResponse> {
  return apiFetch<MaterialsListResponse>(`/api/courses/${canvasCourseId}/materials`);
}

export async function uploadMaterial(
  canvasCourseId: number,
  file: File,
): Promise<MaterialItem> {
  const fd = new FormData();
  fd.append("file", file);
  return apiFetch<MaterialItem>(`/api/courses/${canvasCourseId}/materials`, {
    method: "POST",
    body: fd,
  });
}

export async function addUrlMaterial(
  canvasCourseId: number,
  url: string,
): Promise<MaterialItem> {
  return apiFetch<MaterialItem>(`/api/courses/${canvasCourseId}/materials/url`, {
    method: "POST",
    body: JSON.stringify({ url }),
    headers: { "content-type": "application/json" },
  });
}

export async function deleteMaterial(
  canvasCourseId: number,
  fileId: string,
): Promise<void> {
  await apiFetch<void>(`/api/courses/${canvasCourseId}/materials/${fileId}`, {
    method: "DELETE",
    parseJson: false,
  });
}

export async function refreshMaterials(canvasCourseId: number): Promise<MaterialsListResponse> {
  return apiFetch<MaterialsListResponse>(`/api/courses/${canvasCourseId}/materials/refresh`, {
    method: "POST",
  });
}
