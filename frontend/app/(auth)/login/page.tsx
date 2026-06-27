"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Atom, Eye, EyeOff } from "lucide-react";
import { login } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

export default function LoginPage() {
  const { setSession } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    setLoading(true);
    try {
      const resp = await login(email, password);
      setSession(resp.access_token, resp.user);
      router.push("/runs");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      if (msg === "email_not_verified") {
        setUnverified(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setResent(false);
    try {
      await fetch("/qlab-api/auth/resend-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResent(true);
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark" style={{ width: 40, height: 40 }}>
            <Atom size={20} aria-hidden="true" />
          </div>
          <div>
            <span>Q-Lab</span>
            <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 1 }}>State of Quantum</div>
          </div>
        </div>
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-sub">State of Quantum</p>

        {unverified ? (
          <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✉️</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
              Please verify your email first
            </p>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 20 }}>
              Check your inbox for <strong>{email}</strong> and click the verification link before signing in.
            </p>
            {resent ? (
              <p style={{ fontSize: 13, color: "#10b981", fontWeight: 600, marginBottom: 16 }}>Email resent — check your inbox ✓</p>
            ) : (
              <button className="button" onClick={handleResend} disabled={resending} style={{ width: "100%", justifyContent: "center", marginBottom: 12 }}>
                {resending ? "Sending…" : "Resend verification email"}
              </button>
            )}
            <button onClick={() => { setUnverified(false); setError(null); }} style={{ background: "none", border: "none", color: "#1d6f8f", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
              Try a different account
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" />
            <label className="auth-label">Password</label>
            <div style={{ position: "relative" }}>
              <input className="input" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" style={{ width: "100%", paddingRight: 40, boxSizing: "border-box" }} />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0, display: "flex" }}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="button" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <p style={{ textAlign: "right", margin: "4px 0 0", fontSize: 13 }}>
              <Link href="/forgot-password" style={{ color: "#1d6f8f" }}>Forgot password?</Link>
            </p>
          </form>
        )}

        <p className="auth-footer">
          No account?{" "}
          <Link href="/register" style={{ color: "#1d6f8f", fontWeight: 600 }}>Create one</Link>
        </p>
      </div>
    </main>
  );
}
