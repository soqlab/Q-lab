"use client";

import { useState, useEffect } from "react";
import { SpeedupCertResult, certifySpeedup } from "../../../lib/api";
import { Zap, Play, Award, AlertTriangle } from "lucide-react";

const PROBLEMS = [
  { id: "sampling", label: "Quantum Sampling", color: "#3b82f6" },
  { id: "search", label: "Grover Search", color: "#8b5cf6" },
  { id: "factoring", label: "Shor Factoring", color: "#10b981" },
  { id: "simulation", label: "Hamiltonian Sim", color: "#f59e0b" },
  { id: "optimization", label: "QAOA Optimization", color: "#ef4444" },
  { id: "linear_systems", label: "HHL Linear Systems", color: "#06b6d4" },
];

export default function SpeedupPage() {
  const [problemType, setProblemType] = useState("sampling");
  const [nQubits, setNQubits] = useState(20);
  const [circuitDepth, setCircuitDepth] = useState(100);
  const [result, setResult] = useState<SpeedupCertResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await certifySpeedup({ problem_type: problemType, n_qubits: nQubits, circuit_depth: circuitDepth });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void handleRun(); }, []);

  const selectedProblem = PROBLEMS.find((p) => p.id === problemType);

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <Zap size={28} color="#f59e0b" />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800 }}>Quantum Speedup Certifier</h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem" }}>Certify quantum computational advantage over classical algorithms</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem" }}>
            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>Problem Type</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {PROBLEMS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setProblemType(p.id)}
                    style={{
                      flex: "1 1 calc(50% - 0.25rem)",
                      border: problemType === p.id ? `2px solid ${p.color}` : "2px solid #334155",
                      borderRadius: 8,
                      padding: "0.5rem 0.4rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      background: problemType === p.id ? `${p.color}22` : "#0f172a",
                      color: problemType === p.id ? p.color : "#94a3b8",
                      transition: "all 0.15s",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Qubits</span>
                <span style={{ fontSize: "0.9rem", color: "#e2e8f0", fontWeight: 700 }}>{nQubits}</span>
              </div>
              <input type="range" min={4} max={50} value={nQubits} onChange={(e) => setNQubits(Number(e.target.value))} style={{ width: "100%", accentColor: "#f59e0b" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748b" }}>
                <span>4</span><span>50</span>
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Circuit Depth</span>
                <span style={{ fontSize: "0.9rem", color: "#e2e8f0", fontWeight: 700 }}>{circuitDepth}</span>
              </div>
              <input type="range" min={10} max={500} step={10} value={circuitDepth} onChange={(e) => setCircuitDepth(Number(e.target.value))} style={{ width: "100%", accentColor: "#f59e0b" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748b" }}>
                <span>10</span><span>500</span>
              </div>
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{ width: "100%", border: "none", borderRadius: 8, padding: "0.7rem", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, background: loading ? "#78350f" : "#f59e0b", color: "#0f172a", fontSize: "0.95rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
            >
              <Play size={16} />
              {loading ? "Certifying..." : "Certify Speedup"}
            </button>

            {error && (
              <div style={{ marginTop: "1rem", background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.7rem", fontSize: "0.82rem" }}>
                {error}
              </div>
            )}
          </div>

          <div>
            {!result ? (
              <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#64748b" }}>
                <Zap size={48} color="#334155" />
                <div style={{ marginTop: "1rem", fontSize: "1rem" }}>Configure a problem and run to certify quantum speedup</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{
                  background: result.advantage_certified ? "#052e1622" : "#451a0322",
                  border: `1px solid ${result.advantage_certified ? "#10b981" : "#f59e0b"}`,
                  borderRadius: 12,
                  padding: "1.25rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                }}>
                  {result.advantage_certified ? <Award size={32} color="#10b981" /> : <AlertTriangle size={32} color="#f59e0b" />}
                  <div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 800, color: result.advantage_certified ? "#10b981" : "#f59e0b" }}>
                      {result.advantage_certified ? "Quantum Advantage Certified" : "Advantage Not Yet Certified (below crossover)"}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                      Problem: {selectedProblem?.label} · {nQubits} qubits · depth {circuitDepth}
                    </div>
                  </div>
                </div>

                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: "1.5rem", marginBottom: "0.75rem" }}>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.25rem" }}>Speedup Ratio</div>
                      <div style={{ fontSize: "2.2rem", fontWeight: 900, color: "#3b82f6", lineHeight: 1 }}>
                        {result.speedup_ratio > 1e6
                          ? `~${(result.speedup_log2 / 10).toFixed(1)} × 10^${result.speedup_log2.toFixed(0)}`
                          : result.speedup_ratio.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        ×
                      </div>
                    </div>
                    <div style={{ paddingBottom: "0.4rem" }}>
                      <span style={{ background: "#1e3a5f", border: "1px solid #3b82f6", color: "#60a5fa", borderRadius: 20, padding: "0.25rem 0.75rem", fontSize: "0.8rem", fontWeight: 700 }}>
                        Confidence: {result.confidence_level}
                      </span>
                    </div>
                  </div>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #334155" }}>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", color: "#64748b", fontWeight: 700 }}></th>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", color: "#8b5cf6", fontWeight: 700 }}>Quantum</th>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", color: "#94a3b8", fontWeight: 700 }}>Classical</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", fontWeight: 600 }}>Complexity Class</td>
                        <td style={{ padding: "0.5rem 0.75rem", color: "#e2e8f0", fontFamily: "monospace" }}>{result.quantum_complexity_class}</td>
                        <td style={{ padding: "0.5rem 0.75rem", color: "#e2e8f0", fontFamily: "monospace" }}>{result.classical_complexity_class}</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", fontWeight: 600 }}>Operations</td>
                        <td style={{ padding: "0.5rem 0.75rem", color: "#e2e8f0" }}>{result.quantum_gate_count?.toLocaleString()}</td>
                        <td style={{ padding: "0.5rem 0.75rem", color: "#e2e8f0" }}>{result.classical_operations?.toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", fontWeight: 600 }}>Time Estimate</td>
                        <td style={{ padding: "0.5rem 0.75rem", color: "#e2e8f0" }}>{result.quantum_time_estimate_ms} ms</td>
                        <td style={{ padding: "0.5rem 0.75rem", color: "#e2e8f0" }}>{result.classical_time_estimate_ms} ms</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.25rem" }}>Classical Formula</div>
                    <div style={{ fontFamily: "monospace", color: "#a5f3fc", fontSize: "0.95rem" }}>{result.classical_formula}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.25rem" }}>Quantum Advantage Crossover</div>
                    <div style={{ color: "#f59e0b", fontWeight: 600 }}>Quantum advantage kicks in at n = {result.crossover_n_qubits} qubits</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.25rem" }}>Best Classical Algorithm</div>
                    <div style={{ color: "#e2e8f0" }}>{result.current_best_classical_algorithm}</div>
                  </div>
                  {result.reference && (
                    <div style={{ color: "#94a3b8", fontSize: "0.8rem", fontStyle: "italic" }}>{result.reference}</div>
                  )}
                  {result.caveats && result.caveats.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.4rem" }}>Caveats</div>
                      <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#94a3b8", fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        {result.caveats.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
