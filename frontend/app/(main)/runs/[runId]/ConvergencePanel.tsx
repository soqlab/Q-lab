"use client";

import { useEffect, useState } from "react";
import { TrendingDown } from "lucide-react";
import { fetchConvergence, ConvergenceResult, ConvergenceSeries } from "../../../../lib/api";

// ------------------------------------------------------------------
// Verdict badge
// ------------------------------------------------------------------
const VERDICT_META: Record<string, { color: string; bg: string; label: string }> = {
  converged:          { color: "#059669", bg: "#d1fae5", label: "Converged"    },
  converging:         { color: "#3b82f6", bg: "#dbeafe", label: "Converging"   },
  plateauing:         { color: "#d97706", bg: "#fef3c7", label: "Plateauing"   },
  diverging:          { color: "#dc2626", bg: "#fee2e2", label: "Diverging"    },
  insufficient_data:  { color: "#6b7280", bg: "#f3f4f6", label: "Too few steps" },
  no_energy_metric:   { color: "#6b7280", bg: "#f3f4f6", label: "Non-energy"   },
};

function VerdictBadge({ verdict }: { verdict: string }) {
  const m = VERDICT_META[verdict] ?? VERDICT_META["insufficient_data"];
  return (
    <span style={{ background: m.bg, color: m.color, fontWeight: 700, fontSize: 12, padding: "3px 10px", borderRadius: 999 }}>
      {m.label}
    </span>
  );
}

// ------------------------------------------------------------------
// SVG convergence chart — raw + smoothed lines
// ------------------------------------------------------------------
function ConvergenceChart({ series }: { series: ConvergenceSeries }) {
  const W = 440; const H = 150; const PL = 50; const PT = 8; const PB = 22; const PR = 10;
  const cW = W - PL - PR;
  const cH = H - PT - PB;

  const { steps, values, smoothed } = series;
  if (!steps.length) return null;

  const minY = Math.min(...values, ...smoothed);
  const maxY = Math.max(...values, ...smoothed);
  const rangeY = maxY - minY || 1;

  function px(i: number) { return PL + (i / (steps.length - 1)) * cW; }
  function py(v: number) { return PT + (1 - (v - minY) / rangeY) * cH; }

  const rawPath = values.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const smPath  = smoothed.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");

  const yTicks = [minY, (minY + maxY) / 2, maxY];

  const fmtV = (v: number) => Math.abs(v) >= 1000 ? v.toExponential(2) : v.toPrecision(5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
      {yTicks.map(y => (
        <g key={y}>
          <line x1={PL} y1={py(y)} x2={W - PR} y2={py(y)} stroke="var(--line)" strokeWidth={0.5} />
          <text x={PL - 4} y={py(y) + 3} fontSize={8} fill="var(--muted)" textAnchor="end">{fmtV(y)}</text>
        </g>
      ))}
      {/* Best value line */}
      <line x1={PL} y1={py(series.stats.best)} x2={W - PR} y2={py(series.stats.best)}
        stroke="#10b981" strokeWidth={0.8} strokeDasharray="3 2" />
      {/* Raw (faint) */}
      <path d={rawPath} fill="none" stroke="#94a3b8" strokeWidth={1} strokeOpacity={0.5} />
      {/* Smoothed */}
      <path d={smPath} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinejoin="round" />
      {/* X labels */}
      {[0, Math.floor(steps.length / 2), steps.length - 1].map(i => (
        <text key={i} x={px(i)} y={H - PB + 12} fontSize={8} fill="var(--muted)" textAnchor="middle">
          {steps[i]}
        </text>
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------
// Single series card
// ------------------------------------------------------------------
function SeriesCard({ series }: { series: ConvergenceSeries }) {
  const stats = series.stats;
  const conv = series.convergence;
  const impSign = (stats.improvement ?? 0) < 0 ? "+" : "";
  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{series.name}</span>
        <VerdictBadge verdict={conv.verdict} />
        {series.is_energy && <span style={{ fontSize: 11, color: "var(--muted)", background: "var(--panel-2)", padding: "1px 7px", borderRadius: 999 }}>energy-like</span>}
      </div>
      <ConvergenceChart series={series} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginTop: 12, fontSize: 12 }}>
        <div><div style={{ color: "var(--muted)" }}>Initial</div><strong>{stats.initial?.toPrecision(6) ?? "—"}</strong></div>
        <div><div style={{ color: "var(--muted)" }}>Final</div><strong>{stats.final?.toPrecision(6) ?? "—"}</strong></div>
        <div><div style={{ color: "var(--muted)" }}>Best</div><strong style={{ color: "var(--ok)" }}>{stats.best.toPrecision(6)}</strong></div>
        <div>
          <div style={{ color: "var(--muted)" }}>Improvement</div>
          <strong style={{ color: (stats.improvement ?? 0) > 0 ? "var(--ok)" : "var(--muted)" }}>
            {stats.improvement !== null ? `${impSign}${stats.improvement.toPrecision(4)}` : "—"}
            {stats.improvement_pct !== null ? ` (${stats.improvement_pct.toFixed(1)}%)` : ""}
          </strong>
        </div>
        <div><div style={{ color: "var(--muted)" }}>Steps</div><strong>{stats.total_steps}</strong></div>
        <div><div style={{ color: "var(--muted)" }}>Variance</div><strong>{stats.variance.toPrecision(4)}</strong></div>
        {conv.spread !== undefined && (
          <div><div style={{ color: "var(--muted)" }}>Last spread</div><strong>{conv.spread.toPrecision(4)}</strong></div>
        )}
        {conv.plateau_step !== null && (
          <div><div style={{ color: "var(--muted)" }}>Plateau at step</div><strong style={{ color: "var(--ok)" }}>{conv.plateau_step}</strong></div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function ConvergencePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<ConvergenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConvergence(runId)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Unavailable"));
  }, [runId]);

  if (error) return null;
  if (!data) return null;  // No loading state — only show if data exists
  if (!data.has_convergence_data) return null;  // Hide if no step metrics

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TrendingDown size={16} aria-hidden="true" /> Convergence Analysis
        </h2>
        <VerdictBadge verdict={data.prognosis} />
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
          {data.total_steps} steps · {data.series.length} series
        </span>
      </div>

      {data.best_energy !== null && (
        <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--line)", display: "flex", gap: 24, fontSize: 12 }}>
          <span style={{ color: "var(--muted)" }}>Best energy: <strong style={{ color: "var(--text)", fontSize: 14 }}>{data.best_energy.toPrecision(8)}</strong></span>
          {data.total_improvement !== null && (
            <span style={{ color: "var(--muted)" }}>Total improvement: <strong style={{ color: (data.total_improvement ?? 0) > 0 ? "var(--ok)" : "var(--muted)" }}>{data.total_improvement.toPrecision(5)}</strong></span>
          )}
        </div>
      )}

      {data.series.map(s => <SeriesCard key={s.name} series={s} />)}

      <div style={{ padding: "8px 18px", fontSize: 11, color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
        Purple line = EWMA-smoothed · Grey = raw values · Green dashes = best value
        · Use <code>qlab.log_metric(name, value, step=i)</code> to populate this panel.
      </div>
    </section>
  );
}
