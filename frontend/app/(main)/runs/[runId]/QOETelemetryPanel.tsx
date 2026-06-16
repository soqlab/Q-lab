"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { fetchQOETelemetry, type QOETelemetryPoint, type QOETelemetryResult } from "../../../../lib/api";

const TREND_LABEL: Record<QOETelemetryResult["coherence_trend"], string> = {
  single_snapshot: "Single snapshot",
  decaying: "Decaying",
  recovering: "Recovering",
  stable: "Stable",
};

export default function QOETelemetryPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<QOETelemetryResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQOETelemetry(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const isFallback = data.source === "final_counts";
  const trendColor =
    data.coherence_trend === "decaying" ? "var(--danger)" :
    data.coherence_trend === "recovering" ? "var(--ok)" :
    "var(--text)";

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Radio size={16} aria-hidden="true" />
          Observer Telemetry
        </h2>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
          {data.snapshot_count} snapshot{data.snapshot_count === 1 ? "" : "s"} · {data.confidence} confidence
        </span>
      </div>

      <div style={{ padding: "14px 18px", display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          <Stat label="Coherence trend" value={TREND_LABEL[data.coherence_trend]} color={trendColor} />
          <Stat label="Initial proxy" value={`${(data.initial_coherence * 100).toFixed(1)}%`} />
          <Stat label="Final proxy" value={`${(data.final_coherence * 100).toFixed(1)}%`} />
          <Stat label="Drop" value={`${(data.coherence_drop * 100).toFixed(1)}%`} color={data.coherence_drop > 0.08 ? "var(--danger)" : undefined} />
        </div>

        <TelemetryChart points={data.points} />

        {isFallback && (
          <div style={{
            padding: "8px 10px",
            border: "1px solid var(--warn)",
            background: "var(--warn-bg)",
            color: "var(--warn)",
            borderRadius: 6,
            fontSize: 12,
          }}>
            Only final measurement counts were available. Log <code>results.qoe_snapshots</code> with depth-labeled counts for true step-by-step telemetry.
          </div>
        )}

        <div style={{ fontSize: 11, color: "var(--muted)" }}>{data.note}</div>
      </div>
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</span>
    </div>
  );
}

function TelemetryChart({ points }: { points: QOETelemetryPoint[] }) {
  const W = 560;
  const H = 170;
  const PL = 36;
  const PR = 14;
  const PT = 12;
  const PB = 30;
  const cW = W - PL - PR;
  const cH = H - PT - PB;
  const depths = points.map(p => p.depth);
  const minDepth = Math.min(...depths);
  const maxDepth = Math.max(...depths);

  function x(depth: number) {
    if (maxDepth === minDepth) return PL + cW / 2;
    return PL + ((depth - minDepth) / (maxDepth - minDepth)) * cW;
  }

  function y(value: number) {
    return PT + cH - Math.max(0, Math.min(1, value)) * cH;
  }

  function path(key: "coherence_proxy" | "purity" | "correlation_signal") {
    return points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.depth).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  }

  const series = [
    { key: "coherence_proxy" as const, label: "Coherence", color: "#2563eb" },
    { key: "purity" as const, label: "Purity", color: "#16a34a" },
    { key: "correlation_signal" as const, label: "Correlation", color: "#9333ea" },
  ];

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 420, display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <g key={v}>
            <line x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} stroke="var(--line)" strokeWidth={0.5} />
            <text x={PL - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">
              {(v * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        {series.map(s => (
          <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {points.map(p => (
          <g key={`${p.index}-${p.depth}`}>
            <circle cx={x(p.depth)} cy={y(p.coherence_proxy)} r={3} fill="#2563eb" />
            <text x={x(p.depth)} y={H - 10} textAnchor="middle" fontSize={9} fill="var(--muted)">
              d{p.depth}
            </text>
          </g>
        ))}
        <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke="var(--line)" />
      </svg>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", paddingLeft: 6 }}>
        {series.map(s => (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)" }}>
            <span style={{ width: 10, height: 3, background: s.color, borderRadius: 999 }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
