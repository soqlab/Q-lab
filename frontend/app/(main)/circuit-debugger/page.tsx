"use client";
import { useState } from "react";
import { debugCircuit, CircuitDebugResult, CircuitDebugStep } from "@/lib/api";

const PRESET = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];`;

export default function CircuitDebuggerPage() {
  const [qasm, setQasm] = useState(PRESET);
  const [result, setResult] = useState<CircuitDebugResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await debugCircuit({ qasm })); setSelected(0); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const step: CircuitDebugStep | undefined = result?.steps[selected];

  return (
    <div style={{ display: "flex", gap: 24, height: "calc(100vh - 64px)" }}>
      <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>QASM Input</div>
          <textarea value={qasm} onChange={e => setQasm(e.target.value)}
            style={{ width: "100%", height: 200, background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: 8, fontSize: 12, fontFamily: "monospace", resize: "vertical" }} />
          <button onClick={run} disabled={loading}
            style={{ marginTop: 12, width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Simulating…" : "Debug Circuit"}
          </button>
        </div>
        {result && (
          <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Steps ({result.n_steps})</div>
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {result.steps.map((s, i) => (
                <div key={i} onClick={() => setSelected(i)}
                  style={{ padding: "6px 8px", borderRadius: 4, cursor: "pointer", marginBottom: 2, background: selected === i ? "#334155" : "transparent", color: selected === i ? "#e2e8f0" : "#94a3b8", fontSize: 13 }}>
                  Step {s.step_index}: <span style={{ color: "#a78bfa" }}>{s.gate_name}</span>
                  {s.target_qubits.length > 0 && <span> q[{s.target_qubits.join(",")}]</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {step && (
          <>
            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>
                Step {step.step_index}: {step.gate_name} on q[{step.target_qubits.join(",")}]
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[["Bloch X", step.bloch_x?.toFixed(4)], ["Bloch Y", step.bloch_y?.toFixed(4)], ["Bloch Z", step.bloch_z?.toFixed(4)]].map(([l, v]) => (
                  <div key={l} style={{ background: "#0f172a", borderRadius: 6, padding: 12, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{l}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#a78bfa" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>State Probabilities</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {step.probabilities.map((p, i) => (
                  <div key={i} style={{ background: "#0f172a", borderRadius: 6, padding: "8px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>|{i.toString(2).padStart(Math.max(1, result?.n_qubits ?? 1), "0")}⟩</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#34d399" }}>{(p * 100).toFixed(1)}%</div>
                    <div style={{ background: "#1e293b", height: 4, borderRadius: 2, marginTop: 4 }}>
                      <div style={{ background: "#34d399", width: `${p * 100}%`, height: "100%", borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Amplitudes (real + imag)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {step.state_real.map((re, i) => (
                  <div key={i} style={{ background: "#0f172a", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontFamily: "monospace", color: "#e2e8f0" }}>
                    |{i.toString(2).padStart(Math.max(1, result?.n_qubits ?? 1), "0")}⟩: {re.toFixed(3)} {step.state_imag[i] >= 0 ? "+" : ""}{step.state_imag[i]?.toFixed(3)}i
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {result && !step && (
          <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Final Measurement Outcomes</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(result.measurement_outcomes).map(([state, count]) => (
                <div key={state} style={{ background: "#0f172a", borderRadius: 6, padding: "8px 12px", textAlign: "center" }}>
                  <div style={{ fontSize: 14, color: "#a78bfa", fontFamily: "monospace" }}>|{state}⟩</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0" }}>{count}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
