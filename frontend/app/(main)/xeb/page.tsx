"use client";
import { useState, useEffect } from "react";
import { runXEB, XEBResult } from "@/lib/api";

export default function XEBPage() {
  const [nQubits, setNQubits] = useState(10);
  const [depth, setDepth] = useState(14);
  const [nCircuits, setNCircuits] = useState(10);
  const [noise, setNoise] = useState(0.002);
  const [result, setResult] = useState<XEBResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await runXEB({ n_qubits: nQubits, circuit_depth: depth, n_circuits: nCircuits, noise_level: noise })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, []);

  const W = 560, H = 120;
  function barChart(data: number[]) {
    if (!data || data.length === 0) return null;
    const maxV = Math.max(...data.map(Math.abs), 0.001);
    const bw = W / data.length - 2;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#334155" strokeWidth={1} />
        {data.map((v, i) => {
          const barH = (Math.abs(v) / maxV) * (H / 2 - 4);
          const y = v >= 0 ? H / 2 - barH : H / 2;
          return <rect key={i} x={i * (bw + 2)} y={y} width={bw} height={barH} fill={v >= 0 ? "#6366f1" : "#f87171"} opacity={0.8} />;
        })}
      </svg>
    );
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>XEB Configuration</div>
          {([["Qubits", nQubits, setNQubits, 2, 30, 1], ["Depth", depth, setDepth, 1, 40, 1], ["Circuits", nCircuits, setNCircuits, 1, 50, 1]] as [string, number, (x: number) => void, number, number, number][]).map(([l, v, s, min, max, step]) => (
            <div key={String(l)} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{l}: {v}</div>
              <input type="range" min={Number(min)} max={Number(max)} step={Number(step)} value={Number(v)}
                onChange={e => (s as (x: number) => void)(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          ))}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Noise/Gate: {noise}</div>
            <input type="range" min={0} max={0.05} step={0.001} value={noise} onChange={e => setNoise(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Running XEB…" : "Run XEB"}
          </button>
        </div>

        {result && (
          <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Verdict</div>
            <div style={{ padding: 10, borderRadius: 6, background: result.quantum_advantage_certified ? "#14532d" : "#1e293b", border: `1px solid ${result.quantum_advantage_certified ? "#34d399" : "#334155"}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: result.quantum_advantage_certified ? "#34d399" : "#94a3b8" }}>
                {result.quantum_advantage_certified ? "✓ Quantum Advantage Certified" : "✗ Not Certified"}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Confidence: {result.confidence_level}</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                ["Linear XEB", result.linear_xeb_fidelity.toFixed(6), "#6366f1"],
                ["Heavy Output Prob", result.heavy_output_probability.toFixed(4), "#34d399"],
                ["Quantum Speedup", `${result.quantum_speedup_factor.toFixed(0)}×`, "#f59e0b"],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: String(c) }}>{v}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Per-Circuit XEB Fidelity</div>
              {barChart(result.per_circuit_xeb)}
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Each bar = one random circuit</div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Google Sycamore Comparison</div>
              <div style={{ fontSize: 13, color: "#cbd5e1" }}>{result.google_sycamore_comparison}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                ["Ideal Heavy Output Threshold", result.ideal_heavy_output_threshold.toFixed(3)],
                ["Predicted XEB from Noise", result.predicted_xeb_from_noise.toFixed(6)],
                ["Porter-Thomas KL Div", result.porter_thomas_kl_divergence.toFixed(6)],
                ["Classical Sim Time", `${result.classical_simulation_time_estimate_s.toFixed(1)}s`],
              ].map(([l, v]) => (
                <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{l}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>{v}</div>
                </div>
              ))}
            </div>
          </>
        )}
        {!result && !loading && <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Configure parameters and run XEB</div>}
      </div>
    </div>
  );
}


