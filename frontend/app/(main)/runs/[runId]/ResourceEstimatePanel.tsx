"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Zap } from "lucide-react";
import { fetchResourceEstimate, ResourceEstimate } from "../../../../lib/api";

function GaugeMeter({ value, label }: { value: number; label: string }) {
  const color = value >= 0.8 ? "var(--ok)" : value >= 0.5 ? "var(--warn)" : "var(--danger)";
  const pct = Math.round(value * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 80, height: 80 }}>
        <svg width={80} height={80} viewBox="0 0 80 80">
          <circle cx={40} cy={40} r={32} fill="none" stroke="var(--line)" strokeWidth={8} />
          <circle
            cx={40} cy={40} r={32} fill="none"
            stroke={color} strokeWidth={8}
            strokeDasharray={`${2 * Math.PI * 32}`}
            strokeDashoffset={`${2 * Math.PI * 32 * (1 - value)}`}
            strokeLinecap="round"
            transform="rotate(-90 40 40)"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 15, fontWeight: 700, color,
        }}>
          {pct}%
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", fontWeight: 600 }}>
        {label}
      </div>
    </div>
  );
}

function StatRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ fontWeight: 600, fontFamily: mono ? "monospace" : undefined }}>{value}</span>
    </div>
  );
}

export default function ResourceEstimatePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<ResourceEstimate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchResourceEstimate(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const { circuit, fidelity_estimate: fe, shots_recommendation: sr, timing_estimate: te, warnings } = data;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={16} aria-hidden="true" />
          Resource Estimate
        </h2>
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
          {data.has_calibration ? "Calibration-based" : "Circuit-only estimate"}
        </span>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ borderBottom: "1px solid var(--line)" }}>
          {warnings.map((w, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: "10px 18px",
              background: "var(--warn-bg, #fef3c7)",
              borderBottom: i < warnings.length - 1 ? "1px solid var(--line)" : undefined,
            }}>
              <AlertTriangle size={14} color="var(--warn, #d97706)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13, color: "var(--text)" }}>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Fidelity gauges */}
        {fe && (
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>
              Predicted Fidelity
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
              {fe.gate_fidelity != null && (
                <GaugeMeter value={fe.gate_fidelity} label="Gate fidelity" />
              )}
              {fe.readout_fidelity != null && (
                <GaugeMeter value={fe.readout_fidelity} label="Readout fidelity" />
              )}
              {fe.combined_fidelity != null && (
                <GaugeMeter value={fe.combined_fidelity} label="Combined" />
              )}
            </div>
            {(fe.dominant_error_source || fe.bottleneck_gate) && (
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {fe.dominant_error_source && (
                  <span style={{ background: "var(--danger-bg)", color: "var(--danger-text)", fontSize: 12, padding: "3px 9px", borderRadius: 999, fontWeight: 600 }}>
                    Dominant: {fe.dominant_error_source.replace("_", " ")}
                  </span>
                )}
                {fe.bottleneck_gate && (
                  <span style={{ background: "var(--panel-2)", color: "var(--muted)", fontSize: 12, padding: "3px 9px", borderRadius: 999, fontFamily: "monospace", border: "1px solid var(--line)" }}>
                    Bottleneck: {fe.bottleneck_gate}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Circuit complexity */}
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Circuit Complexity
          </div>
          {circuit.two_qubit_gate_count != null && circuit.two_qubit_gate_count > 0 && (
            <StatRow label="Two-qubit gates" value={circuit.two_qubit_gate_count} />
          )}
          {circuit.rotation_gate_count != null && circuit.rotation_gate_count > 0 && (
            <StatRow label="Rotation gates (T-family)" value={circuit.rotation_gate_count} />
          )}
          {circuit.single_qubit_gate_count != null && (
            <StatRow label="Single-qubit gates" value={circuit.single_qubit_gate_count} />
          )}
          {circuit.non_clifford_ratio != null && (
            <StatRow label="Non-Clifford ratio" value={`${(circuit.non_clifford_ratio * 100).toFixed(1)}%`} />
          )}
        </div>

        {/* Shots recommendations */}
        {sr && (
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
              Recommended Shot Count
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {[
                { label: "1% precision", value: sr.for_1pct_precision },
                { label: "0.5% precision", value: sr.for_0_5pct_precision },
                { label: "0.1% precision", value: sr.for_0_1pct_precision },
              ].map(item => (
                <div key={item.label} style={{ background: "var(--panel-2)", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                    {item.value.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{item.label}</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>{sr.note}</p>
          </div>
        )}

        {/* Timing estimate */}
        {te && (
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
              QPU Time Estimate
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                {te.estimated_circuit_time_us}
              </span>
              <span style={{ fontSize: 14, color: "var(--muted)" }}>µs</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>{te.note}</p>
          </div>
        )}
      </div>
    </section>
  );
}
