"use client";

import { useState } from "react";
import { UnitarySynthResult, GateStep, synthesizeUnitary } from "../../../lib/api";
import { Grid, Play, CheckCircle, Cpu } from "lucide-react";

const IDENTITY_1 = "[[1,0],[0,1]]";
const IDENTITY_2 = "[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]";
const IDENTITY_3 = JSON.stringify([
  [1,0,0,0,0,0,0,0],[0,1,0,0,0,0,0,0],[0,0,1,0,0,0,0,0],[0,0,0,1,0,0,0,0],
  [0,0,0,0,1,0,0,0],[0,0,0,0,0,1,0,0],[0,0,0,0,0,0,1,0],[0,0,0,0,0,0,0,1]
]);
const CNOT_MATRIX = "[[1,0,0,0],[0,1,0,0],[0,0,0,1],[0,0,1,0]]";
const HADAMARD_MATRIX = JSON.stringify([[1/Math.sqrt(2),1/Math.sqrt(2)],[1/Math.sqrt(2),-1/Math.sqrt(2)]].map(r => r.map(v => parseFloat(v.toFixed(6)))));
const TOFFOLI_MATRIX = JSON.stringify([
  [1,0,0,0,0,0,0,0],[0,1,0,0,0,0,0,0],[0,0,1,0,0,0,0,0],[0,0,0,1,0,0,0,0],
  [0,0,0,0,1,0,0,0],[0,0,0,0,0,1,0,0],[0,0,0,0,0,0,0,1],[0,0,0,0,0,0,1,0]
]);

function identityForQubits(n: number): string {
  if (n === 1) return IDENTITY_1;
  if (n === 2) return IDENTITY_2;
  return IDENTITY_3;
}

export default function UnitarySynthPage() {
  const [nQubits, setNQubits] = useState<number>(2);
  const [matrix, setMatrix] = useState<string>(CNOT_MATRIX);
  const [optimize, setOptimize] = useState<boolean>(true);
  const [result, setResult] = useState<UnitarySynthResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function handleNQubitsChange(n: number) {
    setNQubits(n);
    setMatrix(identityForQubits(n));
    setParseError(null);
  }

  async function handleRun() {
    setParseError(null);
    setError(null);
    let parsed: number[][];
    try {
      parsed = JSON.parse(matrix) as number[][];
      if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) throw new Error("Must be a 2D array");
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : String(e));
      return;
    }
    setLoading(true);
    try {
      const res = await synthesizeUnitary({ matrix: parsed, optimize });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const textareaRows = nQubits === 1 ? 4 : nQubits === 2 ? 8 : 10;

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <Grid size={28} color="#8b5cf6" />
          <div>
            <h1 style={{ color: "#e2e8f0", fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Circuit Synthesis from Unitary</h1>
            <p style={{ color: "#94a3b8", fontSize: "0.875rem", margin: 0 }}>Decompose a unitary matrix into a gate sequence</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Number of Qubits</label>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => handleNQubitsChange(n)}
                    style={{ flex: 1, border: "none", borderRadius: 8, padding: "0.6rem", cursor: "pointer", fontWeight: 700, background: nQubits === n ? "#8b5cf6" : "#334155", color: nQubits === n ? "#fff" : "#94a3b8" }}
                  >
                    {n}Q
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Unitary Matrix (JSON)</label>
              <textarea
                value={matrix}
                onChange={(e) => { setMatrix(e.target.value); setParseError(null); }}
                rows={textareaRows}
                style={{ width: "100%", marginTop: "0.5rem", background: "#0f172a", color: "#e2e8f0", border: parseError ? "1px solid #ef4444" : "1px solid #334155", borderRadius: 6, padding: "0.5rem", fontFamily: "monospace", fontSize: "0.72rem", resize: "vertical", boxSizing: "border-box" }}
              />
              {parseError && (
                <div style={{ color: "#f87171", fontSize: "0.75rem", marginTop: "0.25rem" }}>Parse error: {parseError}</div>
              )}
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.5rem" }}>Presets</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {[
                  { label: "CNOT (2Q)", action: () => { setNQubits(2); setMatrix(CNOT_MATRIX); } },
                  { label: "Hadamard (1Q)", action: () => { setNQubits(1); setMatrix(HADAMARD_MATRIX); } },
                  { label: "Toffoli (3Q)", action: () => { setNQubits(3); setMatrix(TOFFOLI_MATRIX); } },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={p.action}
                    style={{ border: "none", borderRadius: 6, padding: "0.5rem 0.75rem", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", background: "#334155", color: "#94a3b8", textAlign: "left" }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ color: "#e2e8f0", fontSize: "0.875rem", fontWeight: 600 }}>Optimize Circuit</label>
              <input
                type="checkbox"
                checked={optimize}
                onChange={(e) => setOptimize(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: "#8b5cf6", cursor: "pointer" }}
              />
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{ border: "none", borderRadius: 8, padding: "0.7rem", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, background: loading ? "#64748b" : "#8b5cf6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", fontSize: "0.9rem" }}
            >
              <Play size={16} />
              {loading ? "Synthesizing..." : "Synthesize Circuit"}
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
                <Grid size={48} color="#334155" />
                <p style={{ color: "#64748b", fontSize: "0.9rem", textAlign: "center" }}>Enter a unitary matrix and run synthesis to see the gate decomposition</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.4rem 0.75rem", borderRadius: 20, background: result.is_unitary ? "#052e1622" : "#7f1d1d22", border: `1px solid ${result.is_unitary ? "#10b981" : "#ef4444"}`, color: result.is_unitary ? "#10b981" : "#f87171", fontSize: "0.8rem", fontWeight: 700 }}>
                      <CheckCircle size={14} />
                      {result.is_unitary ? "Unitary ✓" : "Not Unitary ✗"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.4rem 0.75rem", borderRadius: 20, background: result.is_special_unitary ? "#1e3a5f22" : "#1e293b", border: `1px solid ${result.is_special_unitary ? "#3b82f6" : "#334155"}`, color: result.is_special_unitary ? "#3b82f6" : "#64748b", fontSize: "0.8rem", fontWeight: 700 }}>
                      {result.is_special_unitary ? "SU ✓" : "U only"}
                    </div>
                    <div style={{ padding: "0.4rem 0.75rem", borderRadius: 20, background: "#1e293b", border: "1px solid #334155", color: "#8b5cf6", fontSize: "0.8rem", fontWeight: 700 }}>
                      {result.synthesis_method}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "0.75rem" }}>
                    {[
                      { label: "Depth", value: String(result.circuit_depth), color: "#3b82f6" },
                      { label: "Gates", value: String(result.n_gates), color: "#8b5cf6" },
                      { label: "CX Gates", value: String(result.n_cx_gates), color: "#f59e0b" },
                      { label: "Fidelity", value: result.fidelity_to_target.toFixed(5), color: "#10b981" },
                      { label: "T-Count", value: String(result.t_count), color: "#ef4444" },
                    ].map((s) => (
                      <div key={s.label} style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center", border: "1px solid #334155" }}>
                        <div style={{ color: s.color, fontSize: "1rem", fontWeight: 700 }}>{s.value}</div>
                        <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <Cpu size={16} color="#8b5cf6" />
                    <span style={{ color: "#e2e8f0", fontWeight: 700 }}>Gate Sequence</span>
                    <span style={{ color: "#64748b", fontSize: "0.75rem" }}>({result.gate_sequence.length} gates)</span>
                  </div>
                  <div style={{ maxHeight: 240, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #334155" }}>
                          <th style={{ color: "#64748b", fontWeight: 600, textAlign: "left", padding: "0.4rem 0.5rem" }}>#</th>
                          <th style={{ color: "#64748b", fontWeight: 600, textAlign: "left", padding: "0.4rem 0.5rem" }}>Gate</th>
                          <th style={{ color: "#64748b", fontWeight: 600, textAlign: "left", padding: "0.4rem 0.5rem" }}>Qubits</th>
                          <th style={{ color: "#64748b", fontWeight: 600, textAlign: "left", padding: "0.4rem 0.5rem" }}>Params</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.gate_sequence.map((g: GateStep, i: number) => (
                          <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                            <td style={{ color: "#64748b", padding: "0.35rem 0.5rem", fontFamily: "monospace" }}>{i + 1}</td>
                            <td style={{ color: "#8b5cf6", padding: "0.35rem 0.5rem", fontFamily: "monospace", fontWeight: 700 }}>{g.gate}</td>
                            <td style={{ color: "#3b82f6", padding: "0.35rem 0.5rem", fontFamily: "monospace" }}>[{g.qubits.join(",")}]</td>
                            <td style={{ color: "#94a3b8", padding: "0.35rem 0.5rem", fontFamily: "monospace" }}>
                              {g.params && g.params.length > 0 ? g.params.map((p) => p.toFixed(3)).join(", ") : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.5rem" }}>QASM Output</div>
                  <pre style={{ maxHeight: 200, overflowY: "auto", background: "#0f172a", color: "#a5f3fc", borderRadius: 6, padding: "0.75rem", fontSize: "0.75rem", fontFamily: "monospace", margin: 0, border: "1px solid #334155" }}>
                    {result.qasm_output}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
