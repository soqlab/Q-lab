"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { fetchCircuitDiff, CircuitDiffResult } from "../../../../../../lib/api";

// ------------------------------------------------------------------
// Similarity bar
// ------------------------------------------------------------------
function SimilarityBar({ pct }: { pct: number }) {
  const color = pct >= 0.9 ? "#10b981" : pct >= 0.6 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 160, height: 8, background: "var(--panel-2)", borderRadius: 4 }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 4, transition: "width .4s" }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color }}>{(pct * 100).toFixed(1)}% similar</span>
    </div>
  );
}

// ------------------------------------------------------------------
// Unified diff viewer
// ------------------------------------------------------------------
function DiffViewer({ lines, truncated }: { lines: string[]; truncated: boolean }) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, overflow: "auto" }}>
      {lines.map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isRem = line.startsWith("-") && !line.startsWith("---");
        const isHdr = line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++");
        return (
          <div
            key={i}
            style={{
              padding: "1px 14px",
              background: isAdd ? "#dcfce7" : isRem ? "#fee2e2" : isHdr ? "var(--panel-2)" : "transparent",
              color: isAdd ? "#166534" : isRem ? "#991b1b" : isHdr ? "var(--muted)" : "var(--text)",
              whiteSpace: "pre",
            }}
          >
            {line}
          </div>
        );
      })}
      {truncated && (
        <div style={{ padding: "8px 14px", color: "var(--muted)", fontSize: 11, fontStyle: "italic" }}>
          Diff truncated at 500 lines.
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Gate histogram delta table
// ------------------------------------------------------------------
function GateDeltaTable({ delta }: { delta: CircuitDiffResult["gate_histogram_delta"] }) {
  const rows = Object.entries(delta).filter(([, v]) => v.delta !== 0).sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta));
  if (!rows.length) return <p style={{ fontSize: 13, color: "var(--muted)", padding: "0 18px 10px" }}>Gate counts unchanged.</p>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--line)", color: "var(--muted)", fontSize: 11 }}>
            <th style={{ padding: "6px 18px", textAlign: "left" }}>Gate</th>
            <th style={{ padding: "6px 14px", textAlign: "right" }}>Run A</th>
            <th style={{ padding: "6px 14px", textAlign: "right" }}>Run B</th>
            <th style={{ padding: "6px 14px", textAlign: "right" }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([gate, { a, b, delta: d }]) => (
            <tr key={gate} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "6px 18px", fontFamily: "monospace", fontWeight: 600 }}>{gate}</td>
              <td style={{ padding: "6px 14px", textAlign: "right" }}>{a}</td>
              <td style={{ padding: "6px 14px", textAlign: "right" }}>{b}</td>
              <td style={{
                padding: "6px 14px", textAlign: "right", fontWeight: 700,
                color: d > 0 ? "#059669" : "#dc2626",
              }}>
                {d > 0 ? `+${d}` : d}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------
export default function CircuitDiffPage({ params: paramsPromise }: { params: Promise<{ runId: string; otherId: string }> }) {
  const params = use(paramsPromise);
  const { runId, otherId } = params;
  const [data, setData] = useState<CircuitDiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCircuitDiff(runId, otherId).then(setData).catch(e => setError(e instanceof Error ? e.message : "Failed"));
  }, [runId, otherId]);

  if (error) return (
    <main className="page">
      <Link className="button secondary" href={`/runs/${runId}`}><ArrowLeft size={15} /> Back</Link>
      <div className="empty" style={{ color: "var(--danger)" }}>{error}</div>
    </main>
  );

  if (!data) return (
    <main className="page">
      <div className="empty">Loading diff…</div>
    </main>
  );

  const totalGates = data.diff_stats.added + data.diff_stats.removed + data.diff_stats.unchanged;
  const fpDeltaRows = Object.entries(data.fingerprint_delta);

  return (
    <main className="page">
      <div className="toolbar">
        <Link className="button secondary" href={`/runs/${runId}`}><ArrowLeft size={15} /> Run A</Link>
        <Link className="button secondary" href={`/runs/${otherId}`}>{data.run_b.circuit_name || otherId.slice(0, 8)} ↗</Link>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Circuit Diff</h2>
          <SimilarityBar pct={data.similarity} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderBottom: "1px solid var(--line)" }}>
          {[
            { label: "Added gates", value: data.diff_stats.added, color: "#059669" },
            { label: "Removed gates", value: data.diff_stats.removed, color: "#dc2626" },
            { label: "Unchanged gates", value: data.diff_stats.unchanged, color: "var(--muted)" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ padding: "12px 18px", borderRight: "1px solid var(--line)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
              {totalGates > 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>{((value / totalGates) * 100).toFixed(1)}% of circuit</div>}
            </div>
          ))}
        </div>

        {/* Run IDs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, padding: "10px 18px", fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
          <div>A: <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>{data.run_a.circuit_name || runId.slice(0, 12)}</strong> ({data.run_a.gate_count} gates)</div>
          <div>B: <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>{data.run_b.circuit_name || otherId.slice(0, 12)}</strong> ({data.run_b.gate_count} gates)</div>
        </div>
      </section>

      {fpDeltaRows.length > 0 && (
        <section className="panel">
          <div className="panel-header"><h2>Fingerprint Changes</h2></div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)", color: "var(--muted)", fontSize: 11 }}>
                  <th style={{ padding: "6px 18px", textAlign: "left" }}>Field</th>
                  <th style={{ padding: "6px 14px", textAlign: "right" }}>Run A</th>
                  <th style={{ padding: "6px 14px", textAlign: "right" }}>Run B</th>
                </tr>
              </thead>
              <tbody>
                {fpDeltaRows.map(([k, { a, b }]) => (
                  <tr key={k} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "6px 18px", fontFamily: "monospace" }}>{k}</td>
                    <td style={{ padding: "6px 14px", textAlign: "right", color: "var(--muted)" }}>{String(a ?? "—")}</td>
                    <td style={{ padding: "6px 14px", textAlign: "right", fontWeight: 600 }}>{String(b ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-header"><h2>Gate Histogram Delta</h2></div>
        <GateDeltaTable delta={data.gate_histogram_delta} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Unified Diff</h2>
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>Gate-level changes</span>
        </div>
        {data.unified_diff.length === 0 ? (
          <p style={{ padding: "14px 18px", fontSize: 13, color: "var(--muted)", margin: 0 }}>Circuits are identical at the gate level.</p>
        ) : (
          <DiffViewer lines={data.unified_diff} truncated={data.diff_lines_truncated} />
        )}
      </section>
    </main>
  );
}
