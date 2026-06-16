"use client";
import { useEffect, useState } from "react";
import { NoiseRouterResult, QubitRouteAnalysis, routeCircuit, listRouterBackends } from "../../../lib/api";
import { Navigation, Play } from "lucide-react";

type BackendInfo = { id: string; n_qubits: number; coupling_pairs: number };

const PRESET = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[1],q[2];
t q[0];
measure q -> c;`;

const BACKEND_COLORS: Record<string, string> = {
  ibm_nairobi: "#3b82f6",
  ibm_oslo: "#8b5cf6",
  ionq_aria: "#10b981",
};

function QubitBar({ error, label, maxErr }: { error: number; label: string; maxErr: number }) {
  const frac = maxErr > 0 ? error / maxErr : 0;
  const color = frac > 0.66 ? "#ef4444" : frac > 0.33 ? "#f59e0b" : "#10b981";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: "#64748b", fontSize: "0.72rem", width: 28 }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: "#0f172a", borderRadius: 99 }}>
        <div style={{ width: `${frac * 100}%`, height: "100%", background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: "0.68rem", color, width: 36 }}>{(error * 100).toFixed(2)}%</span>
    </div>
  );
}

export default function NoiseRouterPage() {
  const [qasm, setQasm] = useState(PRESET);
  const [backend, setBackend] = useState("ibm_nairobi");
  const [backends, setBackends] = useState<BackendInfo[]>([
    { id: "ibm_nairobi", n_qubits: 7, coupling_pairs: 6 },
    { id: "ibm_oslo", n_qubits: 7, coupling_pairs: 6 },
    { id: "ionq_aria", n_qubits: 11, coupling_pairs: 110 },
  ]);
  const [result, setResult] = useState<NoiseRouterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRouterBackends().then(b => setBackends(b)).catch(() => {});
  }, []);

  const run = async () => {
    setLoading(true); setError(null);
    try { setResult(await routeCircuit({ qasm, backend })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const accentColor = BACKEND_COLORS[backend] || "#3b82f6";
  const maxErr = result ? Math.max(...result.qubit_analysis.map((q: QubitRouteAnalysis) => q.optimized_gate_error), 0.001) : 0.01;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Navigation size={28} color="#3b82f6" /> Noise-Aware Qubit Router
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Assigns logical qubits to the physical qubits with the best T1/T2/gate-error profile.
          Remaps QASM indices to minimize expected decoherence error on real hardware topologies.
        </p>
      </div>
      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Configuration</h3>
            <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={9}
              style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box", resize: "vertical", marginBottom: 12 }} />
            <h4 style={{ color: "#94a3b8", fontSize: "0.82rem", marginBottom: 6 }}>Target Backend</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
              {backends.map(b => (
                <button key={b.id} onClick={() => setBackend(b.id)}
                  style={{ textAlign: "left", background: backend === b.id ? (BACKEND_COLORS[b.id] || "#3b82f6") + "22" : "#0f172a", border: `1px solid ${backend === b.id ? (BACKEND_COLORS[b.id] || "#3b82f6") : "#334155"}`, borderRadius: 7, padding: "0.5rem 0.75rem", cursor: "pointer", color: backend === b.id ? (BACKEND_COLORS[b.id] || "#3b82f6") : "#94a3b8", fontWeight: backend === b.id ? 600 : 400, fontSize: "0.82rem" }}>
                  {b.id.replace(/_/g, " ").toUpperCase()}
                  <span style={{ float: "right", fontSize: "0.7rem", opacity: 0.6 }}>{b.n_qubits}Q</span>
                </button>
              ))}
            </div>
            <button onClick={run} disabled={loading}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: accentColor, color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
              <Play size={15} /> {loading ? "Routing…" : "Route Circuit"}
            </button>
          </div>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Error Reduction", value: `${(result.expected_error_reduction * 100).toFixed(1)}%`, color: "#10b981" },
                  { label: "Logical Qubits", value: result.n_logical_qubits, color: accentColor },
                  { label: "Physical Qubits", value: result.n_physical_qubits, color: "#64748b" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.3rem", fontWeight: 700, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 600, marginBottom: 10 }}>Qubit Assignment</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {result.qubit_analysis.map((a: QubitRouteAnalysis) => (
                      <div key={a.logical_qubit} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0.5rem", background: "#0f172a", borderRadius: 5 }}>
                        <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>q{a.logical_qubit} →</span>
                        <span style={{ color: accentColor, fontWeight: 700, fontSize: "0.82rem" }}>phys[{a.optimized_physical}]</span>
                        <span style={{ color: "#64748b", fontSize: "0.72rem" }}>T1={a.optimized_t1_us.toFixed(0)}μs</span>
                        {a.improved && <span style={{ color: "#10b981", fontSize: "0.65rem" }}>↑</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 600, marginBottom: 10 }}>Gate Error After Routing</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {result.qubit_analysis.slice(0, 8).map((q: QubitRouteAnalysis) => (
                      <QubitBar key={q.logical_qubit} error={q.optimized_gate_error} label={`q${q.logical_qubit}`} maxErr={maxErr} />
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                <h3 style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>Optimized QASM</h3>
                <pre style={{ background: "#0f172a", borderRadius: 6, padding: "0.75rem", color: "#a5f3fc", fontSize: "0.75rem", margin: 0, overflowX: "auto", maxHeight: 200 }}>
                  {result.optimized_qasm}
                </pre>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#475569" }}>
              <Navigation size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Select a backend and route a circuit to map logical qubits to low-error physical qubits.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
