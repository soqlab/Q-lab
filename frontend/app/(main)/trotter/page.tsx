"use client";
import { useState, useEffect } from "react";
import { runTrotterEvolution, TrotterResult } from "@/lib/api";

const HAMILTONIANS = ["ising_1d", "heisenberg_xxz", "transverse_field", "xy_model"];
const INIT_STATES = ["neel", "all_up", "ghz", "superposition"];

export default function TrotterPage() {
  const [hamiltonian, setHamiltonian] = useState("ising_1d");
  const [nQubits, setNQubits] = useState(4);
  const [tTotal, setTTotal] = useState(2.0);
  const [nSteps, setNSteps] = useState(20);
  const [trotterOrder, setTrotterOrder] = useState(1);
  const [J, setJ] = useState(1.0);
  const [h, setH] = useState(0.5);
  const [initState, setInitState] = useState("neel");
  const [result, setResult] = useState<TrotterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await runTrotterEvolution({ hamiltonian, n_qubits: nQubits, t_total: tTotal, n_steps: nSteps, trotter_order: trotterOrder, J, h, initial_state: initState })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, []);

  const W = 540, H = 160;
  function lineChart(data: number[], color: string) {
    if (!data || data.length < 2) return null;
    const min = Math.min(...data); const max = Math.max(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 10) - 5}`).join(" ");
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
        <polyline fill="none" stroke={color} strokeWidth={2} points={pts} />
      </svg>
    );
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>Hamiltonian</div>
          <select value={hamiltonian} onChange={e => setHamiltonian(e.target.value)}
            style={{ width: "100%", marginBottom: 12, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {HAMILTONIANS.map(h2 => <option key={h2} value={h2}>{h2.replace(/_/g, " ")}</option>)}
          </select>
          {([["n_qubits", nQubits, setNQubits, 2, 8], ["t_total", tTotal, setTTotal, 0.1, 10], ["n_steps", nSteps, setNSteps, 2, 200], ["J", J, setJ, -5, 5], ["h", h, setH, 0, 5]] as [string, number, (x: number) => void, number, number][]).map(([label, val, setter, min, max]) => (
            <div key={String(label)} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label} = {Number(val).toFixed(1)}</div>
              <input type="range" min={Number(min)} max={Number(max)} step={label === "n_qubits" || label === "n_steps" ? 1 : 0.1} value={Number(val)}
                onChange={e => (setter as (v: number) => void)(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          ))}
          <label style={{ fontSize: 11, color: "#64748b" }}>Trotter Order</label>
          <div style={{ display: "flex", gap: 8, marginTop: 4, marginBottom: 8 }}>
            {[1, 2].map(o => (
              <button key={o} onClick={() => setTrotterOrder(o)}
                style={{ flex: 1, padding: "6px 0", background: trotterOrder === o ? "#6366f1" : "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, cursor: "pointer" }}>
                {o}{o === 1 ? "st" : "nd"} Order
              </button>
            ))}
          </div>
          <label style={{ fontSize: 11, color: "#64748b" }}>Initial State</label>
          <select value={initState} onChange={e => setInitState(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 12, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {INIT_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Simulating…" : "Run Trotter"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                ["Ground State E", result.ground_state_energy_estimate.toFixed(4), "#a78bfa"],
                ["Max Trotter Error", result.max_trotter_error.toFixed(6), "#f87171"],
                ["E Conservation", result.energy_conservation_error.toFixed(6), "#fbbf24"],
                ["Rec. Steps", result.recommended_n_steps, "#34d399"],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: String(c) }}>{v}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>

            {[
              ["Energy Evolution", result.energy_evolution, "#6366f1"],
              ["Magnetization", result.magnetization_evolution, "#34d399"],
              ["Entanglement Entropy", result.entanglement_evolution, "#f59e0b"],
              ["Trotter Error", result.trotter_error_evolution, "#f87171"],
            ].map(([label, data, color]) => (
              <div key={String(label)} style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>{label}</div>
                {lineChart(data as number[], String(color))}
              </div>
            ))}

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Final State Distribution</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {result.final_state_labels.map((label, i) => (
                  <div key={label} style={{ background: "#0f172a", borderRadius: 6, padding: 10, textAlign: "center", minWidth: 70 }}>
                    <div style={{ fontSize: 12, color: "#a78bfa", fontFamily: "monospace" }}>|{label}⟩</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>{(result.final_probabilities[i] * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {!result && !loading && <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Configure Hamiltonian and run simulation</div>}
      </div>
    </div>
  );
}

