"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import type { AuthUser } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { fetchPasskeyConfig, signInWithPasskey } from "../../../lib/passkeys";
import { linkSoqlab, soqlabMessage, soqlabStatus, unlinkSoqlab, type SoqlabStatus } from "../../../lib/soqlab";

/**
 * SOQLAB passkey: link this account to one passkey for Q-Lab and SOQLAB's other products, or
 * unlink it. Shown only when the server offers SOQLAB sign-in. Linking needs a sign-in in the last
 * 10 minutes; when it is older, the person confirms with their Q-Lab passkey first.
 */
export default function SoqlabPanel({ me, reloadMe, withPasskey }: {
  me: AuthUser | null;
  reloadMe: () => Promise<void>;
  withPasskey: <T>(action: (t: string) => Promise<T>) => Promise<T>;
}) {
  const { token, setSession } = useAuth();
  const [offered, setOffered] = useState(false);
  const [status, setStatus] = useState<SoqlabStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchPasskeyConfig().then((c) => {
      if (!live || !c.soqlab_id || !token) return;
      setOffered(true);
      void soqlabStatus(token).then((s) => { if (live) setStatus(s); }).catch(() => {});
    });
    return () => { live = false; };
  }, [token]);

  if (!offered) return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (err) {
      setError(soqlabMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const link = () => run(async () => {
    try {
      await linkSoqlab(token!);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if ((code !== "recent_sign_in_required" && code !== "passkey_session_required") || !(me?.passkeys ?? 0)) throw err;
      // Confirm with the Q-Lab passkey, then go on with that fresh session.
      const resp = await signInWithPasskey();
      if (me && resp.user.id !== me.id) throw new Error("That passkey belongs to a different account.");
      setSession(resp.access_token, resp.user);
      await linkSoqlab(resp.access_token);
    }
  });

  const unlink = () => run(async () => {
    if (!confirm("Stop signing in to Q-Lab with your SOQLAB passkey? Your Q-Lab passkeys keep working.")) return;
    const resp = await withPasskey((t) => unlinkSoqlab(t));
    setNote(resp.remote_unlinked
      ? "Unlinked. SOQLAB no longer links this passkey to Q-Lab."
      : "Unlinked here. SOQLAB couldn't be reached to forget the link; you can remove it at id.soqlab.com too.");
    setStatus(token ? await soqlabStatus(token).catch(() => null) : null);
    await reloadMe();
  });

  const linked = !!status?.linked;
  return (
    <section className="panel" id="signin" aria-labelledby="soqlab-heading">
      <div className="panel-header"><h2 id="soqlab-heading">SOQLAB passkey</h2></div>
      <div style={{ padding: "16px 18px", display: "grid", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
          One passkey for Q-Lab and SOQLAB&apos;s other products, kept at id.soqlab.com. Linking is your
          choice and you can undo it. Q-Lab gets an identifier that only Q-Lab uses, no name or email,
          and the products never see each other&apos;s data.
        </p>
        <p role="status" style={{ fontSize: 13, margin: 0 }}>
          {status === null ? "Checking…" : linked
            ? `Linked${status.linked_at ? ` since ${new Date(status.linked_at).toLocaleDateString()}` : ""}. You can sign in with “Sign in with SOQLAB”.`
            : "Not linked. You sign in with your Q-Lab passkey."}
        </p>
        {linked && status && !status.has_passkey && (
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            To unlink, first add a Q-Lab passkey above, so you can still sign in afterwards.
          </p>
        )}
        {error && <div className="auth-error" role="alert">{error}</div>}
        {note && <div role="status" style={{ fontSize: 13, color: "var(--ok)" }}>{note}</div>}
        <div>
          {linked ? (
            <button className="button secondary" type="button" onClick={() => void unlink()} disabled={busy || !status?.has_passkey}>
              Unlink SOQLAB passkey
            </button>
          ) : (
            <button className="button" type="button" onClick={() => void link()} disabled={busy || status === null}>
              <KeyRound size={15} aria-hidden="true" /> {busy ? "Opening SOQLAB…" : "Create a SOQLAB passkey"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
