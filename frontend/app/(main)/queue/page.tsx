"use client";
import { useEffect, useState } from "react";
import { BackendQueueStatus, QueueRecommendation, getQueueStatus, recommendBackend } from "../../../lib/api";
import { Server, Zap, Clock, RefreshCw, Award } from "lucide-react";

function StatusBadge({ status, operational }: { status: string; operational: boolean }) {
  if (operational) return <span style={{ color: "#10b981", background: "#10b98118", border: "1px solid #10b98140", borderRadius: 4, padding: "0 6px", fontSize: "0.7rem", fontWeight: 600 }}>ACTIVE</span>;
  return <span style={{ color: "#f59e0b", background: "#f59e0b18", border: "1px solid #f59e0b40", borderRadius: 4, padding: "0 6px", fontSize: "0.7rem", fontWeight: 600 }}>{status.toUpperCase()}</span>;
}

function QueueBar({ length }: { length: number }) {
  const max = 300;
  const pct = Math.min(100, (length / max) * 100);
  const color = length < 50 ? "#10b981" : length < 150 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 80, height: 6, background: "#0f172a", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.4s" }} />
      </div>
      <span style={{ color, fontSize: "0.82rem", fontFamily: "monospace", fontWeight: 600, minWidth: 32 }}>{length}</span>
    </div>
  );
}

function HourlyChart({ chart }: { chart: { hour: number; run_count: number }[] }) {
  if (!chart?.length) return null;
  const max = Math.max(...chart.map(h => h.run_count), 1);
  const H = 80; const W = 360;
  const bw = (W / 24) - 2;
  return (
    <svg width={W} height={H + 20} style={{ display: "block" }}>
      {chart.map(({ hour, run_count }) => {
        const h = (run_count / max) * H;
        const x = hour * (W / 24) + 1;
        return (
          <g key={hour}>
            <rect x={x} y={H - h} width={bw} height={h} fill={run_count < 5 ? "#10b981" : run_count < 20 ? "#f59e0b" : "#ef4444"} opacity={0.7} rx={1} />
            {hour % 6 === 0 && (
              <text x={x + bw / 2} y={H + 14} textAnchor="middle" fill="#475569" fontSize={10}>{hour}:00</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function QueuePage() {
  const [backends, setBackends] = useState<BackendQueueStatus[]>([]);
  const [source, setSource] = useState("—");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<QueueRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nQubits, setNQubits] = useState(2);
  const [maxQueue, setMaxQueue] = useState(100);
  const [sortBy, setSortBy] = useState<"queue" | "name" | "wait">("queue");
  const [filterOp, setFilterOp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setRefreshing(true); setError(null);
    try {
      const [status, rec] = await Promise.all([
        getQueueStatus(),
        recommendBackend(nQubits, maxQueue),
      ]);
      setBackends(status.backends); setSource(status.source);
      setFetchedAt(status.fetched_at); setRecommendation(rec);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, [nQubits, maxQueue]);

  const sorted = [...backends]
    .filter(b => !filterOp || b.operational)
    .sort((a, b) => {
      if (sortBy === "queue") return (a.queue_length ?? 999) - (b.queue_length ?? 999);
      if (sortBy === "wait") return (a.estimated_wait_minutes ?? 999) - (b.estimated_wait_minutes ?? 999);
      return a.name.localeCompare(b.name);
    });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
            <Server size={28} color="#3b82f6" /> Queue Intelligence
          </h1>
          <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
            Real-time backend status, queue depths, and smart scheduling recommendations.
            {source === "simulated" && (
              <span style={{ marginLeft: 8, color: "#f59e0b", fontSize: "0.8rem" }}>
                Simulated —{" "}
                <a href="/settings" style={{ color: "#f59e0b", textDecoration: "underline" }}>
                  connect your IBM account in Settings
                </a>{" "}
                for live queue data
              </span>
            )}
          </p>
        </div>
        <button onClick={load} disabled={refreshing}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 1.2rem", cursor: "pointer" }}>
          <RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>
          {error === "NO_IBM_TOKEN" ? (
            <>
              No IBM Quantum token found.{" "}
              <a href="/settings" style={{ color: "#93c5fd", textDecoration: "underline" }}>
                Connect your account in Settings → Provider Connections
              </a>{" "}
              to see live queue data.
            </>
          ) : error}
        </div>
      )}

      {recommendation && (
        <div style={{ background: "linear-gradient(135deg, #1d3a6b 0%, #1e293b 100%)", borderRadius: 12, border: "1px solid #3b82f6", padding: "1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Award size={20} color="#fbbf24" />
            <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "1rem" }}>Recommended Backend</span>
          </div>
          {recommendation.recommended ? (
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0 2rem" }}>
              <div style={{ color: "#3b82f6", fontSize: "1.5rem", fontWeight: 800, gridRow: "span 2" }}>
                {recommendation.recommended}
              </div>
              <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>{recommendation.reason}</div>
              <div style={{ display: "flex", gap: "1.5rem", color: "#64748b", fontSize: "0.8rem" }}>
                <span><Clock size={11} style={{ display: "inline", marginRight: 4 }} />~{recommendation.estimated_wait_minutes} min wait</span>
                <span>Queue: {recommendation.queue_length}</span>
                <span>{recommendation.n_qubits} qubits</span>
              </div>
            </div>
          ) : (
            <p style={{ color: "#f59e0b", fontSize: "0.9rem" }}>No backends match your criteria. Try increasing max queue length.</p>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={14} /> Min qubits:
          <input type="number" value={nQubits} onChange={e => setNQubits(Number(e.target.value))} min={1} max={127}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.35rem 0.5rem", width: 60, fontSize: "0.85rem" }} />
        </label>
        <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 8 }}>
          Max queue:
          <input type="number" value={maxQueue} onChange={e => setMaxQueue(Number(e.target.value))} min={0} max={1000}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.35rem 0.5rem", width: 70, fontSize: "0.85rem" }} />
        </label>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {(["queue", "name", "wait"] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              style={{ padding: "0.35rem 0.8rem", borderRadius: 6, border: "1px solid", fontSize: "0.8rem", cursor: "pointer",
                background: sortBy === s ? "#3b82f6" : "transparent",
                borderColor: sortBy === s ? "#3b82f6" : "#334155",
                color: sortBy === s ? "#fff" : "#64748b" }}>
              {s === "queue" ? "By Queue" : s === "name" ? "By Name" : "By Wait"}
            </button>
          ))}
          <button onClick={() => setFilterOp(f => !f)}
            style={{ padding: "0.35rem 0.8rem", borderRadius: 6, border: "1px solid", fontSize: "0.8rem", cursor: "pointer",
              background: filterOp ? "#10b981" : "transparent",
              borderColor: filterOp ? "#10b981" : "#334155",
              color: filterOp ? "#fff" : "#64748b" }}>
            Operational only
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: "#64748b", textAlign: "center", padding: "4rem" }}>Loading queue status…</div>
      ) : (
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#0f172a", color: "#64748b", fontSize: "0.8rem" }}>
                {["Backend", "Status", "Queue Depth", "Est. Wait", "Qubits", "Provider"].map(h => (
                  <th key={h} style={{ padding: "0.65rem 1rem", textAlign: "left", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((b, i) => (
                <tr key={b.name} style={{ borderTop: "1px solid #0f172a", background: i % 2 === 0 ? "transparent" : "#0f172a18" }}>
                  <td style={{ padding: "0.7rem 1rem", color: "#e2e8f0", fontWeight: 600 }}>{b.name}</td>
                  <td style={{ padding: "0.7rem 1rem" }}><StatusBadge status={b.status} operational={b.operational} /></td>
                  <td style={{ padding: "0.7rem 1rem" }}><QueueBar length={b.queue_length ?? 0} /></td>
                  <td style={{ padding: "0.7rem 1rem", color: "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}>
                    <Clock size={12} color="#64748b" />
                    {b.estimated_wait_minutes != null ? `~${b.estimated_wait_minutes} min` : "—"}
                  </td>
                  <td style={{ padding: "0.7rem 1rem", color: "#64748b" }}>{b.n_qubits ?? "—"}</td>
                  <td style={{ padding: "0.7rem 1rem", color: "#475569", fontSize: "0.8rem" }}>{b.provider}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <div style={{ color: "#64748b", textAlign: "center", padding: "3rem" }}>No backends match your filters.</div>
          )}
        </div>
      )}

      {fetchedAt && (
        <div style={{ color: "#334155", fontSize: "0.75rem", textAlign: "right", marginTop: 8 }}>
          Last fetched: {new Date(fetchedAt).toLocaleString()} · Source: {source}
        </div>
      )}
    </div>
  );
}
