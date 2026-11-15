"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { finishSoqlab, soqlabMessage, type SoqlabResult } from "../../../lib/soqlab";
import AuthFrame from "../AuthFrame";
import RecoveryCodes from "../RecoveryCodes";
import s from "../auth.module.css";

// Where id.soqlab.com sends the browser back with a one-time code. The code is used once, from
// this tab only, and taken out of the address bar at once.
function SoqlabCallback() {
  const { setSession } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const ran = useRef(false);
  // What id.soqlab.com sent back, read once.
  const [back] = useState(() => ({
    code: params.get("code"), state: params.get("state"), iss: params.get("iss") ?? "",
    denied: params.get("error"), why: params.get("error_description"),
  }));
  // Not an error to dwell on: the person closed the SOQLAB page, or the passkey wasn't used.
  const [error, setError] = useState<string | null>(() => (back.denied || !back.code || !back.state)
    ? (back.denied === "interaction_required" && back.why === "not_linked"
      ? soqlabMessage(new Error("soqlab_not_linked"))
      : back.denied === "access_denied" ? "SOQLAB sign-in was cancelled. Nothing changed." : "SOQLAB didn't send a sign-in back. Start again.")
    : null);
  const [done, setDone] = useState<SoqlabResult | null>(null);
  const [step, setStep] = useState<"codes" | "key" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    window.history.replaceState(null, "", "/soqlab-callback");
    const { code, state, iss, denied } = back;
    if (denied || !code || !state) return;
    finishSoqlab(code, state, iss)
      .then((resp) => {
        setSession(resp.access_token, resp.user);
        if (resp.recovery_codes?.length) { setDone(resp); setStep("codes"); return; }
        if (resp.api_key) { setDone(resp); setStep("key"); return; }
        router.replace(resp.purpose === "link" ? "/settings#signin" : resp.next);
      })
      .catch((err) => setError(soqlabMessage(err)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <AuthFrame caption="SOQLAB sign-in">
        <h1 className={s.title}>Not signed in</h1>
        <div className={s.error} role="alert">{error}</div>
        <Link className={s.primary} href="/login">Back to sign in</Link>
        <Link className={s.secondary} href="/register">Create an account</Link>
      </AuthFrame>
    );
  }

  if (done && step === "codes") {
    return (
      <AuthFrame caption="New account · recovery codes" aside={<span>Shown once</span>}>
        <h1 className={s.title}>Save your recovery codes</h1>
        <p className={s.lead}>
          Your Q-Lab account signs in with your SOQLAB passkey. If you ever lose it, one of these
          codes gets you back into Q-Lab. Each works once, and Q-Lab can&apos;t show them again.
        </p>
        <RecoveryCodes codes={done.recovery_codes ?? []} onSaved={() => (done.api_key ? setStep("key") : router.push(done.next))} />
      </AuthFrame>
    );
  }

  if (done && step === "key" && done.api_key) {
    const key = done.api_key;
    return (
      <AuthFrame caption="New account · API key" aside={<span>Shown once</span>}>
        <h1 className={s.title}>Your API key</h1>
        <p className={s.lead}>The SDK uses this key to send your runs to Q-Lab. Copy it now; it isn&apos;t shown again.</p>
        <div className={s.keyBox}>
          <code>{key}</code>
          <button type="button" className={s.link} onClick={() => {
            void navigator.clipboard.writeText(key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
          }}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <button type="button" className={s.primary} onClick={() => router.push(done.next)}>Go to your runs</button>
      </AuthFrame>
    );
  }

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", background: "var(--bg)" }}>
      <p className="mono" role="status" style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Signing you in…</p>
    </main>
  );
}

export default function SoqlabCallbackPage() {
  return (
    <Suspense>
      <SoqlabCallback />
    </Suspense>
  );
}
