"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPasskeyConfig } from "../../../lib/passkeys";
import AuthFrame from "../AuthFrame";
import s from "../auth.module.css";

// Emailed recovery: only for accounts that have an email address. Accounts without one use a
// recovery code (/recover). On a server that still allows passwords, the link resets one instead.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError("That didn't go through. Try again in a minute.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      caption={recovery ? "Recover · by email" : "Reset password"}
      links={
        <>
          <div className={s.linkRow}>
            <span>No email on your account?</span>
            <Link className={s.link} href="/recover">Use a recovery code</Link>
          </div>
          <div className={s.linkRow}>
            <span>Found your passkey?</span>
            <Link className={s.link} href="/login">Sign in</Link>
          </div>
        </>
      }
    >
      <h1 className={s.title}>{recovery ? "Email me a recovery link" : "Email me a reset link"}</h1>
      {submitted ? (
        <p className={s.lead} role="status">
          If an account has <strong>{email}</strong> as its address, a link is on its way. It works once and
          expires in 15 minutes.
        </p>
      ) : (
        <>
          <p className={s.lead}>
            {recovery
              ? "Only for accounts that have an email address. The link lets you create a new passkey."
              : "The link lets you choose a new password."}
          </p>
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
            <div className={s.field}>
              <label className={s.label} htmlFor="forgot-email">Email address</label>
              <input id="forgot-email" className={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required autoFocus autoComplete="email" maxLength={254} />
            </div>
            {error && <div className={s.error} role="alert">{error}</div>}
            <button className={s.primary} type="submit" disabled={loading || !email}>
              {loading ? "Sending…" : "Send the link"}
            </button>
          </form>
        </>
      )}
    </AuthFrame>
  );
}
