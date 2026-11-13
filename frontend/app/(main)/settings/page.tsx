"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Copy, Cpu, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { changePassword, checkInsightsAvailable, createAPIKey, deleteAPIKey, fetchMe, listAPIKeys, deleteAccount, type APIKeyInfo, type AuthUser } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import {
  addPasskey,
  listPasskeys,
  passkeyErrorMessage,
  removePasskey,
  renamePasskey,
  signInWithPasskey,
  type PasskeyInfo,
} from "../../../lib/passkeys";
import { EmailPanel, RecoveryCodesPanel } from "./AccountRecovery";

// ── Provider credential types ─────────────────────────────────────────────────

type ProviderCred = {
  cred_id: string;
  provider: string;
  label: string;
  key_hint: string;
  is_active: boolean;
  last_used_at: string | null;
};

const PROVIDERS = [
  {
    id: "ibm",
    name: "IBM Quantum",
    desc: "Access IBM quantum computers for live queue data, real calibration, and direct job submission.",
    placeholder: "Your IBM Quantum API token",
  },
  {
    id: "ionq",
    name: "IonQ",
    desc: "Run circuits on IonQ trapped-ion quantum computers via the IonQ Cloud.",
    placeholder: "Your IonQ API key",
  },
  {
    id: "rigetti",
    name: "Rigetti QCS",
    desc: "Access Rigetti superconducting QPUs via the Quantum Cloud Services (QCS) platform.",
    placeholder: "Your Rigetti QCS API key",
  },
] as const;

async function listProviderCreds(token: string): Promise<ProviderCred[]> {
  const r = await fetch("/qlab-api/api/v1/credentials", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return [];
  return r.json();
}

async function saveProviderCred(
  token: string,
  provider: string,
  label: string,
  apiKey: string,
): Promise<ProviderCred> {
  const r = await fetch("/qlab-api/api/v1/credentials", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ provider, label, api_key: apiKey }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as Record<string, string>;
    throw new Error(err.detail ?? "Save failed");
  }
  return r.json();
}

async function testProviderCred(
  token: string,
  credId: string,
): Promise<{ status: string; error?: string }> {
  const r = await fetch(`/qlab-api/api/v1/credentials/${credId}/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.json();
}

async function deleteProviderCred(token: string, credId: string): Promise<void> {
  await fetch(`/qlab-api/api/v1/credentials/${credId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── ProviderCard component ────────────────────────────────────────────────────

function ProviderCard({
  provider,
  cred,
  token,
  onRefresh,
}: {
  provider: typeof PROVIDERS[number];
  cred: ProviderCred | null;
  token: string;
  onRefresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState(provider.name);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; error?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await saveProviderCred(token, provider.id, label || provider.name, apiKey);
      setApiKey("");
      setShowForm(false);
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!cred) return;
    setTesting(true); setTestResult(null);
    const result = await testProviderCred(token, cred.cred_id);
    setTestResult(result);
    setTesting(false);
  }

  async function handleRemove() {
    if (!cred) return;
    await deleteProviderCred(token, cred.cred_id);
    setTestResult(null);
    onRefresh();
  }

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 10,
      padding: "14px 18px", display: "grid", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{provider.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, lineHeight: 1.5 }}>{provider.desc}</div>
        </div>
        <span style={{
          flexShrink: 0, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999,
          background: cred ? "var(--ok-bg)" : "var(--panel-2)",
          color: cred ? "var(--ok)" : "var(--muted)",
        }}>
          {cred ? `Connected · …${cred.key_hint}` : "Not connected"}
        </span>
      </div>

      {cred ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="button secondary" style={{ height: 30, fontSize: 12 }} onClick={handleTest} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button className="button secondary" style={{ height: 30, fontSize: 12 }} onClick={handleRemove}>
            <Trash2 size={13} aria-hidden="true" /> Remove
          </button>
          {testResult && (
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: testResult.status === "valid" ? "var(--ok)" : "var(--danger)",
            }}>
              {testResult.status === "valid"
                ? "✓ Valid"
                : `✗ ${testResult.status}${testResult.error ? `: ${testResult.error}` : ""}`}
            </span>
          )}
        </div>
      ) : showForm ? (
        <form onSubmit={handleSave} style={{ display: "grid", gap: 8, maxWidth: 440 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Label</label>
            <input
              className="input"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={provider.name}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>API Token / Key</label>
            <input
              className="input"
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={provider.placeholder}
              required
              style={{ fontFamily: "monospace", fontSize: 13 }}
            />
          </div>
          {err && <div style={{ fontSize: 12, color: "var(--danger)" }}>{err}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="button" type="submit" disabled={saving || !apiKey}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="button secondary" type="button" onClick={() => { setShowForm(false); setErr(null); }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          className="button secondary"
          style={{ height: 32, fontSize: 13, width: "fit-content" }}
          onClick={() => setShowForm(true)}
        >
          <Plus size={14} aria-hidden="true" /> Add token
        </button>
      )}
    </div>
  );
}

function KeyRow({ k, onRevoke }: { k: APIKeyInfo; onRevoke: (id: number) => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <tr>
      <td>{k.name}</td>
      <td>
        <code style={{ fontSize: 12, background: "#f0f3f7", padding: "2px 6px", borderRadius: 4 }}>
          {k.prefix}…
        </code>
      </td>
      <td>
        <span
          style={{
            display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 12,
            background: k.is_active ? "#eaf6ef" : "#f5f5f5",
            color: k.is_active ? "#1f8a5b" : "#888",
          }}
        >
          {k.is_active ? "Active" : "Revoked"}
        </span>
      </td>
      <td style={{ fontSize: 12, color: "#5f6f80" }}>
        {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never"}
      </td>
      <td style={{ fontSize: 12, color: "#5f6f80" }}>
        {k.expires_at ? new Date(k.expires_at).toLocaleDateString() : "No expiry"}
      </td>
      <td>
        {k.is_active && (
          confirming ? (
            <span style={{ display: "flex", gap: 8 }}>
              <button className="button" style={{ background: "#e74c3c", borderColor: "#e74c3c", height: 28, fontSize: 12 }} onClick={() => onRevoke(k.id)}>Revoke</button>
              <button className="button secondary" style={{ height: 28, fontSize: 12 }} onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          ) : (
            <button className="button secondary" style={{ height: 28, fontSize: 12 }} onClick={() => setConfirming(true)}>
              <Trash2 size={13} aria-hidden="true" /> Revoke
            </button>
          )
        )}
      </td>
    </tr>
  );
}

// ── Passkeys ─────────────────────────────────────────────────────────────────

/**
 * Run `action` with a passkey session. With QLAB_PASSKEYS_ONLY the server answers 403
 * "passkey_session_required" to API-key changes from any other session: the person confirms
 * with a passkey (or, without one yet, creates their first), and the action runs again.
 */
function usePasskeyStepUp(me: AuthUser | null, reloadMe: () => Promise<void>) {
  const { token, setSession } = useAuth();
  return async function withPasskey<T>(action: (t: string) => Promise<T>): Promise<T> {
    try {
      return await action(token!);
    } catch (err) {
      if (!(err instanceof Error) || err.message !== "passkey_session_required") throw err;
    }
    const resp = (me?.passkeys ?? 0) > 0 ? await signInWithPasskey() : await addPasskey(token!);
    const meId = (me as (AuthUser & { user_id?: number }) | null)?.user_id ?? me?.id;
    if (meId !== undefined && resp.user.id !== meId) {
      throw new Error("That passkey belongs to a different account.");
    }
    setSession(resp.access_token, resp.user);
    await reloadMe();
    return action(resp.access_token);
  };
}

function PasskeysPanel({ me, reloadMe, withPasskey }: {
  me: AuthUser | null;
  reloadMe: () => Promise<void>;
  withPasskey: <T>(action: (t: string) => Promise<T>) => Promise<T>;
}) {
  const { token, setSession } = useAuth();
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  async function load(t = token) {
    if (!t) return;
    setPasskeys(await listPasskeys(t).catch(() => []));
  }

  useEffect(() => {
    if (!token) return;
    let live = true;
    void listPasskeys(token).then((list) => { if (live) setPasskeys(list); }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const add = () => run(async () => {
    // A second passkey needs a passkey session; withPasskey asks for the existing one first.
    const resp = await withPasskey((t) => addPasskey(t));
    setSession(resp.access_token, resp.user);
    await reloadMe();
    await load(resp.access_token);
  });

  const rename = (id: number, name: string) => run(async () => {
    await renamePasskey(token!, id, name);
    setEditing(null);
    await load();
  });

  const remove = (id: number) => run(async () => {
    await withPasskey((t) => removePasskey(t, id));
    await reloadMe();
    await load();
  });

  return (
    <section className="panel">
      <div className="panel-header"><h2>Passkeys</h2></div>
      <div style={{ padding: "16px 18px", display: "grid", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
          You sign in to Q-Lab with a passkey: Face ID, a fingerprint, a device PIN or a security key.
          A second passkey is a way back in if you lose a device. Press Add a passkey here, then pick
          where to keep it in your browser&apos;s prompt (this device, a security key, or a phone by
          scanning its code). Your last passkey can&apos;t be removed.
        </p>
        {me?.has_password && (
          <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
            This account still has a password. Add a passkey and the password is deleted.
          </div>
        )}
        {passkeys.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Added</th><th>Last used</th><th>Synced</th><th></th></tr>
              </thead>
              <tbody>
                {passkeys.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {editing?.id === p.id ? (
                        <form onSubmit={(e) => { e.preventDefault(); void rename(p.id, editing.name); }} style={{ display: "flex", gap: 6 }}>
                          <input className="input" value={editing.name} maxLength={100} onChange={(e) => setEditing({ id: p.id, name: e.target.value })} aria-label="Passkey name" autoFocus />
                          <button className="button" type="submit" disabled={busy || !editing.name.trim()} style={{ height: 30, fontSize: 12 }}>Save</button>
                          <button className="button secondary" type="button" onClick={() => setEditing(null)} style={{ height: 30, fontSize: 12 }}>Cancel</button>
                        </form>
                      ) : p.name}
                    </td>
                    <td style={{ fontSize: 12, color: "#5f6f80" }}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}</td>
                    <td style={{ fontSize: 12, color: "#5f6f80" }}>{p.last_used_at ? new Date(p.last_used_at).toLocaleDateString() : "Never"}</td>
                    <td style={{ fontSize: 12, color: "#5f6f80" }}>{p.backed_up ? "Yes" : "No"}</td>
                    <td>
                      <span style={{ display: "flex", gap: 8 }}>
                        <button className="button secondary" style={{ height: 28, fontSize: 12 }} onClick={() => setEditing({ id: p.id, name: p.name })} disabled={busy}>
                          <Pencil size={13} aria-hidden="true" /> Rename
                        </button>
                        <button className="button secondary" style={{ height: 28, fontSize: 12 }} onClick={() => void remove(p.id)} disabled={busy || passkeys.length <= 1}
                          title={passkeys.length <= 1 ? "Your only passkey can't be removed" : undefined}>
                          <Trash2 size={13} aria-hidden="true" /> Remove
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <div className="auth-error">{error}</div>}
        <div>
          <button className="button" type="button" onClick={() => void add()} disabled={busy}>
            <KeyRound size={15} aria-hidden="true" /> {busy ? "Waiting for your passkey…" : "Add a passkey"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ChangePasswordPanel({ token }: { token: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) { setError("New passwords do not match"); return; }
    if (next.length < 8) { setError("Password must be at least 8 characters"); return; }
    setBusy(true); setError(null); setSuccess(false);
    try {
      await changePassword(token, current, next);
      setSuccess(true);
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header"><h2>Change Password</h2></div>
      <form onSubmit={handleSubmit} style={{ padding: "16px 18px", display: "grid", gap: 12, maxWidth: 420 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#5f6f80" }}>Current password</label>
          <input className="input" type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#5f6f80" }}>New password</label>
          <input className="input" type="password" value={next} onChange={e => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, color: "#5f6f80" }}>Confirm new password</label>
          <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
        </div>
        {error && <div className="auth-error">{error}</div>}
        {success && (
          <div style={{ background: "#eaf6ef", border: "1px solid #c0e8d0", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#1f8a5b", fontWeight: 600 }}>
            Password changed successfully.
          </div>
        )}
        <div>
          <button className="button" type="submit" disabled={busy || !current || !next || !confirm}>
            <KeyRound size={15} aria-hidden="true" /> {busy ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function SettingsPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [keys, setKeys] = useState<APIKeyInfo[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [expiresDays, setExpiresDays] = useState("");
  const [insightsStatus, setInsightsStatus] = useState<{ available: boolean; model: string | null } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerCreds, setProviderCreds] = useState<ProviderCred[]>([]);
  const [me, setMe] = useState<AuthUser | null>(null);
  const reloadMe = async () => {
    const t = localStorage.getItem("qlab_token");
    if (t) setMe(await fetchMe(t).catch(() => null));
  };
  const withPasskey = usePasskeyStepUp(me, reloadMe);

  useEffect(() => {
    if (!token) { router.push("/login"); return; }
    void load();
    void loadProviderCreds();
    void fetchMe(token).then(setMe, () => setMe(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    try {
      const [list, status] = await Promise.all([
        listAPIKeys(token!),
        checkInsightsAvailable().catch(() => null),
      ]);
      setKeys(list);
      setInsightsStatus(status);
    } catch {
      setError("Failed to load API keys");
    }
  }

  async function loadProviderCreds() {
    const list = await listProviderCreds(token!).catch(() => []);
    setProviderCreds(list);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const result = await withPasskey((t) => createAPIKey(t, keyName, expiresDays ? Number(expiresDays) : undefined));
      setNewKey(result.key);
      setKeyName("");
      setExpiresDays("");
      await load();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: number) {
    try {
      await withPasskey((t) => deleteAPIKey(t, id));
      await load();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    }
  }

  return (
    <main className="page">
      {/* Profile */}
      <section className="panel">
        <div className="panel-header"><h2>Profile</h2></div>
        <div style={{ padding: "16px 18px", display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 14, fontSize: 14 }}>
            <span style={{ color: "#5f6f80", width: 100 }}>Name</span>
            <span>{user?.name ?? "—"}</span>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 14 }}>
            <span style={{ color: "#5f6f80", width: 100 }}>Email</span>
            <span>{user?.email ?? <span style={{ color: "#5f6f80" }}>None (optional, see Email address below)</span>}</span>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 14 }}>
            <span style={{ color: "#5f6f80", width: 100 }}>Role</span>
            <span style={{ textTransform: "capitalize" }}>{user?.role ?? "—"}</span>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 14 }}>
            <span style={{ color: "#5f6f80", width: 100 }}>Org ID</span>
            <span>{user?.org_id ?? "None"}</span>
          </div>
        </div>
      </section>

      {/* Passkeys (sign-in) */}
      <PasskeysPanel me={me} reloadMe={reloadMe} withPasskey={withPasskey} />
      <RecoveryCodesPanel withPasskey={withPasskey} reloadMe={reloadMe} />
      <EmailPanel me={me} withPasskey={withPasskey} reloadMe={reloadMe} />

      {/* Password: only for an account that still has one, on a server that allows passwords */}
      {me?.has_password && !me.passkeys_only && <ChangePasswordPanel token={token!} />}

      {/* Create key */}
      <section className="panel">
        <div className="panel-header"><h2>Create API Key</h2></div>
        <form onSubmit={handleCreate} style={{ padding: "16px 18px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#5f6f80" }}>Key name</label>
            <input className="input" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. CI runner" required style={{ minWidth: 200 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#5f6f80" }}>Expires in days <span style={{ color: "#aaa" }}>(optional)</span></label>
            <input className="input" type="number" value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} placeholder="e.g. 90" style={{ width: 130 }} min={1} />
          </div>
          <button className="button" type="submit" disabled={creating}>
            <Plus size={16} aria-hidden="true" /> {creating ? "Creating…" : "Create key"}
          </button>
        </form>
        {newKey && (
          <div style={{ margin: "0 18px 18px", padding: 14, background: "#eaf6ef", border: "1px solid #c0e8d0", borderRadius: 8 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "#1f8a5b", fontWeight: 600 }}>
              Copy this key now — it will not be shown again.
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <code style={{ flex: 1, fontSize: 13, wordBreak: "break-all" }}>{newKey}</code>
              <button
                className="button secondary"
                style={{ height: 32, fontSize: 12 }}
                onClick={() => void navigator.clipboard.writeText(newKey)}
                type="button"
              >
                <Copy size={13} aria-hidden="true" /> Copy
              </button>
            </div>
          </div>
        )}
        {error && <div className="empty" style={{ color: "#e74c3c" }}>{error}</div>}
      </section>

      {/* Key list */}
      <section className="panel">
        <div className="panel-header"><h2>Your API Keys ({keys.length})</h2></div>
        {keys.length === 0 ? (
          <div className="empty">No API keys yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Status</th>
                  <th>Last used</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <KeyRow key={k.id} k={k} onRevoke={handleRevoke} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Provider Connections */}
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Cpu size={16} aria-hidden="true" /> Provider Connections
          </h2>
        </div>
        <div style={{ padding: "16px 18px", display: "grid", gap: 12 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
            Connect your quantum provider accounts to unlock live queue data, real device calibration,
            and direct job submission from Q-Lab. Tokens are stored encrypted and never shared.
          </p>
          {PROVIDERS.map(p => (
            <ProviderCard
              key={p.id}
              provider={p}
              cred={providerCreds.find(c => c.provider === p.id) ?? null}
              token={token!}
              onRefresh={loadProviderCreds}
            />
          ))}
        </div>
      </section>

      {/* AI Insights status */}
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Brain size={16} /> AI Insight Engine
          </h2>
          {insightsStatus?.available ? (
            <span style={{ fontSize: 12, background: "var(--ok-bg)", color: "var(--ok)", padding: "3px 10px", borderRadius: 999, fontWeight: 600 }}>
              Active
            </span>
          ) : (
            <span style={{ fontSize: 12, background: "var(--panel-2)", color: "var(--muted)", padding: "3px 10px", borderRadius: 999, fontWeight: 600 }}>
              Not configured
            </span>
          )}
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          {insightsStatus?.available ? (
            <>
              <div style={{ fontSize: 13, color: "var(--ok)" }}>
                Claude AI insights are active. Model: <strong>{insightsStatus.model}</strong>
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Every run detail page shows a &ldquo;Generate Analysis&rdquo; button that produces a graded performance report with bottleneck identification and recommendations.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                Set <code style={{ background: "var(--panel-2)", padding: "1px 6px", borderRadius: 4 }}>ANTHROPIC_API_KEY</code> in your environment to enable AI-powered experiment analysis on every run.
              </div>
              <pre style={{ fontSize: 12, background: "var(--panel-2)", padding: "10px 14px", borderRadius: 6, overflow: "auto", margin: 0 }}>
                {`# In your .env or docker-compose.yml:\nANTHROPIC_API_KEY=sk-ant-...\n\n# Optional: use a more powerful model\nQLAB_INSIGHT_MODEL=claude-sonnet-4-6`}
              </pre>
            </>
          )}
        </div>
      </section>

      {/* SDK usage */}
      <section className="panel">
        <div className="panel-header"><h2>SDK Setup</h2></div>
        <pre className="code" style={{ margin: 0, borderRadius: "0 0 8px 8px" }}>{`pip install qlab-sdk

from qlab import QLabTracker

tracker = QLabTracker(
    api_key="qlab_YOUR_KEY",
    url="https://your-qlab-domain.com",
)
# Use tracker.run() or tracker.log_run() to track experiments.`}</pre>
      </section>

      {/* Danger zone */}
      <DangerZone withPasskey={withPasskey} />
    </main>
  );
}

function DangerZone({ withPasskey }: { withPasskey: <T>(action: (t: string) => Promise<T>) => Promise<T> }) {
  const { token, clearSession } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");

  const handleDelete = async () => {
    if (!token) return;
    setDeleting(true);
    try {
      await withPasskey((t) => deleteAccount(t));
      clearSession();
      router.push("/login?deleted=1");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete account");
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <section className="panel" style={{ border: "1px solid var(--danger)" }}>
      <div className="panel-header" style={{ borderBottom: "1px solid var(--danger)" }}>
        <h2 style={{ color: "var(--danger)" }}>Danger Zone</h2>
      </div>
      <div style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Delete Account</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Your account is locked straight away and erased 7 days later: your runs, projects only you
              use, API keys, passkeys, saved keys, integrations, notification channels and profile. Public
              share links stop at once. Sign in with your passkey within the 7 days to cancel. The security
              log keeps its entries about the account, without your name, email or browser details.
              Want a copy first? <a href="/gdpr" style={{ color: "inherit" }}>Export your data</a>.
            </div>
          </div>
          {!confirming ? (
            <button className="btn btn-danger" onClick={() => setConfirming(true)}>
              Delete Account
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>
                Delete this account? After 7 days this can&apos;t be undone.
              </div>
              {err && <div style={{ fontSize: 12, color: "var(--danger)" }}>{err}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => { setConfirming(false); setErr(""); }}>Cancel</button>
                <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting…" : "Yes, delete my account"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
