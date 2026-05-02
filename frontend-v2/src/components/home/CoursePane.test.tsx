import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseDeadlines, MaterialItem } from "../../api/types";
import { CoursePane } from "./CoursePane";

const listMaterials = vi.fn();

vi.mock("../../api/materials", () => ({
  listMaterials: (...args: unknown[]) => listMaterials(...args),
  deleteMaterial: vi.fn(),
  refreshMaterials: vi.fn(),
  addUrlMaterial: vi.fn(),
  uploadMaterial: vi.fn(),
}));

vi.mock("../../api/queries", () => ({
  useSetDeadlineSubmission: () => ({ mutate: vi.fn() }),
}));

function material(overrides: Partial<MaterialItem>): MaterialItem {
  return {
    id: "file-1",
    filename: "slides.pdf",
    source: "canvas",
    source_url: null,
    size_bytes: 1024,
    content_type: "application/pdf",
    indexed_at: null,
    index_error: null,
    updated_at: "2026-05-02T10:00:00Z",
    ...overrides,
  };
}

const course: CourseDeadlines = {
  course: {
    id: "course-1",
    canvas_course_id: 42,
    name: "Algorithms",
    code: "ALG101",
    status: "taking",
  },
  buckets: {
    overdue: [],
    today: [],
    this_week: [],
    next_two_weeks: [],
    later: [],
    no_due_date: [],
  },
  pending_count: 0,
};

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("CoursePane material polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listMaterials.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops polling when a same-length material list finishes indexing", async () => {
    listMaterials
      .mockResolvedValueOnce({ materials: [material({ indexed_at: null })] })
      .mockResolvedValueOnce({
        materials: [material({ indexed_at: "2026-05-02T10:01:00Z" })],
      })
      .mockResolvedValue({ materials: [material({ indexed_at: "2026-05-02T10:01:00Z" })] });

    render(<CoursePane course={course} />);

    await flushPromises();
    expect(listMaterials).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await flushPromises();
    expect(listMaterials).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await flushPromises();

    expect(listMaterials).toHaveBeenCalledTimes(2);
  });
});
