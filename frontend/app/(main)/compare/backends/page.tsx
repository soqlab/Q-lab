"use client";
import { useEffect, useState } from "react";
import { ComparisonResult, createComparison, getComparison, listComparisons } from "../../../../lib/api";
import { GitCompare, Play, Trophy, DollarSign, ChevronDown, ChevronUp } from "lucide-react";

const PROVIDERS = ["simulator", "ibm", "ionq"];
const PRESET_BACKENDS = [
  "ibm_brisbane", "ibm_kyoto", "ibm_osaka", "ibm_sherbrooke",
  "simulator_statevector", "simulator_mps",
];

const PRESET_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

type Target = { provider: string; backend: string };

function BarCell({ value, max }: { value: number | null; max: number }) {
  if (value == null) return <td style={{ padding: "0.5rem 0.75rem", color: "#475569" }}>—</td>;
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <td style={{ padding: "0.5rem 0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 80, height: 6, background: "#0f172a", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #1d4ed8, #3b82f6)", borderRadius: 99 }} />
        </div>
        <span style={{ color: "#e2e8f0", fontSize: "0.85rem", fontFamily: "monospace" }}>{(value * 100).toFixed(1)}%</span>
      </div>
    </td>
  );
}

export default function CompareBackendsPage() {
  const [targets, setTargets] = useState<Target[]>([
    { provider: "simulator", backend: "ibm_brisbane" },
    { provider: "simulator", backend: "ibm_kyoto" },
  ]);
  const [qasm, setQasm] = useState(PRESET_QASM);
  const [shots, setShots] = useState(1024);
  const [circuitName, setCircuitName] = useState("Bell State");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [history, setHistory] = useState<{ comparison_id: string; n_backends: number; submitted_at: string | null; circuit_name: string | null }[]>([]);
  const [loadingResult, setLoadingResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    listComparisons().then(setHistory).catch(() => {});
  }, []);

  const addTarget = () => setTargets(t => [...t, { provider: "simulator", backend: "simulator_statevector" }]);
  const removeTarget = (i: number) => setTargets(t => t.filter((_, j) => j !== i));
  const updateTarget = (i: number, field: keyof Target, value: string) =>
    setTargets(t => t.map((x, j) => j === i ? { ...x, [field]: value } : x));

  const handleRun = async () => {
    if (targets.length < 2) { setError("Select at least 2 backends"); return; }
    setRunning(true); setError(null);
    try {
      const r = await createComparison({ qasm, targets, shots, circuit_name: circuitName });
      setLoadingResult(r.comparison_id);
      const full = await getComparison(r.comparison_id);
      setResult(full);
      const h = await listComparisons();
      setHistory(h);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); setLoadingResult(null); }
  };

  const loadHistory = async (id: string) => {
    setLoadingResult(id);
    try {
      const r = await getComparison(id);
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoadingResult(null); }
  };

  const maxSP = result ? Math.max(...result.metrics_table.map(m => m.success_probability ?? 0)) : 1;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <GitCompare size={28} color="#3b82f6" /> Cross-Backend Comparison
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Run the same circuit on up to 6 backends simultaneously and compare fidelity and cost.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        <div>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>Circuit</h3>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 10 }}>
              Name
              <input value={circuitName} onChange={e => setCircuitName(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 10 }}>
              QASM
              <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={8}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.8rem", boxSizing: "border-box", resize: "vertical" }} />
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Shots: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{shots}</span>
              <input type="range" min={128} max={8192} step={128} value={shots} onChange={e => setShots(Number(e.target.value))}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#3b82f6" }} />
            </label>
          </div>

          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ color: "#e2e8f0", fontWeight: 600 }}>Target Backends ({targets.length})</h3>
              <button onClick={addTarget} disabled={targets.length >= 6}
                style={{ background: "#0f172a", border: "1px solid #334155", color: "#3b82f6", borderRadius: 6, padding: "0.35rem 0.7rem", cursor: "pointer", fontSize: "0.8rem", opacity: targets.length >= 6 ? 0.4 : 1 }}>
                + Add
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {targets.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select value={t.provider} onChange={e => updateTarget(i, "provider", e.target.value)}
                    style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.4rem 0.5rem", fontSize: "0.8rem", flex: 0.6 }}>
                    {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={t.backend} onChange={e => updateTarget(i, "backend", e.target.value)}
                    style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.4rem 0.5rem", fontSize: "0.8rem", flex: 1 }}>
                    {PRESET_BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <button onClick={() => removeTarget(i)} disabled={targets.length <= 2}
                    style={{ background: "transparent", border: "1px solid #7f1d1d", color: "#ef4444", borderRadius: 6, padding: "0.35rem 0.6rem", cursor: "pointer", opacity: targets.length <= 2 ? 0.3 : 1 }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button onClick={handleRun} disabled={running}
              style={{ width: "100%", marginTop: "1rem", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 600, opacity: running ? 0.6 : 1 }}>
              <Play size={16} /> {running ? "Running comparison…" : "Run Comparison"}
            </button>
          </div>
        </div>

        <div>
          {result && (
            <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1rem" }}>
              <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>
                Results — {result.comparison_id}
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
                <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", display: "flex", alignItems: "center", gap: 10 }}>
                  <Trophy size={20} color="#f59e0b" />
                  <div>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>Best Fidelity</div>
                    <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{result.winner_by_fidelity ?? "—"}</div>
                  </div>
                </div>
                <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", display: "flex", alignItems: "center", gap: 10 }}>
                  <DollarSign size={20} color="#10b981" />
                  <div>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>Cheapest</div>
                    <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{result.winner_by_cost ?? "—"}</div>
                  </div>
                </div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ color: "#64748b", borderBottom: "1px solid #1e293b" }}>
                    {["Backend", "Status", "Success Prob.", "Cost (credits)", "Top bitstring"].map(h => (
                      <th key={h} style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.metrics_table.map(m => (
                    <tr key={m.backend} style={{ borderBottom: "1px solid #0f172a" }}>
                      <td style={{ padding: "0.5rem 0.75rem", color: m.backend === result.winner_by_fidelity ? "#fbbf24" : "#e2e8f0", fontWeight: m.backend === result.winner_by_fidelity ? 700 : 400 }}>
                        {m.backend === result.winner_by_fidelity ? "🏆 " : ""}{m.backend}
                      </td>
                      <td style={{ padding: "0.5rem 0.75rem" }}>
                        <span style={{ color: m.status === "completed" ? "#10b981" : "#f59e0b", fontSize: "0.75rem" }}>{m.status}</span>
                      </td>
                      <BarCell value={m.success_probability} max={maxSP} />
                      <td style={{ padding: "0.5rem 0.75rem", color: "#94a3b8" }}>
                        {m.cost_credits != null ? m.cost_credits.toFixed(4) : "—"}
                      </td>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", fontFamily: "monospace", fontSize: "0.78rem" }}>
                        {m.top_bitstring ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <button onClick={() => setShowHistory(h => !h)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", color: "#e2e8f0", fontWeight: 600, cursor: "pointer", padding: 0 }}>
              Recent Comparisons ({history.length})
              {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showHistory && (
              <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: 6 }}>
                {history.slice(0, 10).map(h => (
                  <button key={h.comparison_id} onClick={() => loadHistory(h.comparison_id)}
                    style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 0.75rem", textAlign: "left", cursor: "pointer",
                      opacity: loadingResult === h.comparison_id ? 0.6 : 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: "0.85rem" }}>{h.circuit_name || h.comparison_id}</span>
                      <span style={{ color: "#64748b", fontSize: "0.75rem" }}>{h.n_backends} backends</span>
                    </div>
                    <div style={{ color: "#475569", fontSize: "0.72rem", marginTop: 2 }}>
                      {h.submitted_at ? new Date(h.submitted_at).toLocaleString() : "—"}
                    </div>
                  </button>
                ))}
                {history.length === 0 && <p style={{ color: "#64748b", fontSize: "0.85rem" }}>No past comparisons</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
