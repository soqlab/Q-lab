"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Atom, Eye, EyeOff } from "lucide-react";
import { login } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

function LoginForm() {
  const { setSession } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next") || "/runs";
  // Only allow relative paths to prevent open-redirect attacks
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/runs";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [isOAuthAccount, setIsOAuthAccount] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    setIsOAuthAccount(false);
    setLoading(true);
    try {
      const resp = await login(email, password);
      setSession(resp.access_token, resp.user);
      router.push(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      if (msg === "email_not_verified") {
        setUnverified(true);
      } else if (msg === "oauth_account") {
        setIsOAuthAccount(true);
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
            {isOAuthAccount && (
              <div style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, padding: "12px 14px", fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
                This account was created with Google or GitHub — it has no password.<br />
                <span style={{ color: "var(--muted)" }}>Use one of the buttons below to sign in.</span>
              </div>
            )}
            <button className="button" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <p style={{ textAlign: "right", margin: "4px 0 0", fontSize: 13 }}>
              <Link href="/forgot-password" style={{ color: "#1d6f8f" }}>Forgot password?</Link>
            </p>
          </form>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 16px" }}>
          <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>or continue with</span>
          <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <a
            href="/qlab-api/auth/google"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              padding: "10px 16px", borderRadius: 8, border: "1px solid var(--line)",
              background: "var(--surface)", color: "var(--text)", textDecoration: "none",
              fontSize: 14, fontWeight: 500, cursor: "pointer",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </a>
          <a
            href="/qlab-api/auth/github"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              padding: "10px 16px", borderRadius: 8, border: "1px solid var(--line)",
              background: "var(--surface)", color: "var(--text)", textDecoration: "none",
              fontSize: 14, fontWeight: 500, cursor: "pointer",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Continue with GitHub
          </a>
        </div>

        <p className="auth-footer">
          No account?{" "}
          <Link href="/register" style={{ color: "#1d6f8f", fontWeight: 600 }}>Create one</Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
