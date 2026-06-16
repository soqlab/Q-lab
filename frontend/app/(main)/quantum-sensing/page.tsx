"use client";
import { useState } from "react";
import { runQuantumSensing, QuantumSensingResult } from "@/lib/api";

const PROTOCOLS = ["ramsey", "spin_echo", "xy8", "ghz", "adaptive"];
const SENSORS = ["nv_center", "atom_interferometer", "optical_clock", "squid", "qubit_array"];

export default function QuantumSensingPage() {
  const [protocol, setProtocol] = useState("ramsey");
  const [sensor, setSensor] = useState("nv_center");
  const [nSensors, setNSensors] = useState(1);
  const [nReps, setNReps] = useState(1000);
  const [intTime, setIntTime] = useState(10);
  const [useEnt, setUseEnt] = useState(false);
  const [result, setResult] = useState<QuantumSensingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await runQuantumSensing({ protocol, sensor_type: sensor, n_sensors: nSensors, n_repetitions: nReps, interrogation_time_us: intTime, use_entanglement: useEnt })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Sensing Setup</div>
          <label style={{ fontSize: 11, color: "#64748b" }}>Protocol</label>
          <select value={protocol} onChange={e => setProtocol(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 10, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {PROTOCOLS.map(p => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
          </select>
          <label style={{ fontSize: 11, color: "#64748b" }}>Sensor Type</label>
          <select value={sensor} onChange={e => setSensor(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 10, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {SENSORS.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          {([["Sensors (N)", nSensors, setNSensors, 1, 100, 1], ["Repetitions", nReps, setNReps, 1, 100000, 100], ["T_int (µs)", intTime, setIntTime, 0.1, 1000, 0.5]] as [string, number, (x: number) => void, number, number, number][]).map(([l, v, s, min, max, step]) => (
            <div key={String(l)} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{l}: {v}</div>
              <input type="range" min={Number(min)} max={Number(max)} step={Number(step)} value={Number(v)}
                onChange={e => (s as (x: number) => void)(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#64748b", cursor: "pointer", marginBottom: 12 }}>
            <input type="checkbox" checked={useEnt} onChange={e => setUseEnt(e.target.checked)} />
            Use Entanglement (GHZ)
          </label>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Simulating…" : "Run Sensing Sim"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                ["Sensitivity", `${result.sensitivity_T_per_rtHz.toFixed(2)} fT/√Hz`, "#6366f1"],
                ["Scaling", result.scaling_type.split(" ")[0], useEnt ? "#34d399" : "#94a3b8"],
                ["QFI Advantage", `${result.qfi_advantage_over_classical.toFixed(2)}×`, "#f59e0b"],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: String(c) }}>{v}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Fisher Information</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Classical: <span style={{ color: "#e2e8f0" }}>{result.classical_fisher_info.toFixed(2)}</span></div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Quantum: <span style={{ color: "#6366f1", fontWeight: 700 }}>{result.quantum_fisher_info.toFixed(2)}</span></div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ background: "#0f172a", borderRadius: 4, height: 8, width: "100%" }}>
                    <div style={{ background: "#6366f1", height: "100%", borderRadius: 4, width: `${Math.min(100, result.qfi_advantage_over_classical * 10)}%` }} />
                  </div>
                </div>
              </div>

              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Decoherence</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>T1: {result.t1_us}µs &nbsp; T2: {result.t2_us}µs</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Decay factor: <span style={{ color: "#e2e8f0" }}>{result.decoherence_factor.toFixed(4)}</span></div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Duty cycle: <span style={{ color: "#fbbf24" }}>{(result.duty_cycle * 100).toFixed(1)}%</span></div>
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>SQL vs HL Sensitivity</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>SQL: {result.sql_sensitivity_phase.toExponential(3)} rad/√Hz</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>HL: {result.hl_sensitivity_phase.toExponential(3)} rad/√Hz</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>{result.protocol_description}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Application: {result.sensor_application}</div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>Recommendations</div>
              {result.recommendations.map((r, i) => <div key={i} style={{ fontSize: 12, color: "#cbd5e1", padding: "3px 0" }}>• {r}</div>)}
            </div>
          </>
        )}
        {!result && !loading && <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Configure and run quantum sensing simulation</div>}
      </div>
    </div>
  );
}


