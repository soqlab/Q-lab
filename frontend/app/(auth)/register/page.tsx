"use client";

import { useState } from "react";
import Link from "next/link";
import { Atom, Eye, EyeOff, Copy, CheckCircle2 } from "lucide-react";
import { register } from "../../../lib/api";

const pwRules = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "One number", test: (p: string) => /[0-9]/.test(p) },
];

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pwValid = pwRules.every(r => r.test(password));

  function copyKey(key: string) {
    navigator.clipboard.writeText(key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pwValid) { setError("Password does not meet all requirements"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      const resp = await register(email, name, password, org || undefined);
      if (resp.api_key) setApiKey(resp.api_key);
      setRegistered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
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

          <div style={{ fontSize: 48, margin: "24px 0 16px" }}>✉️</div>
          <h1 className="auth-title">Check your inbox</h1>
          <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7, margin: "8px 0 16px" }}>
            We sent a verification link to<br />
            <strong style={{ color: "var(--text)" }}>{email}</strong>
          </p>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 20px" }}>
            Click the link in the email to verify your account, then sign in.
          </p>

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

          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20, marginTop: 8 }}>
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
          </div>

          <p className="auth-footer" style={{ marginTop: 20 }}>
            <Link href="/login" style={{ color: "#1d6f8f", fontWeight: 600 }}>
              Back to sign in
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
          <label className="auth-label">Password</label>
          <div style={{ position: "relative" }}>
            <input className="input" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onFocus={() => setPwFocused(true)} required autoComplete="new-password" style={{ width: "100%", paddingRight: 40, boxSizing: "border-box" }} />
            <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0, display: "flex" }}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {(pwFocused || password) && (
            <ul style={{ margin: "-2px 0 4px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
              {pwRules.map(r => {
                const ok = r.test(password);
                return (
                  <li key={r.label} style={{ fontSize: 12, color: ok ? "#10b981" : "#94a3b8", display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 10 }}>{ok ? "✓" : "○"}</span>
                    {r.label}
                  </li>
                );
              })}
            </ul>
          )}
          <label className="auth-label">Confirm password</label>
          <div style={{ position: "relative" }}>
            <input className="input" type={showConfirm ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" style={{ width: "100%", paddingRight: 40, boxSizing: "border-box", borderColor: confirm && confirm !== password ? "var(--danger)" : undefined }} />
            <button type="button" onClick={() => setShowConfirm(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0, display: "flex" }}>
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {confirm && confirm !== password && (
            <p style={{ fontSize: 12, color: "var(--danger)", margin: "-4px 0 0" }}>Passwords do not match</p>
          )}
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
          <button className="button" type="submit" disabled={loading || !agreed || !pwValid} style={{ width: "100%", justifyContent: "center", opacity: agreed && pwValid ? 1 : 0.5 }}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="auth-footer">
          Already registered?{" "}
          <Link href="/login" style={{ color: "#1d6f8f", fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </main>
  );
}
