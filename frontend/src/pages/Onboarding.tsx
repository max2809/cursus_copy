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
    <div className="min-h-screen flex flex-col">
      <header className="p-6">
        <Logo />
      </header>
      <main className="flex-1 flex items-start justify-center px-4 pb-12">
        <div className="w-full max-w-xl">
          <div className="card-feature">
            <span className="label-caps text-ube-800">Step 2 of 2</span>
            <h1 className="text-card mt-3 mb-2">Connect Canvas</h1>
            <p className="text-warmcharcoal mb-6">
              We need a Personal Access Token to read your deadlines. It's stored
              encrypted and only used to talk to Canvas on your behalf.
            </p>

            <ol className="space-y-2 mb-6 text-sm text-warmcharcoal list-decimal list-inside">
              <li>
                Go to{" "}
                <a
                  href="https://canvas.eur.nl/profile/settings"
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono underline decoration-dotted"
                >
                  canvas.eur.nl/profile/settings
                </a>
              </li>
              <li>Scroll to <span className="font-medium">Approved Integrations</span></li>
              <li>Click <span className="font-medium">+ New Access Token</span></li>
              <li>Name it "Cursus" and leave the expiry empty</li>
              <li>Copy the token (you can only see it once) and paste it below</li>
            </ol>

            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="label-caps text-warmcharcoal">Canvas token</span>
                <input
                  type="password"
                  required
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  className="input-clay mt-1 font-mono text-sm"
                  placeholder="7289~..."
                />
              </label>
              {error && (
                <div className="rounded-card border border-pomegranate-400 bg-pomegranate-400/10 p-3 text-sm text-pomegranate-400">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={mut.isPending}
                className="btn-clay-primary w-full disabled:opacity-60"
              >
                {mut.isPending ? "Connecting and syncing…" : "Connect and sync"}
              </button>
            </form>
          </div>
          <div className="card-dashed mt-4 text-sm text-warmcharcoal">
            <span className="label-caps text-ube-800">Privacy</span>
            <p className="mt-2">
              Your token is encrypted with AES-256-GCM before it hits the database.
              No one else — not your friends, not us — can read it.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
