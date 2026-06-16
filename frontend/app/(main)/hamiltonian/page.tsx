"use client";

import { useState } from "react";
import { HamiltonianStudioResult, PauliTerm, engineerHamiltonian, listHamiltonianPresets } from "../../../lib/api";
import { FlaskConical, Play, Cpu, Zap } from "lucide-react";

const PRESET_HAMILTONIANS = [
  { id: "h2", label: "H₂ Molecule" },
  { id: "lih", label: "LiH" },
  { id: "h2o", label: "H₂O" },
  { id: "ising_1d", label: "1D Ising" },
  { id: "heisenberg", label: "Heisenberg" },
];

const ANSATZE = [
  { id: "hea", label: "HEA" },
  { id: "uccsd", label: "UCCSD" },
  { id: "qaoa", label: "QAOA" },
];

export default function HamiltonianPage() {
  const [preset, setPreset] = useState<string | null>("h2");
  const [nQubits, setNQubits] = useState(4);
  const [ansatz, setAnsatz] = useState<"hea" | "uccsd" | "qaoa">("hea");
  const [pauliTermsText, setPauliTermsText] = useState('[]');
  const [usePreset, setUsePreset] = useState(true);
  const [result, setResult] = useState<HamiltonianStudioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      let res: HamiltonianStudioResult;
      if (usePreset) {
        res = await engineerHamiltonian({ preset: preset ?? undefined, n_qubits: nQubits, ansatz });
      } else {
        let parsed: PauliTerm[];
        try {
          parsed = JSON.parse(pauliTermsText);
        } catch {
          throw new Error("Invalid JSON in Pauli terms");
        }
        res = await engineerHamiltonian({ pauli_terms: parsed, n_qubits: nQubits, ansatz });
      }
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const W = 400;
  const H = 180;
  const PAD = 40;

  const gse = result?.ground_state_energy ?? -2;
  const fse = result?.first_excited_energy ?? -1;
  const energyMin = Math.min(gse, fse) - Math.abs(gse - fse) * 0.4;
  const energyMax = Math.max(gse, fse) + Math.abs(gse - fse) * 0.4;
  const energyRange = energyMax - energyMin || 1;

  function ey(e: number) {
    return H - PAD - ((e - energyMin) / energyRange) * (H - PAD * 2);
  }

  const gsY = result ? ey(gse) : H / 2 + 20;
  const fsY = result ? ey(fse) : H / 2 - 20;
  const midX = W / 2;
  const arrowX = midX + 80;

  const displayedTerms = result?.pauli_terms?.slice(0, 10) ?? [];

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <FlaskConical size={28} color="#f59e0b" />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800 }}>Hamiltonian Engineering Studio</h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem" }}>Design, analyze, and simulate quantum Hamiltonians with VQE ansatz</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Input Mode</div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => setUsePreset(true)}
                  style={{
                    flex: 1,
                    border: usePreset ? "2px solid #f59e0b" : "2px solid #334155",
                    borderRadius: 8,
                    padding: "0.5rem",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: "0.8rem",
                    background: usePreset ? "#f59e0b22" : "#0f172a",
                    color: usePreset ? "#f59e0b" : "#94a3b8",
                  }}
                >
                  Use Preset
                </button>
                <button
                  onClick={() => setUsePreset(false)}
                  style={{
                    flex: 1,
                    border: !usePreset ? "2px solid #f59e0b" : "2px solid #334155",
                    borderRadius: 8,
                    padding: "0.5rem",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: "0.8rem",
                    background: !usePreset ? "#f59e0b22" : "#0f172a",
                    color: !usePreset ? "#f59e0b" : "#94a3b8",
                  }}
                >
                  Custom Terms
                </button>
              </div>
            </div>

            {usePreset ? (
              <div>
                <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Preset Hamiltonian</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {PRESET_HAMILTONIANS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPreset(p.id)}
                      style={{
                        width: "100%",
                        border: preset === p.id ? "2px solid #f59e0b" : "2px solid #334155",
                        borderRadius: 8,
                        padding: "0.5rem 0.75rem",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: "0.82rem",
                        background: preset === p.id ? "#f59e0b22" : "#0f172a",
                        color: preset === p.id ? "#f59e0b" : "#94a3b8",
                        textAlign: "left",
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>Pauli Terms (JSON)</div>
                <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: "0.4rem" }}>
                  e.g. [{`{"pauli_string":"ZZ","coefficient":-1.0}`}]
                </div>
                <textarea
                  rows={6}
                  value={pauliTermsText}
                  onChange={(e) => setPauliTermsText(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 6,
                    padding: "0.5rem",
                    color: "#a5f3fc",
                    fontSize: "0.78rem",
                    fontFamily: "monospace",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            )}

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Qubits</span>
                <span style={{ fontSize: "0.9rem", color: "#e2e8f0", fontWeight: 700 }}>{nQubits}</span>
              </div>
              <input type="range" min={2} max={6} value={nQubits} onChange={(e) => setNQubits(Number(e.target.value))} style={{ width: "100%", accentColor: "#f59e0b" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748b" }}>
                <span>2</span><span>6</span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Ansatz</div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {ANSATZE.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAnsatz(a.id as "hea" | "uccsd" | "qaoa")}
                    style={{
                      flex: 1,
                      border: ansatz === a.id ? "2px solid #f59e0b" : "2px solid #334155",
                      borderRadius: 8,
                      padding: "0.5rem 0.3rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "0.8rem",
                      background: ansatz === a.id ? "#f59e0b22" : "#0f172a",
                      color: ansatz === a.id ? "#f59e0b" : "#94a3b8",
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{ width: "100%", border: "none", borderRadius: 8, padding: "0.7rem", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, background: loading ? "#78350f" : "#f59e0b", color: "#0f172a", fontSize: "0.95rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
            >
              <Play size={16} />
              {loading ? "Running VQE..." : "Engineer Hamiltonian"}
            </button>

            {error && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.7rem", fontSize: "0.82rem" }}>{error}</div>
            )}
          </div>

          <div>
            {!result ? (
              <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#64748b" }}>
                <Cpu size={48} color="#334155" />
                <div style={{ marginTop: "1rem", fontSize: "1rem" }}>Select a Hamiltonian and run to see energy levels</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "1rem" }}>
                  <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem" }}>
                    <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.75rem" }}>Energy Level Diagram</div>
                    <svg width={W} height={H} style={{ overflow: "visible" }}>
                      <line x1={PAD} y1={gsY} x2={midX + 60} y2={gsY} stroke="#3b82f6" strokeWidth={3} />
                      <text x={PAD - 4} y={gsY - 6} fill="#3b82f6" fontSize={11} textAnchor="end">Ground</text>
                      <text x={PAD - 4} y={gsY + 14} fill="#60a5fa" fontSize={10} textAnchor="end">{gse.toFixed(4)}</text>

                      <line x1={PAD} y1={fsY} x2={midX + 60} y2={fsY} stroke="#8b5cf6" strokeWidth={3} />
                      <text x={PAD - 4} y={fsY - 6} fill="#8b5cf6" fontSize={11} textAnchor="end">Excited</text>
                      <text x={PAD - 4} y={fsY + 14} fill="#a78bfa" fontSize={10} textAnchor="end">{fse.toFixed(4)}</text>

                      <line x1={arrowX} y1={gsY} x2={arrowX} y2={fsY} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3,2" markerEnd="url(#arrowUp)" markerStart="url(#arrowDown)" />
                      <text x={arrowX + 8} y={(gsY + fsY) / 2 + 4} fill="#f59e0b" fontSize={10}>Δ={result.spectral_gap.toFixed(4)}</text>

                      <defs>
                        <marker id="arrowUp" markerWidth="6" markerHeight="6" refX="3" refY="6" orient="auto">
                          <path d="M 0 6 L 3 0 L 6 6" fill="none" stroke="#f59e0b" strokeWidth="1.5" />
                        </marker>
                        <marker id="arrowDown" markerWidth="6" markerHeight="6" refX="3" refY="0" orient="auto">
                          <path d="M 0 0 L 3 6 L 6 0" fill="none" stroke="#f59e0b" strokeWidth="1.5" />
                        </marker>
                      </defs>
                    </svg>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                        <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#3b82f6" }}>{result.ground_state_energy.toFixed(4)}</div>
                        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>Ground State Energy</div>
                      </div>
                      <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                        <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#f59e0b" }}>{result.spectral_gap.toFixed(4)}</div>
                        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>Spectral Gap</div>
                      </div>
                      <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                        <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#8b5cf6" }}>{result.n_pauli_terms}</div>
                        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>Pauli Terms</div>
                      </div>
                      <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                        <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#10b981" }}>{result.n_ansatz_params}</div>
                        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>Ansatz Params</div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                      <span style={{
                        background: result.is_hermitian ? "#05200e" : "#7f1d1d22",
                        border: `1px solid ${result.is_hermitian ? "#10b981" : "#ef4444"}`,
                        color: result.is_hermitian ? "#34d399" : "#f87171",
                        borderRadius: 6,
                        padding: "0.25rem 0.75rem",
                        fontSize: "0.8rem",
                        fontWeight: 700,
                      }}>
                        {result.is_hermitian ? "Hermitian" : "Non-Hermitian"}
                      </span>
                      <span style={{
                        background: result.is_commuting ? "#1e3a5f33" : "#1e293b",
                        border: `1px solid ${result.is_commuting ? "#3b82f6" : "#334155"}`,
                        color: result.is_commuting ? "#60a5fa" : "#64748b",
                        borderRadius: 6,
                        padding: "0.25rem 0.75rem",
                        fontSize: "0.8rem",
                        fontWeight: 700,
                      }}>
                        {result.is_commuting ? "Commuting" : "Non-Commuting"}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700 }}>Recommended Optimizer:</span>
                      <span style={{ background: "#1e3a5f33", border: "1px solid #3b82f6", color: "#60a5fa", borderRadius: 6, padding: "0.2rem 0.6rem", fontSize: "0.8rem", fontWeight: 700 }}>
                        {result.recommended_optimizer}
                      </span>
                    </div>
                  </div>
                </div>

                {displayedTerms.length > 0 && (
                  <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem" }}>
                    <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.75rem" }}>
                      Pauli Terms {result.pauli_terms && result.pauli_terms.length > 10 ? `(first 10 of ${result.pauli_terms.length})` : ""}
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #334155" }}>
                          <th style={{ textAlign: "left", padding: "0.4rem 0.75rem", color: "#64748b", fontWeight: 700 }}>Pauli String</th>
                          <th style={{ textAlign: "left", padding: "0.4rem 0.75rem", color: "#64748b", fontWeight: 700 }}>Coefficient</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedTerms.map((term, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #0f172a" }}>
                            <td style={{ padding: "0.4rem 0.75rem", fontFamily: "monospace", color: "#a5f3fc", fontWeight: 700 }}>{term.pauli_string}</td>
                            <td style={{ padding: "0.4rem 0.75rem", color: term.coefficient < 0 ? "#ef4444" : "#10b981", fontWeight: 600 }}>
                              {term.coefficient > 0 ? "+" : ""}{term.coefficient}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {result.ansatz_qasm && (
                  <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem" }}>
                    <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.75rem" }}>Ansatz QASM</div>
                    <pre style={{
                      maxHeight: 150,
                      overflow: "auto",
                      background: "#0f172a",
                      color: "#a5f3fc",
                      borderRadius: 8,
                      padding: "0.75rem",
                      fontSize: "0.78rem",
                      fontFamily: "monospace",
                      margin: 0,
                      lineHeight: 1.5,
                    }}>
                      {result.ansatz_qasm}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
