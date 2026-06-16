"use client";

import { useEffect, useState } from "react";
import { fetchNoiseSim, type NoiseSimResult } from "../../../../lib/api";

function BarSegment({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3, color: "#4f6070" }}>
        <span style={{ textTransform: "capitalize" }}>{label.replace(/_/g, " ")}</span>
        <span style={{ fontWeight: 600 }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 8, background: "#e8ecf0", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function MetricRow({ label, value, unit = "" }: { label: string; value: string | number | null | undefined; unit?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f0f3f7", fontSize: 13 }}>
      <span style={{ color: "#5f6f80" }}>{label}</span>
      <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{value !== null && value !== undefined ? `${value}${unit}` : "—"}</span>
    </div>
  );
}

export default function NoiseModelPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<NoiseSimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || data || error) return;
    fetchNoiseSim(runId).then(setData).catch(e => setError(String(e)));
  }, [open, runId, data, error]);

  const SEGMENT_COLORS: Record<string, string> = {
    gate_errors: "#e74c3c",
    coherence: "#e67e22",
    readout: "#3498db",
  };

  return (
    <section className="panel">
      <div
        className="panel-header"
        onClick={() => setOpen(o => !o)}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <h2>Noise Model</h2>
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ padding: "14px 18px" }}>
          {!data && !error && <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>}
          {error && <div style={{ fontSize: 13, color: "#e74c3c" }}>{error}</div>}

          {data && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {/* Noise Budget */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                  Analytical Noise Budget
                  {!data.has_calibration && (
                    <span style={{ fontSize: 11, fontWeight: 400, color: "#e67e22", marginLeft: 8 }}>(no calibration — using defaults)</span>
                  )}
                </div>
                {Object.entries(data.analytical.noise_budget).map(([key, pct]) => (
                  <BarSegment key={key} label={key} pct={pct} color={SEGMENT_COLORS[key] ?? "#888"} />
                ))}
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                  Dominant: <strong style={{ color: SEGMENT_COLORS[data.dominant_noise_source ?? ""] ?? "#555" }}>
                    {(data.dominant_noise_source ?? "—").replace(/_/g, " ")}
                  </strong>
                </div>
              </div>

              {/* Estimates */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Estimates</div>
                <MetricRow label="Estimated TVD" value={data.analytical.estimated_tvd} />
                <MetricRow label="Est. success prob." value={data.analytical.estimated_success_probability} />
                {data.real_hardware_tvd !== null && (
                  <MetricRow label="Real hardware TVD" value={data.real_hardware_tvd} />
                )}
                {data.aer_tvd !== null && (
                  <MetricRow label="Aer sim TVD (vs real)" value={data.aer_tvd} />
                )}
                {data.comparison && (
                  <div style={{ marginTop: 8, fontSize: 12, background: "#f7f8fa", border: "1px solid #dfe4ea", borderRadius: 6, padding: "8px 12px" }}>
                    {data.comparison.verdict}
                  </div>
                )}

                <div style={{ fontSize: 13, fontWeight: 700, margin: "14px 0 8px" }}>Circuit Params Used</div>
                <MetricRow label="Avg T1" value={data.analytical.parameters_used.avg_t1_us} unit=" µs" />
                <MetricRow label="Avg T2" value={data.analytical.parameters_used.avg_t2_us} unit=" µs" />
                <MetricRow label="Avg 1Q gate error" value={data.analytical.parameters_used.avg_ge_1q} />
                <MetricRow label="Avg 2Q gate error" value={data.analytical.parameters_used.avg_ge_2q} />
                <MetricRow label="Avg readout error" value={data.analytical.parameters_used.avg_ro} />
                <MetricRow label="Est. circuit time" value={data.analytical.parameters_used.estimated_circuit_time_us} unit=" µs" />
              </div>

              {/* Qubit table (full width) */}
              {data.qubit_noise_summary.length > 0 && (
                <div style={{ gridColumn: "1/-1" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Per-Qubit Calibration</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#fafbfc" }}>
                        {["Qubit", "T1 (µs)", "T2 (µs)", "Readout err", "1Q gate err"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid #edf0f3", color: "#5f6f80", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.qubit_noise_summary.map(q => (
                        <tr key={q.qubit}>
                          <td style={{ padding: "5px 10px", borderBottom: "1px solid #f4f6f9", fontWeight: 700 }}>Q{q.qubit}</td>
                          <td style={{ padding: "5px 10px", borderBottom: "1px solid #f4f6f9", fontFamily: "monospace" }}>{q.t1?.toFixed(1) ?? "—"}</td>
                          <td style={{ padding: "5px 10px", borderBottom: "1px solid #f4f6f9", fontFamily: "monospace" }}>{q.t2?.toFixed(1) ?? "—"}</td>
                          <td style={{ padding: "5px 10px", borderBottom: "1px solid #f4f6f9", fontFamily: "monospace" }}>{q.readout_error?.toExponential(2) ?? "—"}</td>
                          <td style={{ padding: "5px 10px", borderBottom: "1px solid #f4f6f9", fontFamily: "monospace" }}>{q.gate_error_1q?.toExponential(2) ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Aer simulation counts */}
              {data.aer_simulation && (
                <div style={{ gridColumn: "1/-1" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                    Aer Simulation Counts <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>({data.aer_simulation.shots} shots)</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {Object.entries(data.aer_simulation.counts).slice(0, 16).map(([state, count]) => (
                      <span key={state} style={{ fontSize: 12, fontFamily: "monospace", background: "#ebf5fb", color: "#1d6f8f", padding: "3px 8px", borderRadius: 4 }}>
                        |{state}⟩ {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
