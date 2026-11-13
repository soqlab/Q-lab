"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { AuthResponse } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import {
  addPasskey,
  fetchPasskeyConfig,
  passkeyErrorMessage,
  passkeysSupported,
  passwordSignIn,
  signInWithPasskey,
} from "../../../lib/passkeys";
import AuthFrame from "../AuthFrame";
import s from "../auth.module.css";

// Sign-in is one button: the browser offers the passkeys it has for Q-Lab (this device, a
// security key, or a phone through the QR code it shows), and the passkey says whose account it is.
function LoginForm() {
  const { setSession } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next") || "/runs";
  // Only relative paths, so the page can't be used to send someone elsewhere.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/runs";
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeysOnly, setPasskeysOnly] = useState(true);
  // Accounts made with a password before passkeys: one last password sign-in, then a passkey.
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enrolment, setEnrolment] = useState<string | null>(null);
  // The passkey prompt ended without a passkey (NotAllowedError): none for Q-Lab here, or closed.
  const [noPasskey, setNoPasskey] = useState(false);
  // Rendered on the server as supported; the browser decides after hydration.
  const supported = useSyncExternalStore(() => () => {}, passkeysSupported, () => true);

  useEffect(() => {
    void fetchPasskeyConfig().then((c) => setPasskeysOnly(c.passkeys_only));
  }, []);

  function done(resp: AuthResponse) {
    setSession(resp.access_token, resp.user);
    router.push(next);
  }

  async function attempt(fn: () => Promise<void>, passkeyPrompt = false) {
    setError(null);
    setNoPasskey(false);
    setLoading(true);
    try {
      await fn();
    } catch (err) {
      if (passkeyPrompt && err instanceof DOMException && err.name === "NotAllowedError") {
        setNoPasskey(true);
        return;
      }
      const msg = passkeyErrorMessage(err);
      setError(msg === "email_not_verified"
        ? "This password account's email address isn't confirmed yet. Use the link Q-Lab emailed you, then try again."
        : msg);
    } finally {
      setLoading(false);
    }
  }

  const signIn = () => attempt(async () => done(await signInWithPasskey()), true);
  const revealPassword = () => {
    setShowPassword(true);
    setNoPasskey(false);
    setError(null);
    // The form renders on the next frame; put the cursor in it.
    requestAnimationFrame(() => document.getElementById("login-email")?.focus());
  };
  const enrol = () => attempt(async () => { if (enrolment) done(await addPasskey(enrolment)); });
  const withPassword = (e: React.FormEvent) => {
    e.preventDefault();
    void attempt(async () => {
      const resp = await passwordSignIn(email, password);
      if (resp.kind === "session") done(resp);
      else setEnrolment(resp.enrolment_token);
    });
  };

  if (enrolment) {
    return (
      <AuthFrame caption="Sign in · one more step">
        <h1 className={s.title}>Create a passkey</h1>
        <p className={s.lead}>
          Q-Lab signs in with passkeys now. Create one to finish signing in. Your password is deleted
          once the passkey is saved, and from then on you sign in with the passkey alone.
        </p>
        {error && <div className={s.error} role="alert">{error}</div>}
        <button className={s.primary} type="button" onClick={() => void enrol()} disabled={loading}>
          {loading ? "Waiting for your passkey…" : "Create a passkey"}
        </button>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      caption="Sign in"
      links={
        <>
          <div className={s.linkRow}>
            <span>Lost your passkey?</span>
            <Link className={s.link} href="/recover">Use a recovery code</Link>
          </div>
          <div className={s.linkRow}>
            <span>No account yet?</span>
            <Link className={s.link} href="/register">Create one</Link>
          </div>
          <div className={s.linkRow}>
            <span>{passkeysOnly ? "Made your account with a password?" : "Prefer a password?"}</span>
            <button type="button" className={s.link} onClick={() => { setShowPassword((v) => !v); setError(null); setNoPasskey(false); }}>
              {showPassword ? "Hide" : "Use email and password"}
            </button>
          </div>
        </>
      }
    >
      <h1 className={s.title}>Sign in to Q-Lab</h1>
      <p className={s.lead}>
        Nothing to type. Your browser shows the passkeys it has for Q-Lab: on this device, on a
        security key, or on your phone by scanning the code it shows.
      </p>
      <button className={s.primary} type="button" onClick={() => void signIn()} disabled={loading || !supported}>
        {loading && !showPassword ? "Waiting for your passkey…" : "Sign in"}
      </button>
      {!supported && (
        <div className={s.error}>This browser can&apos;t use passkeys on this address. Passkeys need a current browser and https.</div>
      )}
      {error && <div className={s.error} role="alert">{error}</div>}
      {noPasskey && (
        <div className={s.notice} role="alert">
          <p className={s.lead}>No Q-Lab passkey came back from this browser.</p>
          <p className={s.note}>
            If you made your account with email and password,{" "}
            <button type="button" className={s.link} onClick={revealPassword}>use that below</button>{" "}
            and you&apos;ll create a passkey after. New here?{" "}
            <Link className={s.link} href="/register">Create an account</Link>. Passkey on your phone? Choose
            &lsquo;use a phone&rsquo; in the browser prompt. Lost it?{" "}
            <Link className={s.link} href="/recover">Use a recovery code</Link>.
          </p>
          <p className={s.note}>
            The browser doesn&apos;t say whether it found no passkey or the prompt was closed, so Q-Lab can&apos;t tell which.
          </p>
        </div>
      )}

      {showPassword && (
        <form onSubmit={withPassword} style={{ display: "grid", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <p className={s.note}>
            {passkeysOnly
              ? "For accounts made before passkeys. After this sign-in you create a passkey, and the password is deleted."
              : "This server still accepts passwords for accounts that have one."}
          </p>
          <div className={s.field}>
            <label className={s.label} htmlFor="login-email">Email</label>
            <input id="login-email" className={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              required autoComplete="username" />
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="login-password">Password</label>
            <input id="login-password" className={s.input} type="password" value={password}
              onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <button className={s.secondary} type="submit" disabled={loading || !email || !password}>
            {loading ? "Signing in…" : passkeysOnly ? "Continue to create a passkey" : "Sign in with password"}
          </button>
        </form>
      )}

      <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        <span className={s.label}>Or with an account you already have</span>
        <div className={s.row}>
          <a className={s.secondary} href="/qlab-api/auth/github">GitHub</a>
          <a className={s.secondary} href="/qlab-api/auth/google">Google</a>
        </div>
      </div>
    </AuthFrame>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
