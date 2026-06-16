"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { fetchPauliNoise, PauliNoiseResult } from "../../../../lib/api";

const TIER_COLOR: Record<string, string> = {
  low:       "#22c55e",
  moderate:  "#f59e0b",
  high:      "#ef4444",
  very_high: "#7c2d12",
};

const TIER_LABEL: Record<string, string> = {
  low:       "Low noise",
  moderate:  "Moderate noise",
  high:      "High noise",
  very_high: "Very high noise",
};

function FlipRateBar({ qubit, rate, isWorst }: { qubit: number; rate: number; isWorst: boolean }) {
  const pct = Math.min(rate * 100, 100);
  const color = rate < 0.1 ? "#22c55e" : rate < 0.25 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", width: 44, flexShrink: 0 }}>
        q[{qubit}]{isWorst ? " ★" : ""}
      </span>
      <div style={{ flex: 1, height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 600, width: 38, textAlign: "right" }}>
        {(rate * 100).toFixed(1)}%
      </span>
    </div>
  );
}

export default function PauliNoisePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<PauliNoiseResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPauliNoise(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const tierColor = TIER_COLOR[data.noise_tier] ?? "#9ca3af";
  const depPct = Math.round(data.effective_depolarizing_rate * 100);
  const entropyPct = Math.round(data.entropy_fraction * 100);
  const showQubits = data.qubit_flip_rates.length > 0;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={16} aria-hidden="true" />
          Pauli Noise Learning
        </h2>
        <span style={{
          marginLeft: "auto", fontSize: 11, padding: "2px 10px", borderRadius: 999,
          background: `${tierColor}18`, color: tierColor, fontWeight: 600,
          border: `1px solid ${tierColor}44`,
        }}>
          {TIER_LABEL[data.noise_tier]}
        </span>
      </div>

      <div style={{ padding: "14px 18px" }}>
        {/* Top-level stats */}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
          <StatBox label="Eff. depolarizing" value={`${depPct}%`} color={tierColor} />
          <StatBox label="Rényi-2 entropy" value={`${data.renyi2_entropy.toFixed(2)} / ${data.n_qubits}`} />
          <StatBox label="Entropy fill" value={`${entropyPct}%`} />
          <StatBox label="Mean flip rate" value={`${(data.mean_flip_rate * 100).toFixed(1)}%`} />
          <StatBox label="Heavy output" value={`${(data.heavy_output_fraction * 100).toFixed(0)}%`}
            color={data.quantum_advantage_indicator ? "#7c3aed" : undefined} />
          <StatBox label="Unique outcomes" value={`${data.unique_outcomes} / ${Math.pow(2, data.n_qubits) > 1e6 ? "2ⁿ" : Math.pow(2, data.n_qubits)}`} />
        </div>

        {/* Noise bar */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, marginBottom: 4 }}>
            Effective depolarizing rate
          </div>
          <div style={{ height: 10, borderRadius: 6, overflow: "hidden", background: "var(--line)" }}>
            <div style={{
              width: `${depPct}%`, height: "100%", borderRadius: 6,
              background: `linear-gradient(90deg, #22c55e, ${tierColor})`,
              transition: "width 0.4s",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginTop: 3 }}>
            <span>0% (pure)</span><span>100% (fully mixed)</span>
          </div>
        </div>

        {/* Interpretation */}
        <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, margin: "0 0 12px",
          padding: "8px 12px", background: `${tierColor}0d`, borderRadius: 6,
          borderLeft: `3px solid ${tierColor}` }}>
          {data.noise_interpretation}
        </p>

        {/* Per-qubit flip rates */}
        {showQubits && data.qubit_flip_rates.length <= 16 && (
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, marginBottom: 8 }}>
              Per-qubit flip rates
            </div>
            {data.qubit_flip_rates.map((rate, i) => (
              <FlipRateBar
                key={i}
                qubit={i}
                rate={rate}
                isWorst={i === data.noisiest_qubit}
              />
            ))}
          </div>
        )}

        {showQubits && data.qubit_flip_rates.length > 16 && (
          <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
            {data.qubit_flip_rates.length} qubits — per-qubit breakdown omitted for wide circuits.
            Noisiest: q[{data.noisiest_qubit}] ({((data.qubit_flip_rates[data.noisiest_qubit!] ?? 0) * 100).toFixed(1)}% flip rate).
          </div>
        )}

        {/* Calibration context */}
        {Object.keys(data.calibration_context).length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)",
            padding: "8px 12px", background: "var(--surface-2)", borderRadius: 6 }}>
            {data.calibration_context.calibration_readout_error != null && (
              <span>Calibration readout error: {(data.calibration_context.calibration_readout_error * 100).toFixed(3)}% · </span>
            )}
            {data.calibration_context.calibration_gate_error != null && (
              <span>Gate error: {(data.calibration_context.calibration_gate_error * 100).toFixed(3)}% · </span>
            )}
            {data.calibration_context.readout_vs_noise && (
              <span style={{ fontWeight: 600 }}>{data.calibration_context.readout_vs_noise}</span>
            )}
          </div>
        )}

        {/* Quantum advantage hint */}
        {data.quantum_advantage_indicator && (
          <div style={{
            marginTop: 10, fontSize: 12, padding: "6px 12px", borderRadius: 6,
            background: "#f5f0ff", color: "#7c3aed", fontWeight: 500,
            border: "1px solid #d8b4fe",
          }}>
            Heavy output fraction {(data.heavy_output_fraction * 100).toFixed(0)}% &gt; 66.7% — circuit is in the quantum advantage regime.
          </div>
        )}
      </div>
    </section>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</span>
    </div>
  );
}
