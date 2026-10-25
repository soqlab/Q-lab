"use client";

import { useEffect, useState } from "react";
import { TrendingDown, TrendingUp, Minus, AlertTriangle, Activity } from "lucide-react";
import { fetchCalibrationDrift, fetchCalibrationForecast, CalibrationDrift, DriftPoint, CalibrationForecastResult, MetricForecast } from "../../../lib/api";
import ChangepointPanel from "./ChangepointPanel";
import PassiveRBPanel from "./PassiveRBPanel";
import DeviceFingerprintPanel from "./DeviceFingerprintPanel";
import HamiltonianPanel from "./HamiltonianPanel";
import MilestonePredictPanel from "./MilestonePredictPanel";

// ------------------------------------------------------------------
// Mini sparkline for a drift series
// ------------------------------------------------------------------
function DriftChart({
  points,
  width = 420,
  height = 140,
  color,
  unit,
}: {
  points: DriftPoint[];
  width?: number;
  height?: number;
  color: string;
  unit: string;
}) {
  if (!points || points.length < 2) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--muted)" }}>
        Not enough data
      </div>
    );
  }

  const PAD = { top: 12, right: 16, bottom: 32, left: 52 };
  const W = width - PAD.left - PAD.right;
  const H = height - PAD.top - PAD.bottom;

  const values = points.map(p => p.v);
  const times = points.map(p => new Date(p.t).getTime());

  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rangeV = maxV - minV || 1;
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const rangeT = maxT - minT || 1;

  function px(p: DriftPoint) {
    const x = PAD.left + ((new Date(p.t).getTime() - minT) / rangeT) * W;
    const y = PAD.top + H - ((p.v - minV) / rangeV) * H;
    return { x, y };
  }

  const pathD = points.map((p, i) => {
    const { x, y } = px(p);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  // Y axis labels
  const yTicks = [minV, minV + rangeV * 0.5, maxV];

  // X axis: first and last date
  const fmt = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <svg width={width} height={height} style={{ overflow: "visible", display: "block" }}>
      {/* Grid lines */}
      {yTicks.map((v, i) => {
        const y = PAD.top + H - ((v - minV) / rangeV) * H;
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={PAD.left + W} y2={y} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="var(--muted)">
              {v.toFixed(v < 10 ? 4 : 1)}
            </text>
          </g>
        );
      })}

      {/* X axis labels */}
      <text x={PAD.left} y={PAD.top + H + 20} textAnchor="start" fontSize={10} fill="var(--muted)">{fmt(minT)}</text>
      <text x={PAD.left + W} y={PAD.top + H + 20} textAnchor="end" fontSize={10} fill="var(--muted)">{fmt(maxT)}</text>

      {/* Unit label */}
      <text x={6} y={PAD.top + H / 2} textAnchor="middle" fontSize={10} fill="var(--muted)" transform={`rotate(-90,6,${PAD.top + H / 2})`}>
        {unit}
      </text>

      {/* Data line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* Dots */}
      {points.map((p, i) => {
        const { x, y } = px(p);
        return (
          <circle key={i} cx={x} cy={y} r={3} fill={color}>
            <title>{new Date(p.t).toLocaleString()} — {p.v} {unit} (run {p.run_id.slice(0, 8)})</title>
          </circle>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------
// Trend badge
// ------------------------------------------------------------------
function TrendBadge({ slope, label }: { slope: number; label: string }) {
  const isImproving = (label.includes("t1") || label.includes("t2"))
    ? slope >= 0
    : slope <= 0; // error metrics improve when going down

  const magnitude = Math.abs(slope);
  const display = magnitude < 0.0001 ? "stable" : magnitude < 0.001 ? "slight" : "strong";

  if (magnitude < 0.00001) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)" }}>
        <Minus size={13} /> Stable
      </span>
    );
  }

  const color = isImproving ? "var(--ok)" : "var(--danger)";
  const Icon = slope > 0 ? TrendingUp : TrendingDown;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color, fontWeight: 600 }}>
      <Icon size={13} />
      {isImproving ? "Improving" : "Degrading"} ({display})
    </span>
  );
}

// ------------------------------------------------------------------
// Series config
// ------------------------------------------------------------------
const SERIES_CONFIG = [
  { key: "avg_t1_us", label: "T1 Coherence", unit: "µs", color: "var(--strong, #6366f1)" },
  { key: "avg_t2_us", label: "T2 Coherence", unit: "µs", color: "var(--ok, #22c55e)" },
  { key: "avg_gate_error", label: "Gate Error", unit: "err rate", color: "var(--warn, #f59e0b)" },
  { key: "avg_readout_error", label: "Readout Error", unit: "err rate", color: "var(--danger, #ef4444)" },
] as const;

type SeriesKey = typeof SERIES_CONFIG[number]["key"];

// ------------------------------------------------------------------
// Calibration Forecast Panel
// ------------------------------------------------------------------

const METRIC_LABELS: Record<string, { label: string; unit: string; color: string; higherIsBetter: boolean }> = {
  t1: { label: "T1", unit: "µs", color: "#3b82f6", higherIsBetter: true },
  t2: { label: "T2", unit: "µs", color: "#8b5cf6", higherIsBetter: true },
  gate_error: { label: "Gate error", unit: "rate", color: "#f59e0b", higherIsBetter: false },
  readout: { label: "Readout error", unit: "rate", color: "#ef4444", higherIsBetter: false },
};

function ForecastChart({ m, cfg }: { m: MetricForecast; cfg: typeof METRIC_LABELS[string] }) {
  if (!m.forecast_points || m.forecast_points.length === 0) return null;
  const pts = m.forecast_points;
  const W = 460; const H = 110;
  const PAD = { top: 10, right: 12, bottom: 28, left: 48 };
  const CW = W - PAD.left - PAD.right;
  const CH = H - PAD.top - PAD.bottom;

  const allVals = pts.flatMap(p => [p.lower, p.upper]);
  if (m.last_value != null) allVals.push(m.last_value);
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const rangeV = maxV - minV || 1;

  const times = pts.map(p => new Date(p.time).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const rangeT = maxT - minT || 1;

  function px(t: number, v: number) {
    return {
      x: PAD.left + ((t - minT) / rangeT) * CW,
      y: PAD.top + CH - ((v - minV) / rangeV) * CH,
    };
  }

  const midPath = pts.map((p, i) => {
    const { x, y } = px(new Date(p.time).getTime(), p.predicted);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const upperPath = pts.map(p => {
    const { x, y } = px(new Date(p.time).getTime(), p.upper);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lowerPath = [...pts].reverse().map(p => {
    const { x, y } = px(new Date(p.time).getTime(), p.lower);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const bandPath = `M${upperPath[0]} L${upperPath.join(" L")} L${lowerPath[0]} L${lowerPath.join(" L")} Z`;

  const yTicks = [minV, minV + rangeV * 0.5, maxV];
  const fmt = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <svg width={W} height={H}>
      {/* CI band */}
      <path d={bandPath} fill={cfg.color} fillOpacity={0.12} />
      {/* Forecast line */}
      <path d={midPath} stroke={cfg.color} strokeWidth={2} fill="none" strokeDasharray="4 3" />
      {/* Y axis ticks */}
      {yTicks.map(v => {
        const y = PAD.top + CH - ((v - minV) / rangeV) * CH;
        return (
          <g key={v}>
            <line x1={PAD.left - 4} y1={y} x2={PAD.left} y2={y} stroke="var(--line)" />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={9} fill="var(--muted)">
              {v < 0.001 ? v.toExponential(1) : v.toFixed(v < 1 ? 3 : 1)}
            </text>
          </g>
        );
      })}
      {/* X axis */}
      <text x={PAD.left} y={H - 4} fontSize={9} fill="var(--muted)">now+2h</text>
      <text x={W - PAD.right} y={H - 4} fontSize={9} textAnchor="end" fill="var(--muted)">
        +{Math.round(rangeT / 3_600_000)}h
      </text>
    </svg>
  );
}

function ForecastPanel({ loading, forecast }: { loading: boolean; forecast: CalibrationForecastResult | null }) {
  const DIRECTION_ICON: Record<string, React.JSX.Element> = {
    improving: <TrendingUp size={12} style={{ color: "#22c55e" }} />,
    degrading: <TrendingDown size={12} style={{ color: "#ef4444" }} />,
    stable: <Minus size={12} style={{ color: "#9ca3af" }} />,
  };

  return (
    <section className="panel" style={{ marginTop: 18 }}>
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TrendingUp size={16} aria-hidden="true" />
          24-Hour Calibration Forecast
        </h2>
        {forecast && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
            {forecast.run_count} calibration runs · EWMA + linear drift
          </span>
        )}
      </div>

      {loading && (
        <div style={{ padding: "14px 18px", color: "var(--muted)", fontSize: 13 }}>
          Generating forecast…
        </div>
      )}

      {forecast && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 1, borderTop: "1px solid var(--line)" }}>
          {Object.entries(forecast.metrics).map(([key, m]) => {
            const cfg = METRIC_LABELS[key];
            if (!cfg || !m) return null;
            if (m.insufficient_data) {
              return (
                <div key={key} style={{ padding: "14px 18px", borderRight: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>{cfg.label}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Insufficient data ({m.data_points ?? 0} / {m.required} points needed)
                  </div>
                </div>
              );
            }
            return (
              <div key={key} style={{ padding: "14px 18px", borderRight: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
                  {m.trend_direction && (
                    <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--muted)" }}>
                      {DIRECTION_ICON[m.trend_direction]}
                      {m.trend_direction}
                    </span>
                  )}
                </div>
                {m.last_value != null && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
                    Current: {m.last_value < 0.001 ? m.last_value.toExponential(2) : m.last_value.toFixed(m.last_value < 1 ? 4 : 1)} {cfg.unit}
                  </div>
                )}
                <div style={{ overflowX: "auto" }}>
                  <ForecastChart m={m} cfg={cfg} />
                </div>
                {m.std != null && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    σ = {m.std < 0.001 ? m.std.toExponential(2) : m.std.toFixed(4)} · shaded = ±1.96σ CI
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------
// Main page
// ------------------------------------------------------------------
export default function CalibrationPage() {
  const [backend, setBackend] = useState("");
  const [draft, setDraft] = useState("");
  const [data, setData] = useState<CalibrationDrift | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forecast, setForecast] = useState<CalibrationForecastResult | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  async function load(b: string) {
    if (!b.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    setForecast(null);
    try {
      const d = await fetchCalibrationDrift(b.trim());
      setData(d);
      setBackend(b.trim());
      setForecastLoading(true);
      fetchCalibrationForecast(b.trim()).then(setForecast).catch(() => setForecast(null)).finally(() => setForecastLoading(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch calibration data");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Calibration Drift</h1>
      </div>

      {/* Backend selector */}
      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Activity size={16} aria-hidden="true" /> Backend Analysis
          </h2>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", gap: 10, alignItems: "center" }}>
          <input
            className="input"
            placeholder="Backend name (e.g. ibm_osaka)"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void load(draft); }}
            style={{ flex: 1, height: 38 }}
          />
          <button
            className="button"
            disabled={loading || !draft.trim()}
            onClick={() => void load(draft)}
            style={{ height: 38, padding: "0 18px" }}
            type="button"
          >
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        {error && (
          <div style={{ margin: "0 18px 14px", padding: "10px 14px", background: "var(--danger-bg)", color: "var(--danger-text)", borderRadius: 6, fontSize: 13 }}>
            {error}
          </div>
        )}
      </section>

      {data && (
        <>
          {/* Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
            {[
              { label: "Backend", value: data.backend },
              { label: "Total runs", value: data.total_runs },
              { label: "With calibration", value: data.runs_with_calibration },
              { label: "Coverage", value: `${data.total_runs > 0 ? ((data.runs_with_calibration / data.total_runs) * 100).toFixed(0) : 0}%` },
            ].map(item => (
              <div key={item.label} className="metric">
                <div className="metric-label">{item.label}</div>
                <div className="metric-value" style={{ fontSize: 22 }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Warnings */}
          {data.warnings.length > 0 && (
            <section className="panel" style={{ marginTop: 18 }}>
              <div className="panel-header"><h2>Warnings</h2></div>
              {data.warnings.map((w, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 18px",
                  background: "var(--warn-bg, #fef3c7)",
                  borderBottom: i < data.warnings.length - 1 ? "1px solid var(--line)" : undefined,
                }}>
                  <AlertTriangle size={14} color="var(--warn, #d97706)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 13 }}>{w}</span>
                </div>
              ))}
            </section>
          )}

          {/* Latest snapshot */}
          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-header"><h2>Latest Values</h2></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 0 }}>
              {SERIES_CONFIG.map(cfg => {
                const latest = data.latest[cfg.key];
                const slope = data.trends[cfg.key] ?? 0;
                return (
                  <div key={cfg.key} style={{ padding: "16px 20px", borderRight: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                      {cfg.label}
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 700, color: cfg.color, fontVariantNumeric: "tabular-nums" }}>
                      {latest != null ? (latest < 0.01 ? latest.toExponential(2) : latest.toFixed(3)) : "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{cfg.unit}</div>
                    <div style={{ marginTop: 8 }}>
                      <TrendBadge slope={slope} label={cfg.key} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Time series charts */}
          {SERIES_CONFIG.map(cfg => {
            const pts = (data.series[cfg.key as SeriesKey] ?? []) as DriftPoint[];
            if (!pts.length) return null;
            const slope = data.trends[cfg.key] ?? 0;
            return (
              <section key={cfg.key} className="panel" style={{ marginTop: 18 }}>
                <div className="panel-header">
                  <h2 style={{ color: cfg.color }}>{cfg.label}</h2>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                    <TrendBadge slope={slope} label={cfg.key} />
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{pts.length} data points</span>
                  </div>
                </div>
                <div style={{ padding: "16px 18px", overflowX: "auto" }}>
                  <DriftChart points={pts} color={cfg.color} unit={cfg.unit} width={600} height={160} />
                </div>
              </section>
            );
          })}
        </>
      )}

      {/* Calibration forecast panel */}
      {(forecastLoading || forecast) && (
        <ForecastPanel loading={forecastLoading} forecast={forecast} />
      )}

      {/* Drift changepoint detection */}
      {data && backend && (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panel-header"><h2>Changepoint Detection</h2></div>
          <div style={{ padding: "0 18px 18px" }}>
            <ChangepointPanel backend={backend} />
          </div>
        </section>
      )}

      {/* Novel feature panels — shown after backend data loads */}
      {data && backend && (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          <MilestonePredictPanel backend={backend} />
          <PassiveRBPanel backend={backend} />
          <DeviceFingerprintPanel backend={backend} />
          <HamiltonianPanel backend={backend} />
        </div>
      )}

      {!data && !loading && !error && (
        <div style={{
          marginTop: 48, display: "flex", flexDirection: "column", alignItems: "center",
          gap: 12, color: "var(--muted)", fontSize: 14,
        }}>
          <Activity size={40} opacity={0.3} />
          <p style={{ margin: 0 }}>Enter a backend name above to analyze calibration drift over time.</p>
        </div>
      )}
    </main>
  );
}
