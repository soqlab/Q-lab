"use client";
import { useState } from "react";
import { VQELandscapeResult, LandscapePoint, exploreLandscape } from "../../../lib/api";
import { TrendingDown, AlertTriangle, Zap } from "lucide-react";

const HAMILTONIANS = [
  { id: "ising", label: "1D Ising", desc: "Nearest-neighbour ZZ coupling" },
  { id: "heisenberg", label: "Heisenberg", desc: "XXX Hamiltonian" },
  { id: "maxcut", label: "MaxCut (QAOA)", desc: "Graph partition objective" },
  { id: "generic", label: "Generic", desc: "Barren plateau showcase" },
];

function Heatmap({ result }: { result: VQELandscapeResult }) {
  const W = 420; const H = 300; const PAD = 30;
  const CW = W - PAD * 2; const CH = H - PAD * 2;
  const n = result.grid_size;
  const cellW = CW / n; const cellH = CH / n;
  const minE = result.min_energy; const maxE = result.max_energy;
  const range = maxE - minE || 1;

  function energyColor(e: number): string {
    const t = (e - minE) / range;
    if (t < 0.33) {
      const r = Math.round(30 + t * 3 * 15); const g = Math.round(100 + t * 3 * 55); const b = Math.round(200 - t * 3 * 50);
      return `rgb(${r},${g},${b})`;
    } else if (t < 0.66) {
      const tt = (t - 0.33) * 3;
      const r = Math.round(45 + tt * 200); const g = Math.round(155 + tt * 20); const b = Math.round(150 - tt * 100);
      return `rgb(${r},${g},${b})`;
    } else {
      const tt = (t - 0.66) * 3;
      const r = Math.round(245); const g = Math.round(175 - tt * 100); const b = Math.round(50);
      return `rgb(${r},${g},${b})`;
    }
  }

  const optX = PAD + ((result.optimal_theta1 - result.grid[0][0].theta1) / (result.grid[n-1][0].theta1 - result.grid[0][0].theta1 || 1)) * CW;
  const optY = PAD + ((result.optimal_theta2 - result.grid[0][0].theta2) / (result.grid[0][n-1].theta2 - result.grid[0][0].theta2 || 1)) * CH;

  return (
    <svg width={W} height={H} style={{ display: "block", width: "100%" }}>
      {result.grid.map((row: LandscapePoint[], i: number) =>
        row.map((pt: LandscapePoint, j: number) => (
          <rect key={`${i}-${j}`} x={PAD + i * cellW} y={PAD + j * cellH} width={cellW + 1} height={cellH + 1} fill={energyColor(pt.energy)} />
        ))
      )}
      <circle cx={optX} cy={optY} r={6} fill="white" stroke="#0f172a" strokeWidth={2} />
      <text x={optX + 8} y={optY + 4} fill="white" fontSize={9} fontWeight="bold">min</text>
      <text x={PAD} y={H - 4} fill="#64748b" fontSize={9}>θ₁: {result.grid[0][0].theta1.toFixed(2)}…{result.grid[n-1][0].theta1.toFixed(2)}</text>
      <text x={PAD} y={PAD - 6} fill="#64748b" fontSize={9}>θ₂ axis →</text>
      <text x={4} y={PAD + CH / 2} fill="#64748b" fontSize={9} transform={`rotate(-90, 10, ${PAD + CH / 2})`}>θ₁ →</text>
    </svg>
  );
}

export default function LandscapePage() {
  const [hamiltonian, setHamiltonian] = useState("ising");
  const [nQubits, setNQubits] = useState(4);
  const [gridSize, setGridSize] = useState(24);
  const [result, setResult] = useState<VQELandscapeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    try { setResult(await exploreLandscape({ hamiltonian, n_qubits: nQubits, grid_size: gridSize })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <TrendingDown size={28} color="#f59e0b" /> Variational Loss Landscape Explorer
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Sweeps two VQE/QAOA parameters across a grid, computing energy expectation at each point.
          Detects barren plateaus, identifies global minima, and visualizes the optimization landscape.
        </p>
      </div>
      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
          <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Hamiltonian</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {HAMILTONIANS.map(h => (
              <button key={h.id} onClick={() => setHamiltonian(h.id)}
                style={{ textAlign: "left", background: hamiltonian === h.id ? "#1d3a6b" : "#0f172a", border: `1px solid ${hamiltonian === h.id ? "#3b82f6" : "#334155"}`, borderRadius: 8, padding: "0.5rem 0.75rem", cursor: "pointer" }}>
                <div style={{ color: hamiltonian === h.id ? "#3b82f6" : "#e2e8f0", fontWeight: 600, fontSize: "0.85rem" }}>{h.label}</div>
                <div style={{ color: "#475569", fontSize: "0.7rem" }}>{h.desc}</div>
              </button>
            ))}
          </div>
          <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 12 }}>
            Qubits: <span style={{ color: "#f59e0b", fontWeight: 700 }}>{nQubits}</span>
            <input type="range" min={2} max={12} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#f59e0b" }} />
          </label>
          <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 16 }}>
            Grid size: <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{gridSize}×{gridSize}</span>
            <input type="range" min={5} max={40} value={gridSize} onChange={e => setGridSize(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#3b82f6" }} />
          </label>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#f59e0b", color: "#0f172a", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 700, opacity: loading ? 0.6 : 1 }}>
            <TrendingDown size={15} /> {loading ? "Computing…" : "Explore Landscape"}
          </button>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Min Energy", value: result.min_energy.toFixed(4), color: "#10b981" },
                  { label: "Optimal θ₁", value: result.optimal_theta1.toFixed(3), color: "#3b82f6" },
                  { label: "Optimal θ₂", value: result.optimal_theta2.toFixed(3), color: "#8b5cf6" },
                  { label: "Roughness", value: result.landscape_roughness.toFixed(4), color: "#f59e0b" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.2rem", fontWeight: 700, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {result.has_barren_plateau && (
                <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={16} /> <strong>Barren Plateau Detected</strong> — gradient variance near zero in center region. Use gradient-free optimizer.
                </div>
              )}

              <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem", marginBottom: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.9rem" }}>Energy Landscape — θ₁ vs θ₂ (−π to π)</h3>
                  <div style={{ display: "flex", gap: 12, fontSize: "0.72rem" }}>
                    <span style={{ color: "#3b82f6" }}>■ Low E</span>
                    <span style={{ color: "#f59e0b" }}>■ Mid</span>
                    <span style={{ color: "#ef4444" }}>■ High E</span>
                    <span style={{ color: "white" }}>○ Min</span>
                  </div>
                </div>
                <Heatmap result={result} />
              </div>

              <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                <h3 style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <Zap size={14} color="#f59e0b" /> Optimizer Recommendations
                </h3>
                {result.recommendations.map((r: string, i: number) => (
                  <div key={i} style={{ color: "#94a3b8", fontSize: "0.82rem", padding: "0.3rem 0", borderBottom: i < result.recommendations.length - 1 ? "1px solid #1e293b" : "none" }}>
                    → {r}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#475569" }}>
              <TrendingDown size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Select a Hamiltonian and explore to see the energy landscape heatmap.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
