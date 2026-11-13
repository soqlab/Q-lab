"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { passkeyErrorMessage, recoverWithCode, recoverWithPasskey } from "../../../lib/passkeys";
import AuthFrame from "../AuthFrame";
import s from "../auth.module.css";

// Getting back in without a passkey. Without email: a one-time recovery code creates a new
// passkey on this device. With ?token= (the emailed link, for accounts that have an address):
// the link does the same.
function RecoverForm() {
  const { setSession } = useAuth();
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setLoading(true);
    try {
      await fn();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const withLink = () => run(async () => {
    const resp = await recoverWithPasskey(token);
    setSession(resp.access_token, resp.user);
    router.push("/settings");
  });

  const withCode = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const resp = await recoverWithCode(code);
      setSession(resp.access_token, resp.user);
      setLeft(resp.recovery_codes_remaining);
    });
  };

  if (left !== null) {
    return (
      <AuthFrame caption="Recovered">
        <h1 className={s.title}>You&apos;re back in</h1>
        <p className={s.lead}>
          This device now has a new passkey for your account. The code you used no longer works.
        </p>
        <div className={left <= 3 ? s.error : s.ok}>
          {left === 0
            ? "That was your last recovery code. Make a new set in Settings now."
            : `${left} recovery code${left === 1 ? "" : "s"} left.${left <= 3 ? " Make a new set in Settings soon." : ""}`}
        </div>
        <button type="button" className={s.primary} onClick={() => router.push("/settings#recovery")}>Open Settings</button>
        <Link className={s.secondary} href="/runs">Go to your runs</Link>
      </AuthFrame>
    );
  }

  if (token) {
    return (
      <AuthFrame caption="Recover · emailed link">
        <h1 className={s.title}>Create a new passkey</h1>
        <p className={s.lead}>This link from your email adds a new passkey to your account, once. Your device asks you to confirm.</p>
        {error && <div className={s.error} role="alert">{error}</div>}
        <button className={s.primary} type="button" onClick={() => void withLink()} disabled={loading}>
          {loading ? "Waiting for your passkey…" : "Create passkey and sign in"}
        </button>
        <Link className={s.link} href="/recover">Use a recovery code instead</Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      caption="Recover"
      links={
        <>
          <div className={s.linkRow}>
            <span>Still signed in on another device?</span>
            <span>There: Settings, Passkeys, Add a passkey</span>
          </div>
          <div className={s.linkRow}>
            <span>Your account has an email address?</span>
            <Link className={s.link} href="/forgot-password">Email me a link</Link>
          </div>
          <div className={s.linkRow}>
            <span>Found your passkey?</span>
            <Link className={s.link} href="/login">Sign in</Link>
          </div>
        </>
      }
    >
      <h1 className={s.title}>Get back into your account</h1>
      <p className={s.lead}>
        Enter one of the recovery codes you saved when you made your account. It creates a new
        passkey on this device and signs you in. Each code works once.
      </p>
      <form onSubmit={withCode} style={{ display: "grid", gap: 12 }}>
        <div className={s.field}>
          <label className={s.label} htmlFor="recover-code">Recovery code</label>
          <input id="recover-code" className={`${s.input} ${s.codeInput}`} value={code} onChange={(e) => setCode(e.target.value)}
            required maxLength={64} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX" />
        </div>
        {error && <div className={s.error} role="alert">{error}</div>}
        <button className={s.primary} type="submit" disabled={loading || code.replace(/[^0-9a-z]/gi, "").length < 16}>
          {loading ? "Waiting for your passkey…" : "Create a new passkey"}
        </button>
        <p className={s.note}>Five tries per 15 minutes from one internet address, so codes can&apos;t be guessed.</p>
      </form>
    </AuthFrame>
  );
}

export default function RecoverPage() {
  return (
    <Suspense>
      <RecoverForm />
    </Suspense>
  );
}
