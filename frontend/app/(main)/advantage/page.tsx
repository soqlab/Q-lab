"use client";
import { useState } from "react";
import { analyzeRunAdvantage } from "../../../lib/api";
import { Zap, Search } from "lucide-react";

// ---------------------------------------------------------------------------
// Run Advantage Analyzer types
// ---------------------------------------------------------------------------

type ClassicalCost = {
  state_vector_memory_gb: number;
  classical_ops: number;
  classical_time_seconds: number;
  classical_time_human: string;
  is_classically_hard: boolean;
};

type ClassicalBaseline = {
  description: string;
  speedup_type: string;
  speedup_factor?: number;
  classical_queries?: number;
  quantum_queries?: number;
  note?: string;
};

type ClaudeAnalysis = {
  advantage_type: "computational" | "sampling" | "none";
  explanation: string;
  caveats: string[];
  publication_claim: string;
};

type AnalyzerResult = {
  run_id: string;
  circuit_name: string | null;
  algorithm_detected: string;
  n_qubits: number;
  circuit_depth: number;
  n_shots: number;
  success_probability: number | null;
  health_score: number;
  advantage_score: number;
  advantage_verdict: "strong_advantage" | "potential_advantage" | "limited_advantage" | "no_advantage";
  verdict_explanation: string;
  classical_cost: ClassicalCost;
  classical_baseline: ClassicalBaseline;
  is_clifford_only: boolean;
  claude_analysis: ClaudeAnalysis | null;
  analyzed_at: string;
};

const VERDICT_META = {
  strong_advantage:   { bg: "#052e16", border: "#166534", text: "#4ade80", label: "Strong Quantum Speedup" },
  potential_advantage:{ bg: "#1c1400", border: "#854d0e", text: "#fbbf24", label: "Potential Quantum Speedup" },
  limited_advantage:  { bg: "#1f1300", border: "#9a3412", text: "#fb923c", label: "Limited Speedup" },
  no_advantage:       { bg: "#1f0000", border: "#991b1b", text: "#f87171", label: "No Speedup Detected" },
} as const;

function ScoreGauge({ score }: { score: number }) {
  const R = 70; const CX = 100; const CY = 95;
  const startDeg = -210; const endDeg = 30;
  const totalDeg = endDeg - startDeg;
  const toRad = (d: number) => (d * Math.PI) / 180;

  function arcPath(from: number, to: number) {
    const s = { x: CX + R * Math.cos(toRad(from)), y: CY + R * Math.sin(toRad(from)) };
    const e = { x: CX + R * Math.cos(toRad(to)), y: CY + R * Math.sin(toRad(to)) };
    const large = to - from > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
  }

  const fillColor = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  const fillEnd = startDeg + (score / 100) * totalDeg;

  return (
    <svg viewBox="0 0 200 130" width={200} height={130}>
      <path d={arcPath(startDeg, endDeg)} fill="none" stroke="#1e293b" strokeWidth="14" strokeLinecap="round" />
      <path d={arcPath(startDeg, fillEnd)} fill="none" stroke={fillColor} strokeWidth="14" strokeLinecap="round" />
      <text x={CX} y={CY + 10} textAnchor="middle" fontSize="28" fontWeight="bold" fill={fillColor}>{score}</text>
      <text x={CX} y={CY + 26} textAnchor="middle" fontSize="10" fill="#475569">/ 100</text>
      <text x="16" y={CY + 20} fontSize="9" fill="#475569">0</text>
      <text x="170" y={CY + 20} fontSize="9" fill="#475569">100</text>
    </svg>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
      <span style={{ color: "#64748b", fontSize: "0.82rem" }}>{label}</span>
      <span style={{ color: highlight ?? "#e2e8f0", fontWeight: 600, fontSize: "0.82rem" }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run Analyzer Panel
// ---------------------------------------------------------------------------

function RunAnalyzerPanel() {
  const [runId, setRunId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzerResult | null>(null);

  async function analyze() {
    const id = runId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await analyzeRunAdvantage(id) as AnalyzerResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const vm = result ? VERDICT_META[result.advantage_verdict] : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "1.5rem" }}>
      {/* Left: input */}
      <div>
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
          <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Analyze a Run</h3>
          <p style={{ color: "#64748b", fontSize: "0.8rem", marginBottom: "1rem", lineHeight: 1.5 }}>
            Enter a run ID to determine whether it demonstrates genuine quantum advantage over classical simulation.
          </p>
          <label style={{ color: "#94a3b8", fontSize: "0.8rem", display: "block", marginBottom: 6 }}>Run ID</label>
          <input
            value={runId}
            onChange={e => setRunId(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void analyze(); }}
            placeholder="run-abc123..."
            style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box", marginBottom: "0.75rem", fontSize: "0.85rem" }}
          />
          <button
            onClick={() => void analyze()}
            disabled={loading || !runId.trim()}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, padding: "0.65rem", cursor: "pointer", fontWeight: 600, opacity: loading || !runId.trim() ? 0.5 : 1, fontSize: "0.9rem" }}
          >
            <Search size={15} /> {loading ? "Analyzing…" : "Analyze Advantage"}
          </button>
        </div>
      </div>

      {/* Right: results */}
      <div>
        {error && (
          <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem", fontSize: "0.85rem" }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[200, 120, 100].map((h, i) => (
              <div key={i} style={{ height: h, borderRadius: 10, background: "#1e293b", animation: "pulse 1.5s infinite" }} />
            ))}
          </div>
        )}

        {result && vm && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Score + verdict */}
            <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <ScoreGauge score={result.advantage_score} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ background: vm.bg, border: `1px solid ${vm.border}`, borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "0.75rem" }}>
                    <div style={{ color: vm.text, fontWeight: 700, fontSize: "1.05rem" }}>{vm.label}</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.82rem", marginTop: 4 }}>{result.verdict_explanation}</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                    {[
                      { label: "Qubits", value: String(result.n_qubits) },
                      { label: "Depth", value: String(result.circuit_depth) },
                      { label: "Health", value: String(result.health_score) },
                    ].map(x => (
                      <div key={x.label} style={{ background: "#0f172a", borderRadius: 6, padding: "0.4rem", textAlign: "center" }}>
                        <div style={{ color: "#475569", fontSize: "0.68rem" }}>{x.label}</div>
                        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "0.9rem" }}>{x.value}</div>
                      </div>
                    ))}
                  </div>
                  {result.is_clifford_only && (
                    <div style={{ marginTop: 8, background: "#1c1400", border: "1px solid #854d0e", borderRadius: 6, padding: "0.4rem 0.75rem", color: "#fbbf24", fontSize: "0.75rem" }}>
                      Clifford-only circuit — classically simulable (score reduced by 20)
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quantum vs Classical columns */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                <div style={{ color: "#818cf8", fontWeight: 600, fontSize: "0.82rem", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Our Quantum Run</div>
                <InfoRow label="Circuit" value={result.circuit_name ?? result.run_id.slice(0, 12)} />
                <InfoRow label="Algorithm" value={result.algorithm_detected} />
                <InfoRow label="Qubits" value={String(result.n_qubits)} />
                <InfoRow label="Depth" value={String(result.circuit_depth)} />
                <InfoRow label="Shots" value={result.n_shots.toLocaleString()} />
                {result.success_probability != null && (
                  <InfoRow label="Success prob." value={`${(result.success_probability * 100).toFixed(1)}%`} />
                )}
              </div>
              <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                <div style={{ color: "#f87171", fontWeight: 600, fontSize: "0.82rem", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Classical Equivalent</div>
                <InfoRow label="State-vector RAM" value={`${result.classical_cost.state_vector_memory_gb.toFixed(4)} GB`} />
                <InfoRow label="Operations" value={result.classical_cost.classical_ops.toExponential(2)} />
                <InfoRow label="Time (petaflop)" value={result.classical_cost.classical_time_human} />
                <InfoRow
                  label="Classically hard?"
                  value={result.classical_cost.is_classically_hard ? "Yes" : "No"}
                  highlight={result.classical_cost.is_classically_hard ? "#4ade80" : "#f87171"}
                />
              </div>
            </div>

            {/* Algorithm speedup */}
            {result.classical_baseline && (
              <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                <div style={{ color: "#94a3b8", fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Algorithm Speedup</div>
                <p style={{ color: "#cbd5e1", fontSize: "0.85rem", marginBottom: 8 }}>{result.classical_baseline.description}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "0.25rem 0.6rem", fontSize: "0.78rem", color: "#94a3b8" }}>
                    Type: <strong style={{ color: "#e2e8f0" }}>{result.classical_baseline.speedup_type}</strong>
                  </span>
                  {result.classical_baseline.speedup_factor != null && (
                    <span style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "0.25rem 0.6rem", fontSize: "0.78rem", color: "#94a3b8" }}>
                      Factor: <strong style={{ color: "#4ade80" }}>{result.classical_baseline.speedup_factor.toFixed(1)}×</strong>
                    </span>
                  )}
                  {result.classical_baseline.classical_queries != null && (
                    <span style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "0.25rem 0.6rem", fontSize: "0.78rem", color: "#94a3b8" }}>
                      Classical queries: <strong style={{ color: "#e2e8f0" }}>{result.classical_baseline.classical_queries.toLocaleString()}</strong>
                    </span>
                  )}
                  {result.classical_baseline.quantum_queries != null && (
                    <span style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "0.25rem 0.6rem", fontSize: "0.78rem", color: "#94a3b8" }}>
                      Quantum queries: <strong style={{ color: "#818cf8" }}>{result.classical_baseline.quantum_queries.toLocaleString()}</strong>
                    </span>
                  )}
                </div>
                {result.classical_baseline.note && (
                  <p style={{ color: "#475569", fontSize: "0.75rem", marginTop: 8, fontStyle: "italic" }}>{result.classical_baseline.note}</p>
                )}
              </div>
            )}

            {/* Claude analysis */}
            {result.claude_analysis && (
              <div style={{ background: "#1e1040", borderRadius: 10, border: "1px solid #4338ca", padding: "1rem" }}>
                <div style={{ color: "#818cf8", fontWeight: 600, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Claude AI Deep Analysis</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ color: "#94a3b8", fontSize: "0.82rem" }}>Advantage type:</span>
                  <span style={{
                    background: result.claude_analysis.advantage_type === "computational" ? "#14532d" : result.claude_analysis.advantage_type === "sampling" ? "#1e3a5f" : "#27272a",
                    color: result.claude_analysis.advantage_type === "computational" ? "#4ade80" : result.claude_analysis.advantage_type === "sampling" ? "#93c5fd" : "#a1a1aa",
                    fontSize: "0.75rem", fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                  }}>{result.claude_analysis.advantage_type}</span>
                </div>
                <p style={{ color: "#cbd5e1", fontSize: "0.85rem", marginBottom: 10, lineHeight: 1.6 }}>{result.claude_analysis.explanation}</p>
                {result.claude_analysis.caveats.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ color: "#64748b", fontSize: "0.78rem", marginBottom: 4 }}>Caveats</p>
                    <ul style={{ paddingLeft: 18, margin: 0 }}>
                      {result.claude_analysis.caveats.map((c, i) => (
                        <li key={i} style={{ color: "#94a3b8", fontSize: "0.82rem", marginBottom: 2 }}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* Publication claim callout */}
                <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 8, padding: "0.75rem 1rem", marginTop: 4 }}>
                  <p style={{ color: "#4ade80", fontWeight: 600, fontSize: "0.8rem", marginBottom: 6 }}>What can I claim in my paper?</p>
                  <p style={{ color: "#86efac", fontSize: "0.85rem", lineHeight: 1.6, margin: 0 }}>{result.claude_analysis.publication_claim}</p>
                </div>
              </div>
            )}

            {!result.claude_analysis && (
              <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "0.75rem 1rem", color: "#475569", fontSize: "0.82rem", textAlign: "center" }}>
                Set <code style={{ background: "#0f172a", padding: "0 4px", borderRadius: 3, color: "#94a3b8" }}>ANTHROPIC_API_KEY</code> in the backend to enable Claude deep analysis.
              </div>
            )}

            <p style={{ color: "#334155", fontSize: "0.72rem", textAlign: "right" }}>
              Analyzed {result.analyzed_at.slice(0, 19).replace("T", " ")} UTC
            </p>
          </div>
        )}

        {!result && !loading && !error && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 320, color: "#334155" }}>
            <Search size={56} style={{ opacity: 0.15, marginBottom: 16 }} />
            <p style={{ fontSize: "0.9rem" }}>Enter a run ID and click Analyze to begin.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdvantagePage() {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Zap size={28} color="#3b82f6" /> Quantum Advantage Analyzer
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          How hard one of your runs would be to simulate classically: qubits and depth from its stored circuit, the
          memory and operations a statevector simulation needs, and a rule-based score on those figures. It does not
          prove a quantum advantage.
        </p>
      </div>
      <RunAnalyzerPanel />
    </div>
  );
}
