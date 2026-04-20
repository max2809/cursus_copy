import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVerifyToken } from "../api/queries";
import Logo from "../components/Logo";

export default function AuthVerify() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mut = useVerifyToken();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get("token");
    if (!token) {
      setError("No token in the URL.");
      return;
    }
    mut
      .mutateAsync(token)
      .then((res) => navigate(res.next, { replace: true }))
      .catch(() =>
        setError("That link is invalid or expired. Request a new one from the sign-in page.")
      );
  }, [params, mut, navigate]);

  return (
    <div className="auth-page">
      <header>
        <Logo />
      </header>
      <main>
        <div className="auth-card narrow" style={{ textAlign: "center" }}>
          {error ? (
            <>
              <span className="auth-eyebrow" style={{ color: "oklch(50% 0.18 30)" }}>
                Verification failed
              </span>
              <h1 className="auth-title">Link didn't work.</h1>
              <p className="auth-sub">{error}</p>
              <a href="/login" className="auth-btn secondary" style={{ display: "inline-block", width: "auto", padding: "10px 16px", textDecoration: "none" }}>
                Back to sign-in
              </a>
            </>
          ) : (
            <>
              <span className="auth-eyebrow" style={{ color: "var(--accent)" }}>Hang tight</span>
              <h1 className="auth-title">Signing you in…</h1>
              <p className="auth-sub" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
                Verifying your link
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
