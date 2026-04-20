import { useState } from "react";
import { useRequestMagicLink } from "../api/queries";
import Logo from "../components/Logo";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const mut = useRequestMagicLink();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await mut.mutateAsync(email);
    try { localStorage.setItem("cursus_email", email); } catch { /* ignore */ }
    setSent(true);
  };

  return (
    <div className="auth-page">
      <header>
        <Logo />
      </header>
      <main>
        <div style={{ width: "100%", maxWidth: 420 }}>
          {sent ? (
            <div className="auth-card narrow dashed" style={{ textAlign: "center" }}>
              <span className="auth-eyebrow" style={{ color: "var(--accent)" }}>
                Check your inbox
              </span>
              <h1 className="auth-title">Link sent.</h1>
              <p className="auth-sub" style={{ margin: 0 }}>
                If that email is on the invite list, a sign-in link is on its way.
                It expires in 15 minutes.
              </p>
            </div>
          ) : (
            <div className="auth-card narrow">
              <span className="auth-eyebrow">Sign in</span>
              <h1 className="auth-title">Hello, studious.</h1>
              <p className="auth-sub">
                Drop your EUR email. We'll send you a one-time login link.
              </p>
              <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <label>
                  <span className="auth-label">Email</span>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="auth-input"
                    placeholder="you@eur.nl"
                  />
                </label>
                <button type="submit" disabled={mut.isPending} className="auth-btn">
                  {mut.isPending ? "Sending…" : "Send magic link"}
                </button>
              </form>
            </div>
          )}
          <p className="auth-footer">Invite-only beta · Erasmus University Rotterdam</p>
        </div>
      </main>
    </div>
  );
}
