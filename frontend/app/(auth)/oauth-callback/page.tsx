"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { fetchMe } from "../../../lib/api";

const API_PREFIX = "/qlab-api";

function OAuthCallback() {
  const { setSession } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const next = searchParams.get("next") || "/runs";

    if (error || !code) {
      router.push("/login?error=oauth_failed");
      return;
    }

    fetch(`${API_PREFIX}/auth/oauth/exchange?code=${encodeURIComponent(code)}`)
      .then(res => {
        if (!res.ok) throw new Error("exchange_failed");
        return res.json();
      })
      .then(({ access_token }: { access_token: string }) =>
        fetchMe(access_token).then(user => {
          setSession(access_token, user);
          router.push(next);
        })
      )
      .catch(() => router.push("/login?error=oauth_failed"));
  }, []); // eslint-disable-line

  return (
    <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5"
          style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 16px" }}>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10"/>
        </svg>
        <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>Signing you in…</p>
      </div>
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
