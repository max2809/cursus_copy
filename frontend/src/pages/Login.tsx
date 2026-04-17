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
    setSent(true);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-6">
        <Logo />
      </header>
      <main className="flex-1 flex items-start md:items-center justify-center px-4">
        <div className="w-full max-w-md mt-8 md:mt-0">
          {sent ? (
            <div className="card-feature border-dashed text-center">
              <span className="label-caps text-matcha-600">Check your inbox</span>
              <h1 className="text-card mt-3 mb-2">Link sent</h1>
              <p className="text-warmcharcoal">
                If that email is on the invite list, a sign-in link is on its way.
                It expires in 15 minutes.
              </p>
            </div>
          ) : (
            <div className="card-feature">
              <span className="label-caps text-warmcharcoal">Sign in</span>
              <h1 className="text-card mt-3 mb-1">Hello, studious.</h1>
              <p className="text-warmcharcoal mb-6">
                Drop your EUR email. We'll send you a one-time login link.
              </p>
              <form onSubmit={submit} className="space-y-4">
                <label className="block">
                  <span className="label-caps text-warmcharcoal">Email</span>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-clay mt-1"
                    placeholder="you@eur.nl"
                  />
                </label>
                <button
                  type="submit"
                  disabled={mut.isPending}
                  className="btn-clay-primary w-full disabled:opacity-60"
                >
                  {mut.isPending ? "Sending..." : "Send magic link"}
                </button>
              </form>
            </div>
          )}
          <p className="text-center text-sm text-warmsilver mt-4 font-mono">
            Invite-only beta · Erasmus University Rotterdam
          </p>
        </div>
      </main>
    </div>
  );
}
