"use client";

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { fetchQubitMap, QubitMapResult, MappedPair } from "../../../../lib/api";

// ------------------------------------------------------------------
// Readout error color
// ------------------------------------------------------------------
function roColor(e: number | null) {
  if (e === null) return "#94a3b8";
  if (e < 0.01) return "#10b981";
  if (e < 0.03) return "#f59e0b";
  return "#ef4444";
}

// ------------------------------------------------------------------
// Compact qubit chip
// ------------------------------------------------------------------
function QubitChip({ pair }: { pair: MappedPair }) {
  const color = roColor(pair.readout_error);
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "10px 14px", borderRadius: 10, border: `2px solid ${color}`,
      background: color + "18", minWidth: 80,
    }}>
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Q<sub>{pair.logical}</sub>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 2 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color }}>P{pair.physical}</span>
      </div>
      {pair.readout_error !== null && (
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
          RO {(pair.readout_error * 100).toFixed(2)}%
        </div>
      )}
      {pair.T1_us !== null && (
        <div style={{ fontSize: 10, color: "var(--muted)" }}>
          T1 {pair.T1_us.toFixed(1)}µs
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Routing overhead KPIs
// ------------------------------------------------------------------
function OverheadRow({ overhead }: { overhead: QubitMapResult["routing_overhead"] }) {
  const kpis = [
    {
      label: "Depth overhead",
      value: overhead.depth_overhead_pct !== null ? `+${overhead.depth_overhead_pct}%` : "—",
      color: (overhead.depth_overhead_pct ?? 0) > 50 ? "#ef4444" : (overhead.depth_overhead_pct ?? 0) > 20 ? "#f59e0b" : "#10b981",
    },
    { label: "SWAP gates added", value: String(overhead.swap_count), color: overhead.swap_count > 10 ? "#ef4444" : "var(--text)" },
    { label: "Original depth", value: String(overhead.depth_before ?? "—"), color: "var(--muted)" },
    { label: "Transpiled depth", value: String(overhead.depth_after ?? "—"), color: "var(--text)" },
    { label: "Original gates", value: String(overhead.size_before ?? "—"), color: "var(--muted)" },
    { label: "Transpiled gates", value: String(overhead.size_after ?? "—"), color: "var(--text)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 0 }}>
      {kpis.map(k => (
        <div key={k.label} style={{ padding: "10px 14px", borderRight: "1px solid var(--line)" }}>
          <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>{k.label}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: k.color }}>{k.value}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function QubitMapPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<QubitMapResult | null>(null);

  useEffect(() => {
    fetchQubitMap(runId).then(setData).catch(() => null);
  }, [runId]);

  if (!data) return null;

  // Only show if we have layout data OR routing overhead info
  const hasOverhead = data.routing_overhead.depth_before !== null || data.routing_overhead.swap_count > 0;
  if (!data.has_layout && !hasOverhead) return null;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Cpu size={16} aria-hidden="true" /> Qubit Mapping &amp; Routing
        </h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {data.num_qubits} logical qubits
          {data.transpiler_version && ` · Qiskit ${data.transpiler_version}`}
          {data.transpiler_duration_ms && ` · transpiled in ${data.transpiler_duration_ms}ms`}
        </span>
      </div>

      {/* Routing overhead */}
      <div style={{ borderBottom: "1px solid var(--line)" }}>
        <OverheadRow overhead={data.routing_overhead} />
      </div>

      {/* Logical → Physical qubit chips */}
      {data.has_layout && data.mapped_pairs.length > 0 && (
        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Logical → Physical Mapping
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {data.mapped_pairs.map(p => (
              <QubitChip key={p.logical} pair={p} />
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
            Border colour = readout error (green &lt;1%, amber &lt;3%, red ≥3%).
          </div>
        </div>
      )}

      {!data.has_layout && (
        <div style={{ padding: "12px 18px", fontSize: 13, color: "var(--muted)" }}>
          No layout information in transpiler data.
          Pass <code>initial_layout</code> in the transpiler dict when submitting to populate this panel.
        </div>
      )}
    </section>
  );
}
