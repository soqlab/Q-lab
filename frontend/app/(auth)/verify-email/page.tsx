"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AuthFrame from "../AuthFrame";
import s from "../auth.module.css";

// The link Q-Lab emails to confirm an address. Signing in never needs it.
function VerifyEmailContent() {
  const token = useSearchParams().get("token") ?? "";
  const [fetchStatus, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [fetchMessage, setMessage] = useState("");
  const status = token ? fetchStatus : "error";
  const message = token ? fetchMessage : "This link is missing its code. Use the link from the email.";

  useEffect(() => {
    if (!token) return;
    fetch(`/qlab-api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
        if (res.ok) {
          setStatus("success");
          setMessage("Your email address is confirmed.");
        } else {
          setStatus("error");
          setMessage(typeof data.detail === "string" ? data.detail : "The link may have expired.");
        }
      })
      .catch(() => { setStatus("error"); setMessage("That didn't go through. Try the link again."); });
  }, [token]);

  return (
    <AuthFrame caption="Confirm email">
      {status === "loading" && <p className={s.note} role="status">Confirming your address…</p>}
      {status === "success" && (
        <>
          <h1 className={s.title}>Address confirmed</h1>
          <p className={s.lead}>{message}</p>
          <Link className={s.primary} href="/runs" style={{ textDecoration: "none" }}>Go to Q-Lab</Link>
        </>
      )}
      {status === "error" && (
        <>
          <h1 className={s.title}>Not confirmed</h1>
          <p className={s.lead}>{message} You can send a new link from Settings.</p>
          <Link className={s.secondary} href="/settings">Open Settings</Link>
        </>
      )}
    </AuthFrame>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
