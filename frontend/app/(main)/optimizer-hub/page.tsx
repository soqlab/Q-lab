"use client";

import { useState } from "react";
import { OptimizerHubResult, OptimizerRunResult, runOptimizerHub } from "../../../lib/api";
import { Cpu, Play, Trophy, TrendingDown } from "lucide-react";

const ALL_OPTIMIZERS = ["COBYLA", "SPSA", "ADAM", "L-BFGS-B", "SLSQP"];
type Hamiltonian = "ising" | "heisenberg" | "maxcut" | "generic";

function Sparkline({ pts }: { pts: number[] }): React.ReactElement {
  if (!pts || pts.length < 2) return <svg width={100} height={30} />;
  const minE = Math.min(...pts);
  const maxE = Math.max(...pts) || minE + 1;
  const w = 100;
  const h = 30;
  const points = pts.map((v, j) => `${(j / (pts.length - 1)) * w},${h - ((v - minE) / (maxE - minE + 0.0001)) * h}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={points} stroke="#3b82f6" fill="none" strokeWidth={1.5} />
    </svg>
  );
}

export default function OptimizerHubPage() {
  const [hamiltonian, setHamiltonian] = useState<Hamiltonian>("ising");
  const [nQubits, setNQubits] = useState<number>(4);
  const [nLayers, setNLayers] = useState<number>(2);
  const [maxIter, setMaxIter] = useState<number>(200);
  const [selectedOptimizers, setSelectedOptimizers] = useState<string[]>([...ALL_OPTIMIZERS]);
  const [result, setResult] = useState<OptimizerHubResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function toggleOptimizer(opt: string) {
    setSelectedOptimizers((prev) =>
      prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
    );
  }

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await runOptimizerHub({
        hamiltonian,
        n_qubits: nQubits,
        optimizers: selectedOptimizers,
        n_layers: nLayers,
        max_iter: maxIter,
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <Cpu size={28} color="#8b5cf6" />
          <div>
            <h1 style={{ color: "#e2e8f0", fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>VQE Optimizer Hub</h1>
            <p style={{ color: "#94a3b8", fontSize: "0.875rem", margin: 0 }}>Compare classical optimizers for variational quantum eigensolvers</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.5rem" }}>Hamiltonian</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                {(["ising", "heisenberg", "maxcut", "generic"] as Hamiltonian[]).map((h) => (
                  <button
                    key={h}
                    onClick={() => setHamiltonian(h)}
                    style={{ border: "none", borderRadius: 8, padding: "0.6rem", cursor: "pointer", fontWeight: 700, fontSize: "0.75rem", background: hamiltonian === h ? "#8b5cf6" : "#334155", color: hamiltonian === h ? "#fff" : "#94a3b8", textTransform: "capitalize" }}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Qubits</label>
                <span style={{ color: "#8b5cf6", fontWeight: 700, fontSize: "0.875rem" }}>{nQubits}</span>
              </div>
              <input
                type="range"
                min={2}
                max={8}
                step={1}
                value={nQubits}
                onChange={(e) => setNQubits(parseInt(e.target.value))}
                style={{ width: "100%", accentColor: "#8b5cf6" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>
                <span>2</span><span>8</span>
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Layers</label>
                <span style={{ color: "#8b5cf6", fontWeight: 700, fontSize: "0.875rem" }}>{nLayers}</span>
              </div>
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={nLayers}
                onChange={(e) => setNLayers(parseInt(e.target.value))}
                style={{ width: "100%", accentColor: "#8b5cf6" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>
                <span>1</span><span>4</span>
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Max Iterations</label>
                <span style={{ color: "#8b5cf6", fontWeight: 700, fontSize: "0.875rem" }}>{maxIter}</span>
              </div>
              <input
                type="range"
                min={50}
                max={500}
                step={50}
                value={maxIter}
                onChange={(e) => setMaxIter(parseInt(e.target.value))}
                style={{ width: "100%", accentColor: "#8b5cf6" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>
                <span>50</span><span>500</span>
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.5rem" }}>Optimizers</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {ALL_OPTIMIZERS.map((opt) => (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", padding: "0.35rem 0" }}>
                    <input
                      type="checkbox"
                      checked={selectedOptimizers.includes(opt)}
                      onChange={() => toggleOptimizer(opt)}
                      style={{ width: 16, height: 16, accentColor: "#8b5cf6", cursor: "pointer" }}
                    />
                    <span style={{ color: selectedOptimizers.includes(opt) ? "#e2e8f0" : "#64748b", fontSize: "0.85rem", fontWeight: 600 }}>{opt}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleRun}
              disabled={loading || selectedOptimizers.length === 0}
              style={{ border: "none", borderRadius: 8, padding: "0.7rem", cursor: loading || selectedOptimizers.length === 0 ? "not-allowed" : "pointer", fontWeight: 700, background: loading || selectedOptimizers.length === 0 ? "#64748b" : "#8b5cf6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", fontSize: "0.9rem" }}
            >
              <Play size={16} />
              {loading ? "Optimizing..." : "Run Optimizer Hub"}
            </button>

            {error && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem", fontSize: "0.8rem" }}>
                {error}
              </div>
            )}
          </div>

          <div>
            {!result ? (
              <div style={{ height: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", background: "#1e293b", borderRadius: 10, border: "1px solid #334155" }}>
                <Cpu size={48} color="#334155" />
                <p style={{ color: "#64748b", fontSize: "0.9rem", textAlign: "center" }}>Select optimizers and configure VQE parameters to start the benchmark</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #f59e0b33", padding: "1.25rem", display: "flex", alignItems: "center", gap: "1.25rem" }}>
                  <Trophy size={36} color="#f59e0b" />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#f59e0b", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Winner</div>
                    <div style={{ color: "#e2e8f0", fontSize: "1.75rem", fontWeight: 900, lineHeight: 1 }}>{result.best_optimizer}</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginTop: "0.25rem" }}>{result.winner_summary}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#64748b", fontSize: "0.7rem" }}>Best Energy</div>
                    <div style={{ color: "#10b981", fontSize: "1.25rem", fontWeight: 700 }}>{result.best_energy.toFixed(4)}</div>
                    <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>True Min: <span style={{ color: "#3b82f6" }}>{result.true_minimum.toFixed(4)}</span></div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  {result.results.map((r: OptimizerRunResult) => {
                    const isWinner = r.optimizer === result.best_optimizer;
                    return (
                      <div
                        key={r.optimizer}
                        style={{ background: "#1e293b", borderRadius: 10, border: isWinner ? "1px solid #f59e0b" : "1px solid #334155", padding: "1rem" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            {isWinner && <Trophy size={14} color="#f59e0b" />}
                            <span style={{ color: isWinner ? "#f59e0b" : "#e2e8f0", fontWeight: 700, fontSize: "0.9rem" }}>{r.optimizer}</span>
                          </div>
                          <span style={{ padding: "0.2rem 0.5rem", borderRadius: 12, fontSize: "0.7rem", fontWeight: 700, background: r.converged ? "#052e1622" : "#7f1d1d22", color: r.converged ? "#10b981" : "#ef4444", border: `1px solid ${r.converged ? "#10b981" : "#ef4444"}` }}>
                            {r.converged ? "Converged" : "Not Converged"}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                          <div style={{ background: "#0f172a", borderRadius: 6, padding: "0.4rem 0.6rem", flex: 1, minWidth: 70 }}>
                            <div style={{ color: "#10b981", fontSize: "0.85rem", fontWeight: 700 }}>{r.final_energy.toFixed(4)}</div>
                            <div style={{ color: "#64748b", fontSize: "0.65rem" }}>Final Energy</div>
                          </div>
                          <div style={{ background: "#0f172a", borderRadius: 6, padding: "0.4rem 0.6rem", flex: 1, minWidth: 70 }}>
                            <div style={{ color: "#3b82f6", fontSize: "0.85rem", fontWeight: 700 }}>{r.n_iterations}</div>
                            <div style={{ color: "#64748b", fontSize: "0.65rem" }}>Iterations</div>
                          </div>
                          <div style={{ background: "#0f172a", borderRadius: 6, padding: "0.4rem 0.6rem", flex: 1, minWidth: 70 }}>
                            <div style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 700 }}>{r.time_ms.toFixed(0)}ms</div>
                            <div style={{ color: "#64748b", fontSize: "0.65rem" }}>Time</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <TrendingDown size={12} color="#64748b" />
                          <span style={{ color: "#64748b", fontSize: "0.7rem" }}>Convergence</span>
                          <Sparkline pts={r.convergence_curve} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
