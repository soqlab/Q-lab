"use client";
import { useState } from "react";
import { runMitigation, MitigationJob } from "@/lib/api";

const METHODS = [
  { value: "zne_richardson", label: "ZNE Richardson", desc: "Zero-noise extrapolation — extrapolates to λ=0 from scaled noise points" },
  { value: "zne_exponential", label: "ZNE Exponential", desc: "Exponential fit — better for deep circuits with large noise" },
  { value: "pec", label: "PEC", desc: "Probabilistic Error Cancellation — quasi-probability decomposition" },
  { value: "cdr", label: "CDR", desc: "Clifford Data Regression — trains linear model on Clifford circuits" },
  { value: "m3", label: "M3", desc: "Matrix-free Measurement Mitigation — efficient readout correction" },
  { value: "symmetry", label: "Symmetry Verification", desc: "Post-selects on symmetry sector — no overhead but some shot waste" },
];

export default function ZnePecPage() {
  const [method, setMethod] = useState("zne_richardson");
  const [nQubits, setNQubits] = useState(5);
  const [depth, setDepth] = useState(20);
  const [noiseModel, setNoiseModel] = useState("depolarizing");
  const [noiseFactors, setNoiseFactors] = useState("1.0, 1.5, 2.0, 2.5, 3.0");
  const [result, setResult] = useState<MitigationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const factors = noiseFactors.split(",").map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
      const r = await runMitigation({ method, n_qubits: nQubits, circuit_depth: depth, backend: noiseModel, noise_factors: factors });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>ZNE / PEC Error Mitigation</h1>
      <p style={{ color: "var(--muted)" }}>Apply Zero-Noise Extrapolation, Probabilistic Error Cancellation, or other advanced mitigation methods to recover near-ideal expectation values from noisy hardware.</p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          {METHODS.map(m => (
            <button key={m.value} onClick={() => setMethod(m.value)}
              style={{
                padding: 12,
                borderRadius: 8,
                border: method === m.value ? "1px solid var(--strong)" : "1px solid var(--line)",
                background: method === m.value ? "rgba(99,102,241,0.3)" : "transparent",
                textAlign: "left",
                fontSize: 13,
                cursor: "pointer",
                color: "var(--text)",
              }}>
              <div style={{ fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{m.desc}</div>
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Qubits</label>
            <input type="number" min={1} max={20} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Circuit Depth</label>
            <input type="number" min={1} value={depth} onChange={e => setDepth(Number(e.target.value))}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Noise Model (backend)</label>
            <select value={noiseModel} onChange={e => setNoiseModel(e.target.value)}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }}>
              {["depolarizing", "thermal_relaxation", "ibm_brisbane", "ionq_aria_1"].map(n => (
                <option key={n} value={n}>{n.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: "span 3" }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Noise Scale Factors (comma-separated)</label>
            <input value={noiseFactors} onChange={e => setNoiseFactors(e.target.value)}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", fontFamily: "ui-monospace,monospace", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }} />
          </div>
        </div>
        <button onClick={run} disabled={loading}
          style={{ padding: "8px 24px", background: "var(--strong)", borderRadius: 6, fontWeight: 500, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer", color: "var(--text)", border: "none" }}>
          {loading ? "Mitigating..." : "Run Mitigation"}
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {([
              ["Noisy Value", result.noisy_value.toFixed(6), "var(--danger)"],
              ["Mitigated Value", result.mitigated_value.toFixed(6), "var(--ok)"],
              ["True Estimate", result.estimated_true_value.toFixed(6), "var(--strong)"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} style={{ background: "var(--surface)", borderRadius: 8, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 20, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: c }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20 }}>
            <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 16 }}>Mitigation Performance</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  <span>Overhead factor</span>
                  <span style={{ fontFamily: "ui-monospace,monospace", color: "#f59e0b" }}>{result.mitigation_overhead.toFixed(2)}×</span>
                </div>
                <div style={{ width: "100%", background: "var(--line)", borderRadius: 999, height: 10 }}>
                  <div style={{ background: "#f59e0b", height: 10, borderRadius: 999, width: `${Math.min(100, (result.mitigation_overhead - 1) * 20)}%` }} />
                </div>
              </div>
              {result.confidence_interval && result.confidence_interval.length === 2 && (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  95% CI: [{result.confidence_interval[0].toFixed(6)}, {result.confidence_interval[1].toFixed(6)}]
                </div>
              )}
            </div>

            {result.zne && result.zne.noise_factors.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase" }}>ZNE Extrapolation Curve (R² = {result.zne.r_squared.toFixed(3)})</h3>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 96, background: "var(--surface)", borderRadius: 6, padding: 8 }}>
                  {result.zne.noise_factors.map((lam, i) => {
                    const vals = result.zne!.raw_values;
                    const mn = Math.min(...vals); const mx = Math.max(...vals);
                    const pct = mx === mn ? 50 : ((vals[i] - mn) / (mx - mn)) * 100;
                    return (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <div style={{ width: "100%", background: "var(--strong)", borderRadius: "4px 4px 0 0", height: `${Math.max(4, pct)}%` }} />
                        <div style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: "var(--muted)" }}>λ={lam}</div>
                      </div>
                    );
                  })}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", background: "var(--ok)", borderRadius: "4px 4px 0 0", opacity: 0.7, height: "10%" }} title="λ=0 extrapolated" />
                    <div style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: "var(--ok)" }}>λ=0*</div>
                  </div>
                </div>
              </div>
            )}
          </div>

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
