"use client";
import { useState, useEffect } from "react";
import { runMirrorCircuit, MirrorCircuitResult } from "@/lib/api";

export default function MirrorCircuitPage() {
  const [nQubits, setNQubits] = useState(4);
  const [depth, setDepth] = useState(10);
  const [nCircuits, setNCircuits] = useState(20);
  const [nShots, setNShots] = useState(1024);
  const [noise, setNoise] = useState(0.002);
  const [result, setResult] = useState<MirrorCircuitResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await runMirrorCircuit({ n_qubits: nQubits, circuit_depth: depth, n_circuits: nCircuits, n_shots: nShots, noise_level: noise })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, []);

  const gradeColor = (g: string) => ({ A: "#34d399", B: "#6366f1", C: "#fbbf24", D: "#f97316", F: "#f87171" })[g] ?? "#94a3b8";

  const W = 560, H = 100;
  function sparkline(data: number[]) {
    if (!data || data.length < 2) return null;
    const min = Math.min(...data); const max = Math.max(...data);
    const range = max - min || 0.01;
    const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 6) - 3}`).join(" ");
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
        <polyline fill="none" stroke="#6366f1" strokeWidth={2} points={pts} />
        {data.map((v, i) => {
          const x = (i / (data.length - 1)) * W;
          const y = H - ((v - min) / range) * (H - 6) - 3;
          return <circle key={i} cx={x} cy={y} r={3} fill="#a78bfa" />;
        })}
      </svg>
    );
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Mirror Circuit Config</div>
          {([["Qubits", nQubits, setNQubits, 2, 20, 1], ["Depth", depth, setDepth, 1, 50, 1], ["Circuits", nCircuits, setNCircuits, 1, 100, 1], ["Shots", nShots, setNShots, 100, 8192, 100]] as [string, number, (x: number) => void, number, number, number][]).map(([l, v, s, min, max, step]) => (
            <div key={String(l)} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{l}: {v}</div>
              <input type="range" min={Number(min)} max={Number(max)} step={Number(step)} value={Number(v)}
                onChange={e => (s as (x: number) => void)(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          ))}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Noise/Gate: {noise}</div>
            <input type="range" min={0} max={0.05} step={0.001} value={noise} onChange={e => setNoise(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Benchmarking…" : "Run Mirror Circuit"}
          </button>
        </div>

        {result && (
          <div style={{ background: "#1e293b", borderRadius: 8, padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Quality Grade</div>
            <div style={{ fontSize: 72, fontWeight: 900, color: gradeColor(result.quality_grade) }}>{result.quality_grade}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{result.comparison_to_ideal}</div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                ["Mean Success", `${(result.mean_success_probability * 100).toFixed(1)}%`, "#34d399"],
                ["EPG", result.effective_error_per_gate.toFixed(6), "#f87171"],
                ["EPL", result.effective_error_per_layer.toFixed(6), "#fbbf24"],
                ["CLOPS", result.clops_estimate.toLocaleString(), "#6366f1"],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: String(c) }}>{v}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Per-Circuit Success Probability</div>
              {sparkline(result.per_circuit_success)}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Polarization Fidelity</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>{(result.polarization_fidelity * 100).toFixed(2)}%</div>
              </div>
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Entanglement Layer Fidelity</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>{(result.entanglement_layer_fidelity * 100).toFixed(2)}%</div>
              </div>
            </div>

            {result.recommendations.length > 0 && (
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Recommendations</div>
                {result.recommendations.map((r, i) => (
                  <div key={i} style={{ fontSize: 13, color: "#cbd5e1", padding: "4px 0" }}>• {r}</div>
                ))}
              </div>
            )}
          </>
        )}
        {!result && !loading && <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Run mirror circuit benchmarking</div>}
      </div>
    </div>
  );
}


