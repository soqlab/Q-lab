"use client";

import { useEffect, useMemo, useState } from "react";
import { ScatterChart } from "lucide-react";
import { fetchProjects, fetchSweep, fetchSweepParams, SweepResult, SweepPoint } from "../../../lib/api";

// ------------------------------------------------------------------
// Hand-written SVG scatter plot — no dependencies
// ------------------------------------------------------------------
function ScatterPlot({ points, xLabel, yLabel }: { points: SweepPoint[]; xLabel: string; yLabel: string }) {
  if (!points.length) return null;

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 560, H = 320;
  const PAD = { top: 20, right: 20, bottom: 50, left: 60 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  function sx(x: number) {
    if (maxX === minX) return PAD.left + plotW / 2;
    return PAD.left + ((x - minX) / (maxX - minX)) * plotW;
  }
  function sy(y: number) {
    if (maxY === minY) return PAD.top + plotH / 2;
    return PAD.top + ((maxY - y) / (maxY - minY)) * plotH;
  }

  const STATUS_COLORS: Record<string, string> = {
    completed: "#22c55e",
    failed: "#ef4444",
    running: "#f59e0b",
    submitted: "#3b82f6",
  };

  // Y grid lines
  const gridY = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: PAD.top + t * plotH,
    label: (minY + (1 - t) * (maxY - minY)).toFixed(3),
  }));
  // X grid lines
  const gridX = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    x: PAD.left + t * plotW,
    label: (minX + t * (maxX - minX)).toFixed(3),
  }));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }}>
        {/* Grid */}
        {gridY.map(g => (
          <g key={g.label}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={g.y} y2={g.y} stroke="var(--line)" strokeWidth={0.5} />
            <text x={PAD.left - 6} y={g.y + 4} textAnchor="end" fontSize={10} fill="var(--muted)" style={{ fontFamily: "monospace" }}>
              {g.label}
            </text>
          </g>
        ))}
        {gridX.map(g => (
          <g key={g.label}>
            <line x1={g.x} x2={g.x} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--line)" strokeWidth={0.5} />
            <text x={g.x} y={PAD.top + plotH + 18} textAnchor="middle" fontSize={10} fill="var(--muted)" style={{ fontFamily: "monospace" }}>
              {g.label}
            </text>
          </g>
        ))}

        {/* Axes */}
        <line x1={PAD.left} x2={PAD.left + plotW} y1={PAD.top + plotH} y2={PAD.top + plotH}
          stroke="var(--line)" strokeWidth={1} />
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + plotH}
          stroke="var(--line)" strokeWidth={1} />

        {/* Axis labels */}
        <text x={PAD.left + plotW / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--muted)" fontWeight={600}>
          {xLabel}
        </text>
        <text
          x={14} y={PAD.top + plotH / 2}
          textAnchor="middle" fontSize={11} fill="var(--muted)" fontWeight={600}
          transform={`rotate(-90, 14, ${PAD.top + plotH / 2})`}
        >
          {yLabel}
        </text>

        {/* Points */}
        {points.map((p, i) => {
          const cx = sx(p.x);
          const cy = sy(p.y);
          const color = STATUS_COLORS[p.status] ?? "var(--strong)";
          return (
            <g key={p.run_id}>
              <circle cx={cx} cy={cy} r={6} fill={color} opacity={0.75} stroke="var(--panel)" strokeWidth={1.5} />
              <title>{p.circuit_name || p.run_id.slice(0, 10)} | {xLabel}={p.x.toFixed(4)} {yLabel}={p.y.toFixed(4)}</title>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: 12, padding: "0 0 0 60px", flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
        {Object.entries(STATUS_COLORS).map(([s, c]) => (
          points.some(p => p.status === s) ? (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: c, display: "inline-block" }} />
              {s}
            </span>
          ) : null
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Summary stats
// ------------------------------------------------------------------
function SweepStats({ points, xLabel, yLabel }: { points: SweepPoint[]; xLabel: string; yLabel: string }) {
  const ys = points.map(p => p.y);
  const xs = points.map(p => p.x);
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const best = points.reduce((a, b) => (b.y > a.y ? b : a));
  const worst = points.reduce((a, b) => (b.y < a.y ? b : a));
  const xRange = `${Math.min(...xs).toFixed(4)} – ${Math.max(...xs).toFixed(4)}`;
  const yRange = `${Math.min(...ys).toFixed(4)} – ${Math.max(...ys).toFixed(4)}`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
      {[
        { label: "Data Points", value: String(points.length) },
        { label: `${xLabel} range`, value: xRange },
        { label: `${yLabel} range`, value: yRange },
        { label: `Mean ${yLabel}`, value: mean.toFixed(4) },
        { label: `Best ${yLabel}`, value: `${best.y.toFixed(4)} @ x=${best.x.toFixed(4)}` },
        { label: `Worst ${yLabel}`, value: `${worst.y.toFixed(4)} @ x=${worst.x.toFixed(4)}` },
      ].map(kpi => (
        <div key={kpi.label} style={{ background: "var(--panel-2)", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            {kpi.label}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", wordBreak: "break-all" }}>{kpi.value}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Points table
// ------------------------------------------------------------------
function PointsTable({ points, xLabel, yLabel }: { points: SweepPoint[]; xLabel: string; yLabel: string }) {
  const sorted = [...points].sort((a, b) => b.y - a.y);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Circuit</th>
            <th>{xLabel}</th>
            <th>{yLabel}</th>
            <th>Status</th>
            <th>Backend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr key={p.run_id}>
              <td style={{ color: "var(--muted)", fontSize: 12 }}>{i + 1}</td>
              <td>
                <a href={`/runs/${p.run_id}`} style={{ color: "var(--strong)", fontSize: 13 }}>
                  {p.circuit_name || p.run_id.slice(0, 10)}
                </a>
              </td>
              <td style={{ fontVariantNumeric: "tabular-nums", fontFamily: "monospace", fontSize: 13 }}>
                {p.x.toFixed(6).replace(/\.?0+$/, "")}
              </td>
              <td style={{ fontVariantNumeric: "tabular-nums", fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>
                {p.y.toFixed(6).replace(/\.?0+$/, "")}
              </td>
              <td><span style={{ fontSize: 12 }}>{p.status}</span></td>
              <td style={{ fontSize: 12, color: "var(--muted)" }}>{p.backend || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------
// Main page
// ------------------------------------------------------------------
export default function SweepPage() {
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>([]);
  const [project, setProject] = useState("");
  const [xParam, setXParam] = useState("");
  const [yMetric, setYMetric] = useState("health_score");
  const [availableX, setAvailableX] = useState<string[]>([]);
  const [availableY, setAvailableY] = useState<string[]>(["health_score", "depth", "num_qubits", "gate_count", "success_probability"]);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects().then(ps => {
      setProjects(ps);
      if (ps.length > 0) setProject(ps[0].slug);
    }).catch(() => setProjects([]));
  }, []);

  // When project changes, load available params
  useEffect(() => {
    if (!project) return;
    fetchSweepParams(project).then(p => {
      setAvailableX(p.available_x_params);
      setAvailableY(p.available_y_metrics);
      if (p.available_x_params.length > 0) setXParam(p.available_x_params[0]);
    }).catch(() => setError("Failed to load sweep parameters"));
  }, [project]);

  async function analyze() {
    if (!project || !xParam || !yMetric) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSweep(project, xParam, yMetric);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div className="toolbar">
        <select className="input" value={project} onChange={e => setProject(e.target.value)} aria-label="Project">
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map(p => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>

        <select className="input" value={xParam} onChange={e => setXParam(e.target.value)} aria-label="X axis parameter"
          disabled={availableX.length === 0}>
          {availableX.length === 0
            ? <option value="">No numeric params</option>
            : availableX.map(p => <option key={p} value={p}>{p}</option>)
          }
        </select>

        <select className="input" value={yMetric} onChange={e => setYMetric(e.target.value)} aria-label="Y axis metric">
          {availableY.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <button className="button" type="button" onClick={() => void analyze()} disabled={loading || !project || !xParam}>
          <ScatterChart size={17} aria-hidden="true" />
          {loading ? "Analyzing…" : "Analyze Sweep"}
        </button>
      </div>

      {error && <div className="empty" style={{ color: "var(--danger)" }}>{error}</div>}

      {!result && !loading && (
        <section className="panel">
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <ScatterChart size={40} color="var(--muted)" />
            <p style={{ color: "var(--muted)", marginTop: 12 }}>
              Select a project, numeric parameter (X), and metric (Y) to visualize how changing a parameter affects experiment outcomes.
            </p>
          </div>
        </section>
      )}

      {result && result.matched_points > 0 && (
        <>
          <section className="panel">
            <div className="panel-header">
              <h2>Parameter Sweep</h2>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                {result.matched_points} of {result.total_runs} runs matched · {result.project}
              </span>
            </div>
            <div style={{ padding: "16px 18px" }}>
              <ScatterPlot points={result.points} xLabel={result.x_param} yLabel={result.y_metric} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header"><h2>Summary Statistics</h2></div>
            <div style={{ padding: "16px 18px" }}>
              <SweepStats points={result.points} xLabel={result.x_param} yLabel={result.y_metric} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Data Points</h2>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Sorted by {result.y_metric} (highest first)</span>
            </div>
            <PointsTable points={result.points} xLabel={result.x_param} yLabel={result.y_metric} />
          </section>
        </>
      )}

      {result && result.matched_points === 0 && (
        <section className="panel">
          <div className="empty">
            No runs in <strong>{result.project}</strong> have a numeric parameter <code>{result.x_param}</code> with metric <code>{result.y_metric}</code>.
            <br />
            Log parameters with <code>qlab.run(qc, parameters={"{"}&#39;{result.x_param}&#39;: value{"}"})</code>.
          </div>
        </section>
      )}
    </main>
  );
}
