"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchRunMetricsData, type MetricPoint, type RunMetricsResponse } from "../../../../lib/api";

// ------------------------------------------------------------------
// Tiny SVG line chart — no dependencies
// ------------------------------------------------------------------
function SparkLine({ points, color = "var(--strong)" }: { points: { x: number; y: number }[]; color?: string }) {
  if (points.length < 2) {
    const p = points[0];
    return (
      <svg width="100%" height="60" viewBox="0 0 200 60" preserveAspectRatio="none">
        <circle cx={100} cy={30} r={4} fill={color} />
        <text x={100} y={24} textAnchor="middle" fontSize={11} fill={color}>{p?.y.toFixed(4)}</text>
      </svg>
    );
  }

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 300, H = 80, PAD = 6;

  function sx(x: number) {
    if (maxX === minX) return W / 2;
    return PAD + ((x - minX) / (maxX - minX)) * (W - PAD * 2);
  }
  function sy(y: number) {
    if (maxY === minY) return H / 2;
    return PAD + ((maxY - y) / (maxY - minY)) * (H - PAD * 2);
  }

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  const areaD = `${pathD} L ${sx(xs[xs.length - 1]).toFixed(1)} ${H} L ${sx(xs[0]).toFixed(1)} ${H} Z`;

  const last = points[points.length - 1];
  const first = points[0];
  const delta = last.y - first.y;
  const deltaColor = delta < 0 ? "var(--ok)" : delta > 0 ? "var(--danger)" : "var(--muted)";

  return (
    <div style={{ position: "relative" }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(t => (
          <line key={t} x1={0} x2={W} y1={PAD + t * (H - PAD * 2)} y2={PAD + t * (H - PAD * 2)}
            stroke="var(--line)" strokeWidth={0.5} />
        ))}
        {/* Area fill */}
        <path d={areaD} fill={color} opacity={0.08} />
        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* Last point dot */}
        <circle cx={sx(last.x)} cy={sy(last.y)} r={3.5} fill={color} />
      </svg>
      {/* Axis labels */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
        <span>step {first.x}</span>
        <span style={{ color: deltaColor, fontWeight: 600 }}>
          {delta > 0 ? "+" : ""}{delta.toFixed(4)} ({((delta / Math.abs(first.y || 1)) * 100).toFixed(1)}%)
        </span>
        <span>step {last.x}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Single metric card
// ------------------------------------------------------------------
function MetricCard({ name, points }: { name: string; points: MetricPoint[] }) {
  const hasSteps = points.some(p => p.step !== null && p.step !== undefined);
  const last = points[points.length - 1];
  const chartPoints = hasSteps
    ? points.map(p => ({ x: p.step ?? 0, y: p.value }))
    : points.map((p, i) => ({ x: i, y: p.value }));

  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--line)",
      borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", fontFamily: "monospace" }}>{name}</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
          {last.value.toFixed(6).replace(/\.?0+$/, "")}
        </span>
      </div>
      {points.length > 1
        ? <SparkLine points={chartPoints} />
        : <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Logged {new Date(last.logged_at).toLocaleString()}
          </div>
      }
      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        {points.length} point{points.length > 1 ? "s" : ""}
        {hasSteps ? ` · steps ${chartPoints[0].x}–${chartPoints[chartPoints.length - 1].x}` : ""}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Full panel
// ------------------------------------------------------------------
export default function MetricsPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<RunMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRunMetricsData(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading) return null;
  if (!data || data.total_points === 0) return null;

  const names = Object.keys(data.metrics).sort();

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Metrics</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {names.length} metric{names.length !== 1 ? "s" : ""} · {data.total_points.toLocaleString()} total points
        </span>
      </div>
      <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {names.map(name => (
          <MetricCard key={name} name={name} points={data.metrics[name]} />
        ))}
      </div>
    </section>
  );
}
