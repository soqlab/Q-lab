"use client";
import { useState } from "react";
import { runQAOA, QAOAResult } from "@/lib/api";

const PROBLEMS = ["maxcut", "vertex_cover", "mis"];
const GRAPHS = ["random_3reg", "erdos_renyi", "complete", "ring"];

export default function QAOAPage() {
  const [nNodes, setNNodes] = useState(8);
  const [pLayers, setPLayers] = useState(3);
  const [graphType, setGraphType] = useState("random_3reg");
  const [maxIter, setMaxIter] = useState(200);
  const [result, setResult] = useState<QAOAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await runQAOA({ problem: "maxcut", n_nodes: nNodes, p_layers: pLayers, graph_type: graphType, max_iter: maxIter })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const W = 540, H = 140;
  function convChart(data: number[]) {
    if (!data || data.length < 2) return null;
    const min = Math.min(...data); const max = Math.max(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 8) - 4}`).join(" ");
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
        <rect x={0} y={0} width={W} height={H} fill="#0f172a" rx={4} />
        <polyline fill="none" stroke="#6366f1" strokeWidth={2} points={pts} />
      </svg>
    );
  }

  function graphViz(result: QAOAResult) {
    const n = result.n_nodes;
    const r = 80;
    const cx = 110, cy = 110;
    const nodeX = (i: number) => cx + r * Math.cos((2 * Math.PI * i / n) - Math.PI / 2);
    const nodeY = (i: number) => cy + r * Math.sin((2 * Math.PI * i / n) - Math.PI / 2);

    return (
      <svg viewBox="0 0 220 220" style={{ width: 200, height: 200, flexShrink: 0 }}>
        {result.edges.map((e, i) => (
          <line key={i} x1={nodeX(e.from)} y1={nodeY(e.from)} x2={nodeX(e.to)} y2={nodeY(e.to)} stroke="#334155" strokeWidth={1.5} />
        ))}
        {Array.from({ length: n }, (_, i) => (
          <g key={i}>
            <circle cx={nodeX(i)} cy={nodeY(i)} r={12} fill={result.qaoa_assignment[i] ? "#6366f1" : "#0f172a"} stroke={result.qaoa_assignment[i] ? "#a78bfa" : "#334155"} strokeWidth={2} />
            <text x={nodeX(i)} y={nodeY(i) + 4} textAnchor="middle" fontSize={10} fill="#e2e8f0">{i}</text>
          </g>
        ))}
      </svg>
    );
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>QAOA Config</div>
          {([["Nodes", nNodes, setNNodes, 3, 20, 1], ["QAOA Depth (p)", pLayers, setPLayers, 1, 10, 1], ["Max Iterations", maxIter, setMaxIter, 10, 1000, 10]] as [string, number, (x: number) => void, number, number, number][]).map(([l, v, s, min, max, step]) => (
            <div key={String(l)} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{l}: {v}</div>
              <input type="range" min={Number(min)} max={Number(max)} step={Number(step)} value={Number(v)}
                onChange={e => (s as (x: number) => void)(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          ))}
          <label style={{ fontSize: 11, color: "#64748b" }}>Graph Type</label>
          <select value={graphType} onChange={e => setGraphType(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 12, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {GRAPHS.map(g => <option key={g} value={g}>{g.replace(/_/g, " ")}</option>)}
          </select>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Optimizing…" : "Run QAOA"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              {graphViz(result)}
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  ["Classical Optimal", result.classical_optimal, "#e2e8f0"],
                  ["QAOA Result", result.qaoa_cut_value, "#6366f1"],
                  ["Approx Ratio", result.approximation_ratio.toFixed(4), result.approximation_ratio > 0.878 ? "#34d399" : "#fbbf24"],
                  ["Beats GW Bound?", result.exceeds_gw ? "Yes" : "No", result.exceeds_gw ? "#34d399" : "#f87171"],
                ].map(([l, v, c]) => (
                  <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 12, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: String(c) }}>{v}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Convergence ({result.n_iterations} iterations)</div>
              {convChart(result.convergence_history)}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Optimal Gammas</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {result.optimal_gammas.map((g, i) => (
                    <span key={i} style={{ padding: "4px 8px", background: "#0f172a", borderRadius: 6, fontSize: 12, color: "#a78bfa", fontFamily: "monospace" }}>{g.toFixed(4)}</span>
                  ))}
                </div>
              </div>
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Optimal Betas</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {result.optimal_betas.map((b, i) => (
                    <span key={i} style={{ padding: "4px 8px", background: "#0f172a", borderRadius: 6, fontSize: 12, color: "#34d399", fontFamily: "monospace" }}>{b.toFixed(4)}</span>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
        {!result && !loading && <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Configure graph and run QAOA optimizer</div>}
      </div>
    </div>
  );
}


