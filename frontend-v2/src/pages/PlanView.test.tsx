import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanView } from "./PlanView";

const mocks = vi.hoisted(() => ({
  studyPlanState: null as any,
  generateMutateAsync: vi.fn(),
  setTaskDoneMutate: vi.fn(),
}));

vi.mock("../api/queries", () => ({
  useStudyPlan: () => ({
    data: mocks.studyPlanState,
    isLoading: false,
    error: null,
  }),
  useGenerateStudyPlan: () => ({
    mutateAsync: mocks.generateMutateAsync,
    isPending: false,
  }),
  useSetStudyPlanTaskDone: () => ({
    mutate: mocks.setTaskDoneMutate,
  }),
  useSetDeadlineSubmission: () => ({
    mutate: vi.fn(),
  }),
}));

function currentPayload(overrides: Record<string, unknown> = {}) {
  return {
    available_courses: [
      {
        id: "course-1",
        canvas_course_id: 101,
        name: "Microeconomics",
        code: "MIC101",
        status: "taking",
      },
      {
        id: "course-2",
        canvas_course_id: 202,
        name: "Finance",
        code: "FIN202",
        status: "taken",
      },
    ],
    selected_canvas_course_ids: [101],
    plan: null,
    ...overrides,
  };
}

function task(
  id: string,
  title: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    title,
    detail: `${title} detail.`,
    priority: "recommended",
    reason: "Current course material indexed from Canvas.",
    done: false,
    source_refs: [],
    ...overrides,
  };
}

function generatedPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    week_start: "2026-05-03",
    week_end: "2026-05-09",
    generated_at: "2026-05-03T10:00:00Z",
    selected_canvas_course_ids: [101, 202],
    pressure_points: [
      {
        id: "pressure-1",
        course_id: "course-1",
        canvas_course_id: 101,
        course_name: "Microeconomics",
        title: "Micro Problem Set",
        type: "assignment",
        due_at: "2026-05-05T10:00:00+00:00",
        priority: "high",
        reason: "Deadline falls inside this weekly checklist window.",
      },
      {
        id: "pressure-2",
        course_id: "course-2",
        canvas_course_id: 202,
        course_name: "Finance",
        title: "Finance Memo",
        type: "assignment",
        due_at: "2026-05-06T10:00:00+00:00",
        priority: "medium",
        reason: "Deadline falls inside this weekly checklist window.",
      },
    ],
    courses: [
      {
        id: "course-1",
        canvas_course_id: 101,
        name: "Microeconomics",
        code: "MIC101",
        status: "taking",
        confidence: "high",
        tasks: [task("task-micro", "Study Micro Topic")],
      },
      {
        id: "course-2",
        canvas_course_id: 202,
        name: "Finance",
        code: "FIN202",
        status: "taken",
        confidence: "medium",
        tasks: [task("task-finance", "Study Finance Topic")],
      },
    ],
    ...overrides,
  };
}

describe("PlanView weekly learning path", () => {
  beforeEach(() => {
    mocks.studyPlanState = currentPayload();
    mocks.generateMutateAsync.mockReset();
    mocks.setTaskDoneMutate.mockReset();
  });

  it("keeps course selection behind edit courses and updates the path from the panel", async () => {
    render(<PlanView courses={[]} />);

    expect(screen.getByRole("heading", { name: "Weekly learning path" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Microeconomics/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Finance/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit courses" }));

    expect(screen.getByRole("checkbox", { name: /Microeconomics/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Finance/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: /Finance/ }));
    fireEvent.click(screen.getByRole("button", { name: "Update path" }));

    await waitFor(() => {
      expect(mocks.generateMutateAsync).toHaveBeenCalledWith({
        selectedCanvasCourseIds: [202, 101],
      });
    });
  });

  it("renders generated courses as one unified weekly path without tabs", () => {
    mocks.studyPlanState = currentPayload({
      selected_canvas_course_ids: [101, 202],
      plan: generatedPlan(),
    });

    render(<PlanView courses={[]} />);

    expect(screen.getByRole("heading", { name: "Weekly learning path" })).toBeInTheDocument();
    expect(screen.getByText("2 courses - 2 steps - 2 deadlines")).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Study plan courses" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Microeconomics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Finance" })).toBeInTheDocument();
    expect(screen.getByText("Study Micro Topic")).toBeInTheDocument();
    expect(screen.getByText("Study Finance Topic")).toBeInTheDocument();
    expect(screen.getByText("Micro Problem Set")).toBeInTheDocument();
    expect(screen.getByText("Finance Memo")).toBeInTheDocument();
  });

  it("keeps course details compact until the course is expanded", () => {
    mocks.studyPlanState = currentPayload({
      selected_canvas_course_ids: [101],
      plan: generatedPlan({
        selected_canvas_course_ids: [101],
        pressure_points: [],
        courses: [
          {
            id: "course-1",
            canvas_course_id: 101,
            name: "Microeconomics",
            code: "MIC101",
            status: "taking",
            confidence: "high",
            tasks: [
              task("task-1", "Study Topic 1", {
                source_refs: [{ label: "Week 1 Slides.pdf", kind: "canvas", url: "/api/x" }],
              }),
              task("task-2", "Study Topic 2"),
              task("task-3", "Study Topic 3"),
            ],
          },
        ],
      }),
    });

    render(<PlanView courses={[]} />);

    expect(screen.getByText("Study Topic 1")).toBeInTheDocument();
    expect(screen.getByText("Study Topic 2")).toBeInTheDocument();
    expect(screen.queryByText("Study Topic 3")).not.toBeInTheDocument();
    expect(screen.queryByText("Week 1 Slides.pdf")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Microeconomics" }));

    expect(screen.getByText("Study Topic 3")).toBeInTheDocument();
    expect(screen.getByText("Week 1 Slides.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Microeconomics" }));

    expect(screen.queryByText("Study Topic 3")).not.toBeInTheDocument();
  });

  it("toggles task completion from the unified path", () => {
    mocks.studyPlanState = currentPayload({
      selected_canvas_course_ids: [101],
      plan: generatedPlan({
        selected_canvas_course_ids: [101],
        pressure_points: [],
        courses: [
          {
            id: "course-1",
            canvas_course_id: 101,
            name: "Microeconomics",
            code: "MIC101",
            status: "taking",
            confidence: "high",
            tasks: [task("task-micro", "Study Micro Topic")],
          },
        ],
      }),
    });

    render(<PlanView courses={[]} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Mark as done" }));

    expect(mocks.setTaskDoneMutate).toHaveBeenCalledWith({
      taskId: "task-micro",
      done: true,
    });
  });
});
