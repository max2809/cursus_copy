import { IconBook, IconClose } from "../../design/icons";
import { API_BASE_URL } from "../../api/client";
import type { Citation, CitationSourceKind } from "../../api/types";

interface Props {
  citation: Citation | null;
  onClose: () => void;
}

const KIND_LABELS: Record<CitationSourceKind, string> = {
  canvas: "Canvas file",
  canvas_page: "Canvas page",
  canvas_syllabus: "Syllabus",
  upload: "Upload",
  url: "Link",
  deadline: "Assignment",
};

function resolveUrl(url: string): string {
  // Absolute URL — use as-is.
  if (/^https?:\/\//i.test(url)) return url;
  // Relative path — prepend the API origin so our auth cookie is sent.
  return `${API_BASE_URL}${url}`;
}

export function CitationDrawer({ citation, onClose }: Props) {
  if (!citation) return null;
  const title = citation.source_name ?? citation.heading_path ?? `Source ${citation.marker}`;
  const kindLabel = citation.source_kind ? KIND_LABELS[citation.source_kind] : null;
  const page = citation.page_hint != null ? `p. ${citation.page_hint}` : null;
  const href = citation.source_url ? resolveUrl(citation.source_url) : null;
  return (
    <div className="cite-drawer-overlay" onClick={onClose}>
      <div className="cite-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="cite-drawer-head">
          <div className="cite-drawer-title">
            <IconBook /> Source
          </div>
          <button
            className="iconbtn"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            <IconClose />
          </button>
        </div>
        <div className="cite-drawer-chapter">{title}</div>
        {(kindLabel || citation.heading_path || page) && (
          <div className="cite-drawer-loc">
            {[kindLabel, citation.source_name ? citation.heading_path : null, page]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
        <blockquote className="cite-drawer-quote">"{citation.snippet}"</blockquote>
        <div className="cite-drawer-actions">
          {href ? (
            <a
              className="cite-drawer-btn primary"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconBook /> Open source
            </a>
          ) : (
            <button className="cite-drawer-btn" type="button" disabled>
              <IconBook /> Source unavailable
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
