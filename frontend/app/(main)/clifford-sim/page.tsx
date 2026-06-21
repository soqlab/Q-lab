"use client";

import { useState, useEffect } from "react";
import { CliffordSimResult, runCliffordSim } from "../../../lib/api";
import { Layers, Play, Cpu, AlertTriangle } from "lucide-react";

const PRESETS = [
  { label: "Bell State", qasm: `OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;` },
  { label: "GHZ (3Q)", qasm: `OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\nmeasure q -> c;` },
  { label: "Clifford+T", qasm: `OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\nt q[0];\ncx q[0],q[1];\ns q[1];\nh q[2];\nmeasure q -> c;` },
];

export default function CliffordSimPage() {
  const [qasm, setQasm] = useState(PRESETS[0].qasm);
  const [result, setResult] = useState<CliffordSimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRun = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await runCliffordSim({ qasm });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void handleRun(); }, []);

  const stabChipColor = (s: string) => {
    if (s.startsWith("+")) return "#10b981";
    if (s.startsWith("-")) return "#ef4444";
    return "#3b82f6";
  };

  return (
    <div style={{ padding: 24, background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <Layers size={22} color="#8b5cf6" />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Clifford Stabilizer Simulator</h1>
        </div>

        {error && (
          <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Presets</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => setQasm(p.qasm)}
                    style={{
                      border: qasm === p.qasm ? "1.5px solid #8b5cf6" : "1.5px solid #334155",
                      borderRadius: 8,
                      padding: "0.55rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      background: qasm === p.qasm ? "#8b5cf618" : "#0f172a",
                      color: qasm === p.qasm ? "#8b5cf6" : "#94a3b8",
                      fontSize: 14,
                      width: "100%",
                      textAlign: "left",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>QASM</div>
              <textarea
                rows={10}
                value={qasm}
                onChange={e => setQasm(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  color: "#e2e8f0",
                  fontFamily: "monospace",
                  fontSize: 12,
                  padding: "0.5rem",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{
                border: "none",
                borderRadius: 8,
                padding: "0.7rem",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
                background: loading ? "#3b1f6e" : "#8b5cf6",
                color: "#fff",
                fontSize: 15,
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Play size={16} />
              {loading ? "Simulating..." : "Run Simulation"}
            </button>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <Cpu size={14} color="#94a3b8" />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>About</span>
              </div>
              <p style={{ fontSize: 12, color: "#64748b", margin: 0, lineHeight: 1.6 }}>
                Uses Aaronson-Gottesman stabilizer tableau. O(n²) per gate for n≤10 qubits. Magic states (T gates) break Clifford simulability.
              </p>
            </div>
          </div>

          <div>
            {result ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{
                  background: "#1e293b",
                  borderRadius: 10,
                  border: `1px solid ${result.is_clifford_circuit && result.is_classically_simulable ? "#10b981" : "#f59e0b"}`,
                  padding: "1rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}>
                  {result.is_clifford_circuit && result.is_classically_simulable ? (
                    <>
                      <Cpu size={18} color="#10b981" />
                      <span style={{ fontWeight: 700, fontSize: 14, color: "#10b981" }}>
                        Clifford Circuit — Classically Simulable in O(n²)
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={18} color="#f59e0b" />
                      <span style={{ fontWeight: 700, fontSize: 14, color: "#f59e0b" }}>
                        Non-Clifford Circuit — {result.magic_state_count} magic states detected
                      </span>
                    </>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
                  {[
                    { label: "Qubits", value: String(result.n_qubits), color: "#3b82f6" },
                    { label: "Clifford Gates", value: String(result.n_gates_clifford), color: "#10b981" },
                    { label: "Non-Clifford", value: String(result.n_gates_non_clifford), color: "#ef4444" },
                    { label: "Magic States", value: String(result.magic_state_count), color: "#f59e0b" },
                    { label: "Sim Time", value: `${result.simulation_time_us} μs`, color: "#8b5cf6" },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                    Stabilizer Generators
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {result.stabilizer_generators.map((g, i) => (
                      <span
                        key={i}
                        style={{
                          background: "#0f172a",
                          border: `1px solid ${stabChipColor(g)}44`,
                          color: stabChipColor(g),
                          fontFamily: "monospace",
                          fontSize: 13,
                          padding: "3px 10px",
                          borderRadius: 6,
                        }}
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                      Pauli Expectations
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <tbody>
                        <tr>
                          <td style={{ padding: "4px 0", color: "#94a3b8", fontSize: 13 }}>Z₀</td>
                          <td style={{ padding: "4px 0", fontFamily: "monospace", fontSize: 13, color: "#e2e8f0" }}>
                            {result.pauli_expectation_z0.toFixed(4)}
                          </td>
                        </tr>
                        <tr>
                          <td style={{ padding: "4px 0", color: "#94a3b8", fontSize: 13 }}>Z₁</td>
                          <td style={{ padding: "4px 0", fontFamily: "monospace", fontSize: 13, color: "#e2e8f0" }}>
                            {result.pauli_expectation_z1.toFixed(4)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div style={{ marginTop: 12, fontSize: 11, color: "#64748b" }}>
                      Max simulable: {result.max_simulable_qubits} qubits
                    </div>
                  </div>

                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                      Tableau Snapshot (first 4 rows)
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {result.tableau_snapshot.slice(0, 4).map((row, ri) => (
                        <div key={ri} style={{ display: "flex", gap: 3 }}>
                          {row.map((cell, ci) => (
                            <span
                              key={ci}
                              style={{
                                fontFamily: "monospace",
                                fontSize: 13,
                                color: cell === "1" ? "#e2e8f0" : "#334155",
                                background: cell === "1" ? "#1e3a5f" : "#0f172a",
                                padding: "1px 6px",
                                borderRadius: 3,
                              }}
                            >
                              {cell}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                background: "#1e293b",
                borderRadius: 10,
                border: "1px solid #334155",
                height: 420,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
              }}>
                <Layers size={48} color="#334155" />
                <div style={{ color: "#64748b", fontSize: 15 }}>Select a preset or paste QASM and run simulation</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
