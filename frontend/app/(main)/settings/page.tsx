"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { changePassword, checkInsightsAvailable, createAPIKey, deleteAPIKey, listAPIKeys, deleteAccount, type APIKeyInfo } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

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

  useEffect(() => {
    if (!token) { router.push("/login"); return; }
    void load();
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const result = await createAPIKey(token!, keyName, expiresDays ? Number(expiresDays) : undefined);
      setNewKey(result.key);
      setKeyName("");
      setExpiresDays("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: number) {
    try {
      await deleteAPIKey(token!, id);
      await load();
    } catch {
      setError("Failed to revoke key");
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
            <span>{user?.email ?? "—"}</span>
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

      {/* Change password */}
      <ChangePasswordPanel token={token!} />

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
    url="https://soqlab.com",
)
# Use tracker.run() or tracker.log_run() to track experiments.`}</pre>
      </section>

      {/* Danger zone */}
      <DangerZone />
    </main>
  );
}

function DangerZone() {
  const { token, clearSession } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");

  const handleDelete = async () => {
    if (!token) return;
    setDeleting(true);
    try {
      await deleteAccount(token);
      clearSession();
      router.push("/login");
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
              Permanently deactivate your account. Your runs and data will be preserved for the organisation.
            </div>
          </div>
          {!confirming ? (
            <button className="btn btn-danger" onClick={() => setConfirming(true)}>
              Delete Account
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>
                Are you sure? This cannot be undone.
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
