"use client";

import { useState } from "react";
import { fetchDriftChangepoints, DriftChangepointResult, Changepoint, MetricTimeSeries } from "../../../lib/api";

const METRIC_COLOR: Record<string, string> = {
  avg_t1_us:         "#6366f1",
  avg_t2_us:         "#22c55e",
  avg_gate_error:    "#ef4444",
  avg_gate_error_2q: "#f97316",
  avg_readout_error: "#f59e0b",
};

function MiniSparkline({
  values,
  cpIndices,
  color,
  height = 40,
}: {
  values: number[];
  cpIndices: number[];
  color: string;
  height?: number;
}) {
  if (values.length < 2) return null;
  const W = 200;
  const H = height;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  });

  const cpX = cpIndices.map((i) => (i / (values.length - 1)) * W);

  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      {cpX.map((x, i) => (
        <line key={i} x1={x} y1={0} x2={x} y2={H} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3 2" opacity={0.7} />
      ))}
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function ChangepointCard({ cp }: { cp: Changepoint }) {
  const [open, setOpen] = useState(false);
  const confidence = Math.round(cp.confidence * 100);
  const confColor = confidence >= 60 ? "#ef4444" : confidence >= 30 ? "#f59e0b" : "#6b7280";

  return (
    <div style={{
      border: `1px solid ${confColor}44`, borderRadius: 8, marginBottom: 8, overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", background: `${confColor}0a`, border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          fontSize: 11, padding: "2px 8px", borderRadius: 10,
          background: `${confColor}22`, color: confColor, fontWeight: 700, flexShrink: 0,
        }}>
          {confidence}% conf.
        </span>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
          {cp.timestamp ? new Date(cp.timestamp).toLocaleString() : `Run index ${cp.index}`}
        </span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>
          {cp.affected_metrics.length} metric{cp.affected_metrics.length !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "12px 14px", background: "var(--panel-2)" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            {cp.runs_before} runs before · {cp.runs_after} runs after this changepoint
          </div>
          {Object.entries(cp.metric_shifts).map(([key, shift]) => (
            <div key={key} style={{
              display: "flex", alignItems: "center", gap: 12, marginBottom: 6,
              padding: "6px 10px", borderRadius: 6,
              background: shift.direction === "degradation" ? "#fef2f2" : "#f0fdf4",
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: METRIC_COLOR[key] ?? "#9ca3af",
              }} />
              <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>
                {key.replace("avg_", "").replace(/_/g, " ")}
              </span>
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {shift.before_mean.toPrecision(4)} → {shift.after_mean.toPrecision(4)}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: shift.direction === "degradation" ? "#dc2626" : "#16a34a",
              }}>
                {shift.pct_change > 0 ? "+" : ""}{shift.pct_change.toFixed(1)}% {shift.direction}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChangepointPanel({ backend }: { backend: string }) {
  const [data, setData] = useState<DriftChangepointResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sensitivity, setSensitivity] = useState(1.0);

  const run = async () => {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const result = await fetchDriftChangepoints(backend, 100, sensitivity);
      setData(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Drift Changepoint Detection</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <label style={{ fontSize: 12, color: "#6b7280" }}>Sensitivity:</label>
          <select
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            style={{ fontSize: 12, padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: 6 }}
          >
            <option value={0.5}>High (0.5×)</option>
            <option value={1.0}>Normal (1×)</option>
            <option value={2.0}>Low (2×)</option>
          </select>
          <button
            onClick={run}
            disabled={loading}
            style={{
              padding: "6px 14px", background: "#6366f1", color: "#fff",
              border: "none", borderRadius: 6, fontSize: 13, cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Detecting…" : "Detect Changepoints"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: "#991b1b", background: "#fef2f2", padding: "8px 12px", borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Narrative */}
          <div style={{
            fontSize: 13, lineHeight: 1.55, padding: "10px 14px", borderRadius: 6, marginBottom: 16,
            background: data.n_changepoints > 0 ? "#fef3c7" : "#f0fdf4",
            borderLeft: `3px solid ${data.n_changepoints > 0 ? "#f59e0b" : "#22c55e"}`,
            color: "#374151",
          }}>
            {data.narrative}
          </div>

          {/* Metric sparklines */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            {Object.entries(data.metrics).map(([key, metric]) => (
              <div key={key} style={{
                background: "#f9fafb", border: "1px solid #e5e7eb",
                borderRadius: 8, padding: "10px 12px", minWidth: 220,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: METRIC_COLOR[key] ?? "#9ca3af" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{metric.label}</span>
                  <span style={{
                    fontSize: 10, marginLeft: "auto",
                    color: metric.trend === "increasing" ? "#16a34a" : metric.trend === "decreasing" ? "#dc2626" : "#6b7280",
                    fontWeight: 500,
                  }}>
                    {metric.trend}
                  </span>
                </div>
                <MiniSparkline
                  values={metric.values}
                  cpIndices={metric.changepoint_indices}
                  color={METRIC_COLOR[key] ?? "#6366f1"}
                />
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
                  mean {metric.mean.toPrecision(4)} ± {metric.std.toPrecision(3)} · {metric.changepoint_indices.length} CP
                </div>
              </div>
            ))}
          </div>

          {/* Changepoint list */}
          {data.n_changepoints > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
                {data.n_changepoints} changepoint{data.n_changepoints !== 1 ? "s" : ""} detected
              </div>
              {data.changepoints.map((cp, i) => (
                <ChangepointCard key={i} cp={cp} />
              ))}
            </>
          )}

          {/* Trust window */}
          <div style={{
            fontSize: 12, padding: "8px 12px", borderRadius: 6, marginTop: 12,
            background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe",
          }}>
            <strong>Trust window:</strong> {data.trust_window.n_runs} runs after the last changepoint are safe for comparison.
          </div>
        </>
      )}
    </div>
  );
}
