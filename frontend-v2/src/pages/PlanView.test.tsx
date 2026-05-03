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

describe("PlanView weekly checklist", () => {
  beforeEach(() => {
    mocks.studyPlanState = currentPayload();
    mocks.generateMutateAsync.mockReset();
    mocks.setTaskDoneMutate.mockReset();
  });

  it("auto-selects taking courses and generates with adjusted course selection", async () => {
    render(<PlanView courses={[]} />);

    expect(screen.getByRole("checkbox", { name: /Microeconomics/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Finance/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: /Finance/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate checklist/ }));

    await waitFor(() => {
      expect(mocks.generateMutateAsync).toHaveBeenCalledWith({
        selectedCanvasCourseIds: [202, 101],
      });
    });
  });

  it("puts selected and currently-taking courses before other courses", () => {
    mocks.studyPlanState = currentPayload({
      available_courses: [
        {
          id: "course-1",
          canvas_course_id: 101,
          name: "Accounting",
          code: "ACC101",
          status: "taking",
        },
        {
          id: "course-2",
          canvas_course_id: 202,
          name: "Biology",
          code: "BIO202",
          status: "taken",
        },
        {
          id: "course-3",
          canvas_course_id: 303,
          name: "Zoology",
          code: "ZOO303",
          status: "taken",
        },
      ],
      selected_canvas_course_ids: [303],
    });

    render(<PlanView courses={[]} />);

    const courseOptions = screen.getAllByRole("checkbox").map((option) =>
      option.getAttribute("aria-label"),
    );

    expect(courseOptions).toEqual([
      "Zoology (taken)",
      "Accounting (taking)",
      "Biology (taken)",
    ]);
  });

  it("renders per-course checklist tasks and toggles completion", () => {
    mocks.studyPlanState = currentPayload({
      plan: {
        id: "plan-1",
        week_start: "2026-05-03",
        week_end: "2026-05-09",
        generated_at: "2026-05-03T10:00:00Z",
        selected_canvas_course_ids: [101],
        pressure_points: [
          {
            id: "pressure-1",
            course_id: "course-1",
            canvas_course_id: 101,
            course_name: "Microeconomics",
            title: "Problem Set 1",
            type: "assignment",
            due_at: "2026-05-05T10:00:00+00:00",
            priority: "high",
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
            tasks: [
              {
                id: "task-competition",
                title: "Study Competition",
                detail: "Perfect competition, monopoly, and oligopoly.",
                priority: "recommended",
                reason: "Current course material indexed from Canvas.",
                done: false,
                source_refs: [
                  {
                    label: "Week 1 Competition Slides.pdf",
                    kind: "canvas",
                    url: "/api/courses/101/materials/file-1/download",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    render(<PlanView courses={[]} />);

    expect(screen.getByText("This Week's Pressure Points")).toBeInTheDocument();
    expect(screen.getByText("Problem Set 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Microeconomics" })).toBeInTheDocument();
    expect(screen.getByText("Study Competition")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Mark as done" }));

    expect(mocks.setTaskDoneMutate).toHaveBeenCalledWith({
      taskId: "task-competition",
      done: true,
    });
  });
});
