import { IconBook, IconCards, IconClose } from "../../design/icons";
import type { Citation } from "../../api/types";

interface Props {
  citation: Citation | null;
  onClose: () => void;
}

export function CitationDrawer({ citation, onClose }: Props) {
  if (!citation) return null;
  const src = citation.heading_path ?? `Source ${citation.marker}`;
  const page = citation.page_hint != null ? `p. ${citation.page_hint}` : null;
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
        <div className="cite-drawer-chapter">{src}</div>
        {page && <div className="cite-drawer-loc">{page}</div>}
        <blockquote className="cite-drawer-quote">"{citation.snippet}"</blockquote>
        <div className="cite-drawer-actions">
          <button className="cite-drawer-btn" type="button" disabled>
            <IconCards /> Save to notes
          </button>
        </div>
      </div>
    </div>
  );
}
