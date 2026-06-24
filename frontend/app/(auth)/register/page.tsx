"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Atom } from "lucide-react";
import { register } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

export default function RegisterPage() {
  const { setSession } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resp = await register(email, name, password, org || undefined);
      setSession(resp.access_token, resp.user);
      router.push("/runs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
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
        <h1 className="auth-title">Create account</h1>
        <p className="auth-sub">First user becomes organization owner.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-label">Full name</label>
          <input
            className="input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            autoComplete="name"
          />
          <label className="auth-label">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <label className="auth-label">Organization name <span style={{ color: "#aaa", fontWeight: 400 }}>(optional)</span></label>
          <input
            className="input"
            type="text"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="e.g. MIT Quantum Lab"
          />
          <label className="auth-label">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={8}
          />
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#94a3b8", cursor: "pointer", marginTop: 4 }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 2, accentColor: "#7c3aed", flexShrink: 0 }}
              required
            />
            <span>
              I agree to the{" "}
              <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>Terms of Service</a>
              {" "}and{" "}
              <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>Privacy Policy</a>
            </span>
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button className="button" type="submit" disabled={loading || !agreed} style={{ width: "100%", justifyContent: "center", opacity: agreed ? 1 : 0.5 }}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="auth-footer">
          Already registered?{" "}
          <Link href="/login" style={{ color: "#1d6f8f", fontWeight: 600 }}>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
