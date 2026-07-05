"use client";
import { useState } from "react";
import { optimizeJobSchedule, OptScheduleResult, ScheduleAssignment } from "@/lib/api";

const OBJECTIVES = [
  { value: "min_cost", label: "Minimize Cost" },
  { value: "max_fidelity", label: "Maximize Fidelity" },
  { value: "min_time", label: "Minimize Time" },
  { value: "balanced", label: "Balanced" },
];

interface CircuitSpec {
  circuit_id: string;
  n_qubits: number;
  circuit_depth: number;
  n_shots: number;
  priority: string;
}

export default function JobSchedulerPage() {
  const [circuits, setCircuits] = useState<CircuitSpec[]>([
    { circuit_id: "vqe_energy", n_qubits: 6, circuit_depth: 40, n_shots: 8192, priority: "high" },
    { circuit_id: "qaoa_maxcut", n_qubits: 10, circuit_depth: 20, n_shots: 4096, priority: "normal" },
    { circuit_id: "ghz_sensing", n_qubits: 4, circuit_depth: 10, n_shots: 16384, priority: "low" },
  ]);
  const [objective, setObjective] = useState("balanced");
  const [budget, setBudget] = useState(10.0);
  const [result, setResult] = useState<OptScheduleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function addCircuit() {
    setCircuits(c => [...c, { circuit_id: `circuit_${c.length + 1}`, n_qubits: 5, circuit_depth: 20, n_shots: 4096, priority: "normal" }]);
  }

  function removeCircuit(i: number) {
    setCircuits(c => c.filter((_, idx) => idx !== i));
  }

  function updateCircuit(i: number, key: keyof CircuitSpec, val: string | number) {
    setCircuits(c => c.map((circ, idx) => idx === i ? { ...circ, [key]: val } : circ));
  }

  async function schedule() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await optimizeJobSchedule({ circuits, objective, budget_usd: budget });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    marginTop: 2,
    background: "var(--line)",
    color: "var(--text)",
    fontSize: 13,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid var(--line)",
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Job Scheduler</h1>
      <p style={{ color: "var(--muted)" }}>Optimally assign a batch of circuits across multiple backends. Minimizes cost, wait time, or maximizes fidelity — respecting budget constraints.</p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontWeight: 600, fontSize: 13 }}>Circuit Batch</h2>
          <button onClick={addCircuit} style={{ fontSize: 12, padding: "4px 12px", background: "var(--line)", borderRadius: 6, border: "none", color: "var(--text)", cursor: "pointer" }}>+ Add Circuit</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {circuits.map((c, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8, alignItems: "flex-end", background: "var(--surface)", borderRadius: 8, padding: 12 }}>
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>Circuit ID</label>
                <input value={c.circuit_id} onChange={e => updateCircuit(i, "circuit_id", e.target.value)}
                  style={{ ...inputStyle, fontFamily: "ui-monospace,monospace" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>Qubits</label>
                <input type="number" value={c.n_qubits} onChange={e => updateCircuit(i, "n_qubits", Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>Depth</label>
                <input type="number" value={c.circuit_depth} onChange={e => updateCircuit(i, "circuit_depth", Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>Shots</label>
                <input type="number" value={c.n_shots} onChange={e => updateCircuit(i, "n_shots", Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>Priority</label>
                  <select value={c.priority} onChange={e => updateCircuit(i, "priority", e.target.value)}
                    style={inputStyle}>
                    {["high", "normal", "low"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <button onClick={() => removeCircuit(i)} style={{ color: "var(--danger)", padding: "0 8px 4px", background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>×</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Objective</label>
            <select value={objective} onChange={e => setObjective(e.target.value)}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}>
              {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Budget (USD)</label>
            <input type="number" step="0.1" value={budget} onChange={e => setBudget(Number(e.target.value))}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }} />
          </div>
        </div>
        <button onClick={schedule} disabled={loading || circuits.length === 0}
          style={{ padding: "8px 24px", background: "var(--strong)", borderRadius: 6, fontWeight: 500, border: "none", color: "var(--text)", cursor: loading || circuits.length === 0 ? "not-allowed" : "pointer", opacity: loading || circuits.length === 0 ? 0.5 : 1 }}>
          {loading ? "Scheduling..." : "Optimize Schedule"}
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            {([
              ["Total Cost", `$${result.total_cost_usd.toFixed(4)}`, result.total_cost_usd <= budget ? "var(--ok)" : "var(--danger)"],
              ["Makespan", `${result.makespan_min.toFixed(0)} min`, "var(--text)"],
              ["Avg Fidelity", `${(result.average_fidelity * 100).toFixed(2)}%`, "var(--strong)"],
              ["Savings vs Random", `$${result.savings_vs_random_usd.toFixed(4)}`, "var(--ok)"],
            ] as [string, string, string][]).map(([l, v, metricColor]) => (
              <div key={l} style={{ background: "var(--surface)", borderRadius: 8, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 18, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: metricColor }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20 }}>
            <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 16 }}>Assignment Table</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 13 }}>
                <thead>
                  <tr style={{ fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                    <th style={{ textAlign: "left", padding: "8px 16px 8px 0" }}>Circuit</th>
                    <th style={{ textAlign: "left", paddingRight: 16 }}>Backend</th>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>Fidelity</th>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>Cost</th>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>Queue Pos.</th>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>Score</th>
                    <th style={{ textAlign: "left" }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.assignments ?? []).map((a: ScheduleAssignment, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 16px 8px 0", fontFamily: "ui-monospace,monospace", fontSize: 13 }}>{a.circuit_id}</td>
                      <td style={{ paddingRight: 16, fontFamily: "ui-monospace,monospace", color: "var(--strong)", fontSize: 12 }}>{a.backend}</td>
                      <td style={{ textAlign: "right", paddingRight: 16, fontFamily: "ui-monospace,monospace" }}>{(a.estimated_fidelity * 100).toFixed(2)}%</td>
                      <td style={{ textAlign: "right", paddingRight: 16, fontFamily: "ui-monospace,monospace", color: "#f59e0b" }}>${a.estimated_cost_usd.toFixed(4)}</td>
                      <td style={{ textAlign: "right", paddingRight: 16, fontFamily: "ui-monospace,monospace", color: "var(--muted)" }}>#{a.queue_position}</td>
                      <td style={{ textAlign: "right", paddingRight: 16, fontFamily: "ui-monospace,monospace", color: "var(--strong)" }}>{a.score.toFixed(3)}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{a.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
