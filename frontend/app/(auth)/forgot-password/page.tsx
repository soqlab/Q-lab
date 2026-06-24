"use client";

import { useState } from "react";
import Link from "next/link";
import { Atom } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 1 }}>Science of Quantum</div>
          </div>
        </div>
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-sub">We'll email you a reset link</p>

        {submitted ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
            <p style={{ marginBottom: 8, fontWeight: 600 }}>Check your inbox</p>
            <p style={{ fontSize: 14, color: "var(--color-muted)", marginBottom: 20 }}>
              If <strong>{email}</strong> is registered, a reset link has been sent. It expires in 15 minutes.
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
              placeholder="you@university.edu"
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="button" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
              {loading ? "Sending…" : "Send reset link"}
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
