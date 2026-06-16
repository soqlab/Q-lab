"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2, Zap, ZapOff } from "lucide-react";
import {
  createWebhook,
  deleteWebhook,
  fetchWebhooks,
  updateWebhook,
  type Webhook,
} from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

const ALL_EVENTS = ["run.created", "run.completed", "run.failed", "benchmark.completed"];

function EventBadge({ event }: { event: string }) {
  const color: Record<string, { bg: string; color: string }> = {
    "run.created":          { bg: "#eef7fb", color: "#0f516a" },
    "run.completed":        { bg: "#eaf6ef", color: "#1f8a5b" },
    "run.failed":           { bg: "#fdeceb", color: "#c0392b" },
    "benchmark.completed":  { bg: "#fdf4e7", color: "#a76310" },
  };
  const s = color[event] ?? { bg: "#f5f5f5", color: "#555" };
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {event}
    </span>
  );
}

function WebhookRow({ wh, token, onRefresh }: { wh: Webhook; token: string; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function toggle() {
    setBusy(true);
    try { await updateWebhook(token, wh.id, { is_active: !wh.is_active }); onRefresh(); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try { await deleteWebhook(token, wh.id); onRefresh(); }
    finally { setBusy(false); setConfirming(false); }
  }

  return (
    <tr style={{ opacity: wh.is_active ? 1 : 0.55 }}>
      <td>
        <div style={{ fontWeight: 600 }}>{wh.name}</div>
        <div style={{ fontSize: 12, color: "#5f6f80", marginTop: 2, wordBreak: "break-all" }}>{wh.url}</div>
      </td>
      <td>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {wh.events.map(e => <EventBadge key={e} event={e} />)}
        </div>
      </td>
      <td style={{ fontSize: 12, color: "#5f6f80" }}>{wh.project_slug || "All projects"}</td>
      <td>
        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600,
          background: wh.is_active ? "#eaf6ef" : "#f5f5f5", color: wh.is_active ? "#1f8a5b" : "#888" }}>
          {wh.is_active ? "Active" : "Paused"}
        </span>
      </td>
      <td style={{ fontSize: 12, color: "#5f6f80" }}>
        {wh.last_triggered_at ? new Date(wh.last_triggered_at).toLocaleString() : "Never"}
        {wh.last_status_code && (
          <span style={{ marginLeft: 6, color: wh.last_status_code < 300 ? "#1f8a5b" : "#c0392b", fontWeight: 600 }}>
            {wh.last_status_code}
          </span>
        )}
      </td>
      <td>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="button secondary" style={{ height: 28, fontSize: 12, padding: "0 10px" }} onClick={toggle} disabled={busy}>
            {wh.is_active ? <><ZapOff size={13} aria-hidden="true" /> Pause</> : <><Zap size={13} aria-hidden="true" /> Resume</>}
          </button>
          {confirming ? (
            <>
              <button className="button" style={{ background: "#e74c3c", borderColor: "#e74c3c", height: 28, fontSize: 12 }} onClick={remove} disabled={busy}>Delete</button>
              <button className="button secondary" style={{ height: 28, fontSize: 12 }} onClick={() => setConfirming(false)}>Cancel</button>
            </>
          ) : (
            <button className="button secondary" style={{ height: 28, fontSize: 12 }} onClick={() => setConfirming(true)}>
              <Trash2 size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function WebhooksPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["run.completed", "run.failed"]);
  const [projectSlug, setProjectSlug] = useState("");
  const [sign, setSign] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!token) { router.push("/login"); return; }
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    try { setHooks(await fetchWebhooks(token!)); }
    catch { setError("Failed to load webhooks"); }
  }

  function toggleEvent(ev: string) {
    setEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim() || events.length === 0) return;
    setCreating(true);
    setError(null);
    setNewSecret(null);
    try {
      const result = await createWebhook(token!, { name, url, events, project_slug: projectSlug || undefined, sign });
      if (result.secret) setNewSecret(result.secret);
      setName(""); setUrl(""); setEvents(["run.completed", "run.failed"]); setProjectSlug(""); setSign(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create webhook");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="page">
      {/* Create */}
      <section className="panel">
        <div className="panel-header"><h2>Create Webhook</h2></div>
        <form onSubmit={handleCreate} style={{ padding: "16px 18px", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, color: "#5f6f80" }}>Name</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Slack alerts" required />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, color: "#5f6f80" }}>Project filter <span style={{ color: "#aaa", fontWeight: 400 }}>(optional — blank = all)</span></label>
              <input className="input" value={projectSlug} onChange={e => setProjectSlug(e.target.value)} placeholder="e.g. vqe-2026" />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#5f6f80" }}>Endpoint URL</label>
            <input className="input" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.example.com/qlab" required />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 13, color: "#5f6f80" }}>Events</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ALL_EVENTS.map(ev => (
                <label key={ev} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={sign} onChange={e => setSign(e.target.checked)} />
              Sign payloads with HMAC-SHA256 secret
            </label>
          </div>
          {error && <div className="auth-error">{error}</div>}
          <div>
            <button className="button" type="submit" disabled={creating || events.length === 0}>
              <Plus size={16} aria-hidden="true" /> {creating ? "Creating…" : "Create webhook"}
            </button>
          </div>
        </form>

        {newSecret && (
          <div style={{ margin: "0 18px 18px", padding: 14, background: "#eaf6ef", border: "1px solid #c0e8d0", borderRadius: 8 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "#1f8a5b", fontWeight: 600 }}>
              Save this signing secret — it will not be shown again.
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <code style={{ flex: 1, fontSize: 12, wordBreak: "break-all" }}>{newSecret}</code>
              <button className="button secondary" style={{ height: 32, fontSize: 12 }} type="button"
                onClick={() => void navigator.clipboard.writeText(newSecret)}>
                <Copy size={13} aria-hidden="true" /> Copy
              </button>
            </div>
          </div>
        )}
      </section>

      {/* List */}
      <section className="panel">
        <div className="panel-header">
          <h2>Webhooks ({hooks.length})</h2>
        </div>
        {hooks.length === 0 ? (
          <div className="empty">No webhooks yet. Create one above to start receiving event notifications.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name / URL</th>
                  <th>Events</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Last triggered</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {hooks.map(wh => (
                  <WebhookRow key={wh.id} wh={wh} token={token!} onRefresh={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Payload format */}
      <section className="panel">
        <div className="panel-header"><h2>Payload Format</h2></div>
        <pre className="code" style={{ margin: 0, borderRadius: "0 0 8px 8px" }}>{`POST <your-endpoint>
Content-Type: application/json
X-Qlab-Event: run.completed
X-Qlab-Signature: sha256=<hmac-hex>  (if signing enabled)

{
  "event": "run.completed",
  "run_id": "abc123",
  "circuit_name": "vqe_ansatz",
  "backend": "ibm_sherbrooke",
  "status": "completed",
  "health_score": 87.4,
  "project": "vqe-2026",
  "created_at": "2026-06-07T14:32:00Z"
}`}</pre>
      </section>
    </main>
  );
}
