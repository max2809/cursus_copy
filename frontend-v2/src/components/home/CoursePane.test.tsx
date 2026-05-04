import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseDeadlines, Deadline, MaterialItem } from "../../api/types";
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

function deadline(index: number, title = `Assignment ${index}`): Deadline {
  return {
    id: `deadline-${index}`,
    title,
    type: "assignment",
    due_at: `2026-05-${String(index + 10).padStart(2, "0")}T21:59:00Z`,
    url: `https://canvas.example/courses/42/assignments/${index}`,
    points_possible: 100,
    submitted: false,
  };
}

function undatedDeadline(title = "Assignment without parsed due date"): Deadline {
  return {
    ...deadline(99, title),
    due_at: null,
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

  it("can expand the upcoming list when more than six deadlines exist", async () => {
    listMaterials.mockResolvedValue({ materials: [] });
    const courseWithManyDeadlines: CourseDeadlines = {
      ...course,
      pending_count: 7,
      buckets: {
        ...course.buckets,
        later: [
          deadline(1),
          deadline(2),
          deadline(3),
          deadline(4),
          deadline(5),
          deadline(6),
          deadline(7, "Assignment"),
        ],
      },
    };

    render(<CoursePane course={courseWithManyDeadlines} />);
    await flushPromises();

    expect(screen.queryByText("Assignment")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show all 7 upcoming/ }));

    expect(screen.getByText("Assignment")).toBeInTheDocument();
  });

  it("shows pending deadlines even when Canvas has no parsed due date", async () => {
    listMaterials.mockResolvedValue({ materials: [] });
    const courseWithUndatedDeadline: CourseDeadlines = {
      ...course,
      pending_count: 1,
      buckets: {
        ...course.buckets,
        no_due_date: [undatedDeadline()],
      },
    };

    render(<CoursePane course={courseWithUndatedDeadline} />);
    await flushPromises();

    expect(screen.queryByText("Nothing pending.")).not.toBeInTheDocument();
    expect(screen.getByText("Assignment without parsed due date")).toBeInTheDocument();
    expect(screen.getByText("no due date")).toBeInTheDocument();
  });
});
