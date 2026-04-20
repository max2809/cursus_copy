// Shared helpers for displaying a course consistently across the app.
// Every surface that renders a course (sidebar, home, plan, library, chat
// header) should pull from here so a course reads the same everywhere:
// same three-letter badge, same colour.

const COURSE_COLORS = [
  "oklch(72% 0.14 285)",
  "oklch(70% 0.14 30)",
  "oklch(68% 0.13 195)",
  "oklch(70% 0.12 150)",
  "oklch(72% 0.13 60)",
  "oklch(68% 0.13 340)",
];

/**
 * Deterministic colour per course id, so the same course gets the same
 * swatch on every page regardless of sort order. Accepts either the UUID
 * string or the Canvas integer id.
 */
export function courseColor(id: string | number): string {
  const s = String(id);
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return COURSE_COLORS[Math.abs(hash) % COURSE_COLORS.length];
}

const STOPWORDS = new Set([
  "of",
  "the",
  "and",
  "&",
  "in",
  "on",
  "to",
  "for",
  "a",
  "an",
  "with",
  "at",
]);

/**
 * Three-letter uppercase abbreviation built from the first letter of each
 * significant word. Falls back to the first three alpha characters of the
 * raw name if there aren't enough words (or not enough letters).
 *   "Economics of Conflict"        → "EC" → padded via fallback → "ECO"
 *   "Neuroscience: Cognition, Gen" → "NCG"
 *   "Capstone Thesis"              → "CT" → padded to "CAP" via fallback
 */
export function courseBadge(name: string | null | undefined): string {
  const raw = (name || "").trim();
  if (!raw) return "?";
  const words = raw
    .split(/[\s:\-,/()]+/)
    .map((w) => w.trim())
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
  if (words.length >= 3) {
    return words
      .slice(0, 3)
      .map((w) => w[0].toUpperCase())
      .join("");
  }
  // Fallback: first 3 alpha characters of the raw string.
  return (raw.replace(/[^A-Za-z]/g, "").slice(0, 3) || raw.slice(0, 3)).toUpperCase();
}

/**
 * Strip the common 2-4-letter institutional prefix on Canvas course codes
 * (EUC-, EUR-, RSM-, …) so the subject portion stands alone and fits in
 * narrow columns.
 */
export function shortCourseCode(code: string | null | undefined): string {
  if (!code) return "";
  return code.replace(/^[A-Z]{2,4}-\s*/, "");
}
