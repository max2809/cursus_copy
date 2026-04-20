import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useLogout, useSubmitPat } from "../api/queries";
import Logo from "../components/Logo";

export default function Settings() {
  const logout = useLogout();
  const submitPat = useSubmitPat();
  const navigate = useNavigate();
  const [pat, setPat] = useState("");
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updatePat = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(false);
    try {
      await submitPat.mutateAsync(pat);
      setPat("");
      setOk(true);
    } catch {
      setError("Canvas rejected that token.");
    }
  };

  return (
    <div className="auth-page">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Logo />
        <Link
          to="/"
          style={{
            color: "var(--ink-2)",
            fontSize: 13,
            textDecoration: "none",
            padding: "6px 12px",
            borderRadius: "var(--r-pill)",
            border: "1px solid var(--hair)",
          }}
        >
          ← Back to home
        </Link>
      </header>
      <main style={{ alignItems: "flex-start" }}>
        <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: "var(--pad-4)" }}>
          <div>
            <span className="auth-eyebrow">Account</span>
            <h1 className="auth-title">Settings.</h1>
          </div>

          <section className="auth-card">
            <span className="auth-eyebrow" style={{ color: "var(--accent)" }}>Canvas token</span>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: "6px 0 6px" }}>Replace your PAT</h2>
            <p style={{ color: "var(--ink-2)", fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
              Use this if Canvas invalidated your token or you regenerated it.
              Your old token is overwritten after a successful sync.
            </p>
            <form onSubmit={updatePat} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                className="auth-input mono"
                placeholder="7289~..."
                required
              />
              {error && <div className="auth-banner error">{error}</div>}
              {ok && <div className="auth-banner">Saved and synced.</div>}
              <button type="submit" disabled={submitPat.isPending} className="auth-btn">
                {submitPat.isPending ? "Saving…" : "Update token"}
              </button>
            </form>
          </section>

          <section className="auth-card dashed">
            <span className="auth-eyebrow">Session</span>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: "6px 0 12px" }}>Sign out</h2>
            <button
              onClick={async () => {
                try { localStorage.removeItem("cursus_email"); } catch { /* ignore */ }
                await logout.mutateAsync();
                navigate("/login", { replace: true });
              }}
              className="auth-btn secondary"
              type="button"
            >
              Sign out of Cursus
            </button>
          </section>
        </div>
      </main>
    </div>
  );
}
