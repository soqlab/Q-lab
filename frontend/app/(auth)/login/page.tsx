"use client";

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Atom, KeyRound } from "lucide-react";
import type { AuthResponse } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import {
  addPasskey,
  conditionalUiAvailable,
  fetchPasskeyConfig,
  passkeyErrorMessage,
  passkeysSupported,
  passwordSignIn,
  signInWithPasskey,
} from "../../../lib/passkeys";

function LoginForm() {
  const { setSession } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next") || "/runs";
  // Only allow relative paths to prevent open-redirect attacks
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/runs";
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [passkeysOnly, setPasskeysOnly] = useState(true);
  // Existing password accounts: one last password sign-in, then they must add a passkey.
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enrolment, setEnrolment] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  // Rendered on the server as supported; the browser decides after hydration.
  const supported = useSyncExternalStore(() => () => {}, passkeysSupported, () => true);
  const conditional = useRef<AbortController | null>(null);

  function done(resp: AuthResponse) {
    setSession(resp.access_token, resp.user);
    router.push(next);
  }

  function handleError(err: unknown) {
    const msg = passkeyErrorMessage(err);
    if (msg === "email_not_verified") setUnverified(true);
    else setError(msg);
  }

  useEffect(() => {
    void fetchPasskeyConfig().then((c) => setPasskeysOnly(c.passkeys_only));
    if (!passkeysSupported()) return;
    // Conditional UI: the browser offers saved passkeys in the email field's autofill.
    let cancelled = false;
    void conditionalUiAvailable().then((available) => {
      if (!available || cancelled) return;
      const ctrl = new AbortController();
      conditional.current = ctrl;
      signInWithPasskey({ conditional: true, signal: ctrl.signal })
        .then(done)
        .catch((err) => {
          if (!ctrl.signal.aborted) handleError(err);
        });
    });
    return () => { cancelled = true; conditional.current?.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePasskey() {
    conditional.current?.abort();
    setError(null);
    setUnverified(false);
    setLoading(true);
    try {
      done(await signInWithPasskey());
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    conditional.current?.abort();
    setError(null);
    setUnverified(false);
    setLoading(true);
    try {
      const resp = await passwordSignIn(email, password);
      if (resp.kind === "session") done(resp);
      else setEnrolment(resp.enrolment_token);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnrol() {
    if (!enrolment) return;
    setError(null);
    setLoading(true);
    try {
      done(await addPasskey(enrolment));
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setResent(false);
    try {
      const res = await fetch("/qlab-api/auth/resend-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) setResent(true);
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
              Check your inbox and click the verification link before signing in.
            </p>
            {email && (resent ? (
              <p style={{ fontSize: 13, color: "#10b981", fontWeight: 600, marginBottom: 16 }}>Email resent — check your inbox ✓</p>
            ) : (
              <button className="button" onClick={handleResend} disabled={resending} style={{ width: "100%", justifyContent: "center", marginBottom: 12 }}>
                {resending ? "Sending…" : "Resend verification email"}
              </button>
            ))}
            <button onClick={() => { setUnverified(false); setError(null); }} style={{ background: "none", border: "none", color: "#1d6f8f", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
              Try a different account
            </button>
          </div>
        ) : enrolment ? (
          <div className="auth-form">
            <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6, margin: 0 }}>
              <strong>One more step.</strong> Q-Lab now signs in with passkeys instead of passwords.
              Create a passkey on this device to finish signing in. Your password is then deleted.
            </p>
            {error && <div className="auth-error">{error}</div>}
            <button className="button" type="button" onClick={handleEnrol} disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
              <KeyRound size={16} aria-hidden="true" /> {loading ? "Waiting for your passkey…" : "Create a passkey"}
            </button>
          </div>
        ) : (
          <div className="auth-form">
            {/* Lets the browser offer saved passkeys as autofill (conditional UI). */}
            <input
              className="input"
              type="email"
              name="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username webauthn"
              placeholder="Email (your passkey can fill this in)"
              aria-label="Email"
            />
            {!showPassword && (
              <button className="button" type="button" onClick={handlePasskey} disabled={loading || !supported} style={{ width: "100%", justifyContent: "center" }}>
                <KeyRound size={16} aria-hidden="true" /> {loading ? "Waiting for your passkey…" : "Sign in with passkey"}
              </button>
            )}
            {!supported && (
              <div className="auth-error">This browser can&apos;t use passkeys here. Passkeys need a current browser and an https address.</div>
            )}
            {showPassword && (
              <form onSubmit={handlePassword} className="auth-form" style={{ margin: 0 }}>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="Password" aria-label="Password" />
                <button className="button" type="submit" disabled={loading || !email} style={{ width: "100%", justifyContent: "center" }}>
                  {loading ? "Signing in…" : passkeysOnly ? "Continue to add a passkey" : "Sign in"}
                </button>
              </form>
            )}
            {error && <div className="auth-error">{error}</div>}
            <p style={{ display: "flex", justifyContent: "space-between", gap: 12, margin: "4px 0 0", fontSize: 13 }}>
              <button type="button" onClick={() => { setShowPassword((v) => !v); setError(null); }} style={{ background: "none", border: "none", padding: 0, color: "#1d6f8f", cursor: "pointer", fontSize: 13 }}>
                {showPassword ? "Use a passkey instead" : passkeysOnly ? "Signed up with a password?" : "Use a password"}
              </button>
              <Link href="/forgot-password" style={{ color: "#1d6f8f" }}>{passkeysOnly ? "Lost your passkey?" : "Forgot password?"}</Link>
            </p>
          </div>
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
