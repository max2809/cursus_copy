import type { MaterialItem } from "../../api/types";

interface Props {
  item: MaterialItem;
  onDelete?: () => void;
}

function statusColor(m: MaterialItem): string {
  if (m.index_error) return "bg-pomegranate-500";
  if (m.indexed_at) return "bg-matcha-500";
  return "bg-lemon-400";
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function MaterialRow({ item, onDelete }: Props) {
  const isCanvas = item.source === "canvas" || item.source === "canvas_page";
  return (
    <div className="flex items-center gap-3 border-b border-oat/30 py-2 text-sm">
      <span
        className={`inline-block w-2.5 h-2.5 rounded-pill ${statusColor(item)}`}
        title={item.index_error ?? (item.indexed_at ? "Indexed" : "Indexing")}
      />
      <span className="flex-1 truncate font-medium">{item.filename}</span>
      <span className="text-xs opacity-60 w-24">{fmtSize(item.size_bytes)}</span>
      <span
        className={
          "text-xs px-2 py-0.5 rounded-pill border border-black " +
          (isCanvas
            ? "bg-slushie-200"
            : item.source === "url"
            ? "bg-ube-200"
            : "bg-cream")
        }
      >
        {item.source}
      </span>
      {item.indexed_at && (
        <span className="text-xs opacity-60 w-28 truncate">
          {new Date(item.indexed_at).toLocaleString()}
        </span>
      )}
      {!isCanvas && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="w-7 h-7 rounded-pill border-2 border-black hover:bg-pomegranate-400"
          aria-label="Delete"
        >
          🗑
        </button>
      )}
    </div>
  );
}
