"use client";

import { useEffect, useState } from "react";
import { Mountain } from "lucide-react";
import { fetchLandscape, LandscapeResult, LandscapeSeries } from "../../../../lib/api";

// ------------------------------------------------------------------
// SVG line chart for a 1D landscape series
// ------------------------------------------------------------------
function LandscapeChart({ series }: { series: LandscapeSeries }) {
  const W = 480; const H = 160; const PL = 60; const PT = 10; const PB = 24; const PR = 12;
  const cW = W - PL - PR;
  const cH = H - PT - PB;

  const { x_values: xs, y_values: ys } = series;
  if (xs.length < 2) return null;

  const minX = xs[0]; const maxX = xs[xs.length - 1]; const rangeX = maxX - minX || 1;
  const minY = Math.min(...ys); const maxY = Math.max(...ys); const rangeY = maxY - minY || 1;

  function px(x: number) { return PL + ((x - minX) / rangeX) * cW; }
  function py(y: number) { return PT + (1 - (y - minY) / rangeY) * cH; }

  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${px(x).toFixed(1)},${py(ys[i]).toFixed(1)}`).join(" ");
  const minYx = xs[ys.indexOf(minY)];

  const yTicks = [minY, (minY + maxY) / 2, maxY];
  const fmtV = (v: number) => Math.abs(v) >= 1000 || Math.abs(v) < 0.001 ? v.toExponential(2) : v.toPrecision(5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
      {/* Grid + y-labels */}
      {yTicks.map(y => (
        <g key={y}>
          <line x1={PL} y1={py(y)} x2={W - PR} y2={py(y)} stroke="var(--line)" strokeWidth={0.5} />
          <text x={PL - 4} y={py(y) + 3} fontSize={8} fill="var(--muted)" textAnchor="end">{fmtV(y)}</text>
        </g>
      ))}
      {/* Minimum marker */}
      <line x1={px(minYx)} y1={PT} x2={px(minYx)} y2={H - PB} stroke="#10b981" strokeWidth={0.8} strokeDasharray="3 2" />
      <circle cx={px(minYx)} cy={py(minY)} r={4} fill="#10b981" />
      {/* Main line */}
      <path d={path} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinejoin="round" />
      {/* Filled area */}
      <path
        d={`${path} L${px(maxX).toFixed(1)},${(PT + cH).toFixed(1)} L${PL},${(PT + cH).toFixed(1)} Z`}
        fill="#6366f1"
        fillOpacity={0.08}
      />
      {/* X labels */}
      {[0, Math.floor(xs.length / 2), xs.length - 1].map(i => (
        <text key={i} x={px(xs[i])} y={H - PB + 12} fontSize={8} fill="var(--muted)" textAnchor="middle">
          {xs[i].toPrecision(4)}
        </text>
      ))}
      {/* Axis labels */}
      <text x={PL - 40} y={PT + cH / 2} fontSize={8} fill="var(--muted)" textAnchor="middle"
        transform={`rotate(-90,${PL - 40},${PT + cH / 2})`}>{series.y_label}</text>
      <text x={PL + cW / 2} y={H} fontSize={8} fill="var(--muted)" textAnchor="middle">{series.x_label}</text>
    </svg>
  );
}

// ------------------------------------------------------------------
// 2D scatter scatter panel (param vs energy)
// ------------------------------------------------------------------
function ScatterChart({ grid }: { grid: NonNullable<LandscapeResult["grid_2d"]> }) {
  const W = 380; const H = 160; const PL = 60; const PT = 10; const PB = 24; const PR = 12;
  const cW = W - PL - PR; const cH = H - PT - PB;

  const pts = grid.points;
  const xs = pts.map(p => p.param); const ys = pts.map(p => p.energy);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const rangeX = maxX - minX || 1;
  const minY = Math.min(...ys); const maxY = Math.max(...ys); const rangeY = maxY - minY || 1;

  function px(x: number) { return PL + ((x - minX) / rangeX) * cW; }
  function py(y: number) { return PT + (1 - (y - minY) / rangeY) * cH; }

  const minPt = pts.reduce((a, b) => b.energy < a.energy ? b : a);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
      <line x1={PL} y1={py(minY)} x2={W - PR} y2={py(minY)} stroke="var(--line)" strokeWidth={0.5} />
      <line x1={PL} y1={py(maxY)} x2={W - PR} y2={py(maxY)} stroke="var(--line)" strokeWidth={0.5} />
      {pts.map((p, i) => (
        <circle key={i} cx={px(p.param)} cy={py(p.energy)} r={3}
          fill={p === minPt ? "#10b981" : "#6366f1"}
          fillOpacity={p === minPt ? 1 : 0.6} />
      ))}
      {/* Axis labels */}
      <text x={PL + cW / 2} y={H} fontSize={8} fill="var(--muted)" textAnchor="middle">{grid.param_name}</text>
      <text x={PL - 40} y={PT + cH / 2} fontSize={8} fill="var(--muted)" textAnchor="middle"
        transform={`rotate(-90,${PL - 40},${PT + cH / 2})`}>{grid.energy_name}</text>
    </svg>
  );
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function LandscapePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<LandscapeResult | null>(null);

  useEffect(() => {
    fetchLandscape(runId).then(setData).catch(() => null);
  }, [runId]);

  if (!data || !data.has_landscape_data) return null;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Mountain size={16} aria-hidden="true" /> Parameter Landscape
        </h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {data.series.length} energy series
          {data.param_names.length > 0 && ` · params: ${data.param_names.join(", ")}`}
        </span>
      </div>

      {data.series.map(s => (
        <div key={s.name} style={{ borderTop: "1px solid var(--line)", padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</span>
            <span style={{ fontSize: 12, color: "var(--ok)" }}>
              min = {s.min_value.toPrecision(6)} at step {s.min_at_step.toPrecision(4)}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{s.point_count} points</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: data.grid_2d ? "1fr 1fr" : "1fr", gap: 18 }}>
            <LandscapeChart series={s} />
            {data.grid_2d && data.grid_2d.energy_name === s.name && (
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Energy vs {data.grid_2d.param_name}
                </div>
                <ScatterChart grid={data.grid_2d} />
              </div>
            )}
          </div>
        </div>
      ))}

      <div style={{ padding: "8px 18px", fontSize: 11, color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
        Green dashes / dots mark the minimum energy point.
        Log metrics with <code>qlab.log_metric(&quot;energy&quot;, val, step=theta)</code>.
      </div>
    </section>
  );
}
