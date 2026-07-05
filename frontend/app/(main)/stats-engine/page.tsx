"use client";
import { useState } from "react";
import { runStatAnalysis, StatAnalysisResult } from "@/lib/api";

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontFamily: "ui-monospace,monospace" }}>{(value * 100).toFixed(2)}%</span>
      </div>
      <div style={{ width: "100%", background: "var(--line)", borderRadius: 999, height: 6 }}>
        <div style={{ width: `${Math.min(100, value * 100)}%`, height: 6, borderRadius: 999, background: "var(--strong)" }} />
      </div>
    </div>
  );
}

export default function StatsEnginePage() {
  const [nQubits, setNQubits] = useState(2);
  const [nShots, setNShots] = useState(8192);
  const [targetState, setTargetState] = useState("00");
  const [rawCounts, setRawCounts] = useState('{"00": 4020, "01": 180, "10": 160, "11": 3832}');
  const [nSamples, setNSamples] = useState(5);
  const [result, setResult] = useState<StatAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    setLoading(true); setError(""); setResult(null);
    try {
      const counts = JSON.parse(rawCounts) as Record<string, number>;
      const samples = Array.from({ length: nSamples }, (_, i) => ({
        counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.max(0, Math.round(v * (0.95 + Math.random() * 0.1)))])),
        n_shots: nShots, n_qubits: nQubits, label: `Run ${i + 1}`,
      }));
      const r = await runStatAnalysis({ samples, target_state: targetState, confidence_level: 0.95, n_bootstrap: 500 });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Statistical Analysis Engine</h1>
      <p style={{ color: "var(--muted)" }}>Fisher information, Cramér–Rao bounds, bootstrap CIs, Bayesian evidence, and full error budget — computed automatically on every result set.</p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Qubits</label>
            <input type="number" value={nQubits} min={1} max={10} onChange={e => setNQubits(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Shots per run</label>
            <input type="number" value={nShots} min={100} onChange={e => setNShots(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Target state</label>
            <input value={targetState} onChange={e => setTargetState(e.target.value)} placeholder="00"
              className="input" style={{ width: "100%", marginTop: 4, fontFamily: "ui-monospace,monospace" }} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Measurement counts (JSON)</label>
          <textarea value={rawCounts} onChange={e => setRawCounts(e.target.value)}
            style={{ width: "100%", height: 80, marginTop: 4, background: "var(--surface)", color: "var(--ok)", fontFamily: "ui-monospace,monospace", fontSize: 13, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box", resize: "vertical" }} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Simulated samples (runs): {nSamples}</label>
          <input type="range" min={2} max={20} value={nSamples} onChange={e => setNSamples(Number(e.target.value))}
            style={{ width: "100%", marginTop: 4 }} />
        </div>
        <button onClick={analyze} disabled={loading} className="button"
          style={{ padding: "8px 24px", opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Analyzing..." : "Run Full Statistical Analysis"}
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            {([
              ["Fidelity", `${(result.fidelity_mean * 100).toFixed(3)}%`, result.is_significant ? "var(--ok)" : "#f59e0b"],
              ["p-value", result.chi2_p_value.toFixed(4), result.chi2_p_value < 0.05 ? "var(--ok)" : "var(--danger)"],
              ["Effect Size d", result.effect_size.toFixed(3), "var(--strong)"],
              ["Power", `${(result.power * 100).toFixed(1)}%`, result.power > 0.8 ? "var(--ok)" : "#f59e0b"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} style={{ background: "var(--surface)", borderRadius: 8, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 20, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: c }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13 }}>Fidelity Distribution</h2>
              <Meter value={result.fidelity_mean} label="Mean fidelity" />
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                95% CI: [{(result.fidelity_ci_low * 100).toFixed(3)}%, {(result.fidelity_ci_high * 100).toFixed(3)}%]
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Bootstrap: {(result.bootstrap_mean * 100).toFixed(3)}% ± {(result.bootstrap_std * 100).toFixed(3)}%</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: result.is_significant ? "var(--ok)" : "#f59e0b" }}>
                {result.is_significant ? "Statistically significant (χ² test)" : "Not significant at α=0.05"}
              </div>
            </div>

            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13 }}>Fisher Information</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
                <div><span style={{ color: "var(--muted)" }}>QFI:</span> <span style={{ fontFamily: "ui-monospace,monospace" }}>{result.fisher.qfi.toFixed(2)}</span></div>
                <div><span style={{ color: "var(--muted)" }}>CFI:</span> <span style={{ fontFamily: "ui-monospace,monospace" }}>{result.fisher.cfi.toFixed(2)}</span></div>
                <div><span style={{ color: "var(--muted)" }}>HL bound:</span> <span style={{ fontFamily: "ui-monospace,monospace" }}>{result.fisher.hl_bound.toFixed(6)}</span></div>
                <div><span style={{ color: "var(--muted)" }}>SQL bound:</span> <span style={{ fontFamily: "ui-monospace,monospace" }}>{result.fisher.sql_bound.toFixed(6)}</span></div>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                <span style={{ color: result.fisher.beating_sql ? "var(--ok)" : "var(--muted)" }}>
                  {result.fisher.beating_sql ? "✓ Beats SQL" : "✗ Below SQL"}
                </span>
                <span style={{ color: result.fisher.beating_hl ? "#f59e0b" : "var(--muted)" }}>
                  {result.fisher.beating_hl ? "✓ Beats HL!" : "✗ Below HL"}
                </span>
              </div>
            </div>
          </div>

          <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ fontWeight: 600, fontSize: 13 }}>Error Budget</h2>
            <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
              <div><span style={{ color: "var(--muted)" }}>Shot noise:</span> <span style={{ fontFamily: "ui-monospace,monospace", color: "var(--info-text)" }}>{(result.shot_variance * 1e6).toFixed(2)}×10⁻⁶</span></div>
              <div><span style={{ color: "var(--muted)" }}>Systematic:</span> <span style={{ fontFamily: "ui-monospace,monospace", color: "var(--danger)" }}>{(result.systematic_variance * 1e6).toFixed(2)}×10⁻⁶</span></div>
              <div><span style={{ color: "var(--muted)" }}>Dominant:</span> <span style={{ fontWeight: 500, color: result.dominant_noise === "systematic" ? "var(--danger)" : "var(--info-text)" }}>{result.dominant_noise}</span></div>
            </div>
            <div style={{ width: "100%", height: 16, background: "var(--line)", borderRadius: 999, overflow: "hidden", display: "flex" }}>
              <div style={{ background: "#3b82f6", height: "100%", width: `${result.error_budget.shot_fraction * 100}%` }} />
              <div style={{ background: "#ef4444", height: "100%", width: `${result.error_budget.systematic_fraction * 100}%` }} />
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: "#3b82f6", display: "inline-block" }} /> Shot noise {(result.error_budget.shot_fraction * 100).toFixed(0)}%</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: "#ef4444", display: "inline-block" }} /> Systematic {(result.error_budget.systematic_fraction * 100).toFixed(0)}%</span>
            </div>
          </div>

          {(result.recommendations ?? []).length > 0 && (
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13 }}>Recommendations</h2>
              {(result.recommendations ?? []).map((r, i) => <div key={i} style={{ fontSize: 13, color: "var(--text)" }}>• {r}</div>)}
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Need {result.sample_size_needed} total runs for 80% power at current effect size</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
