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

export type MaterialSource = "canvas" | "upload" | "url";

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

export interface Citation {
  marker: number;
  chunk_id: string | null;
  file_id: string | null;
  deadline_id: string | null;
  page_hint: number | null;
  heading_path: string | null;
  snippet: string;
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
