import type { MutableRefObject } from "react";
import type { Citation } from "../../api/types";

interface Props {
  citations: Citation[];
  cardRefs: MutableRefObject<Map<number, HTMLDivElement | null>>;
}

export function SourcesPanel({ citations, cardRefs }: Props) {
  if (citations.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wider font-medium opacity-60">Sources</div>
      {citations.map((c) => (
        <div
          key={c.marker}
          ref={(el) => {
            cardRefs.current.set(c.marker, el);
          }}
          className="rounded-feature border-2 border-black bg-white p-3 text-sm transition"
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-pill bg-black text-cream text-xs items-center justify-center">
              {c.marker}
            </span>
            <span className="font-medium truncate">{c.heading_path ?? "source"}</span>
          </div>
          {c.page_hint != null && (
            <div className="text-xs mt-1 opacity-60">p.{c.page_hint}</div>
          )}
          <p className="mt-2 text-xs leading-snug opacity-80">{c.snippet}</p>
        </div>
      ))}
    </div>
  );
}
