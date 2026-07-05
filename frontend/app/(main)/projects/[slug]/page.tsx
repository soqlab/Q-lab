"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, XCircle, Clock, TrendingUp, BarChart2, Layers } from "lucide-react";
import { fetchProjectStats, ProjectStats, ProjectTimelinePoint, healthColor, qlabApiPath } from "../../../../lib/api";

// ------------------------------------------------------------------
// Mini sparkline (SVG)
// ------------------------------------------------------------------
function Sparkline({ points, color = "var(--strong)" }: { points: number[]; color?: string }) {
  if (points.length < 2) return null;
  const W = 200; const H = 48; const PAD = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = (W - PAD * 2) / (points.length - 1);
  const d = points.map((v, i) => {
    const x = PAD + i * step;
    const y = PAD + H - PAD * 2 - ((v - min) / range) * (H - PAD * 2);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------------
// Status dot
// ------------------------------------------------------------------
function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle size={13} color="var(--ok)" />;
  if (status === "failed") return <XCircle size={13} color="var(--danger)" />;
  return <Clock size={13} color="var(--muted)" />;
}

// ------------------------------------------------------------------
// Backend bar chart
// ------------------------------------------------------------------
function BackendChart({ byBackend }: { byBackend: Record<string, number> }) {
  const entries = Object.entries(byBackend).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...entries.map(e => e[1]), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entries.map(([name, count]) => (
        <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span style={{ minWidth: 120, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>
            {name}
          </span>
          <div style={{ flex: 1, height: 16, background: "var(--panel-2)", borderRadius: 3 }}>
            <div style={{ width: `${(count / max) * 100}%`, height: "100%", background: "var(--strong)", borderRadius: 3, transition: "width 0.5s" }} />
          </div>
          <span style={{ color: "var(--muted)", minWidth: 24, textAlign: "right" }}>{count}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Health distribution histogram (10 buckets: 0-9, 10-19, …, 90-100)
// ------------------------------------------------------------------
function HealthHistogram({ scores }: { scores: number[] }) {
  if (!scores.length) return <p style={{ color: "var(--muted)", fontSize: 13 }}>No health scores available.</p>;
  const buckets = Array(10).fill(0);
  for (const s of scores) buckets[Math.min(9, Math.floor(s / 10))]++;
  const max = Math.max(...buckets, 1);
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 60 }}>
      {buckets.map((count, i) => {
        const label = `${i * 10}–${i * 10 + 9}`;
        const mid = i * 10 + 5;
        const color = healthColor(mid);
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div
              title={`Score ${label}: ${count} run${count !== 1 ? "s" : ""}`}
              style={{
                width: "100%",
                height: `${(count / max) * 52}px`,
                background: color,
                borderRadius: "2px 2px 0 0",
                minHeight: count > 0 ? 2 : 0,
                transition: "height 0.5s",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
// Recent runs table
// ------------------------------------------------------------------
function RecentRunsTable({ runs }: { runs: ProjectTimelinePoint[] }) {
  const recent = [...(runs ?? [])].reverse().slice(0, 15);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Run", "Backend", "Status", "Qubits", "Depth", "Health", "Date"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--line)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {recent.map(r => (
            <tr key={r.run_id} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "8px 10px" }}>
                <Link href={`/runs/${r.run_id}`} style={{ color: "var(--strong)", textDecoration: "none", fontWeight: 500 }}>
                  {r.circuit_name || r.run_id.slice(0, 10)}
                </Link>
              </td>
              <td style={{ padding: "8px 10px", color: "var(--muted)" }}>{r.backend || "—"}</td>
              <td style={{ padding: "8px 10px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <StatusIcon status={r.status} />
                  {r.status}
                </span>
              </td>
              <td style={{ padding: "8px 10px" }}>{r.num_qubits ?? "—"}</td>
              <td style={{ padding: "8px 10px" }}>{r.depth ?? "—"}</td>
              <td style={{ padding: "8px 10px" }}>
                {r.health_score != null
                  ? <span style={{ fontWeight: 700, color: healthColor(r.health_score) }}>{r.health_score}</span>
                  : <span style={{ color: "var(--muted)" }}>—</span>}
              </td>
              <td style={{ padding: "8px 10px", color: "var(--muted)", fontSize: 12 }}>
                {new Date(r.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------
export default function ProjectPage({ params }: { params: { slug: string } }) {
  const [data, setData] = useState<ProjectStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjectStats(params.slug)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load project"));
  }, [params.slug]);

  if (error) return <main className="page"><div className="empty">{error}</div></main>;
  if (!data) return <main className="page"><div className="empty">Loading project…</div></main>;

  const completed = data.by_status["completed"] ?? 0;
  const failed = data.by_status["failed"] ?? 0;
  const running = data.total_runs - completed - failed;

  // Health timeline for sparkline
  const healthTimeline = (data.timeline ?? [])
    .filter(r => r.health_score != null)
    .map(r => r.health_score as number);

  const bestRun = [...(data.timeline ?? [])].filter(r => r.health_score != null).sort((a, b) => (b.health_score ?? 0) - (a.health_score ?? 0))[0];
  const worstRun = [...(data.timeline ?? [])].filter(r => r.health_score != null).sort((a, b) => (a.health_score ?? 0) - (b.health_score ?? 0))[0];

  return (
    <main className="page">
      <div className="toolbar">
        <Link className="button secondary" href="/projects"><ArrowLeft size={17} /> Projects</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, flex: 1 }}>{data.name}</h1>
        <a
          className="button secondary"
          href={qlabApiPath(`/api/v1/exports/runs.csv?project=${encodeURIComponent(params.slug)}`)}
          style={{ fontSize: 13 }}
        >
          <BarChart2 size={15} /> Export CSV
        </a>
        <Link
          className="button"
          href={`/?project=${encodeURIComponent(params.slug)}`}
          style={{ fontSize: 13 }}
        >
          <Layers size={15} /> View Runs
        </Link>
      </div>

      {data.description && (
        <p style={{ margin: "4px 0 14px", fontSize: 14, color: "var(--muted)" }}>{data.description}</p>
      )}

      {/* KPI strip */}
      <div className="summary-grid">
        <div className="metric">
          <div className="metric-label">Total Runs</div>
          <div className="metric-value">{data.total_runs}</div>
        </div>
        <div className="metric" style={{ borderColor: "var(--ok)" }}>
          <div className="metric-label">Completed</div>
          <div className="metric-value" style={{ color: "var(--ok)" }}>{completed}</div>
        </div>
        <div className="metric" style={{ borderColor: "var(--danger)" }}>
          <div className="metric-label">Failed</div>
          <div className="metric-value" style={{ color: "var(--danger)" }}>{failed}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Success Rate</div>
          <div className="metric-value">
            {data.total_runs > 0 ? `${(data.completion_rate * 100).toFixed(0)}%` : "—"}
          </div>
        </div>
        <div className="metric" style={{ borderColor: data.avg_health ? healthColor(data.avg_health) : undefined }}>
          <div className="metric-label">Avg Health</div>
          <div className="metric-value" style={{ color: data.avg_health ? healthColor(data.avg_health) : undefined }}>
            {data.avg_health ?? "—"}
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
        {/* Health trend */}
        {healthTimeline.length >= 2 && (
          <section className="panel">
            <div className="panel-header">
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TrendingUp size={15} /> Health Score Trend
              </h2>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
                {healthTimeline.length} data points
              </span>
            </div>
            <div style={{ padding: "16px 18px" }}>
              <Sparkline points={healthTimeline} color="var(--strong)" />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
                <span>min: <strong style={{ color: healthColor(data.min_health ?? 0) }}>{data.min_health}</strong></span>
                <span>avg: <strong>{data.avg_health}</strong></span>
                <span>max: <strong style={{ color: healthColor(data.max_health ?? 0) }}>{data.max_health}</strong></span>
              </div>
            </div>
          </section>
        )}

        {/* Health distribution */}
        {healthTimeline.length > 0 && (
          <section className="panel">
            <div className="panel-header"><h2>Health Distribution</h2></div>
            <div style={{ padding: "16px 18px" }}>
              <HealthHistogram scores={healthTimeline} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--muted)" }}>
                <span>0</span>
                <span>50</span>
                <span>100</span>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Backend breakdown */}
      {Object.keys(data.by_backend ?? {}).length > 0 && (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panel-header"><h2>Backends Used</h2></div>
          <div style={{ padding: "16px 18px" }}>
            <BackendChart byBackend={data.by_backend ?? {}} />
          </div>
        </section>
      )}

      {/* Best / worst runs */}
      {(bestRun || worstRun) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
          {bestRun && (
            <section className="panel" style={{ borderColor: "var(--ok)" }}>
              <div className="panel-header"><h2 style={{ color: "var(--ok)" }}>Best Run</h2></div>
              <div style={{ padding: "12px 18px" }}>
                <Link href={`/runs/${bestRun.run_id}`} style={{ fontSize: 14, fontWeight: 600, color: "var(--strong)" }}>
                  {bestRun.circuit_name || bestRun.run_id.slice(0, 12)}
                </Link>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Health: <strong style={{ color: "var(--ok)", fontSize: 18 }}>{bestRun.health_score}</strong>
                  {bestRun.backend && <> · {bestRun.backend}</>}
                </div>
              </div>
            </section>
          )}
          {worstRun && (
            <section className="panel" style={{ borderColor: "var(--danger)" }}>
              <div className="panel-header"><h2 style={{ color: "var(--danger)" }}>Lowest Health Run</h2></div>
              <div style={{ padding: "12px 18px" }}>
                <Link href={`/runs/${worstRun.run_id}`} style={{ fontSize: 14, fontWeight: 600, color: "var(--strong)" }}>
                  {worstRun.circuit_name || worstRun.run_id.slice(0, 12)}
                </Link>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Health: <strong style={{ color: "var(--danger)", fontSize: 18 }}>{worstRun.health_score}</strong>
                  {worstRun.backend && <> · {worstRun.backend}</>}
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Recent runs */}
      {(data.timeline ?? []).length > 0 && (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panel-header">
            <h2>Recent Runs</h2>
            <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
              Showing last 15 of {data.total_runs}
            </span>
          </div>
          <RecentRunsTable runs={data.timeline ?? []} />
        </section>
      )}
    </main>
  );
}
