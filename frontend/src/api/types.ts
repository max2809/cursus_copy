export type DeadlineType = "assignment" | "quiz" | "exam" | "event" | "other";

export interface DeadlineCourse {
  id: string;
  name: string;
  code: string | null;
}

export interface Deadline {
  id: string;
  title: string;
  type: DeadlineType;
  due_at: string | null;
  url: string;
  points_possible: number | null;
  submitted: boolean | null;
}

export type BucketKey =
  | "overdue"
  | "today"
  | "this_week"
  | "next_two_weeks"
  | "later"
  | "no_due_date";

export interface CourseDeadlines {
  course: DeadlineCourse;
  buckets: Record<BucketKey, Deadline[]>;
  pending_count: number;
}

export interface DeadlinesResponse {
  courses: CourseDeadlines[];
  last_synced_at: string | null;
}
