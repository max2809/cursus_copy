import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVerifyToken } from "../api/queries";

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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card-feature max-w-md w-full text-center">
        {error ? (
          <>
            <span className="label-caps text-pomegranate-400">Verification failed</span>
            <h1 className="text-card mt-3 mb-2">Link didn't work</h1>
            <p className="text-warmcharcoal">{error}</p>
            <a href="/login" className="btn-clay inline-block mt-6">
              Back to sign-in
            </a>
          </>
        ) : (
          <>
            <span className="label-caps text-matcha-600">Hang tight</span>
            <h1 className="text-card mt-3 mb-2">Signing you in…</h1>
            <p className="text-warmcharcoal font-mono text-sm">Verifying your link</p>
          </>
        )}
      </div>
    </div>
  );
}
