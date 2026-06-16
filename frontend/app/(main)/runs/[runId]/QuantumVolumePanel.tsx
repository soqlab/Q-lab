"use client";

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { fetchQuantumVolume, QuantumVolumeResult, QVSweepPoint } from "../../../../lib/api";

// ------------------------------------------------------------------
// Grade badge
// ------------------------------------------------------------------
const GRADE_META = {
  excellent: { color: "#7c3aed", bg: "#ede9fe", label: "Excellent" },
  good:      { color: "#059669", bg: "#d1fae5", label: "Good"      },
  moderate:  { color: "#d97706", bg: "#fef3c7", label: "Moderate"  },
  limited:   { color: "#dc2626", bg: "#fee2e2", label: "Limited"   },
};

function GradeBadge({ grade }: { grade: QuantumVolumeResult["grade"] }) {
  const m = GRADE_META[grade];
  return (
    <span style={{ background: m.bg, color: m.color, fontWeight: 700, fontSize: 12, padding: "3px 10px", borderRadius: 999 }}>
      {m.label}
    </span>
  );
}

// ------------------------------------------------------------------
// QV number display (large, log-scale label)
// ------------------------------------------------------------------
function QVDisplay({ qv, log2qv }: { qv: number; log2qv: number }) {
  return (
    <div style={{ textAlign: "center", padding: "8px 0" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        Estimated Quantum Volume
      </div>
      <div style={{ fontSize: 52, fontWeight: 800, color: "var(--strong)", lineHeight: 1 }}>
        {qv >= 1024 ? `2^${log2qv}` : qv}
      </div>
      {log2qv > 0 && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          log₂(QV) = {log2qv}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Fidelity sweep chart — shows when combined_fidelity drops below 2/3
// ------------------------------------------------------------------
function SweepChart({ sweep, threshold }: { sweep: QVSweepPoint[]; threshold: number }) {
  const W = 380; const H = 120; const PL = 30; const PT = 8; const PB = 22; const PR = 8;
  const cW = W - PL - PR;
  const cH = H - PT - PB;

  const maxD = sweep[sweep.length - 1]?.d ?? 12;
  const step = cW / (maxD - 1);

  function px(d: number) { return PL + (d - 1) * step; }
  function py(f: number) { return PT + cH - Math.min(1, Math.max(0, f)) * cH; }

  const totalD = sweep.map((pt, i) => ({ ...pt, i }));
  const totalPath = totalD.map((pt, i) => `${i === 0 ? "M" : "L"}${px(pt.d).toFixed(1)},${py(pt.combined_fidelity).toFixed(1)}`).join(" ");
  const gatePath  = totalD.map((pt, i) => `${i === 0 ? "M" : "L"}${px(pt.d).toFixed(1)},${py(pt.gate_fidelity).toFixed(1)}`).join(" ");
  const cohPath   = totalD.map((pt, i) => `${i === 0 ? "M" : "L"}${px(pt.d).toFixed(1)},${py(pt.coherence_fidelity).toFixed(1)}`).join(" ");

  const threshY = py(threshold);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
      {/* Grid */}
      {[0, 0.5, threshold, 1].map(y => (
        <g key={y}>
          <line x1={PL} y1={py(y)} x2={W - PR} y2={py(y)} stroke="var(--line)" strokeWidth={0.5} />
          <text x={PL - 3} y={py(y) + 3} fontSize={8} fill="var(--muted)" textAnchor="end">{(y * 100).toFixed(0)}</text>
        </g>
      ))}
      {/* Threshold line */}
      <line x1={PL} y1={threshY} x2={W - PR} y2={threshY} stroke="var(--danger)" strokeWidth={1} strokeDasharray="4 2" />
      <text x={W - PR - 2} y={threshY - 3} fontSize={8} fill="var(--danger)" textAnchor="end">2/3</text>
      {/* Series */}
      <path d={gatePath}  fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2" />
      <path d={cohPath}   fill="none" stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 2" />
      <path d={totalPath} fill="none" stroke="#3b82f6" strokeWidth={2} />
      {/* Dots */}
      {sweep.map(pt => (
        <circle key={pt.d} cx={px(pt.d)} cy={py(pt.combined_fidelity)} r={pt.above_threshold ? 3 : 2}
          fill={pt.above_threshold ? "#3b82f6" : "var(--danger)"} />
      ))}
      {/* X labels */}
      {sweep.filter(pt => pt.d === 1 || pt.d % 2 === 0).map(pt => (
        <text key={pt.d} x={px(pt.d)} y={H - PB + 12} fontSize={8} fill="var(--muted)" textAnchor="middle">
          d={pt.d}
        </text>
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function QuantumVolumePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<QuantumVolumeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchQuantumVolume(runId)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Unavailable"));
  }, [runId]);

  if (error) return null;
  if (!data) return (
    <section className="panel">
      <div className="panel-header"><h2>Quantum Volume</h2></div>
      <div className="empty" style={{ padding: 24 }}>Estimating QV…</div>
    </section>
  );

  const cal = data.calibration_used;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Cpu size={16} aria-hidden="true" /> Quantum Volume
        </h2>
        <GradeBadge grade={data.grade} />
        {!data.has_calibration && (
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>(estimated defaults)</span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        {/* Left — QV number */}
        <div style={{ padding: "16px 18px", borderRight: "1px solid var(--line)" }}>
          <QVDisplay qv={data.estimated_qv} log2qv={data.log2_qv} />
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Max reliable depth</span>
              <strong style={{ color: "var(--text)" }}>{data.max_reliable_depth}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Fidelity threshold</span>
              <strong style={{ color: "var(--text)" }}>{(data.fidelity_threshold * 100).toFixed(1)}%</strong>
            </div>
            {data.num_qubits > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Qubits in run</span>
                <strong style={{ color: "var(--text)" }}>{data.num_qubits}</strong>
              </div>
            )}
          </div>
          <div style={{ marginTop: 10, padding: "6px 8px", background: "var(--panel-2)", borderRadius: 6, fontSize: 11, color: "var(--muted)" }}>
            {data.note}
          </div>
        </div>

        {/* Right — sweep chart */}
        <div style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
            Fidelity vs circuit depth (square model) — blue line is combined, dashed: gate (amber) / coherence (green)
          </div>
          <SweepChart sweep={data.sweep} threshold={data.fidelity_threshold} />
        </div>
      </div>

      {/* Calibration row */}
      <div style={{ padding: "10px 18px", borderTop: "1px solid var(--line)", display: "flex", gap: 20, flexWrap: "wrap", fontSize: 11, color: "var(--muted)" }}>
        <span>1Q err: <strong style={{ color: "var(--text)" }}>{(cal.avg_gate_1q_error * 100).toFixed(4)}%</strong></span>
        <span>2Q err: <strong style={{ color: "var(--text)" }}>{(cal.avg_gate_2q_error * 100).toFixed(3)}%</strong></span>
        <span>RO err: <strong style={{ color: "var(--text)" }}>{(cal.avg_readout_error * 100).toFixed(2)}%</strong></span>
        {cal.avg_t1_us !== null && <span>T1: <strong style={{ color: "var(--text)" }}>{cal.avg_t1_us.toFixed(0)} µs</strong></span>}
        {cal.avg_t2_us !== null && <span>T2: <strong style={{ color: "var(--text)" }}>{cal.avg_t2_us.toFixed(0)} µs</strong></span>}
      </div>
    </section>
  );
}
