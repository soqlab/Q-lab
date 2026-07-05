"use client";
import { useState } from "react";
import { optimizeDDSequence, DDReport, DDPulseSchedule } from "@/lib/api";

export default function DDOptimizerPage() {
  const [backend, setBackend] = useState("ibm_brisbane");
  const [noiseType, setNoiseType] = useState("1/f");
  const [t1, setT1] = useState(150.0);
  const [t2, setT2] = useState(80.0);
  const [idleTime, setIdleTime] = useState(5.0);
  const [result, setResult] = useState<DDReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await optimizeDDSequence({ backend, noise_type: noiseType, t1_us: t1, t2_us: t2 });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const t2Improvement = result ? result.estimated_t2_with_dd / Math.max(result.estimated_t2_without_dd, 0.001) : 1;

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Dynamical Decoupling Optimizer</h1>
      <p style={{ color: "var(--muted)" }}>Compare all DD sequences (Hahn, CPMG, XY-4, XY-8, KDD, UDD, CDD) for your hardware and noise profile. Get the optimal sequence and predicted T2 improvement.</p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Backend</label>
            <select value={backend} onChange={e => setBackend(e.target.value)}
              className="input" style={{ width: "100%", marginTop: 4 }}>
              {["ibm_brisbane", "ibm_kyoto", "ionq_aria_1", "rigetti_ankaa_2"].map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Noise Type</label>
            <select value={noiseType} onChange={e => setNoiseType(e.target.value)}
              className="input" style={{ width: "100%", marginTop: 4 }}>
              {["1/f", "white", "telegraph", "mixed"].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>T1 (μs)</label>
            <input type="number" step="any" value={t1} onChange={e => setT1(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>T2 (μs)</label>
            <input type="number" step="any" value={t2} onChange={e => setT2(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Idle Time (μs)</label>
            <input type="number" step="any" value={idleTime} onChange={e => setIdleTime(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="button"
          style={{ opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Optimizing..." : "Compare All Sequences"}
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "rgba(99,102,241,0.15)", border: "1px solid var(--strong)", borderRadius: 8, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--strong)", textTransform: "uppercase", marginBottom: 4 }}>Optimal Sequence</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>{result.recommended_sequence.toUpperCase()}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{result.reason}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>T2 improvement</div>
              <div style={{ fontSize: 30, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: "var(--ok)" }}>{t2Improvement.toFixed(2)}×</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{result.estimated_t2_without_dd.toFixed(1)} → {result.estimated_t2_with_dd.toFixed(1)} μs</div>
            </div>
          </div>

          <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20 }}>
            <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 16 }}>Sequence Comparison</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 13 }}>
                <thead>
                  <tr style={{ fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                    <th style={{ textAlign: "left", padding: "8px 16px 8px 0" }}>Sequence</th>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>T2 Improv.</th>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>T1 Improv.</th>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>Gate Overhead</th>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>Time OH%</th>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>Fidelity +%</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.sequences ?? []).sort((a: DDPulseSchedule, b: DDPulseSchedule) => b.t2_improvement_factor - a.t2_improvement_factor).map((seq: DDPulseSchedule) => (
                    <tr key={seq.sequence_type} style={{ borderBottom: "1px solid var(--line)", background: seq.sequence_type === result.recommended_sequence ? "rgba(99,102,241,0.1)" : "transparent" }}>
                      <td style={{ padding: "8px 16px 8px 0", fontFamily: "ui-monospace,monospace", fontWeight: 500 }}>
                        {seq.sequence_type === result.recommended_sequence && <span style={{ color: "var(--strong)", marginRight: 4 }}>★</span>}
                        {seq.sequence_type.toUpperCase()}
                      </td>
                      <td style={{ textAlign: "right", paddingRight: 16, fontFamily: "ui-monospace,monospace" }}>
                        <span style={{ color: seq.t2_improvement_factor > 1.5 ? "var(--ok)" : seq.t2_improvement_factor > 1.1 ? "#f59e0b" : "var(--muted)" }}>
                          {seq.t2_improvement_factor.toFixed(2)}×
                        </span>
                      </td>
                      <td style={{ textAlign: "right", paddingRight: 16, fontFamily: "ui-monospace,monospace", color: "var(--info-text)" }}>{seq.t1_improvement_factor.toFixed(2)}×</td>
                      <td style={{ textAlign: "right", paddingRight: 16, fontFamily: "ui-monospace,monospace", color: "var(--muted)" }}>{seq.gate_overhead}×</td>
                      <td style={{ textAlign: "right", paddingRight: 16, fontFamily: "ui-monospace,monospace", color: "var(--muted)" }}>{seq.time_overhead_pct.toFixed(0)}%</td>
                      <td style={{ textAlign: "right", paddingRight: 16, fontFamily: "ui-monospace,monospace", color: "var(--strong)" }}>+{seq.fidelity_improvement_pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.sequences.length > 0 && result.sequences[0].pulses.length > 0 && (
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Optimal Pulse Sequence ({result.recommended_sequence.toUpperCase()})</h2>
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                {(result.sequences.find((s: DDPulseSchedule) => s.sequence_type === result.recommended_sequence)?.pulses ?? []).map((pulse: string, i: number) => (
                  <span key={i} style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: "ui-monospace,monospace",
                    background: pulse === "wait"
                      ? "var(--line)"
                      : pulse.includes("X")
                        ? "rgba(59,130,246,0.3)"
                        : pulse.includes("Y")
                          ? "rgba(167,139,250,0.2)"
                          : "rgba(99,102,241,0.2)",
                    color: pulse === "wait"
                      ? "var(--muted)"
                      : pulse.includes("X")
                        ? "var(--info-text)"
                        : pulse.includes("Y")
                          ? "#a78bfa"
                          : "var(--strong)",
                  }}>
                    {pulse}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
