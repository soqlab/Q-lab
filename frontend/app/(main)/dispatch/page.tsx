"use client";

import React, { useEffect, useState } from "react";
import { Clock, CheckCircle, XCircle, RefreshCw, Plus, Trash2, Send } from "lucide-react";
import {
  listDispatchQueue, checkDispatchQueue, enqueueDispatch,
  cancelDispatchEntry, releaseDispatchEntry,
  DispatchEntry, EnqueueResult,
} from "../../../lib/api";

const STATUS_ICON = {
  pending: <Clock size={13} style={{ color: "#f59e0b" }} />,
  released: <CheckCircle size={13} style={{ color: "#22c55e" }} />,
  cancelled: <XCircle size={13} style={{ color: "#9ca3af" }} />,
};

const STATUS_COLOR: Record<string, string> = {
  pending: "#fef3c7",
  released: "#dcfce7",
  cancelled: "#f3f4f6",
};

export default function DispatchPage() {
  const [entries, setEntries] = useState<DispatchEntry[]>([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, released: 0 });
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "released" | "cancelled">("");
  const [showForm, setShowForm] = useState(false);
  const [checkResult, setCheckResult] = useState<{ released: number; still_pending: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await listDispatchQueue(statusFilter ? { status: statusFilter } : undefined);
      setEntries(res.entries);
      setStats({ total: res.total, pending: res.pending, released: res.released });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [statusFilter]);

  async function handleCheck() {
    setChecking(true);
    setCheckResult(null);
    try {
      const r = await checkDispatchQueue();
      setCheckResult({ released: r.released, still_pending: r.still_pending });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  async function handleCancel(id: string) {
    try {
      await cancelDispatchEntry(id);
      setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "cancelled" } : e));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function handleRelease(id: string) {
    try {
      await releaseDispatchEntry(id);
      setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "released" } : e));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Release failed");
    }
  }

  return (
    <main className="page">
      <div className="toolbar">
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Dispatch Queue</h1>
        <button
          className="button secondary"
          style={{ marginLeft: "auto", height: 34 }}
          onClick={() => void handleCheck()}
          disabled={checking}
          type="button"
        >
          <RefreshCw size={14} aria-hidden="true" />
          {checking ? "Checking…" : "Check Calibration"}
        </button>
        <button
          className="button"
          style={{ height: 34 }}
          onClick={() => setShowForm(v => !v)}
          type="button"
        >
          <Plus size={14} aria-hidden="true" />
          New Entry
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard label="Total" value={stats.total} color="var(--text)" />
        <StatCard label="Pending" value={stats.pending} color="#f59e0b" />
        <StatCard label="Released" value={stats.released} color="#22c55e" />
      </div>

      {checkResult && (
        <div style={{
          padding: "10px 14px", background: "#dcfce7", border: "1px solid #86efac",
          borderRadius: 8, fontSize: 13, marginBottom: 12, color: "#15803d",
        }}>
          Check complete — {checkResult.released} released, {checkResult.still_pending} still pending.
          <button style={{ marginLeft: 12, background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#15803d", textDecoration: "underline" }}
            onClick={() => setCheckResult(null)} type="button">Dismiss</button>
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, fontSize: 13, marginBottom: 12, color: "#b91c1c" }}>
          {error}
          <button style={{ marginLeft: 12, background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#b91c1c", textDecoration: "underline" }}
            onClick={() => setError(null)} type="button">Dismiss</button>
        </div>
      )}

      {showForm && (
        <EnqueueForm onSubmit={async (body) => {
          const r = await enqueueDispatch(body);
          setShowForm(false);
          setCheckResult(null);
          void load();
          return r;
        }} onCancel={() => setShowForm(false)} />
      )}

      {/* Filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {(["", "pending", "released", "cancelled"] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            style={{
              height: 30, padding: "0 12px", fontSize: 12, borderRadius: 6, cursor: "pointer",
              border: `1px solid ${statusFilter === s ? "var(--strong)" : "var(--line)"}`,
              background: statusFilter === s ? "var(--strong)" : "transparent",
              color: statusFilter === s ? "#fff" : "var(--text)",
              fontWeight: statusFilter === s ? 600 : 400,
            }}
          >
            {s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Entries */}
      {loading ? (
        <div className="empty">Loading queue…</div>
      ) : entries.length === 0 ? (
        <div className="empty">No dispatch entries{statusFilter ? ` with status "${statusFilter}"` : ""}.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map(entry => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onCancel={handleCancel}
              onRelease={handleRelease}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: "var(--panel)", borderRadius: 8, border: "1px solid var(--line)",
      padding: "10px 18px", minWidth: 100,
    }}>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

function EntryCard({
  entry,
  onCancel,
  onRelease,
}: {
  entry: DispatchEntry;
  onCancel: (id: string) => void;
  onRelease: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const bg = STATUS_COLOR[entry.status] ?? "#f3f4f6";

  return (
    <div style={{
      background: "var(--panel)", borderRadius: 8, border: "1px solid var(--line)",
      overflow: "hidden",
    }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}
        onClick={() => setExpanded(v => !v)}
      >
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
          background: bg, border: `1px solid ${bg}`,
        }}>
          {STATUS_ICON[entry.status]}
          {entry.status}
        </span>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.circuit_name}
        </span>
        <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{entry.backend}</span>
        <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
          {new Date(entry.queued_at).toLocaleDateString()}
        </span>
        {entry.status === "pending" && (
          <div style={{ display: "flex", gap: 6, marginLeft: 8 }} onClick={e => e.stopPropagation()}>
            <button
              className="button"
              style={{ height: 26, fontSize: 11, padding: "0 8px" }}
              onClick={() => onRelease(entry.id)}
              type="button"
            >
              <Send size={11} /> Release
            </button>
            <button
              className="button secondary"
              style={{ height: 26, fontSize: 11, padding: "0 8px", color: "var(--danger)", borderColor: "var(--danger)" }}
              onClick={() => onCancel(entry.id)}
              type="button"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid var(--line)", fontSize: 13 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
            <KV label="ID" value={<code style={{ fontSize: 11 }}>{entry.id}</code>} />
            <KV label="Run ID" value={entry.run_id ?? "—"} />
            <KV label="Queued" value={new Date(entry.queued_at).toLocaleString()} />
            {entry.released_at && <KV label="Released" value={new Date(entry.released_at).toLocaleString()} />}
            {entry.release_reason && <KV label="Reason" value={entry.release_reason} />}
            {entry.notes && <KV label="Notes" value={entry.notes} />}
            {entry.webhook_url && <KV label="Webhook" value={<code style={{ fontSize: 11 }}>{entry.webhook_url}</code>} />}
          </div>

          {Object.keys(entry.thresholds).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>Thresholds</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.entries(entry.thresholds).filter(([, v]) => v != null).map(([k, v]) => (
                  <span key={k} style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 999,
                    background: "var(--panel-2)", border: "1px solid var(--line)",
                  }}>
                    {k.replace(/_/g, " ")}: {v}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}: </span>
      <span>{value}</span>
    </div>
  );
}

function EnqueueForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: Parameters<typeof enqueueDispatch>[0]) => Promise<EnqueueResult>;
  onCancel: () => void;
}) {
  const [circuitName, setCircuitName] = useState("");
  const [backend, setBackend] = useState("");
  const [runId, setRunId] = useState("");
  const [notes, setNotes] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [minT1, setMinT1] = useState("");
  const [minT2, setMinT2] = useState("");
  const [maxGe1q, setMaxGe1q] = useState("");
  const [maxGe2q, setMaxGe2q] = useState("");
  const [maxRo, setMaxRo] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<EnqueueResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!circuitName.trim() || !backend.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const thresholds: Record<string, number> = {};
      if (minT1) thresholds.min_t1_us = parseFloat(minT1);
      if (minT2) thresholds.min_t2_us = parseFloat(minT2);
      if (maxGe1q) thresholds.max_gate_error_1q = parseFloat(maxGe1q);
      if (maxGe2q) thresholds.max_gate_error_2q = parseFloat(maxGe2q);
      if (maxRo) thresholds.max_readout_error = parseFloat(maxRo);
      const r = await onSubmit({
        circuit_name: circuitName.trim(),
        backend: backend.trim(),
        run_id: runId.trim() || undefined,
        thresholds,
        webhook_url: webhookUrl.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to enqueue");
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <div style={{
        background: "var(--panel)", borderRadius: 8, border: "1px solid var(--line)",
        padding: "16px 18px", marginBottom: 16,
      }}>
        <div style={{ color: "#15803d", fontWeight: 600, marginBottom: 6 }}>
          {result.status === "released" ? "Released immediately" : "Queued"} — ID: {result.entry_id}
        </div>
        {result.status === "pending" && result.calibration_failures.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Waiting on: {result.calibration_failures.join("; ")}
          </div>
        )}
        <button className="button secondary" style={{ height: 28, fontSize: 12, marginTop: 8 }}
          onClick={onCancel} type="button">Close</button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{
      background: "var(--panel)", borderRadius: 8, border: "1px solid var(--line)",
      padding: "16px 18px", marginBottom: 16,
    }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>New Dispatch Entry</div>

      {err && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <FormField label="Circuit name *" required>
          <input className="input" value={circuitName} onChange={e => setCircuitName(e.target.value)} placeholder="e.g. VQE ansatz v3" required style={{ height: 34 }} />
        </FormField>
        <FormField label="Backend *" required>
          <input className="input" value={backend} onChange={e => setBackend(e.target.value)} placeholder="e.g. ibm_brisbane" required style={{ height: 34 }} />
        </FormField>
        <FormField label="Run ID (optional)">
          <input className="input" value={runId} onChange={e => setRunId(e.target.value)} placeholder="Link existing run" style={{ height: 34 }} />
        </FormField>
        <FormField label="Webhook URL (optional)">
          <input className="input" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://…" style={{ height: 34 }} />
        </FormField>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>
        Calibration thresholds (leave blank to release immediately)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 12 }}>
        {[
          { label: "Min T1 (µs)", val: minT1, set: setMinT1 },
          { label: "Min T2 (µs)", val: minT2, set: setMinT2 },
          { label: "Max 1Q err", val: maxGe1q, set: setMaxGe1q },
          { label: "Max 2Q err", val: maxGe2q, set: setMaxGe2q },
          { label: "Max readout", val: maxRo, set: setMaxRo },
        ].map(({ label, val, set }) => (
          <FormField key={label} label={label}>
            <input className="input" type="number" step="any" value={val}
              onChange={e => set(e.target.value)} placeholder="—" style={{ height: 34 }} />
          </FormField>
        ))}
      </div>

      <FormField label="Notes (optional)">
        <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)}
          rows={2} style={{ resize: "vertical", fontFamily: "inherit", fontSize: 13 }} />
      </FormField>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="button" type="submit" disabled={saving} style={{ height: 34 }}>
          {saving ? "Enqueueing…" : "Enqueue"}
        </button>
        <button className="button secondary" type="button" onClick={onCancel} style={{ height: 34 }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function FormField({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>
        {label}{required && " *"}
      </label>
      {children}
    </div>
  );
}
