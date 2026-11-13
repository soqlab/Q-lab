"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { fetchMe } from "../../../lib/api";
import { addPasskey, passkeyErrorMessage } from "../../../lib/passkeys";
import AuthFrame from "../AuthFrame";
import s from "../auth.module.css";

function OAuthCallback() {
  const { setSession } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // With passkeys only, Google and GitHub give an account made with them no session, only a
  // 15-minute token that registers its first passkey.
  const [enrolment] = useState(() => searchParams.get("enrol"));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (enrolment) {
      // Keep the token out of the address bar and history.
      window.history.replaceState(null, "", "/oauth-callback");
      return;
    }
    const token = searchParams.get("token");
    const error = searchParams.get("error");
    const raw = searchParams.get("next") || "/runs";
    const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/runs";

    if (error || !token) {
      router.push("/login?error=oauth_failed");
      return;
    }

    fetchMe(token)
      .then(user => {
        setSession(token, user);
        router.push(next);
      })
      .catch(() => router.push("/login?error=oauth_failed"));
  }, []); // eslint-disable-line

  async function enrol() {
    if (!enrolment) return;
    setError(null);
    setLoading(true);
    try {
      const resp = await addPasskey(enrolment);
      setSession(resp.access_token, resp.user);
      router.push("/runs");
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (enrolment) {
    return (
      <AuthFrame caption="Sign in · one more step">
        <h1 className={s.title}>Create a passkey</h1>
        <p className={s.lead}>
          Q-Lab signs in with passkeys now. Create one to finish signing in. Once it is saved, Google and
          GitHub no longer sign in to this account, and from then on you sign in with the passkey alone.
        </p>
        <p className={s.note}>This step expires 15 minutes after you came back from Google or GitHub.</p>
        {error && <div className={s.error} role="alert">{error}</div>}
        <button className={s.primary} type="button" onClick={() => void enrol()} disabled={loading}>
          {loading ? "Waiting for your passkey…" : "Create a passkey"}
        </button>
      </AuthFrame>
    );
  }

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", background: "var(--bg)" }}>
      <p className="mono" role="status" style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Signing you in…</p>
    </main>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense>
      <OAuthCallback />
    </Suspense>
  );
}
