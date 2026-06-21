"use client";

import { useState, useEffect } from "react";
import { GateTomoResult, runGateTomography } from "../../../lib/api";
import { Microscope, Play, Cpu, CheckCircle } from "lucide-react";

const GATES = [
  { id: "h", label: "Hadamard (H)", n_qubits: 1, color: "#3b82f6" },
  { id: "cx", label: "CNOT", n_qubits: 2, color: "#8b5cf6" },
  { id: "t", label: "T Gate", n_qubits: 1, color: "#10b981" },
  { id: "s", label: "S Gate", n_qubits: 1, color: "#f59e0b" },
  { id: "cz", label: "CZ Gate", n_qubits: 2, color: "#ef4444" },
  { id: "swap", label: "SWAP", n_qubits: 2, color: "#06b6d4" },
];

const BACKENDS = ["ibm_nairobi", "ibm_oslo", "ionq_aria", "ideal"];

const TOMO_METHODS = [
  { id: "process_tomo", label: "Process Tomography" },
  { id: "gate_set_tomo", label: "Gate Set Tomography" },
  { id: "direct_rb", label: "Direct RB" },
];

function ptmColor(value: number): string {
  const v = Math.abs(value);
  if (value > 0) {
    return `rgb(${Math.round((1 - v) * 255)},${Math.round((1 - v) * 255)},255)`;
  } else {
    return `rgb(255,${Math.round((1 - v) * 255)},${Math.round((1 - v) * 255)})`;
  }
}

function PTMHeatmap({ ptm, nQubits }: { ptm: number[][]; nQubits: number }) {
  const N = ptm.length;
  const cellSize = nQubits === 1 ? 30 : 15;
  const svgSize = N * cellSize;

  return (
    <div>
      <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.5rem", fontWeight: 600 }}>PAULI TRANSFER MATRIX</div>
      <svg width={svgSize} height={svgSize} style={{ display: "block", maxWidth: "100%" }}>
        {ptm.map((row, i) =>
          row.map((val, j) => (
            <rect
              key={`${i}-${j}`}
              x={j * cellSize}
              y={i * cellSize}
              width={cellSize}
              height={cellSize}
              fill={ptmColor(Math.max(-1, Math.min(1, val)))}
            />
          ))
        )}
      </svg>
      <div style={{ display: "flex", gap: "1rem", marginTop: "0.4rem", fontSize: "0.75rem", color: "#64748b" }}>
        <span style={{ color: "#ff8888" }}>■ -1</span>
        <span style={{ color: "#fff" }}>■ 0</span>
        <span style={{ color: "#8888ff" }}>■ +1</span>
      </div>
    </div>
  );
}

function ErrorBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(100, value * 100);
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.2rem" }}>
        <span>{label}</span>
        <span style={{ color }}>{(value * 100).toFixed(3)}%</span>
      </div>
      <div style={{ background: "#0f172a", borderRadius: 4, height: 6 }}>
        <div style={{ background: color, borderRadius: 4, height: 6, width: `${pct}%`, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

export default function GateTomoPage() {
  const [gate, setGate] = useState("cx");
  const [backend, setBackend] = useState("ibm_nairobi");
  const [tomoMethod, setTomoMethod] = useState("process_tomo");
  const [nShots, setNShots] = useState(4096);
  const [result, setResult] = useState<GateTomoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGate = GATES.find((g) => g.id === gate) ?? GATES[0];

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await runGateTomography({ gate, backend, tomo_method: tomoMethod, n_shots: nShots });
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void handleRun(); }, []);

  const fidelityColor = result
    ? result.process_fidelity > 0.99 ? "#10b981" : result.process_fidelity > 0.95 ? "#f59e0b" : "#ef4444"
    : "#10b981";

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <Microscope size={28} color="#8b5cf6" />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800, color: "#e2e8f0" }}>Multi-Qubit Gate Tomography</h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem" }}>Characterize quantum gate processes via tomography</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.6rem", fontWeight: 600 }}>GATE</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                {GATES.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setGate(g.id)}
                    style={{
                      background: gate === g.id ? g.color + "22" : "transparent",
                      border: `1px solid ${gate === g.id ? g.color : "#334155"}`,
                      borderRadius: 6,
                      color: gate === g.id ? g.color : "#94a3b8",
                      cursor: "pointer",
                      padding: "0.4rem 0.5rem",
                      fontSize: "0.78rem",
                      fontWeight: gate === g.id ? 700 : 400,
                      textAlign: "left",
                    }}
                  >
                    {g.label}
                    <span style={{ float: "right", fontSize: "0.7rem", opacity: 0.7 }}>{g.n_qubits === 1 ? "1Q" : "2Q"}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.6rem", fontWeight: 600 }}>BACKEND</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {BACKENDS.map((b) => (
                  <button
                    key={b}
                    onClick={() => setBackend(b)}
                    style={{
                      background: backend === b ? "#3b82f622" : "transparent",
                      border: `1px solid ${backend === b ? "#3b82f6" : "#334155"}`,
                      borderRadius: 6,
                      color: backend === b ? "#3b82f6" : "#94a3b8",
                      cursor: "pointer",
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.82rem",
                      fontWeight: backend === b ? 700 : 400,
                      textAlign: "left",
                    }}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.6rem", fontWeight: 600 }}>METHOD</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {TOMO_METHODS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setTomoMethod(m.id)}
                    style={{
                      background: tomoMethod === m.id ? "#8b5cf622" : "transparent",
                      border: `1px solid ${tomoMethod === m.id ? "#8b5cf6" : "#334155"}`,
                      borderRadius: 6,
                      color: tomoMethod === m.id ? "#8b5cf6" : "#94a3b8",
                      cursor: "pointer",
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.82rem",
                      fontWeight: tomoMethod === m.id ? 700 : 400,
                      textAlign: "left",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.4rem", fontWeight: 600 }}>
                SHOTS: {nShots.toLocaleString()}
              </div>
              <input
                type="range"
                min={1000}
                max={10000}
                step={1000}
                value={nShots}
                onChange={(e) => setNShots(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                <span>1,000</span><span>10,000</span>
              </div>
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{
                background: "#f59e0b",
                border: "none",
                borderRadius: 8,
                padding: "0.7rem",
                cursor: "pointer",
                fontWeight: 700,
                color: "#0f172a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                opacity: loading ? 0.7 : 1,
              }}
            >
              <Play size={16} />
              {loading ? "Running..." : "Run Tomography"}
            </button>

            {error && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem" }}>{error}</div>
            )}
          </div>

          <div>
            {result === null ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#64748b" }}>
                <Cpu size={56} color="#334155" />
                <p style={{ marginTop: "1rem" }}>Configure a gate and run tomography to see results</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1.25rem", display: "flex", alignItems: "center", gap: "2rem" }}>
                  <div>
                    <div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>PROCESS FIDELITY</div>
                    <div style={{ fontSize: "3rem", fontWeight: 800, color: fidelityColor, lineHeight: 1 }}>
                      {(result.process_fidelity * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>AVG GATE FIDELITY</div>
                    <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "#e2e8f0" }}>
                      {(result.average_gate_fidelity * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>DIAMOND NORM BOUND</div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#f59e0b" }}>
                      {result.diamond_norm_upper_bound.toFixed(4)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <span style={{
                      background: "#7f1d1d22",
                      border: "1px solid #ef4444",
                      borderRadius: 20,
                      padding: "0.2rem 0.6rem",
                      fontSize: "0.8rem",
                      color: "#f87171",
                    }}>
                      {result.dominant_error_channel}
                    </span>
                    <span style={{
                      background: result.is_unital ? "#1d3a6b" : "#1e293b",
                      border: `1px solid ${result.is_unital ? "#3b82f6" : "#475569"}`,
                      borderRadius: 20,
                      padding: "0.2rem 0.6rem",
                      fontSize: "0.8rem",
                      color: result.is_unital ? "#3b82f6" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.3rem",
                    }}>
                      <CheckCircle size={12} />
                      {result.is_unital ? "Unital" : "Non-Unital"}
                    </span>
                  </div>
                </div>

                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.75rem", fontWeight: 600 }}>BACKEND SPECS</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <tbody>
                      {[
                        { label: "Gate Error", value: (result.backend_specs.gate_error * 100).toFixed(4) + "%" },
                        { label: "T1 (us)", value: result.backend_specs.t1_us.toFixed(1) + " μs" },
                        { label: "T2 (us)", value: result.backend_specs.t2_us.toFixed(1) + " μs" },
                        { label: "Gate Time (ns)", value: result.backend_specs.gate_time_ns.toFixed(1) + " ns" },
                      ].map((row) => (
                        <tr key={row.label} style={{ borderBottom: "1px solid #334155" }}>
                          <td style={{ padding: "0.4rem 0", color: "#94a3b8" }}>{row.label}</td>
                          <td style={{ padding: "0.4rem 0", color: "#e2e8f0", textAlign: "right" }}>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
                    <PTMHeatmap ptm={result.ptm} nQubits={result.n_qubits} />
                  </div>

                  <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.75rem", fontWeight: 600 }}>PAULI ERROR RATES</div>
                    <ErrorBar label="Depolarizing" value={result.pauli_error_rates.depolarizing} color="#ef4444" />
                    <ErrorBar label="Dephasing" value={result.pauli_error_rates.dephasing} color="#f59e0b" />
                    <ErrorBar label="Amplitude Damping" value={result.pauli_error_rates.amplitude_damping} color="#8b5cf6" />
                  </div>
                </div>

                {result.recommendations.length > 0 && (
                  <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.5rem", fontWeight: 600 }}>RECOMMENDATIONS</div>
                    <ul style={{ margin: 0, padding: "0 0 0 1.2rem", color: "#e2e8f0", fontSize: "0.88rem", lineHeight: 1.8 }}>
                      {result.recommendations.map((rec, i) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
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
