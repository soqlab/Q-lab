"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, Clock, RefreshCw, XCircle, PauseCircle } from "lucide-react";
import { getCampaign, type CampaignDetail, type SweepRow } from "../../../../lib/api";

const STATUS_ICON: Record<string, React.ElementType> = {
  running: Clock, completed: CheckCircle, cancelled: XCircle, paused: PauseCircle,
};
const STATUS_COLOR: Record<string, string> = {
  running: "#1d6f8f", completed: "#1f8a5b", cancelled: "#e74c3c", paused: "#e67e22",
  pending: "#aaa", submitted: "#1d6f8f", failed: "#e74c3c",
};

function HealthDot({ score }: { score: number | null }) {
  const color = score == null ? "#ddd" : score >= 70 ? "#27ae60" : score >= 40 ? "#e67e22" : "#e74c3c";
  return <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />;
}

function SweepMatrix({ rows, axes }: { rows: SweepRow[]; axes: string[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {axes.map(ax => <th key={ax}>{ax}</th>)}
            <th>Runs</th>
            <th>Status</th>
            <th>Best health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const color = STATUS_COLOR[row.status] ?? "#888";
            const bg = row.status === "completed" ? "#eaf6ef22" : row.status === "pending" ? "#f8f8f8" : "";
            return (
              <tr key={i} style={{ background: bg }}>
                {axes.map(ax => (
                  <td key={ax}><code style={{ fontSize: 12 }}>{String(row.params[ax] ?? "—")}</code></td>
                ))}
                <td style={{ fontSize: 13 }}>
                  {row.runs.length > 0 ? (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {row.runs.map(r => (
                        <Link key={r.run_id} href={`/runs/${r.run_id}`}
                          style={{ fontSize: 11, background: "#f0f4f8", padding: "1px 6px", borderRadius: 4, color: "#1d6f8f" }}>
                          {r.run_id.slice(0, 8)}
                        </Link>
                      ))}
                    </div>
                  ) : <span style={{ color: "#aaa", fontSize: 12 }}>pending</span>}
                </td>
                <td>
                  <span style={{ fontSize: 12, color, fontWeight: 600 }}>{row.status}</span>
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <HealthDot score={row.best_health} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: row.best_health == null ? "#bbb" : STATUS_COLOR[row.status === "completed" ? "completed" : "running"] }}>
                      {row.best_health != null ? row.best_health.toFixed(0) : "—"}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HealthHeatmap({ rows, xAxis, yAxis }: { rows: SweepRow[]; xAxis: string; yAxis: string }) {
  const xVals = [...new Set(rows.map(r => String(r.params[xAxis] ?? "")))];
  const yVals = [...new Set(rows.map(r => String(r.params[yAxis] ?? "")))];
  if (xVals.length < 2 || yVals.length < 2) return null;

  const grid: Record<string, number | null> = {};
  for (const row of rows) {
    const key = `${row.params[xAxis]}_${row.params[yAxis]}`;
    grid[key] = row.best_health;
  }

  function cellColor(h: number | null) {
    if (h == null) return "#f4f4f4";
    if (h >= 80) return "#27ae60";
    if (h >= 65) return "#52c77d";
    if (h >= 50) return "#f39c12";
    if (h >= 35) return "#e67e22";
    return "#e74c3c";
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: "#5f6f80", marginBottom: 8 }}>
        Heatmap: <strong>{xAxis}</strong> × <strong>{yAxis}</strong> (best health score)
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 3 }}>
          <thead>
            <tr>
              <th style={{ fontSize: 11, color: "#5f6f80", padding: "2px 8px" }}>{yAxis} \ {xAxis}</th>
              {xVals.map(x => <th key={x} style={{ fontSize: 11, padding: "2px 8px", minWidth: 60, textAlign: "center" }}>{x}</th>)}
            </tr>
          </thead>
          <tbody>
            {yVals.map(y => (
              <tr key={y}>
                <td style={{ fontSize: 11, color: "#5f6f80", padding: "2px 8px", whiteSpace: "nowrap" }}>{y}</td>
                {xVals.map(x => {
                  const h = grid[`${x}_${y}`] ?? null;
                  return (
                    <td key={x} style={{
                      background: cellColor(h), borderRadius: 4, padding: "6px 10px",
                      textAlign: "center", fontSize: 13, fontWeight: 700,
                      color: h != null && h >= 35 ? "#fff" : "#999",
                      minWidth: 60,
                    }}>
                      {h != null ? h.toFixed(0) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CampaignDetailPage({ params }: { params: { campaignId: string } }) {
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getCampaign(params.campaignId));
    } catch { setError("Campaign not found"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [params.campaignId]);

  if (loading) return <main className="page"><div className="empty">Loading…</div></main>;
  if (error || !data) return <main className="page"><div className="empty">{error ?? "Not found"}</div></main>;

  const pct = data.total_combinations > 0 ? Math.round((data.combinations_done / data.total_combinations) * 100) : 0;
  const StatusIcon = STATUS_ICON[data.status] ?? Clock;
  const statusColor = STATUS_COLOR[data.status] ?? "#888";
  const axes = data.grid.map(ax => ax.name);
  const axisA = axes[0] ?? "";
  const axisB = axes[1];

  return (
    <main className="page">
      <div className="toolbar">
        <Link className="button secondary" href="/campaigns"><ArrowLeft size={17} /> Campaigns</Link>
        <button className="button secondary" onClick={load}><RefreshCw size={15} /> Refresh</button>
      </div>

      {/* Header */}
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StatusIcon size={17} color={statusColor} />
            {data.name}
          </h2>
          <span style={{ fontSize: 12, color: statusColor, fontWeight: 600 }}>{data.status}</span>
        </div>
        <div style={{ padding: "14px 18px" }}>
          {data.description && <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--muted, #5f6f80)", lineHeight: 1.6 }}>{data.description}</p>}

          {/* Progress bar */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#5f6f80", marginBottom: 4 }}>
              <span>{data.combinations_done} / {data.combinations_total} combinations complete</span>
              <span>{pct}%</span>
            </div>
            <div style={{ height: 8, background: "#e8ecf0", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? "#27ae60" : "#1d6f8f", borderRadius: 6, transition: "width 0.5s" }} />
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
            {[
              ["Runs", data.run_count],
              ["Avg health", data.avg_health?.toFixed(0) ?? "—"],
              ["Best health", data.max_health?.toFixed(0) ?? "—"],
              ["Completion", `${(data.completion_rate * 100).toFixed(0)}%`],
              ["Grid axes", data.grid.length],
            ].map(([label, val]) => (
              <div key={String(label)} style={{ background: "var(--panel-2, #f7f8fa)", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{val}</div>
                <div style={{ fontSize: 11, color: "#5f6f80" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Grid spec */}
          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            {data.grid.map(ax => (
              <span key={ax.name} style={{ fontSize: 12, background: "#ebf5fb", color: "#1d6f8f", padding: "3px 10px", borderRadius: 999 }}>
                {ax.name}: {ax.values.map(v => String(v)).join(", ")}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Heatmap (only if 2+ axes) */}
      {axisB && (
        <section className="panel">
          <div className="panel-header"><h2>Health Heatmap</h2></div>
          <div style={{ padding: "14px 18px", overflowX: "auto" }}>
            <HealthHeatmap rows={data.sweep_rows} xAxis={axisA} yAxis={axisB} />
          </div>
        </section>
      )}

      {/* Sweep matrix */}
      <section className="panel">
        <div className="panel-header">
          <h2>Sweep Matrix</h2>
          <span style={{ fontSize: 12, color: "#5f6f80" }}>
            {data.combinations_pending} pending · {data.combinations_done} done
          </span>
        </div>
        <SweepMatrix rows={data.sweep_rows} axes={axes} />
      </section>

      {/* Run list */}
      {data.runs.length > 0 && (
        <section className="panel">
          <div className="panel-header"><h2>All Runs ({data.runs.length})</h2></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Circuit</th>
                  <th>Backend</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map(r => (
                  <tr key={r.run_id}>
                    <td>
                      <Link href={`/runs/${r.run_id}`} style={{ fontFamily: "monospace", fontSize: 12, color: "#1d6f8f" }}>
                        {r.run_id.slice(0, 12)}…
                      </Link>
                    </td>
                    <td style={{ fontSize: 13 }}>{r.circuit_name ?? "—"}</td>
                    <td style={{ fontSize: 13 }}>{r.backend ?? "—"}</td>
                    <td>
                      <span style={{ fontSize: 12, color: STATUS_COLOR[r.status] ?? "#888", fontWeight: 600 }}>{r.status}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <HealthDot score={r.health_score} />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{r.health_score?.toFixed(0) ?? "—"}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: "#5f6f80" }}>
                      {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* SDK usage */}
      <section className="panel">
        <div className="panel-header"><h2>SDK Usage</h2></div>
        <pre style={{ margin: 0, padding: "14px 18px", fontSize: 12, background: "var(--panel-2, #f7f8fa)", borderRadius: "0 0 8px 8px", overflow: "auto" }}>
{`import qlab

qlab.init()

# Submit all grid combinations; tag each run with the campaign ID
# so Q-Lab groups them in this sweep dashboard
for params in qlab.campaign_combinations("${data.campaign_id}"):
    with qlab.run(your_circuit) as r:
        # apply params to your circuit / backend selection
        r.context.update(params)

# Check progress
progress = qlab.get_campaign("${data.campaign_id}")
print(f"{progress['combinations_done']} / {progress['combinations_total']} done")`}
        </pre>
      </section>
    </main>
  );
}
