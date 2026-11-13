"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { fetchMe } from "../../../lib/api";

function OAuthCallback() {
  const { setSession } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
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
