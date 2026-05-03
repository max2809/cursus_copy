export type DeadlineType = "assignment" | "quiz" | "exam" | "event" | "other";

export type CourseStatus = "taking" | "taken" | "hidden";

export interface DeadlineCourse {
  id: string;
  canvas_course_id: number;
  name: string;
  code: string | null;
  status?: CourseStatus;
}

export interface CourseSummary {
  id: string;
  canvas_course_id: number;
  name: string;
  code: string | null;
  status: CourseStatus;
}

export interface Deadline {
  id: string;
  title: string;
  type: DeadlineType;
  due_at: string | null;
  url: string;
  points_possible: number | null;
  submitted: boolean | null;
  manually_submitted?: boolean;
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
  syncing?: boolean;
}

export type MaterialSource =
  | "canvas"
  | "canvas_page"
  | "canvas_syllabus"
  | "upload"
  | "url";

export interface MaterialItem {
  id: string;
  filename: string;
  source: MaterialSource;
  source_url: string | null;
  size_bytes: number | null;
  content_type: string | null;
  indexed_at: string | null;
  index_error: string | null;
  updated_at: string | null;
}

export interface MaterialsListResponse {
  materials: MaterialItem[];
}

export type CitationSourceKind =
  | "canvas"
  | "canvas_page"
  | "canvas_syllabus"
  | "upload"
  | "url"
  | "deadline";

export interface Citation {
  marker: number;
  chunk_id: string | null;
  file_id: string | null;
  deadline_id: string | null;
  page_hint: number | null;
  heading_path: string | null;
  snippet: string;
  source_name?: string | null;
  source_kind?: CitationSourceKind | null;
  source_url?: string | null;
}

export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations_json: Citation[] | null;
  error: boolean;
  created_at: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface SessionDetail extends SessionSummary {
  messages: ChatMessageItem[];
}

export interface SessionListResponse {
  sessions: SessionSummary[];
}

export type StudyPlanPriority = "high" | "medium" | "recommended" | "low";

export interface StudyPlanSourceRef {
  label: string;
  kind: string;
  url: string | null;
}

export interface StudyPlanTask {
  id: string;
  title: string;
  detail: string;
  priority: StudyPlanPriority;
  reason: string;
  source_refs: StudyPlanSourceRef[];
  done: boolean;
}

export interface StudyPlanCourse extends CourseSummary {
  confidence: "high" | "medium" | "low";
  tasks: StudyPlanTask[];
}

export interface StudyPlanPressurePoint {
  id: string;
  course_id: string;
  canvas_course_id: number;
  course_name: string;
  title: string;
  type: DeadlineType;
  due_at: string | null;
  priority: StudyPlanPriority;
  reason: string;
}

export interface StudyPlanPayload {
  id: string;
  week_start: string;
  week_end: string;
  generated_at: string;
  selected_canvas_course_ids: number[];
  pressure_points: StudyPlanPressurePoint[];
  courses: StudyPlanCourse[];
}

export interface StudyPlanCurrentResponse {
  available_courses: CourseSummary[];
  selected_canvas_course_ids: number[];
  plan: StudyPlanPayload | null;
}
