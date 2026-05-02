import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAccount, useLogout, useSubmitPat } from "../api/queries";
import Logo from "../components/Logo";

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
  return "Canvas rejected that token.";
}

export default function Settings() {
  const account = useAccount();
  const logout = useLogout();
  const submitPat = useSubmitPat();
  const navigate = useNavigate();
  const [canvasBaseUrl, setCanvasBaseUrl] = useState("canvas.eur.nl");
  const [canvasBaseUrlEdited, setCanvasBaseUrlEdited] = useState(false);
  const [pat, setPat] = useState("");
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (account.data?.canvas_base_url && !canvasBaseUrlEdited) {
      setCanvasBaseUrl(account.data.canvas_base_url);
    }
  }, [account.data?.canvas_base_url, canvasBaseUrlEdited]);

  const updatePat = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(false);
    try {
      await submitPat.mutateAsync({
        pat,
        canvas_base_url: canvasBaseUrl,
      });
      setPat("");
      setOk(true);
    } catch (err) {
      setError(connectionErrorMessage(err));
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
              Use this if Canvas invalidated your token, you regenerated it, or
              you need to switch to another university Canvas domain. Future
              syncs use the domain saved here.
            </p>
            <form onSubmit={updatePat} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label>
                <span className="auth-label">Canvas URL or domain</span>
                <input
                  type="text"
                  value={canvasBaseUrl}
                  onChange={(e) => {
                    setCanvasBaseUrlEdited(true);
                    setCanvasBaseUrl(e.target.value);
                  }}
                  className="auth-input mono"
                  placeholder="canvas.your-university.edu"
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                />
              </label>
              <label>
                <span className="auth-label">Canvas token</span>
                <input
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  className="auth-input mono"
                  placeholder="7289~..."
                  required
                />
              </label>
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
