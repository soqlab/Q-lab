"use client";

import { useEffect, useState } from "react";
import type { AuthUser } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import {
  newRecoveryCodes,
  passkeyErrorMessage,
  recoveryCodeStatus,
  setAccountEmail,
  type RecoveryCodeStatus,
} from "../../../lib/passkeys";
import RecoveryCodes from "../../(auth)/RecoveryCodes";

type StepUp = <T>(action: (t: string) => Promise<T>) => Promise<T>;

/** Recovery codes: how many are left, and a new set (shown once, cancels the old one). */
export function RecoveryCodesPanel({ withPasskey, reloadMe }: { withPasskey: StepUp; reloadMe: () => Promise<void> }) {
  const { token } = useAuth();
  const [status, setStatus] = useState<RecoveryCodeStatus | null>(null);
  const [fresh, setFresh] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    void recoveryCodeStatus(token).then((st) => { if (live) setStatus(st); }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  async function makeNew() {
    setBusy(true);
    setError(null);
    try {
      const out = await withPasskey((t) => newRecoveryCodes(t));
      setFresh(out.codes);
      setStatus({ remaining: out.remaining, total: out.total, created_at: out.created_at });
      await reloadMe();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const left = status?.remaining;
  return (
    <section className="panel" id="recovery">
      <div className="panel-header">
        <h2>Recovery codes</h2>
        <span className="num" style={{ fontSize: 13, color: "var(--muted)" }}>
          {status ? `${status.remaining} of ${status.total} left` : "—"}
        </span>
      </div>
      <div style={{ padding: "16px 18px", display: "grid", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
          If you lose every device with your passkey, a recovery code lets you make a new passkey at{" "}
          <span className="mono">/recover</span>. Each code works once. Q-Lab keeps only a one-way hash of each.
          {status?.created_at && <> This set was made on {new Date(status.created_at).toLocaleDateString()}.</>}
        </p>
        {left === 0 && !fresh && (
          <div className="alert alert-warn">
            You have no recovery codes. Without them, or a second passkey, or an email address, a lost passkey means a lost account.
          </div>
        )}
        {left !== undefined && left > 0 && left <= 3 && !fresh && (
          <div className="alert alert-warn">Only {left} left. Make a new set.</div>
        )}
        {fresh && (
          <>
            <div className="alert alert-info">Your new codes. They&apos;re shown only now. The old set no longer works.</div>
            <RecoveryCodes codes={fresh} />
            <div><button className="button secondary" type="button" onClick={() => setFresh(null)}>I&apos;ve saved them</button></div>
          </>
        )}
        {error && <div className="auth-error">{error}</div>}
        {!fresh && (
          <div>
            <button className="button" type="button" onClick={() => void makeNew()} disabled={busy}>
              {busy ? "Waiting for your passkey…" : left ? "Make a new set" : "Make recovery codes"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The optional email address: notifications, and emailed recovery if the person wants it. */
export function EmailPanel({ me, withPasskey, reloadMe }: { me: AuthUser | null; withPasskey: StepUp; reloadMe: () => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const current = me?.email ?? null;

  async function save(value: string | null) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const out = await withPasskey((t) => setAccountEmail(t, value));
      setDraft("");
      setNote(out.email === null
        ? "Email address removed. Recovery by email is off; use a recovery code or a second passkey."
        : out.verification_sent
          ? `Saved. Q-Lab sent a confirmation link to ${out.email}. Open it to confirm the address.`
          : `Saved: ${out.email}.`);
      await reloadMe();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" id="email">
      <div className="panel-header">
        <h2>Email address</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Optional</span>
      </div>
      <div style={{ padding: "16px 18px", display: "grid", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
          You never need an email to sign in. An address here is used for recovery links by email and
          for notices about your account. Run and alert emails have their own address, under Notifications.
        </p>
        <div style={{ fontSize: 14 }}>
          {current ? (
            <>
              <span className="mono">{current}</span>{" "}
              <span className={`chip ${me?.email_verified ? "chip-ok" : "chip-warn"}`}>{me?.email_verified ? "confirmed" : "not confirmed"}</span>
            </>
          ) : (
            <span style={{ color: "var(--muted)" }}>No email address on this account.</span>
          )}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void save(draft.trim()); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="input" type="email" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={current ? "New address" : "you@example.org"}
            aria-label="Email address" autoComplete="email" maxLength={254} style={{ flex: "1 1 220px" }} />
          <button className="button" type="submit" disabled={busy || !draft.trim()}>{current ? "Change" : "Add"}</button>
          {current && (
            <button className="button secondary" type="button" disabled={busy} onClick={() => void save(null)}>Remove</button>
          )}
        </form>
        {note && <div className="alert alert-success" role="status">{note}</div>}
        {error && <div className="auth-error">{error}</div>}
      </div>
    </section>
  );
}
