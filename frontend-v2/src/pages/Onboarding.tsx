import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSubmitPat } from "../api/queries";
import Logo from "../components/Logo";

export default function Onboarding() {
  const [pat, setPat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const mut = useSubmitPat();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await mut.mutateAsync(pat);
      navigate("/", { replace: true });
    } catch {
      setError("Canvas rejected that token. Double-check you copied all of it.");
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
                  href="https://canvas.eur.nl/profile/settings"
                  target="_blank"
                  rel="noreferrer"
                >
                  canvas.eur.nl/profile/settings
                </a>
              </li>
              <li>Scroll to <em>Approved Integrations</em></li>
              <li>Click <em>+ New Access Token</em></li>
              <li>Name it "Cursus" and leave the expiry empty</li>
              <li>Copy the token (you can only see it once) and paste it below</li>
            </ol>

            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
