"use client";
import { useState } from "react";
import { emulateOnBackend, EmulationJob } from "@/lib/api";

const BACKENDS = ["ibm_brisbane", "ibm_kyoto", "ibm_osaka", "ionq_aria_1", "ionq_forte_1", "rigetti_ankaa_2", "quantinuum_h2", "aws_sv1"];

export default function BackendEmulatorPage() {
  const [source, setSource] = useState("ibm_brisbane");
  const [target, setTarget] = useState("ionq_aria_1");
  const [nQubits, setNQubits] = useState(5);
  const [depth, setDepth] = useState(30);
  const [nShots, setNShots] = useState(8192);
  const [result, setResult] = useState<EmulationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (source === target) { setError("Source and target backends must be different"); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await emulateOnBackend({ source_backend: source, target_backend: target, n_qubits: nQubits, circuit_depth: depth, n_shots: nShots });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Cross-Backend Emulator</h1>
      <p style={{ color: "var(--muted)" }}>Predict how your circuit will perform when moved from one hardware platform to another. Accounts for gate set, connectivity, noise profile, and SWAP overhead.</p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Source Backend (currently calibrated on)</label>
            <select value={source} onChange={e => setSource(e.target.value)}
              className="input" style={{ width: "100%", marginTop: 4 }}>
              {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Target Backend (emulate performance)</label>
            <select value={target} onChange={e => setTarget(e.target.value)}
              className="input" style={{ width: "100%", marginTop: 4 }}>
              {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Qubits</label>
            <input type="number" min={1} max={30} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Circuit Depth</label>
            <input type="number" min={1} value={depth} onChange={e => setDepth(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Shots</label>
            <input type="number" value={nShots} onChange={e => setNShots(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="button" style={{ opacity: loading ? 0.5 : 1 }}>
          {loading ? "Emulating..." : "Emulate on Target"}
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 16, color: "var(--info-text)" }}>{source}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Fidelity</span><span style={{ fontFamily: "ui-monospace,monospace", color: "var(--text)" }}>{(result.source_fidelity * 100).toFixed(3)}%</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Depth</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{result.circuit_depth}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Qubits</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{result.n_qubits}</span></div>
              </div>
            </div>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 16, color: "#a78bfa" }}>{target} (emulated)</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Fidelity</span>
                  <span style={{ fontFamily: "ui-monospace,monospace", color: result.emulated_fidelity >= result.source_fidelity ? "var(--ok)" : "var(--danger)" }}>
                    {(result.emulated_fidelity * 100).toFixed(3)}%
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>SWAP overhead</span><span style={{ fontFamily: "ui-monospace,monospace", color: "#f59e0b" }}>{result.swap_overhead.toFixed(2)}×</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Connectivity penalty</span><span style={{ fontFamily: "ui-monospace,monospace", color: "#f97316" }}>{(result.connectivity_penalty * 100).toFixed(2)}%</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Agreement</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{(result.cross_backend_agreement * 100).toFixed(1)}%</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Confidence</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{(result.confidence * 100).toFixed(1)}%</span></div>
              </div>
            </div>
          </div>

          <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20 }}>
            <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 16 }}>Fidelity Delta</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  <span>{source}</span><span>{(result.source_fidelity * 100).toFixed(2)}%</span>
                </div>
                <div style={{ width: "100%", background: "var(--line)", borderRadius: 999, height: 12 }}>
                  <div style={{ background: "#3b82f6", height: 12, borderRadius: 999, width: `${result.source_fidelity * 100}%` }} />
                </div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: result.fidelity_delta >= 0 ? "#4ade80" : "#f87171" }}>
                {result.fidelity_delta >= 0 ? "+" : ""}{(result.fidelity_delta * 100).toFixed(3)}%
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  <span>{target}</span><span>{(result.emulated_fidelity * 100).toFixed(2)}%</span>
                </div>
                <div style={{ width: "100%", background: "var(--line)", borderRadius: 999, height: 12 }}>
                  <div style={{ background: "#a855f7", height: 12, borderRadius: 999, width: `${result.emulated_fidelity * 100}%` }} />
                </div>
              </div>
            </div>
          </div>

          {result.warnings && result.warnings.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {result.warnings.map((w, i) => (
                <div key={i} style={{ background: "rgba(245,158,11,0.15)", border: "1px solid #f59e0b", borderRadius: 8, padding: 12, fontSize: 13, color: "#fbbf24" }}>⚠ {w}</div>
              ))}
            </div>
          )}

          {result.noise_model_mapping && Object.keys(result.noise_model_mapping).length > 0 && (
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Noise Model Mapping</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {Object.entries(result.noise_model_mapping).map(([k, v]) => (
                  <div key={k} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, padding: 8, fontSize: 13 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{k}</div>
                    <div style={{ fontFamily: "ui-monospace,monospace", color: "var(--strong)" }}>{typeof v === "number" ? v.toFixed(4) : String(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.recommendations && result.recommendations.length > 0 && (
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Recommendations</h2>
              {result.recommendations.map((r, i) => <div key={i} style={{ fontSize: 13, color: "var(--text)" }}>• {r}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
