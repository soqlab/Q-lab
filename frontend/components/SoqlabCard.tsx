"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchMe, type AuthUser } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fetchPasskeyConfig } from "../lib/passkeys";
import { dismissSoqlabCard, linkSoqlab, soqlabCardDismissed, soqlabMessage } from "../lib/soqlab";

/**
 * A one-time card after a sign-in with an older Q-Lab passkey, when the server offers SOQLAB
 * sign-in: create one SOQLAB passkey for Q-Lab and SOQLAB's other products. "No thanks" hides it
 * for good in this browser. Mounted once in the signed-in layout; nothing shows when it's off.
 */
export default function SoqlabCard() {
  const { token } = useAuth();
  const pathname = usePathname();
  const [me, setMe] = useState<{ token: string; user: AuthUser } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    void fetchPasskeyConfig().then((c) => {
      if (!c.soqlab_id) return;
      return fetchMe(token).then((user) => { if (live) setMe({ token, user }); });
    }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  const user = me?.token === token ? me.user : null;
  const show = !hidden && !!user && user.session === "passkey" && user.soqlab_linked === false
    && !soqlabCardDismissed(user.id) && !pathname.startsWith("/settings");
  if (!show || !user) return null;

  const dismiss = () => { dismissSoqlabCard(user.id); setHidden(true); };
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await linkSoqlab(token!, pathname || "/runs");
    } catch (err) {
      setError(soqlabMessage(err));
      setBusy(false);
    }
  };

  return (
    <aside aria-labelledby="soqlab-card-title" style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", padding: "10px 24px",
      borderBottom: "1px solid var(--line)", background: "var(--panel)", fontSize: 13, color: "var(--text)",
    }}>
      <span style={{ flex: "1 1 280px", lineHeight: 1.5 }}>
        <strong id="soqlab-card-title" style={{ fontWeight: 600 }}>One passkey for SOQLAB&apos;s products.</strong>{" "}
        Create a SOQLAB passkey and use it for Q-Lab and SOQLAB&apos;s other products. Your Q-Lab passkey keeps
        working, and you can unlink any time in <Link href="/settings#signin" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Settings</Link>.
        {error && <span role="alert" style={{ display: "block", color: "var(--danger)" }}>{error}</span>}
      </span>
      <button type="button" className="button" onClick={() => void create()} disabled={busy} style={{ height: 30, fontSize: 12 }}>
        {busy ? "Opening SOQLAB…" : "Create a SOQLAB passkey"}
      </button>
      <button type="button" onClick={dismiss}
        style={{ background: "none", border: 0, padding: 0, color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>
        No thanks
      </button>
    </aside>
  );
}
