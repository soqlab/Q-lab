"use client";

import { useEffect, useState } from "react";
import { Copy, Monitor, Plus, Trash2 } from "lucide-react";
import { qlabApiPath, type AuthUser } from "../../../lib/api";
import { passkeyErrorMessage } from "../../../lib/passkeys";
import { useAuth } from "../../../lib/auth";

/**
 * Display links: Wall mode (/wall) on an office screen without anyone signing in there.
 * A link reads one sentence and one number and nothing else; it can expire and be revoked.
 */

type Metric = "last_run" | "runs_week" | "drift";

const METRICS: [Metric, string][] = [
  ["last_run", "How the latest run matched the ideal"],
  ["runs_week", "Runs in the last 7 days"],
  ["drift", "Machines whose results moved (drift alarm)"],
];

type DisplayLink = {
  id: number;
  name: string;
  metric: Metric;
  status: "active" | "revoked" | "expired";
  created_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_by: { id: number; name: string | null };
};

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(qlabApiPath(path), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(typeof err.detail === "string" ? err.detail : "Something went wrong. Try again.");
  }
  return res.json() as Promise<T>;
}

function when(iso: string | null, empty: string): string {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : empty;
}

export default function DisplayLinksPanel({ me, withPasskey }: {
  me: AuthUser | null;
  withPasskey: <T>(action: (t: string) => Promise<T>) => Promise<T>;
}) {
  const { token, user } = useAuth();
  const [links, setLinks] = useState<DisplayLink[]>([]);
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<Metric>("last_run");
  const [days, setDays] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const role = user?.role ?? me?.role;
  const orgId = user?.org_id ?? me?.org_id ?? null;
  const allowed = orgId === null || role === "owner" || role === "admin";

  async function load() {
    if (!token || !allowed) return;
    try {
      setLinks(await call<DisplayLink[]>(token, "/api/v1/display-links"));
    } catch {
      setLinks([]);
    }
  }

  useEffect(() => {
    if (!token || !allowed) return;
    let live = true;
    call<DisplayLink[]>(token, "/api/v1/display-links")
      .then((list) => { if (live) setLinks(list); }, () => { if (live) setLinks([]); });
    return () => { live = false; };
  }, [token, allowed]);

  if (!allowed) return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreated(null);
    void run(async () => {
      const body = { name: name.trim(), metric, ...(days ? { expires_days: Number(days) } : {}) };
      const res = await withPasskey((t) => call<{ path: string }>(t, "/api/v1/display-links", { method: "POST", body: JSON.stringify(body) }));
      setCreated(`${window.location.origin}${res.path}`);
      setName("");
      setDays("");
    });
  }

  const small = { height: 28, fontSize: 12 } as const;

  return (
    <section className="panel" id="display-links">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}><Monitor size={16} aria-hidden="true" /> Display links</h2>
      </div>
      <p style={{ margin: "14px 18px 0", fontSize: 13, color: "var(--muted)" }}>
        Put Q-Lab on an office screen: Wall mode shows one sentence and one number{orgId !== null ? " for your team" : ""} and
        updates every minute. Nobody signs in on the screen; the link can read only the wall, nothing else.
      </p>
      <form onSubmit={create} style={{ padding: "14px 18px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label htmlFor="dl-name" style={{ fontSize: 13, color: "var(--muted)" }}>Screen name</label>
          <input id="dl-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lab corridor TV" maxLength={120} required style={{ minWidth: 200 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label htmlFor="dl-metric" style={{ fontSize: 13, color: "var(--muted)" }}>It shows</label>
          <select id="dl-metric" className="input" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
            {METRICS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label htmlFor="dl-days" style={{ fontSize: 13, color: "var(--muted)" }}>Expires in days <span style={{ opacity: 0.7 }}>(optional)</span></label>
          <input id="dl-days" className="input" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} placeholder="e.g. 90" style={{ width: 130 }} />
        </div>
        <button className="button" type="submit" disabled={busy}>
          <Plus size={16} aria-hidden="true" /> {busy ? "Working…" : "Make display link"}
        </button>
      </form>
      {created && (
        <div style={{ margin: "0 18px 16px", padding: 14, background: "var(--ok-bg)", border: "1px solid var(--line)", borderRadius: 8 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--ok-text)", fontWeight: 600 }}>
            Open this on the screen. Copy it now: it won&apos;t be shown again.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ flex: "1 1 240px", fontSize: 13, wordBreak: "break-all" }}>{created}</code>
            <button type="button" className="button secondary" style={{ height: 32, fontSize: 12 }} onClick={() => void navigator.clipboard.writeText(created)}>
              <Copy size={13} aria-hidden="true" /> Copy
            </button>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Anyone with this link can see what the screen shows. Revoke it here when the screen goes.
          </p>
        </div>
      )}
      {error && <div className="empty" role="alert" style={{ color: "var(--danger)" }}>{error}</div>}
      {links.length === 0 ? (
        <div className="empty">No display links yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Screen</th><th>Shows</th><th>Made by</th><th>Last used</th><th>Expires</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>
                    {l.status === "active" ? (
                      <select className="input" aria-label={`What ${l.name} shows`} value={l.metric} disabled={busy} style={{ height: 30, fontSize: 12 }}
                        onChange={(e) => {
                          const m = e.target.value as Metric;
                          void run(async () => { await withPasskey((t) => call(t, `/api/v1/display-links/${l.id}`, { method: "PATCH", body: JSON.stringify({ metric: m }) })); });
                        }}>
                        {METRICS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                    ) : (METRICS.find(([id]) => id === l.metric)?.[1] ?? l.metric)}
                  </td>
                  <td style={{ fontSize: 12 }}>{l.created_by.name ?? "—"}<br /><span style={{ color: "var(--muted)" }}>{when(l.created_at, "")}</span></td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{when(l.last_used_at, "Never")}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{when(l.expires_at, "No expiry")}</td>
                  <td style={{ fontSize: 12, textTransform: "capitalize" }}>{l.status}</td>
                  <td>
                    {l.status === "active" && (confirming === l.id ? (
                      <span style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="button" style={{ ...small, background: "var(--danger)", borderColor: "var(--danger)" }}
                          onClick={() => { setConfirming(null); void run(async () => { await withPasskey((t) => call(t, `/api/v1/display-links/${l.id}`, { method: "DELETE" })); }); }}>
                          Revoke
                        </button>
                        <button type="button" className="button secondary" style={small} onClick={() => setConfirming(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className="button secondary" style={small} onClick={() => setConfirming(l.id)}>
                        <Trash2 size={13} aria-hidden="true" /> Revoke
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
