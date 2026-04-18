import { useState, type ChangeEvent } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onFile: (f: File) => Promise<void>;
  onUrl: (url: string) => Promise<void>;
}

export function AddMaterialModal({ open, onClose, onFile, onUrl }: Props) {
  const [tab, setTab] = useState<"file" | "url">("file");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submitFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      await onFile(f);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitUrl() {
    const v = url.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      await onUrl(v);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-feature border-2 border-black p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-medium text-lg mb-3">Add material</h3>
        <div className="flex gap-2 mb-4">
          {(["file", "url"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-3 py-1 rounded-pill border-2 border-black text-sm " +
                (tab === t ? "bg-black text-cream" : "bg-oat-light")
              }
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "file" ? (
          <div className="flex flex-col gap-3">
            <input
              type="file"
              accept=".pdf,.pptx,.docx,.txt,.md"
              onChange={submitFile}
              disabled={busy}
            />
            <p className="text-xs opacity-60">PDF / PPTX / DOCX / TXT / MD up to 50 MB.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="border-2 border-black rounded-pill px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={submitUrl}
              disabled={busy}
              className="rounded-pill bg-black text-cream px-4 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "Fetching…" : "Add link"}
            </button>
          </div>
        )}
        {error && <p className="text-sm text-pomegranate-500 mt-3">{error}</p>}
      </div>
    </div>
  );
}
