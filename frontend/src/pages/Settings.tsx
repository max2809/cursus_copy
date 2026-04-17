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
    setError(null); setOk(false);
    try {
      await submitPat.mutateAsync(pat);
      setPat(""); setOk(true);
    } catch {
      setError("Canvas rejected that token.");
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-oat sticky top-0 z-10 bg-cream/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo />
          <Link to="/" className="btn-clay-ghost">← Dashboard</Link>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-6 py-10 space-y-6">
        <div>
          <span className="label-caps text-warmcharcoal">Account</span>
          <h1 className="text-card mt-2">Settings</h1>
        </div>

        <section className="card-feature">
          <span className="label-caps text-ube-800">Canvas token</span>
          <h2 className="text-feature mt-2 mb-1">Replace your PAT</h2>
          <p className="text-warmcharcoal text-sm mb-4">
            Use this if Canvas invalidated your token or you regenerated it.
            Your old token is overwritten after a successful sync.
          </p>
          <form onSubmit={updatePat} className="space-y-3">
            <input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              className="input-clay font-mono text-sm"
              placeholder="7289~..."
              required
            />
            {error && (
              <div className="text-sm text-pomegranate-400">{error}</div>
            )}
            {ok && (
              <div className="text-sm text-matcha-600 font-mono">Saved and synced.</div>
            )}
            <button
              type="submit"
              disabled={submitPat.isPending}
              className="btn-clay-primary disabled:opacity-60"
            >
              {submitPat.isPending ? "Saving…" : "Update token"}
            </button>
          </form>
        </section>

        <section className="card-dashed">
          <span className="label-caps text-warmcharcoal">Session</span>
          <h2 className="text-feature mt-2 mb-3">Sign out</h2>
          <button
            onClick={async () => {
              await logout.mutateAsync();
              navigate("/login", { replace: true });
            }}
            className="btn-clay"
          >
            Sign out of Study Buddy
          </button>
        </section>
      </main>
    </div>
  );
}
