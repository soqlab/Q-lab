"use client";

import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Types ──────────────────────────────────────────────────────────────────

interface CalPoint { value: number; timestamp: string }

interface TimeseriesData {
  backend: string;
  metric: string;
  points: CalPoint[];
  stats: { mean: number; std: number; min: number; max: number; trend: string };
}

interface DriftAlert {
  alert_id: string;
  backend: string;
  metric: string;
  baseline_value: number;
  current_value: number;
  change_pct: number;
  direction: string;
  severity: string;
  detected_at: string;
  description: string;
}

interface BackendSummary { backend: string; health: string; worst_metric: string | null; change_pct: number }

// ─── Constants ───────────────────────────────────────────────────────────────

const METRICS = ["t1_us", "t2_us", "gate_error_2q", "readout_error"] as const;

const METRIC_LABELS: Record<string, string> = {
  t1_us: "T1 Coherence (μs)",
  t2_us: "T2 Coherence (μs)",
  gate_error_2q: "2Q Gate Error",
  readout_error: "Readout Error",
};

const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
};

const HEALTH_COLOR: Record<string, string> = {
  good: "#10b981",
  degrading: "#f59e0b",
  critical: "#ef4444",
};

const TREND_ICON: Record<string, string> = {
  degrading: "↓",
  improving: "↑",
  stable: "→",
};

// ─── Mini line-chart SVG ─────────────────────────────────────────────────────

function LineChart({ points, color }: { points: CalPoint[]; color: string }) {
  if (points.length < 2) {
    return <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12 }}>Not enough data</div>;
  }

  const w = 280, h = 60, pad = 6;
  const vals = points.map(p => p.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;

  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (w - 2 * pad));
  const ys = vals.map(v => h - pad - ((v - minV) / range) * (h - 2 * pad));

  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const fill = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ")
    + ` L${xs[xs.length - 1].toFixed(1)},${h} L${xs[0].toFixed(1)},${h} Z`;

  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#grad-${color.replace("#", "")})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {points.length <= 20 && xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={2.5} fill={color} />
      ))}
    </svg>
  );
}

// ─── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({ metric, alert, ts }: { metric: string; alert: DriftAlert | undefined; ts: TimeseriesData | null }) {
  const severity = alert?.severity ?? "none";
  const color = SEV_COLOR[severity] ?? "#334155";
  const higherIsBetter = metric === "t1_us" || metric === "t2_us";

  const changePct = alert?.change_pct ?? 0;
  const directionBad = alert?.direction === "degraded";

  return (
    <div style={{
      background: "#1e293b",
      borderRadius: 12,
      border: `1px solid ${color}44`,
      padding: "1rem",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600 }}>{METRIC_LABELS[metric]}</span>
        {alert && (
          <span style={{ background: color + "22", color, border: `1px solid ${color}55`, borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
            {severity}
          </span>
        )}
      </div>

      {ts && (
        <LineChart
          points={ts.points.slice(-10)}
          color={alert ? color : "#3b82f6"}
        />
      )}

      {alert ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
          <div>
            <div style={{ color: "#64748b" }}>Baseline</div>
            <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{alert.baseline_value.toFixed(4)}</div>
          </div>
          <div>
            <div style={{ color: "#64748b" }}>Current</div>
            <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{alert.current_value.toFixed(4)}</div>
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <span style={{ color: directionBad ? "#ef4444" : "#10b981", fontWeight: 700, fontSize: 13 }}>
              {changePct > 0 ? "+" : ""}{changePct.toFixed(1)}%
              {" "}{higherIsBetter ? (changePct < 0 ? "↓ degraded" : "↑ improved") : (changePct > 0 ? "↑ degraded" : "↓ improved")}
            </span>
          </div>
          <div style={{ gridColumn: "span 2", color: "#94a3b8", fontSize: 11 }}>{alert.description}</div>
        </div>
      ) : ts ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, fontSize: 11 }}>
          <div><div style={{ color: "#64748b" }}>Mean</div><div style={{ color: "#e2e8f0" }}>{ts.stats.mean.toFixed(4)}</div></div>
          <div><div style={{ color: "#64748b" }}>Trend</div><div style={{ color: "#10b981" }}>{TREND_ICON[ts.stats.trend] ?? "?"} {ts.stats.trend}</div></div>
          <div><div style={{ color: "#64748b" }}>Std</div><div style={{ color: "#e2e8f0" }}>{ts.stats.std.toFixed(4)}</div></div>
        </div>
      ) : (
        <div style={{ color: "#475569", fontSize: 12 }}>No calibration data</div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function HardwareDriftPage() {
  const [backend, setBackend] = useState("ibm_sherbrooke");
  const [inputBackend, setInputBackend] = useState("ibm_sherbrooke");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<DriftAlert[]>([]);
  const [timeseries, setTimeseries] = useState<Record<string, TimeseriesData | null>>({});
  const [summaries, setSummaries] = useState<BackendSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async (b: string) => {
    setLoading(true);
    setError(null);
    try {
      const [alertsRes, ...tsResults] = await Promise.all([
        fetch(`${API}/api/v1/hardware-drift/alerts/${encodeURIComponent(b)}`).then(r => r.json()),
        ...METRICS.map(m =>
          fetch(`${API}/api/v1/hardware-drift/timeseries/${encodeURIComponent(b)}?metric=${m}&limit=20`)
            .then(r => r.json())
            .catch(() => null)
        ),
      ]);
      setAlerts(alertsRes.alerts ?? []);
      const tsMap: Record<string, TimeseriesData | null> = {};
      METRICS.forEach((m, i) => { tsMap[m] = tsResults[i]; });
      setTimeseries(tsMap);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch drift data");
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/hardware-drift/summary`).then(r => r.json());
      setSummaries(res.backends ?? []);
    } catch {
      // summary is best-effort
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleCheck = () => {
    setBackend(inputBackend);
    fetchData(inputBackend);
    fetchSummary();
  };

  useEffect(() => {
    fetchData(backend);
    fetchSummary();
    // Auto-refresh every 5 minutes
    intervalRef.current = setInterval(() => {
      fetchData(backend);
      fetchSummary();
    }, 5 * 60 * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const criticalCount = alerts.filter(a => a.severity === "critical").length;
  const warningCount = alerts.filter(a => a.severity === "warning").length;
  const stableCount = METRICS.length - alerts.length;

  const alertByMetric = Object.fromEntries(alerts.map(a => [a.metric, a]));

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
          Hardware Drift Alerting
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Monitor T1, T2, gate error, and readout error trends across QPU backends.
          Auto-refreshes every 5 minutes.
        </p>
      </div>

      {/* Backend selector */}
      <div style={{ display: "flex", gap: 10, marginBottom: "1.5rem", alignItems: "center" }}>
        <input
          value={inputBackend}
          onChange={e => setInputBackend(e.target.value)}
          placeholder="Backend name (e.g. ibm_sherbrooke)"
          style={{
            background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
            color: "#e2e8f0", padding: "0.6rem 1rem", fontSize: 14, width: 280,
          }}
          onKeyDown={e => { if (e.key === "Enter") handleCheck(); }}
        />
        <button
          onClick={handleCheck}
          disabled={loading}
          style={{
            background: loading ? "#334155" : "#3b82f6", color: "#fff", border: "none",
            borderRadius: 8, padding: "0.6rem 1.4rem", cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 600, fontSize: 14,
          }}
        >
          {loading ? "Checking…" : "Check Drift"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Severity summary */}
      {!loading && (
        <div style={{ display: "flex", gap: 10, marginBottom: "1.5rem" }}>
          {[
            { label: "Critical", count: criticalCount, color: "#ef4444", icon: "🔴" },
            { label: "Warnings", count: warningCount, color: "#f59e0b", icon: "🟡" },
            { label: "Stable", count: stableCount, color: "#10b981", icon: "🟢" },
          ].map(({ label, count, color, icon }) => (
            <div key={label} style={{ background: "#1e293b", border: `1px solid ${color}44`, borderRadius: 10, padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              <div>
                <div style={{ color, fontWeight: 700, fontSize: 20 }}>{count}</div>
                <div style={{ color: "#64748b", fontSize: 12 }}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Spinner */}
      {loading && (
        <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
          Analyzing drift…
        </div>
      )}

      {/* Metric cards */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
          {METRICS.map(metric => (
            <MetricCard
              key={metric}
              metric={metric}
              alert={alertByMetric[metric]}
              ts={timeseries[metric] ?? null}
            />
          ))}
        </div>
      )}

      {/* All Backends Health table */}
      <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 600, margin: 0 }}>All Backends Health</h2>
          {summaryLoading && <span style={{ color: "#64748b", fontSize: 12 }}>Loading…</span>}
        </div>
        {summaries.length === 0 && !summaryLoading ? (
          <div style={{ padding: "1.5rem", color: "#475569", fontSize: 13 }}>No backend calibration data found.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #334155" }}>
                {["Backend", "Health", "Worst Metric", "Change %"].map(h => (
                  <th key={h} style={{ padding: "0.6rem 1rem", textAlign: "left", color: "#64748b", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaries.map(s => (
                <tr key={s.backend} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "0.6rem 1rem", color: "#e2e8f0", fontFamily: "monospace" }}>{s.backend}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <span style={{ color: HEALTH_COLOR[s.health] ?? "#64748b", fontWeight: 600 }}>
                      {s.health === "good" ? "🟢" : s.health === "critical" ? "🔴" : "🟡"} {s.health}
                    </span>
                  </td>
                  <td style={{ padding: "0.6rem 1rem", color: "#94a3b8" }}>{s.worst_metric ? METRIC_LABELS[s.worst_metric] ?? s.worst_metric : "—"}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <span style={{ color: Math.abs(s.change_pct) > 30 ? "#ef4444" : Math.abs(s.change_pct) > 15 ? "#f59e0b" : "#10b981", fontWeight: 600 }}>
                      {s.change_pct > 0 ? "+" : ""}{s.change_pct.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
