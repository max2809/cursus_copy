import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSubmitPat } from "../api/queries";
import { ApiError } from "../api/client";
import Logo from "../components/Logo";

function canvasSettingsUrl(value: string): string {
  const host = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .trim();
  return `https://${host || "canvas.eur.nl"}/profile/settings`;
}

function connectionErrorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    error.body &&
    typeof error.body === "object" &&
    "detail" in error.body
  ) {
    const detail = String((error.body as { detail: unknown }).detail);
    if (detail === "Invalid Canvas domain") {
      return "Enter the Canvas domain your university uses.";
    }
    if (detail === "Could not reach that Canvas domain") {
      return "Cursus could not reach that Canvas domain.";
    }
  }
  return "Canvas rejected that token. Double-check the domain and token.";
}

export default function Onboarding() {
  const [canvasBaseUrl, setCanvasBaseUrl] = useState("canvas.eur.nl");
  const [pat, setPat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const mut = useSubmitPat();
  const settingsUrl = canvasSettingsUrl(canvasBaseUrl);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await mut.mutateAsync({
        pat,
        canvas_base_url: canvasBaseUrl,
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError(connectionErrorMessage(err));
    }
  };

  return (
    <div className="auth-page">
      <header>
        <Logo />
      </header>
      <main style={{ alignItems: "flex-start" }}>
        <div style={{ width: "100%", maxWidth: 560 }}>
          <div className="auth-card">
            <span className="auth-eyebrow">Step 2 of 2</span>
            <h1 className="auth-title">Connect Canvas.</h1>
            <p className="auth-sub">
              We need a Personal Access Token to read your deadlines. It's stored
              encrypted and only used to talk to Canvas on your behalf.
            </p>

            <ol className="auth-steps">
              <li>
                Go to{" "}
                <a
                  href={settingsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {settingsUrl.replace(/^https:\/\//, "")}
                </a>
              </li>
              <li>Scroll to <em>Approved Integrations</em></li>
              <li>Click <em>+ New Access Token</em></li>
              <li>Name it "Cursus" and leave the expiry empty</li>
              <li>Copy the token (you can only see it once) and paste it below</li>
            </ol>

            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label>
                <span className="auth-label">Canvas URL or domain</span>
                <input
                  type="text"
                  required
                  value={canvasBaseUrl}
                  onChange={(e) => setCanvasBaseUrl(e.target.value)}
                  className="auth-input mono"
                  placeholder="canvas.your-university.edu"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </label>
              <label>
                <span className="auth-label">Canvas token</span>
                <input
                  type="password"
                  required
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  className="auth-input mono"
                  placeholder="7289~..."
                />
              </label>
              {error && <div className="auth-banner error">{error}</div>}
              <button type="submit" disabled={mut.isPending} className="auth-btn">
                {mut.isPending ? "Connecting and syncing…" : "Connect and sync"}
              </button>
            </form>
          </div>

          <div className="auth-card dashed" style={{ marginTop: "var(--pad-3)" }}>
            <span className="auth-eyebrow" style={{ color: "var(--accent)" }}>Privacy</span>
            <p style={{ margin: "6px 0 0", color: "var(--ink-2)", fontSize: 14, lineHeight: 1.6 }}>
              Your token is encrypted with AES-256-GCM before it hits the database.
              No one else — not your friends, not us — can read it.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
