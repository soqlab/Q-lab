"use client";

import { Suspense, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { passkeyErrorMessage, passkeysSupported, signUpWithPasskey } from "../../../lib/passkeys";
import AuthFrame from "../AuthFrame";
import RecoveryCodes from "../RecoveryCodes";
import s from "../auth.module.css";

// A new account is a passkey and a name. No email, no password. Then two things shown once:
// the recovery codes (the way back in without email) and the SDK API key.
function RegisterForm() {
  const { setSession } = useAuth();
  const router = useRouter();
  const rawNext = useSearchParams().get("next") || "/runs";
  // Only relative paths (an invite link sends people back to /join).
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/runs";
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"form" | "codes" | "key">("form");
  const [codes, setCodes] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const supported = useSyncExternalStore(() => () => {}, passkeysSupported, () => true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resp = await signUpWithPasskey(name.trim(), org.trim() || undefined);
      setSession(resp.access_token, resp.user);
      setApiKey(resp.api_key ?? null);
      setCodes(resp.recovery_codes ?? []);
      if (resp.recovery_codes?.length) setStep("codes");
      else if (resp.api_key) setStep("key");
      else router.push(next);
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (step === "codes") {
    return (
      <AuthFrame caption="New account · 2 of 3" aside={<span>Shown once</span>}>
        <h1 className={s.title}>Save your recovery codes</h1>
        <p className={s.lead}>
          If you lose every device with your passkey, one of these codes lets you create a new
          passkey and get back in. Each works once. Q-Lab keeps only a one-way hash of each code, so
          it can&apos;t show them again.
        </p>
        <RecoveryCodes codes={codes} onSaved={() => (apiKey ? setStep("key") : router.push(next))} />
        <p className={s.note}>
          You can make a new set any time in Settings, which cancels this one. A second passkey on
          another device (Settings, Passkeys) is another way back in.
        </p>
      </AuthFrame>
    );
  }

  if (step === "key" && apiKey) {
    return (
      <AuthFrame caption="New account · 3 of 3" aside={<span>Shown once</span>}>
        <h1 className={s.title}>Your API key</h1>
        <p className={s.lead}>The SDK uses this key to send your runs to Q-Lab. Copy it now; it isn&apos;t shown again.</p>
        <div className={s.keyBox}>
          <code>{apiKey}</code>
          <button type="button" className={s.link} onClick={() => {
            void navigator.clipboard.writeText(apiKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
          }}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className={s.note}>In Python: <code className="mono">qlab.init(api_key=&quot;{apiKey.slice(0, 12)}…&quot;)</code>. You can make more keys in Settings.</p>
        <button type="button" className={s.primary} onClick={() => router.push(next)}>{next === "/runs" ? "Go to your runs" : "Continue"}</button>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      caption="New account · 1 of 3"
      links={
        <div className={s.linkRow}>
          <span>Already have an account?</span>
          <Link className={s.link} href="/login">Sign in</Link>
        </div>
      }
    >
      <h1 className={s.title}>Create your Q-Lab account</h1>
      <p className={s.lead}>
        A name and a passkey. No email or password: your device makes the passkey with Face ID, a
        fingerprint, its PIN, a security key, or your phone.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <div className={s.field}>
          <label className={s.label} htmlFor="reg-name">Name</label>
          <input id="reg-name" className={s.input} type="text" value={name} onChange={(e) => setName(e.target.value)}
            required maxLength={200} autoFocus autoComplete="name" />
          <span className={s.note}>Shown to your team and on runs you share.</span>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="reg-org">Organization (optional)</label>
          <input id="reg-org" className={s.input} type="text" value={org} onChange={(e) => setOrg(e.target.value)} maxLength={200} />
        </div>
        <label className={s.check}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
          <span>
            I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> and the{" "}
            <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
          </span>
        </label>
        {error && <div className={s.error} role="alert">{error}</div>}
        {!supported && (
          <div className={s.error}>This browser can&apos;t create passkeys on this address. Passkeys need a current browser and https.</div>
        )}
        <button className={s.primary} type="submit" disabled={loading || !agreed || !supported || !name.trim()}>
          {loading ? "Waiting for your passkey…" : "Create account with a passkey"}
        </button>
        <p className={s.note}>Want recovery by email as well? Add an address later in Settings. It&apos;s never needed to sign in.</p>
      </form>
    </AuthFrame>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
