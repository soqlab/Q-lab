"use client";
import { useState } from "react";
import { buildNoiseModel, NoiseModelResult } from "@/lib/api";

const HARDWARE = ["superconducting", "trapped_ion", "photonic", "spin_qubit", "neutral_atom"];

export default function NoiseModelPage() {
  const [nQubits, setNQubits] = useState(5);
  const [hwType, setHwType] = useState("superconducting");
  const [t1, setT1] = useState(100);
  const [t2, setT2] = useState(80);
  const [g1q, setG1q] = useState(25);
  const [g2q, setG2q] = useState(200);
  const [readoutFid, setReadoutFid] = useState(0.99);
  const [crosstalk, setCrosstalk] = useState(false);
  const [result, setResult] = useState<NoiseModelResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await buildNoiseModel({ n_qubits: nQubits, hardware_type: hwType, t1_us: t1, t2_us: t2, gate_time_1q_ns: g1q, gate_time_2q_ns: g2q, readout_fidelity: readoutFid, include_crosstalk: crosstalk })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Hardware Profile</div>
          <label style={{ fontSize: 11, color: "#64748b" }}>Hardware Type</label>
          <select value={hwType} onChange={e => setHwType(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 12, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {HARDWARE.map(h => <option key={h} value={h}>{h.replace(/_/g, " ")}</option>)}
          </select>
          {([["Qubits", nQubits, setNQubits, 1, 30, 1], ["T1 (µs)", t1, setT1, 1, 2000, 1], ["T2 (µs)", t2, setT2, 1, 1000, 1], ["1Q Gate (ns)", g1q, setG1q, 1, 500, 1], ["2Q Gate (ns)", g2q, setG2q, 10, 2000, 10]] as [string, number, (x: number) => void, number, number, number][]).map(([l, v, s, min, max, step]) => (
            <div key={String(l)} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{l}: {v}</div>
              <input type="range" min={Number(min)} max={Number(max)} step={Number(step)} value={Number(v)}
                onChange={e => (s as (x: number) => void)(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          ))}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Readout Fidelity: {readoutFid.toFixed(3)}</div>
            <input type="range" min={0.9} max={1} step={0.001} value={readoutFid} onChange={e => setReadoutFid(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#64748b", cursor: "pointer", marginBottom: 12 }}>
            <input type="checkbox" checked={crosstalk} onChange={e => setCrosstalk(e.target.checked)} />
            Include Crosstalk
          </label>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Building…" : "Build Noise Model"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                ["1Q Error Rate", result.gate_error_1q.p_total.toExponential(2), "#fbbf24"],
                ["2Q Error Rate", result.gate_error_2q.p_total.toExponential(2), "#f87171"],
                ["Circuit Fidelity (d=10)", `${(result.estimated_circuit_fidelity_d10 * 100).toFixed(1)}%`, "#34d399"],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: String(c) }}>{v}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Gate Error Table</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {Object.entries(result.gate_error_table).map(([gate, info]) => (
                  <div key={gate} style={{ background: "#0f172a", borderRadius: 6, padding: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#a78bfa", fontFamily: "monospace" }}>{gate}</div>
                    <div style={{ fontSize: 11, color: "#e2e8f0" }}>{info.error_rate.toExponential(2)}</div>
                    <div style={{ fontSize: 9, color: "#64748b" }}>{info.error_type.split("+")[0]}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Measurement Errors</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {result.measurement_errors.map(m => (
                  <div key={m.qubit} style={{ background: "#0f172a", borderRadius: 6, padding: 8, textAlign: "center", minWidth: 60 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>Q{m.qubit}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#f87171" }}>{(m.p_meas_error * 100).toFixed(2)}%</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>QV Lower Bound: <span style={{ color: "#6366f1", fontWeight: 700 }}>{result.estimated_qv_lower_bound}</span></div>
              <div style={{ fontSize: 12, color: "#64748b" }}>Dominant error: {result.dominant_error_source}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>Compatible with: {result.compatible_backends.join(", ")}</div>
              <pre style={{ marginTop: 10, background: "#0f172a", borderRadius: 6, padding: 10, fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
                {result.qasm_noise_pragma}
              </pre>
            </div>
          </>
        )}
        {!result && !loading && <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Configure hardware profile to build noise model</div>}
      </div>
    </div>
  );
}


