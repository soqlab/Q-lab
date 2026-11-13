"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { acceptInvite, validateInvite, type InviteInfo } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import AuthFrame from "../AuthFrame";
import s from "../auth.module.css";

function JoinInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token") ?? "";
  const router = useRouter();
  const { token: authToken, user } = useAuth();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [checking, setValidating] = useState(true);
  const [checkError, setValidError] = useState<string | null>(null);
  // Without a token there is nothing to check.
  const validating = inviteToken ? checking : false;
  const validError = inviteToken ? checkError : "This invite link is missing its code.";

  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const back = `/join?token=${encodeURIComponent(inviteToken)}`;

  useEffect(() => {
    if (!inviteToken) return;
    void validateInvite(inviteToken)
      .then(d => { setInfo(d); setValidating(false); })
      .catch(err => { setValidError(err instanceof Error ? err.message : "Invalid invite"); setValidating(false); });
  }, [inviteToken]);

  async function handleAccept() {
    if (!authToken) {
      router.push(`/login?next=${encodeURIComponent(back)}`);
      return;
    }
    setAccepting(true);
    setAcceptError(null);
    try {
      await acceptInvite(authToken, inviteToken);
      setAccepted(true);
      router.push("/team");
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : "Failed to accept invite");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <AuthFrame caption="Team invite">
      {validating && <p className={s.note} role="status">Checking the invite…</p>}
      {validError && (
        <>
          <h1 className={s.title}>This invite doesn&apos;t work</h1>
          <p className={s.lead}>{validError}</p>
          <Link className={s.secondary} href="/login">Go to sign in</Link>
        </>
      )}
      {accepted && <p className={s.lead} role="status">You joined the team. Opening it…</p>}
      {!validating && !validError && !accepted && info && (
        <>
          <h1 className={s.title}>Join {info.org_name}</h1>
          <p className={s.lead}>
            You&apos;re invited as <strong>{info.role}</strong>. The invite expires on{" "}
            {new Date(info.expires_at).toLocaleDateString()}.
          </p>
          {acceptError && <div className={s.error} role="alert">{acceptError}</div>}
          {user ? (
            <>
              <p className={s.note}>Signed in as <strong>{user.name || user.email || "you"}</strong>.</p>
              <button className={s.primary} onClick={() => void handleAccept()} disabled={accepting}>
                {accepting ? "Joining…" : `Join ${info.org_name}`}
              </button>
              <Link className={s.link} href={`/login?next=${encodeURIComponent(back)}`}>Use a different account</Link>
            </>
          ) : (
            <>
              <Link className={s.primary} href={`/register?next=${encodeURIComponent(back)}`} style={{ textDecoration: "none" }}>
                Create an account
              </Link>
              <Link className={s.secondary} href={`/login?next=${encodeURIComponent(back)}`}>I have an account: sign in</Link>
            </>
          )}
        </>
      )}
    </AuthFrame>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinInner />
    </Suspense>
  );
}
