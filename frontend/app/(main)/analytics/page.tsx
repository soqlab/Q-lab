"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchAnalyticsTimeseries, fetchRunMetrics, fetchHealthTrend, qlabApiPath, type TimeseriesPoint, type RunMetrics, type HealthTrendResult, type HealthTrendPoint } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

// ------------------------------------------------------------------
// SVG Line chart
// ------------------------------------------------------------------

function TimeSeriesChart({ data, height = 220 }: { data: TimeseriesPoint[]; height?: number }) {
  const W = 760, H = height, PL = 42, PR = 12, PT = 16, PB = 40;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  if (!data.length) {
    return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa8b6", fontSize: 14 }}>No data for this period.</div>;
  }

  const maxVal = Math.max(...data.map(d => d.total), 1);

  type Pt = { x: number; y: number; yComp: number; yFail: number; d: TimeseriesPoint };
  const pts: Pt[] = data.map((d, i) => ({
    x: PL + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW),
    y: PT + (1 - d.total / maxVal) * chartH,
    yComp: PT + (1 - d.completed / maxVal) * chartH,
    yFail: PT + (1 - d.failed / maxVal) * chartH,
    d,
  }));

  const line = (yKey: keyof Pt) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${(p.x as number).toFixed(1)},${(p[yKey] as number).toFixed(1)}`).join(" ");

  const areaPath = `${line("y")} L${pts[pts.length - 1].x.toFixed(1)},${PT + chartH} L${PL},${PT + chartH} Z`;

  const yLabels = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.max(1, Math.floor(data.length / 7));
  const labelIdxs = data.map((_, i) => i).filter(i => i % labelStep === 0 || i === data.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} aria-label="Runs over time">
      {/* Grid */}
      {yLabels.map(f => {
        const y = PT + f * chartH;
        const v = Math.round(maxVal * (1 - f));
        return (
          <g key={f}>
            <line x1={PL} y1={y} x2={PL + chartW} y2={y} stroke="#edf0f3" strokeWidth={1} />
            <text x={PL - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#9aa8b6">{v}</text>
          </g>
        );
      })}
      {/* Area + main line */}
      <path d={areaPath} fill="rgba(29,111,143,0.08)" />
      <path d={line("y")} fill="none" stroke="#1d6f8f" strokeWidth={2} strokeLinejoin="round" />
      {/* Completed line */}
      <path d={line("yComp")} fill="none" stroke="#27ae60" strokeWidth={1.5} strokeDasharray="4 2" strokeLinejoin="round" />
      {/* Failed line */}
      <path d={line("yFail")} fill="none" stroke="#e74c3c" strokeWidth={1.5} strokeDasharray="4 2" strokeLinejoin="round" />
      {/* X labels */}
      {labelIdxs.map(i => (
        <text key={i} x={pts[i].x} y={H - 6} textAnchor="middle" fontSize={10} fill="#9aa8b6">
          {data[i].date.slice(5)}
        </text>
      ))}
      {/* Dots */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={data.length <= 15 ? 3 : 2} fill="#1d6f8f" />
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------
// Horizontal bar chart
// ------------------------------------------------------------------

function HBarChart({ data, color = "#1d6f8f" }: { data: Record<string, number>; color?: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) return <div className="empty">No data.</div>;
  const max = entries[0][1];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
      {entries.map(([label, val]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
          <div style={{ width: 120, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }} title={label}>{label}</div>
          <div style={{ flex: 1, background: "#f0f3f7", borderRadius: 4, height: 14, overflow: "hidden" }}>
            <div style={{ width: `${(val / max) * 100}%`, background: color, height: "100%", borderRadius: 4, transition: "width 0.4s" }} />
          </div>
          <div style={{ width: 28, textAlign: "right", color: "#5f6f80", fontVariantNumeric: "tabular-nums" }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Stat card
// ------------------------------------------------------------------

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="panel" style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? "#1d6f8f", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 13, color: "#374151", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#9aa8b6", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------
// Health trend chart
// ------------------------------------------------------------------

function HealthTrendChart({ data }: { data: HealthTrendPoint[] }) {
  const W = 760; const H = 180; const PL = 42; const PR = 12; const PT = 14; const PB = 36;
  const cW = W - PL - PR; const cH = H - PT - PB;

  const avgVals = data.map(p => p.avg_health);
  const minY = 0; const maxY = 100;

  function px(i: number) { return PL + (data.length === 1 ? cW / 2 : (i / (data.length - 1)) * cW); }
  function py(v: number) { return PT + (1 - (v - minY) / (maxY - minY)) * cH; }

  const avgPath = data.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(p.avg_health).toFixed(1)}`).join(" ");
  const areaPath = `${avgPath} L${px(data.length - 1).toFixed(1)},${(PT + cH).toFixed(1)} L${PL},${(PT + cH).toFixed(1)} Z`;
  const labelStep = Math.max(1, Math.floor(data.length / 7));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
      {[0, 40, 70, 100].map(v => (
        <g key={v}>
          <line x1={PL} y1={py(v)} x2={W - PR} y2={py(v)} stroke="var(--line)" strokeWidth={0.5} />
          <text x={PL - 6} y={py(v) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">{v}</text>
        </g>
      ))}
      {/* Area */}
      <path d={areaPath} fill="#6366f1" fillOpacity={0.06} />
      {/* Band p25-p75 */}
      {data.length > 1 && (
        <path
          d={[
            ...data.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(p.p75).toFixed(1)}`),
            ...[...data].reverse().map((p, i) => `L${px(data.length - 1 - i).toFixed(1)},${py(p.p25).toFixed(1)}`),
            "Z",
          ].join(" ")}
          fill="#6366f1"
          fillOpacity={0.12}
        />
      )}
      {/* Avg line */}
      <path d={avgPath} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinejoin="round" />
      {/* X labels */}
      {data.map((p, i) => i % labelStep === 0 || i === data.length - 1 ? (
        <text key={i} x={px(i)} y={H - PB + 14} textAnchor="middle" fontSize={9} fill="var(--muted)">{p.date.slice(5)}</text>
      ) : null)}
    </svg>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

export default function AnalyticsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [healthTrend, setHealthTrend] = useState<HealthTrendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === undefined) return;
    if (!token) { router.push("/login"); return; }
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, days]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, m, ht] = await Promise.all([
        fetchAnalyticsTimeseries(token, { days }),
        fetchRunMetrics(token),
        fetchHealthTrend({ days }).catch(() => null),
      ]);
      setSeries(s);
      setMetrics(m);
      setHealthTrend(ht);
    } catch {
      setError("Failed to load analytics data");
    } finally {
      setLoading(false);
    }
  }

  const successRate = metrics ? (metrics.completion_rate * 100).toFixed(1) + "%" : "—";
  const avgHealth = metrics && metrics.average_success_probability != null
    ? (metrics.average_success_probability * 100).toFixed(1) + "%"
    : "—";
  const backendCount = metrics ? Object.keys(metrics.by_backend).length : 0;
  const totalGates = metrics ? Object.values(metrics.gate_counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <main className="page">
      {/* Header strip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Analytics</h1>
        <div style={{ display: "flex", gap: 6 }}>
          {RANGES.map(r => (
            <button
              key={r.days}
              className={`button${days === r.days ? "" : " secondary"}`}
              style={{ height: 32, fontSize: 12, padding: "0 12px" }}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}
      {loading && <div className="empty">Loading analytics…</div>}

      {!loading && metrics && (
        <>
          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <StatCard label="Total Runs" value={metrics.total_runs} />
            <StatCard
              label="Success Rate"
              value={successRate}
              sub={`${metrics.completed_runs} completed`}
              color={metrics.completion_rate >= 0.8 ? "#27ae60" : metrics.completion_rate >= 0.5 ? "#e67e22" : "#e74c3c"}
            />
            <StatCard label="Avg Success Prob." value={avgHealth} sub="across completed runs" />
            <StatCard label="Max Qubits" value={metrics.max_qubits} sub={`Max depth: ${metrics.max_depth}`} />
            <StatCard label="Backends Used" value={backendCount} />
            <StatCard label="Total Gates" value={totalGates.toLocaleString()} sub="across all runs" />
          </div>

          {/* Time series chart */}
          <section className="panel">
            <div className="panel-header" style={{ justifyContent: "space-between" }}>
              <h2>Runs Over Time</h2>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#5f6f80" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width={20} height={4}><line x1={0} y1={2} x2={20} y2={2} stroke="#1d6f8f" strokeWidth={2} /></svg>
                  Total
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width={20} height={4}><line x1={0} y1={2} x2={20} y2={2} stroke="#27ae60" strokeWidth={2} strokeDasharray="4 2" /></svg>
                  Completed
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width={20} height={4}><line x1={0} y1={2} x2={20} y2={2} stroke="#e74c3c" strokeWidth={2} strokeDasharray="4 2" /></svg>
                  Failed
                </span>
              </div>
            </div>
            <div style={{ padding: "12px 18px 8px" }}>
              <TimeSeriesChart data={series} />
            </div>
          </section>

          {/* Health trend */}
          {healthTrend && healthTrend.points.length > 1 && (
            <section className="panel">
              <div className="panel-header">
                <h2>Circuit Health Score Trend</h2>
                <span style={{
                  fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                  background: healthTrend.trend_direction === "improving" ? "#d1fae5" : healthTrend.trend_direction === "degrading" ? "#fee2e2" : "var(--panel-2)",
                  color: healthTrend.trend_direction === "improving" ? "#059669" : healthTrend.trend_direction === "degrading" ? "#dc2626" : "var(--muted)",
                }}>
                  {healthTrend.trend_direction === "improving" ? "↑ Improving" : healthTrend.trend_direction === "degrading" ? "↓ Degrading" : "→ Stable"}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
                  {healthTrend.total_runs} runs · {days}d
                </span>
              </div>
              <div style={{ padding: "12px 18px 8px" }}>
                <HealthTrendChart data={healthTrend.points} />
              </div>
            </section>
          )}

          {/* Two-column section */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <section className="panel">
              <div className="panel-header"><h2>By Backend</h2></div>
              <div style={{ padding: "12px 18px 16px" }}>
                <HBarChart data={metrics.by_backend} color="#1d6f8f" />
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h2>By Status</h2></div>
              <div style={{ padding: "12px 18px 16px" }}>
                <HBarChart
                  data={metrics.by_status}
                  color="#27ae60"
                />
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h2>By Project</h2></div>
              <div style={{ padding: "12px 18px 16px" }}>
                {Object.keys(metrics.by_project).length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>No project data — assign runs to projects to see breakdown.</div>
                ) : (
                  <HBarChart data={metrics.by_project} color="#f59e0b" />
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h2>Top Gate Types</h2></div>
              <div style={{ padding: "12px 18px 16px" }}>
                <HBarChart data={metrics.gate_counts} color="#8b5cf6" />
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h2>Data Capture Rates</h2></div>
              <div style={{ padding: "12px 18px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  { label: "Results captured", pct: metrics.result_capture_rate, color: "#27ae60" },
                  { label: "Calibration data", pct: metrics.calibration_capture_rate, color: "#1d6f8f" },
                  { label: "Completion rate", pct: metrics.completion_rate, color: "#f59e0b" },
                  { label: "Failure rate", pct: metrics.failure_rate, color: "#e74c3c" },
                ].map(({ label, pct, color }) => (
                  <div key={label}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                      <span style={{ color: "#374151" }}>{label}</span>
                      <span style={{ fontWeight: 600, color }}>{(pct * 100).toFixed(1)}%</span>
                    </div>
                    <div style={{ background: "#f0f3f7", borderRadius: 4, height: 8, overflow: "hidden" }}>
                      <div style={{ width: `${pct * 100}%`, background: color, height: "100%", borderRadius: 4, transition: "width 0.4s" }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Circuit metrics */}
          <section className="panel">
            <div className="panel-header"><h2>Circuit Complexity Summary</h2></div>
            <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              {[
                { label: "Max circuit depth", value: metrics.max_depth },
                { label: "Max qubits used", value: metrics.max_qubits },
                { label: "Avg non-Clifford ratio", value: (metrics.average_non_clifford_ratio * 100).toFixed(1) + "%" },
                { label: "Avg success probability", value: metrics.average_success_probability != null ? (metrics.average_success_probability * 100).toFixed(1) + "%" : "N/A" },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: "#f7f8fa", borderRadius: 8, padding: "12px 16px" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#1d6f8f" }}>{value}</div>
                  <div style={{ fontSize: 12, color: "#5f6f80", marginTop: 3 }}>{label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Export banner */}
          <section className="panel" style={{ background: "linear-gradient(135deg, #0d1b2a 0%, #1d4e6f 100%)", border: "none" }}>
            <div style={{ padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Export your data</div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>Download runs as CSV or NDJSON for external analysis.</div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <a href={qlabApiPath("/api/v1/exports/runs.csv")} className="button" style={{ background: "#27ae60", borderColor: "#27ae60", color: "#fff", textDecoration: "none" }}>
                  Download CSV
                </a>
                <a href={qlabApiPath("/api/v1/exports/runs.jsonl")} className="button secondary" style={{ borderColor: "#4a6fa5", color: "#94a3b8", textDecoration: "none" }}>
                  Download NDJSON
                </a>
                <a href={qlabApiPath("/api/v1/reports/runs.md")} className="button secondary" style={{ borderColor: "#4a6fa5", color: "#94a3b8", textDecoration: "none" }}>
                  Markdown Report
                </a>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
