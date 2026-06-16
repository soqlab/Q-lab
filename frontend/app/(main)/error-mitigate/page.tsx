"use client";

import { useState } from "react";
import { ErrorMitigateResult, runErrorMitigate } from "../../../lib/api";
import { Shield, Play, Zap, TrendingUp } from "lucide-react";

const DEFAULT_QASM = `OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\nmeasure q -> c;`;

export default function ErrorMitigatePage() {
  const [qasm, setQasm] = useState<string>(DEFAULT_QASM);
  const [method, setMethod] = useState<string>("all");
  const [noiseLevel, setNoiseLevel] = useState<number>(0.01);
  const [result, setResult] = useState<ErrorMitigateResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await runErrorMitigate({ qasm, method, noise_level: noiseLevel });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const methods = [
    { id: "zne", label: "ZNE" },
    { id: "pec", label: "PEC" },
    { id: "cdr", label: "CDR" },
    { id: "all", label: "All Three" },
  ];

  const maxNoisyExp = result
    ? Math.max(...result.zne_result.noisy_expectations)
    : 1;
  const minNoisyExp = result
    ? Math.min(...result.zne_result.noisy_expectations)
    : 0;
  const noisyRange = maxNoisyExp - minNoisyExp || 1;

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <Shield size={28} color="#f59e0b" />
          <div>
            <h1 style={{ color: "#e2e8f0", fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Error Mitigation Engine</h1>
            <p style={{ color: "#94a3b8", fontSize: "0.875rem", margin: 0 }}>Apply ZNE, PEC, and CDR error mitigation to your quantum circuits</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>QASM Circuit</label>
              <textarea
                value={qasm}
                onChange={(e) => setQasm(e.target.value)}
                rows={8}
                style={{ width: "100%", marginTop: "0.5rem", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", resize: "vertical", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Mitigation Method</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.5rem" }}>
                {methods.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    style={{ border: "none", borderRadius: 8, padding: "0.6rem", cursor: "pointer", fontWeight: 700, fontSize: "0.8rem", background: method === m.id ? "#f59e0b" : "#334155", color: method === m.id ? "#0f172a" : "#94a3b8" }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Noise Level</label>
                <span style={{ color: "#f59e0b", fontSize: "0.875rem", fontWeight: 700 }}>{(noiseLevel * 100).toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={0.001}
                max={0.05}
                step={0.001}
                value={noiseLevel}
                onChange={(e) => setNoiseLevel(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#f59e0b" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>
                <span>0.1%</span><span>5%</span>
              </div>
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{ border: "none", borderRadius: 8, padding: "0.7rem", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, background: loading ? "#64748b" : "#f59e0b", color: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", fontSize: "0.9rem" }}
            >
              <Play size={16} />
              {loading ? "Running..." : "Run Mitigation"}
            </button>

            {error && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem", fontSize: "0.8rem" }}>
                {error}
              </div>
            )}
          </div>

          <div>
            {!result ? (
              <div style={{ height: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", background: "#1e293b", borderRadius: 10, border: "1px solid #334155" }}>
                <Shield size={48} color="#334155" />
                <p style={{ color: "#64748b", fontSize: "0.9rem", textAlign: "center" }}>Configure your circuit and run mitigation to see results</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                    <TrendingUp size={18} color="#10b981" />
                    <span style={{ color: "#10b981", fontWeight: 700, fontSize: "0.875rem" }}>Best: {result.best_method.toUpperCase()}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "0.75rem" }}>
                    {[
                      { label: "Best Expectation", value: result.best_mitigated_expectation.toFixed(4), color: "#10b981" },
                      { label: "Improvement", value: result.overall_improvement_pct.toFixed(1) + "%", color: "#f59e0b" },
                      { label: "Raw Expectation", value: result.raw_expectation.toFixed(4), color: "#94a3b8" },
                      { label: "Method Used", value: result.method_used.toUpperCase(), color: "#3b82f6" },
                    ].map((stat) => (
                      <div key={stat.label} style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center", border: "1px solid #334155" }}>
                        <div style={{ color: stat.color, fontSize: "1rem", fontWeight: 700 }}>{stat.value}</div>
                        <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "1rem" }}>
                  {[
                    { id: "zne", label: "ZNE", value: result.zne_result.best_value.toFixed(4), sub: "Zero-Noise Extrapolation" },
                    { id: "pec", label: "PEC", value: result.pec_result.mitigated_expectation.toFixed(4), sub: "Probabilistic Error Cancellation" },
                    { id: "cdr", label: "CDR", value: result.cdr_result.corrected_expectation.toFixed(4), sub: "Clifford Data Regression" },
                  ].map((m) => {
                    const isWinner = result.best_method.toLowerCase().includes(m.id);
                    return (
                      <div key={m.id} style={{ background: "#1e293b", borderRadius: 10, border: isWinner ? "1px solid #10b981" : "1px solid #334155", padding: "1rem", textAlign: "center" }}>
                        <div style={{ color: isWinner ? "#10b981" : "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase" }}>{m.label}</div>
                        <div style={{ color: "#e2e8f0", fontSize: "1.5rem", fontWeight: 700, margin: "0.5rem 0" }}>{m.value}</div>
                        <div style={{ color: "#64748b", fontSize: "0.7rem" }}>{m.sub}</div>
                        {isWinner && <div style={{ marginTop: "0.5rem", color: "#10b981", fontSize: "0.75rem", fontWeight: 700 }}>BEST</div>}
                      </div>
                    );
                  })}
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                    <Zap size={16} color="#f59e0b" />
                    <span style={{ color: "#e2e8f0", fontWeight: 700 }}>Zero-Noise Extrapolation Detail</span>
                  </div>
                  <div style={{ marginBottom: "0.75rem" }}>
                    <div style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.5rem" }}>Noise Scale Factors vs Expectation Values</div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: 80 }}>
                      {result.zne_result.noise_scale_factors.map((sf, i) => {
                        const val = result.zne_result.noisy_expectations[i] ?? 0;
                        const heightPct = noisyRange > 0 ? ((val - minNoisyExp) / noisyRange) * 100 : 50;
                        return (
                          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                            <div style={{ color: "#94a3b8", fontSize: "0.6rem", marginBottom: 2 }}>{val.toFixed(3)}</div>
                            <div style={{ background: "#3b82f6", borderRadius: "2px 2px 0 0", width: "100%", height: Math.max(4, heightPct * 0.7) + "px" }} />
                            <div style={{ color: "#64748b", fontSize: "0.6rem", marginTop: 2 }}>{sf}x</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
                    <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", border: "1px solid #334155" }}>
                      <div style={{ color: "#64748b", fontSize: "0.7rem" }}>Linear Extrapolation</div>
                      <div style={{ color: "#3b82f6", fontSize: "1rem", fontWeight: 700 }}>{result.zne_result.extrapolated_linear.toFixed(4)}</div>
                    </div>
                    <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", border: "1px solid #334155" }}>
                      <div style={{ color: "#64748b", fontSize: "0.7rem" }}>Richardson Extrapolation</div>
                      <div style={{ color: "#8b5cf6", fontSize: "1rem", fontWeight: 700 }}>{result.zne_result.extrapolated_richardson.toFixed(4)}</div>
                    </div>
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.75rem" }}>Circuit Stats</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.75rem" }}>
                    <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center", border: "1px solid #334155" }}>
                      <div style={{ color: "#3b82f6", fontSize: "1.1rem", fontWeight: 700 }}>{result.n_qubits}</div>
                      <div style={{ color: "#64748b", fontSize: "0.7rem" }}>Qubits</div>
                    </div>
                    <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center", border: "1px solid #334155" }}>
                      <div style={{ color: "#8b5cf6", fontSize: "1.1rem", fontWeight: 700 }}>{result.n_gates}</div>
                      <div style={{ color: "#64748b", fontSize: "0.7rem" }}>Gates</div>
                    </div>
                    <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center", border: "1px solid #334155" }}>
                      <div style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 700, fontFamily: "monospace" }}>{result.qasm_hash.slice(0, 8)}</div>
                      <div style={{ color: "#64748b", fontSize: "0.7rem" }}>QASM Hash</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
