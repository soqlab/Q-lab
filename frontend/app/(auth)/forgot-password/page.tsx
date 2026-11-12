"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Atom } from "lucide-react";
import { fetchPasskeyConfig } from "../../../lib/passkeys";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Passkeys-only servers email an account-recovery link that registers a new passkey.
  const [recovery, setRecovery] = useState(true);

  useEffect(() => {
    void fetchPasskeyConfig().then((c) => setRecovery(c.passkeys_only));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/qlab-api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) throw new Error("Request failed");
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
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
        <h1 className="auth-title">{recovery ? "Recover your account" : "Reset password"}</h1>
        <p className="auth-sub">
          {recovery ? "Lost your passkey? We'll email you a link to create a new one." : "We'll email you a reset link"}
        </p>

        {submitted ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
            <p style={{ marginBottom: 8, fontWeight: 600 }}>Check your inbox</p>
            <p style={{ fontSize: 14, color: "var(--color-muted)", marginBottom: 20 }}>
              If <strong>{email}</strong> is registered, a link has been sent. It works once and expires in 15 minutes.
            </p>
            <Link href="/login" style={{ color: "#1d6f8f", fontWeight: 600, fontSize: 14 }}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-label">Email address</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              maxLength={254}
              placeholder="you@university.edu"
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="button" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
              {loading ? "Sending…" : recovery ? "Send recovery link" : "Send reset link"}
            </button>
          </form>
        )}

        {!submitted && (
          <p className="auth-footer">
            <Link href="/login" style={{ color: "#1d6f8f" }}>
              Back to sign in
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
