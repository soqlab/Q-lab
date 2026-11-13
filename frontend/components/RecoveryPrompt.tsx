"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchMe } from "../lib/api";
import { useAuth } from "../lib/auth";

const DISMISS_KEY = "qlab_recovery_prompt_later";

/**
 * A one-line, dismissible reminder for accounts that have no recovery codes (made before codes
 * existed, or every code used). It never blocks anything; "Later" hides it for this browser session.
 * Mounted once in the signed-in layout.
 */
export default function RecoveryPrompt() {
  const { token } = useAuth();
  const pathname = usePathname();
  // The answer for this token: the account has a passkey and no recovery codes left.
  const [needs, setNeeds] = useState<{ token: string; yes: boolean } | null>(null);
  const [later, setLater] = useState(false);

  useEffect(() => {
    if (!token) return;
    try { if (sessionStorage.getItem(DISMISS_KEY) === "1") return; } catch { /* private mode: just ask */ }
    let live = true;
    fetchMe(token)
      .then((me) => {
        if (live) setNeeds({ token, yes: me.session === "passkey" && (me.passkeys ?? 0) > 0 && me.recovery_codes_remaining === 0 });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [token, pathname]);

  const show = !later && !!token && needs?.token === token && needs.yes && !pathname.startsWith("/settings");
  if (!show) return null;
  return (
    <div role="status" style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", padding: "8px 24px",
      borderBottom: "1px solid var(--line)", background: "var(--panel)", fontSize: 13, color: "var(--text)",
    }}>
      <span className="dot warn" aria-hidden="true" />
      <span style={{ flex: "1 1 260px" }}>
        Your account has no recovery codes. If you lose your passkey, they are how you get back in.
      </span>
      <Link href="/settings#recovery" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Make recovery codes</Link>
      <button type="button" onClick={() => { try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* fine */ } setLater(true); }}
        style={{ background: "none", border: 0, padding: 0, color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>
        Later
      </button>
    </div>
  );
}
