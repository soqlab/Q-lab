"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Microscope } from "lucide-react";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) setError("Missing or invalid reset link. Please request a new one.");
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/qlab-api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? "Reset failed");
      setDone(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark" style={{ width: 40, height: 40 }}>
            <Microscope size={20} aria-hidden="true" />
          </div>
          <span>Q-Lab</span>
        </div>
        <h1 className="auth-title">New password</h1>
        <p className="auth-sub">Choose a strong password for your account</p>

        {done ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>Password updated!</p>
            <p style={{ fontSize: 14, color: "var(--color-muted)", marginBottom: 20 }}>
              Redirecting you to sign in…
            </p>
            <Link href="/login" style={{ color: "#1d6f8f", fontWeight: 600, fontSize: 14 }}>
              Sign in now
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-label">New password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              autoComplete="new-password"
              placeholder="At least 8 characters"
              disabled={!token}
            />
            <label className="auth-label">Confirm password</label>
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              disabled={!token}
            />
            {error && <div className="auth-error">{error}</div>}
            <button
              className="button"
              type="submit"
              disabled={loading || !token}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {loading ? "Updating…" : "Set new password"}
            </button>
          </form>
        )}

        {!done && (
          <p className="auth-footer">
            <Link href="/forgot-password" style={{ color: "#1d6f8f" }}>
              Request a new link
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
