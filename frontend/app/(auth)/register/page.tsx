"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Atom, Copy, CheckCircle2, KeyRound } from "lucide-react";
import { useAuth } from "../../../lib/auth";
import { passkeyErrorMessage, passkeysSupported, signUpWithPasskey } from "../../../lib/passkeys";

// New accounts get a passkey, never a password.
export default function RegisterPage() {
  const { setSession } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const supported = useSyncExternalStore(() => () => {}, passkeysSupported, () => true);

  function copyKey(key: string) {
    navigator.clipboard.writeText(key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resp = await signUpWithPasskey(email, name, org || undefined);
      if (resp.api_key) setApiKey(resp.api_key);
      if (resp.user.email_verified) {
        // No confirmation email to wait for (a server without mail): straight in.
        setSession(resp.access_token, resp.user);
        if (!resp.api_key) { router.push("/runs"); return; }
        setVerified(true);
      }
      setRegistered(true);
    } catch (err) {
      setError(passkeyErrorMessage(err));
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

  if (registered) {
    return (
      <main className="auth-shell">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div className="auth-brand" style={{ justifyContent: "center" }}>
            <div className="brand-mark" style={{ width: 40, height: 40 }}>
              <Atom size={20} aria-hidden="true" />
            </div>
            <div>
              <span>Q-Lab</span>
              <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 1 }}>State of Quantum</div>
            </div>
          </div>

          {verified ? (
            <h1 className="auth-title" style={{ marginTop: 24 }}>Your account is ready</h1>
          ) : (
            <>
              <div style={{ fontSize: 48, margin: "24px 0 16px" }}>✉️</div>
              <h1 className="auth-title">Check your inbox</h1>
              <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7, margin: "8px 0 16px" }}>
                We sent a verification link to<br />
                <strong style={{ color: "var(--text)" }}>{email}</strong>
              </p>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 20px" }}>
                Click the link in the email to verify your account, then sign in with your passkey.
              </p>
            </>
          )}

          {apiKey && (
            <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: 16, marginBottom: 20, textAlign: "left" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#10b981", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Your API key — save it now
              </p>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
                We created one for you automatically. It won&apos;t be shown again.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", borderRadius: 6, padding: "8px 12px", border: "1px solid var(--line)" }}>
                <code style={{ flex: 1, fontSize: 12, color: "var(--text)", wordBreak: "break-all" }}>{apiKey}</code>
                <button onClick={() => copyKey(apiKey)} style={{ background: "none", border: "none", cursor: "pointer", color: copied ? "#10b981" : "var(--muted)", padding: 0, display: "flex", alignItems: "center", gap: 4, fontSize: 12, flexShrink: 0 }}>
                  {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0" }}>
                Use this in the SDK: <code style={{ color: "var(--text)" }}>qlab.init(api_key=&quot;{apiKey.slice(0,14)}…&quot;)</code>
              </p>
            </div>
          )}

          {!verified && <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20, marginTop: 8 }}>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>
              Didn&apos;t receive it? Check your spam folder or resend.
            </p>
            {resent ? (
              <p style={{ fontSize: 13, color: "#10b981", fontWeight: 600 }}>Email resent — check your inbox ✓</p>
            ) : (
              <button
                className="button"
                onClick={handleResend}
                disabled={resending}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {resending ? "Sending…" : "Resend verification email"}
              </button>
            )}
          </div>}

          <p className="auth-footer" style={{ marginTop: 20 }}>
            <Link href={verified ? "/runs" : "/login"} style={{ color: "#1d6f8f", fontWeight: 600 }}>
              {verified ? "Go to your runs" : "Back to sign in"}
            </Link>
          </p>
        </div>
      </main>
    );
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
        <h1 className="auth-title">Create account</h1>
        <p className="auth-sub">First user becomes organization owner.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-label">Full name</label>
          <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus autoComplete="name" />
          <label className="auth-label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <label className="auth-label">Organization name <span style={{ color: "#aaa", fontWeight: 400 }}>(optional)</span></label>
          <input className="input" type="text" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="e.g. MIT Quantum Lab" />
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#94a3b8", cursor: "pointer", marginTop: 4 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2, accentColor: "#7c3aed", flexShrink: 0 }} required />
            <span>
              I agree to the{" "}
              <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>Terms of Service</a>
              {" "}and{" "}
              <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>Privacy Policy</a>
            </span>
          </label>
          {error && <div className="auth-error">{error}</div>}
          {!supported && (
            <div className="auth-error">This browser can&apos;t create passkeys here. Passkeys need a current browser and an https address.</div>
          )}
          <button className="button" type="submit" disabled={loading || !agreed || !supported} style={{ width: "100%", justifyContent: "center", opacity: agreed ? 1 : 0.5 }}>
            <KeyRound size={16} aria-hidden="true" /> {loading ? "Waiting for your passkey…" : "Create account with a passkey"}
          </button>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
            Q-Lab has no passwords. Your device creates a passkey (Face ID, fingerprint, PIN or a security key) that signs you in.
          </p>
        </form>
        <p className="auth-footer">
          Already registered?{" "}
          <Link href="/login" style={{ color: "#1d6f8f", fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </main>
  );
}
