"use client";

import { useEffect, useState } from "react";
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { fetchRobustness, RobustnessResult, RobustnessSweepPoint } from "../../../../lib/api";

// ------------------------------------------------------------------
// Label badge
// ------------------------------------------------------------------
const LABEL_META = {
  robust:   { color: "var(--ok)",     bg: "var(--ok-bg)",     icon: ShieldCheck, text: "Robust"   },
  moderate: { color: "var(--warn)",   bg: "var(--warn-bg)",   icon: Shield,      text: "Moderate" },
  fragile:  { color: "var(--danger)", bg: "var(--danger-bg)", icon: ShieldAlert, text: "Fragile"  },
};

function RobustnessLabel({ label }: { label: RobustnessResult["robustness_label"] }) {
  const meta = LABEL_META[label];
  const Icon = meta.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: meta.bg, color: meta.color,
      fontWeight: 700, fontSize: 13, padding: "3px 10px", borderRadius: 999,
    }}>
      <Icon size={13} aria-hidden="true" /> {meta.text}
    </span>
  );
}

// ------------------------------------------------------------------
// SVG line chart — 4 series over the noise multiplier sweep
// ------------------------------------------------------------------
const SERIES: { key: keyof RobustnessSweepPoint; label: string; color: string }[] = [
  { key: "fidelity",          label: "Total",     color: "#3b82f6" },
  { key: "gate_fidelity",     label: "Gate",      color: "#f59e0b" },
  { key: "coherence_fidelity",label: "Coherence", color: "#10b981" },
  { key: "readout_fidelity",  label: "Readout",   color: "#8b5cf6" },
];

function SweepChart({ sweep }: { sweep: RobustnessSweepPoint[] }) {
  const W = 480; const H = 160; const PL = 38; const PT = 10; const PB = 28; const PR = 10;
  const cW = W - PL - PR;
  const cH = H - PT - PB;

  // Multipliers on x-axis — use log scale for visual clarity
  const xVals = sweep.map(p => Math.log10(p.error_multiplier));
  const xMin = Math.min(...xVals);
  const xMax = Math.max(...xVals);

  function px(multLog: number) {
    return PL + ((multLog - xMin) / (xMax - xMin)) * cW;
  }
  function py(fid: number) {
    return PT + cH - fid * cH;
  }

  const gridYs = [0, 0.25, 0.5, 0.75, 1.0];
  // Baseline (1.0) vertical line
  const baselineX = px(Math.log10(1.0));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
      {/* Grid lines */}
      {gridYs.map(y => (
        <g key={y}>
          <line x1={PL} y1={py(y)} x2={W - PR} y2={py(y)} stroke="var(--line)" strokeWidth={0.5} />
          <text x={PL - 4} y={py(y) + 4} fontSize={9} fill="var(--muted)" textAnchor="end">{(y * 100).toFixed(0)}%</text>
        </g>
      ))}

      {/* Baseline marker */}
      <line x1={baselineX} y1={PT} x2={baselineX} y2={H - PB} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 2" />
      <text x={baselineX + 3} y={PT + 9} fontSize={8} fill="var(--muted)">1×</text>

      {/* Series lines */}
      {SERIES.map(series => {
        const d = sweep.map((pt, i) => {
          const x = px(Math.log10(pt.error_multiplier));
          const y = py(pt[series.key] as number);
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(" ");
        return <path key={series.key} d={d} fill="none" stroke={series.color} strokeWidth={2} strokeLinejoin="round" />;
      })}

      {/* Dots at baseline */}
      {SERIES.map(series => {
        const baseline = sweep.find(p => p.error_multiplier === 1.0);
        if (!baseline) return null;
        const x = px(Math.log10(1.0));
        const y = py(baseline[series.key] as number);
        return <circle key={series.key} cx={x} cy={y} r={3} fill={series.color} />;
      })}

      {/* X-axis labels */}
      {sweep.filter((_, i) => i % 2 === 0 || sweep[i].error_multiplier === 1.0).map(pt => (
        <text key={pt.error_multiplier} x={px(Math.log10(pt.error_multiplier))} y={H - PB + 14}
          fontSize={8.5} fill="var(--muted)" textAnchor="middle">
          {pt.error_multiplier}×
        </text>
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------
// Legend
// ------------------------------------------------------------------
function Legend() {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
      {SERIES.map(s => (
        <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--muted)" }}>
          <span style={{ width: 12, height: 3, background: s.color, borderRadius: 2, display: "inline-block" }} />
          {s.label}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// KPI chip
// ------------------------------------------------------------------
function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function RobustnessPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<RobustnessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRobustness(runId)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Unavailable"));
  }, [runId]);

  if (error) return null;
  if (!data) return (
    <section className="panel">
      <div className="panel-header"><h2>Noise Robustness</h2></div>
      <div className="empty" style={{ padding: 24 }}>Loading robustness sweep…</div>
    </section>
  );

  const tol = data.noise_tolerance_multiplier;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Noise Robustness Sweep</h2>
        <RobustnessLabel label={data.robustness_label} />
        {!data.has_calibration && (
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>estimated defaults</span>
        )}
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 16, padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
        <KPI label="Robustness" value={`${(data.robustness_score * 100).toFixed(0)}%`} sub="F(2×) / F(1×)" />
        <KPI label="Baseline F" value={`${(data.baseline_fidelity * 100).toFixed(1)}%`} sub="at 1× noise" />
        <KPI label="At 2× noise" value={`${(data.fidelity_at_double_noise * 100).toFixed(1)}%`} sub={`vs ${(data.fidelity_at_half_noise * 100).toFixed(0)}% at 0.5×`} />
        <KPI label="Tolerance" value={tol ? `${tol}× limit` : "> 10×"} sub="before F < 50%" />
        <KPI label="Sensitivity" value={Math.abs(data.sensitivity_per_unit_noise).toFixed(3)} sub="fidelity / noise unit" />
      </div>

      {/* Chart */}
      <div style={{ padding: "16px 18px" }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          Circuit fidelity vs noise multiplier (log x-axis, 0.1× = 10× better hardware, 10× = 10× worse)
        </div>
        <SweepChart sweep={data.sweep} />
        <Legend />
      </div>

      {/* Calibration context */}
      <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
        <span>1Q gates: <strong style={{ color: "var(--text)" }}>{data.circuit.single_qubit_gates}</strong></span>
        <span>2Q gates: <strong style={{ color: "var(--text)" }}>{data.circuit.two_qubit_gates}</strong></span>
        <span>Qubits: <strong style={{ color: "var(--text)" }}>{data.circuit.num_qubits}</strong></span>
        <span>Est. circuit time: <strong style={{ color: "var(--text)" }}>{data.circuit.circuit_time_us.toFixed(1)} µs</strong></span>
        <span>Avg gate err: <strong style={{ color: "var(--text)" }}>{(data.calibration_used.avg_gate_error * 100).toFixed(3)}%</strong></span>
        {data.calibration_used.avg_t1_us !== null && (
          <span>T1: <strong style={{ color: "var(--text)" }}>{data.calibration_used.avg_t1_us.toFixed(0)} µs</strong></span>
        )}
      </div>
    </section>
  );
}
