"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AuthFrame from "../AuthFrame";
import s from "../auth.module.css";

// Only on servers that still allow passwords (QLAB_PASSKEYS_ONLY off): the emailed link sets a new one.
function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const error = formError ?? (token ? null : "This reset link is missing its code. Request a new one.");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/qlab-api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = (await r.json().catch(() => ({}))) as { detail?: unknown };
      if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Reset failed");
      setDone(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      caption="Reset password"
      links={!done ? (
        <div className={s.linkRow}>
          <span>Link expired?</span>
          <Link className={s.link} href="/forgot-password">Request a new one</Link>
        </div>
      ) : undefined}
    >
      <h1 className={s.title}>Choose a new password</h1>
      {done ? (
        <>
          <p className={s.lead} role="status">Password updated. Taking you to sign in…</p>
          <Link className={s.secondary} href="/login">Sign in now</Link>
        </>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          <div className={s.field}>
            <label className={s.label} htmlFor="reset-new">New password</label>
            <input id="reset-new" className={s.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required autoFocus autoComplete="new-password" placeholder="At least 8 characters" disabled={!token} />
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="reset-confirm">Confirm password</label>
            <input id="reset-confirm" className={s.input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              required autoComplete="new-password" disabled={!token} />
          </div>
          {error && <div className={s.error} role="alert">{error}</div>}
          <button className={s.primary} type="submit" disabled={loading || !token}>
            {loading ? "Updating…" : "Set new password"}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
