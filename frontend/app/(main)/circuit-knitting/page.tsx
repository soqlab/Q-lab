"use client";
import { useState, useEffect } from "react";
import { runCircuitKnitting, CircuitKnittingResult } from "@/lib/api";

export default function CircuitKnittingPage() {
  const [nQubits, setNQubits] = useState(8);
  const [nSubs, setNSubs] = useState(2);
  const [cutsType, setCutsType] = useState("gate_cut");
  const [method, setMethod] = useState("quasi_prob");
  const [nShots, setNShots] = useState(4096);
  const [noise, setNoise] = useState(0.001);
  const [depth, setDepth] = useState(10);
  const [result, setResult] = useState<CircuitKnittingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await runCircuitKnitting({ n_qubits: nQubits, n_subcircuits: nSubs, cuts_type: cutsType, reconstruction_method: method, n_shots: nShots, noise_level: noise, circuit_depth: depth })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, []);

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Knitting Config</div>
          {([["Qubits", nQubits, setNQubits, 2, 30, 1], ["Subcircuits", nSubs, setNSubs, 2, 6, 1], ["Shots", nShots, setNShots, 100, 65536, 100], ["Depth", depth, setDepth, 1, 50, 1]] as [string, number, (x: number) => void, number, number, number][]).map(([l, v, s, min, max, step]) => (
            <div key={String(l)} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{l}: {v}</div>
              <input type="range" min={Number(min)} max={Number(max)} step={Number(step)} value={Number(v)}
                onChange={e => (s as (x: number) => void)(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          ))}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Noise: {noise}</div>
            <input type="range" min={0} max={0.05} step={0.001} value={noise} onChange={e => setNoise(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
          <label style={{ fontSize: 11, color: "#64748b" }}>Cut Type</label>
          <select value={cutsType} onChange={e => setCutsType(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 10, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {["gate_cut", "wire_cut", "hybrid"].map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
          <label style={{ fontSize: 11, color: "#64748b" }}>Reconstruction</label>
          <select value={method} onChange={e => setMethod(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 12, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {["quasi_prob", "tensor", "direct"].map(m => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
          </select>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Computing…" : "Run Circuit Knitting"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                ["Overhead Factor", `${result.overhead_factor}×`, result.practical_feasibility ? "#34d399" : "#f87171"],
                ["Qubit Savings", `${result.qubit_savings}Q`, "#6366f1"],
                ["Fidelity Gain", `${result.fidelity_improvement.toFixed(2)}×`, "#f59e0b"],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: String(c) }}>{v}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>Fragment Layout</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {result.fragment_sizes.map((sz, i) => (
                  <div key={i} style={{ flex: sz, background: "#0f172a", borderRadius: 6, padding: 12, textAlign: "center", border: "1px solid #334155" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Fragment {i + 1}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#6366f1" }}>{sz}Q</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
                {result.n_cuts} cuts · {result.n_circuit_instances} circuit instances · {result.total_shots_required.toLocaleString()} total shots
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>Fragment Fidelity</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#34d399" }}>{(result.fragment_fidelity * 100).toFixed(2)}%</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>vs full: {(result.full_circuit_fidelity * 100).toFixed(2)}%</div>
              </div>
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>Expectation Value</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#e2e8f0" }}>{result.estimated_expectation_value.toFixed(4)}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>error: ±{result.reconstruction_error_estimate.toFixed(4)}</div>
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{result.method_description}</div>
              <div style={{ marginTop: 8 }}>
                {result.recommendations.map((r, i) => <div key={i} style={{ fontSize: 12, color: "#cbd5e1", padding: "3px 0" }}>• {r}</div>)}
              </div>
            </div>
          </>
        )}
        {!result && !loading && <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Configure and run circuit knitting</div>}
      </div>
    </div>
  );
}


