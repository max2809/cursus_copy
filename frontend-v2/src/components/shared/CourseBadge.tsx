import { courseBadge, courseColor } from "../../lib/course";

interface Props {
  /** Course name used to compute the three-letter abbreviation. */
  name: string;
  /** Stable identifier used for colour (Course.id UUID or canvas_course_id). */
  colorSeed: string | number;
  /**
   * Square side length. Height is 90% of this to match the slightly-rectangular
   * swatch used on plan rows. Pass a larger value for hero placements
   * (home-page course header) and small for inline spots.
   */
  size?: number;
  /** Override font size; defaults to size/3. */
  fontSize?: number;
  /** Border radius; defaults to size/5, capped at 10. */
  radius?: number;
  className?: string;
}

/**
 * One visual source of truth for how a course is rendered across the app.
 * Sidebar, home-page course header, plan-row date column, chat header — they
 * all pull from here so the same course reads the same way everywhere.
 */
export function CourseBadge({
  name,
  colorSeed,
  size = 36,
  fontSize,
  radius,
  className,
}: Props) {
  const fs = fontSize ?? Math.round(size / 2.8);
  const r = radius ?? Math.min(10, Math.round(size / 5));
  return (
    <div
      className={className}
      style={{
        width: size,
        height: Math.round(size * 0.92),
        background: courseColor(colorSeed),
        color: "var(--accent-ink)",
        borderRadius: r,
        display: "grid",
        placeItems: "center",
        fontSize: fs,
        fontWeight: 700,
        fontFamily: "var(--font-sans)",
        fontStyle: "normal",
        letterSpacing: "0.04em",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {courseBadge(name)}
    </div>
  );
}
