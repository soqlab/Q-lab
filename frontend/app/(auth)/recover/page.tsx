"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Atom, KeyRound } from "lucide-react";
import { useAuth } from "../../../lib/auth";
import { passkeyErrorMessage, recoverWithPasskey } from "../../../lib/passkeys";

// The emailed account-recovery link lands here: it registers a new passkey, once.
function RecoverForm() {
  const { setSession } = useAuth();
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [loading, setLoading] = useState(false);
  const [formError, setError] = useState<string | null>(null);
  const error = formError ?? (token ? null : "This recovery link is missing its code. Request a new one.");

  async function handleRecover() {
    setError(null);
    setLoading(true);
    try {
      const resp = await recoverWithPasskey(token);
      setSession(resp.access_token, resp.user);
      router.push("/settings");
    } catch (err) {
      setError(passkeyErrorMessage(err));
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
        <h1 className="auth-title">Create a new passkey</h1>
        <p className="auth-sub">Your device will ask you to confirm with Face ID, a fingerprint, a PIN or a security key.</p>
        <div className="auth-form">
          {error && <div className="auth-error">{error}</div>}
          <button className="button" type="button" onClick={handleRecover} disabled={loading || !token} style={{ width: "100%", justifyContent: "center" }}>
            <KeyRound size={16} aria-hidden="true" /> {loading ? "Waiting for your passkey…" : "Create passkey and sign in"}
          </button>
        </div>
        <p className="auth-footer">
          <Link href="/forgot-password" style={{ color: "#1d6f8f" }}>Request a new link</Link>
        </p>
      </div>
    </main>
  );
}

export default function RecoverPage() {
  return (
    <Suspense>
      <RecoverForm />
    </Suspense>
  );
}
