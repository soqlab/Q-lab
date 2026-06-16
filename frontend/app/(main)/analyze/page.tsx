"use client";
import { useState } from "react";
import { CircuitAnalysis, QubitRisk, analyzeCircuit } from "../../../lib/api";
import { Search, Cpu, AlertTriangle, CheckCircle, Zap } from "lucide-react";

const PRESET_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[1],q[2];
t q[0];
t q[1];
tdg q[2];
h q[0];
measure q -> c;`;

const RISK_COLOR: Record<string, string> = {
  low: "#10b981", medium: "#f59e0b", high: "#f97316", critical: "#ef4444",
};

function GateBar({ name, count, maxCount }: { name: string; count: number; maxCount: number }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <span style={{ color: "#94a3b8", fontSize: "0.78rem", width: 40, textAlign: "right", fontFamily: "monospace" }}>{name}</span>
      <div style={{ flex: 1, height: 6, background: "#0f172a", borderRadius: 99 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#3b82f6", borderRadius: 99 }} />
      </div>
      <span style={{ color: "#64748b", fontSize: "0.78rem", width: 24, textAlign: "right" }}>{count}</span>
    </div>
  );
}

function QubitRiskRow({ q }: { q: QubitRisk }) {
  return (
    <tr style={{ borderBottom: "1px solid #0f172a" }}>
      <td style={{ padding: "0.5rem 0.75rem", color: "#94a3b8" }}>Q{q.qubit}</td>
      <td style={{ padding: "0.5rem 0.75rem", color: "#e2e8f0" }}>{q.total_gate_time_ns} ns</td>
      <td style={{ padding: "0.5rem 0.75rem", color: "#e2e8f0" }}>{(q.accumulated_gate_error * 100).toFixed(2)}%</td>
      <td style={{ padding: "0.5rem 0.75rem", color: "#f59e0b" }}>{(q.t1_decay_probability * 100).toFixed(2)}%</td>
      <td style={{ padding: "0.5rem 0.75rem", color: q.estimated_qubit_error > 0.2 ? "#ef4444" : "#e2e8f0", fontWeight: 700 }}>{(q.estimated_qubit_error * 100).toFixed(2)}%</td>
      <td style={{ padding: "0.5rem 0.75rem" }}>
        <span style={{ color: RISK_COLOR[q.risk_level], background: RISK_COLOR[q.risk_level] + "22", borderRadius: 4, padding: "1px 6px", fontSize: "0.72rem", fontWeight: 700 }}>{q.risk_level}</span>
      </td>
    </tr>
  );
}

export default function AnalyzePage() {
  const [qasm, setQasm] = useState(PRESET_QASM);
  const [name, setName] = useState("GHZ + T");
  const [result, setResult] = useState<CircuitAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setLoading(true); setError(null);
    try { setResult(await analyzeCircuit(qasm, name)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const maxGateCount = result ? Math.max(...Object.values(result.gate_counts)) : 1;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Search size={28} color="#3b82f6" /> Circuit Intelligence Analyzer
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Static QASM analysis: depth, T-gate count, per-qubit decoherence risk, optimization suggestions — no execution required.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: "1.5rem" }}>
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
          <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 8 }}>
            Circuit Name
            <input value={name} onChange={e => setName(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
          </label>
          <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 12 }}>
            QASM
            <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={14}
              style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.78rem", boxSizing: "border-box", resize: "vertical" }} />
          </label>
          <button onClick={handleAnalyze} disabled={loading}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.65rem", cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
            <Zap size={15} /> {loading ? "Analyzing…" : "Analyze Circuit"}
          </button>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Total Gates", value: result.total_gates, color: "#3b82f6" },
                  { label: "Circuit Depth", value: result.circuit_depth, color: "#8b5cf6" },
                  { label: "T-Gate Count", value: result.t_gate_count, color: "#f59e0b" },
                  { label: "Quality Score", value: `${(result.quality_score * 100).toFixed(0)}%`, color: result.quality_score > 0.7 ? "#10b981" : "#ef4444" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.4rem", fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 10, fontSize: "0.9rem" }}>Gate Distribution</h3>
                  {Object.entries(result.gate_counts).slice(0, 10).map(([name, count]) => (
                    <GateBar key={name} name={name} count={count} maxCount={maxGateCount} />
                  ))}
                  <div style={{ marginTop: 8, color: "#64748b", fontSize: "0.75rem" }}>
                    Non-Clifford ratio: <span style={{ color: result.non_clifford_ratio > 0.3 ? "#f59e0b" : "#10b981" }}>{(result.non_clifford_ratio * 100).toFixed(1)}%</span>
                    {" "} · 2Q gates: {(result.resource_estimate.two_qubit_gate_fraction * 100).toFixed(1)}%
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 10, fontSize: "0.9rem" }}>Resource Estimate</h3>
                  {[
                    { label: "Circuit Volume (D×W)", value: result.circuit_volume },
                    { label: "Execution Time", value: `${result.resource_estimate.estimated_execution_time_us} µs` },
                    { label: "T-gate (magic state) cost", value: result.resource_estimate.magic_state_cost },
                    { label: "Avg Qubit Error", value: `${(result.avg_qubit_error * 100).toFixed(2)}%` },
                    { label: "Total Gate Time", value: `${result.total_gate_time_ns} ns` },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ color: "#64748b", fontSize: "0.82rem" }}>{r.label}</span>
                      <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.82rem" }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem", marginBottom: "1rem" }}>
                <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 8, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
                  <Cpu size={16} color="#3b82f6" /> Per-Qubit Decoherence Risk
                </h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ color: "#64748b", borderBottom: "1px solid #1e293b" }}>
                      {["Qubit", "Gate Time", "Gate Error", "T1 Decay", "Total Error", "Risk"].map(h => (
                        <th key={h} style={{ padding: "0.4rem 0.75rem", textAlign: "left", fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{result.per_qubit_risk.map(q => <QubitRiskRow key={q.qubit} q={q} />)}</tbody>
                </table>
              </div>

              {result.optimization_suggestions.length > 0 && (
                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #f59e0b40", padding: "1rem" }}>
                  <h3 style={{ color: "#f59e0b", fontWeight: 600, marginBottom: 8, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
                    <AlertTriangle size={16} /> Optimization Opportunities
                  </h3>
                  {result.optimization_suggestions.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                      <CheckCircle size={13} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ color: "#94a3b8", fontSize: "0.82rem" }}>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, color: "#475569" }}>
              <Search size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Paste QASM and click Analyze to get a full circuit intelligence report.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
