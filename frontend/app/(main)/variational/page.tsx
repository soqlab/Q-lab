"use client";

import { useEffect, useState } from "react";
import {
  listVariationalRuns, createVariationalRun, addVariationalIterations,
  VariationalRun, VariationalRunCreate, VariationalIteration,
} from "../../../lib/api";

const STATUS_COLOR: Record<string, string> = {
  running: "#3b82f6", converged: "#10b981", diverged: "#ef4444",
  stalled: "#f59e0b", barren_plateau: "#a855f7",
};

const ALGORITHMS = ["vqe", "qaoa", "adapt_vqe", "other"];

function renderChart(vr: VariationalRun): React.ReactNode {
  const iters = vr.iterations ?? [];
  if (iters.length === 0) return <div style={{ color: "#6b7280", fontSize: 13 }}>No iterations yet.</div>;
  const energies = iters.map(i => i.energy);
  const minE = Math.min(...energies);
  const maxE = Math.max(...energies);
  const range = maxE - minE || 1;
  const W = 400, H = 120, pad = 20;

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {/* Y axis labels */}
      <text x={pad - 4} y={pad} fontSize={9} fill="#6b7280" textAnchor="end">{maxE.toFixed(3)}</text>
      <text x={pad - 4} y={H - pad + 4} fontSize={9} fill="#6b7280" textAnchor="end">{minE.toFixed(3)}</text>
      {/* Axes */}
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#374151" />
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#374151" />
      {/* Energy line */}
      {energies.map((e, i) => {
        if (i === 0) return null;
        const x1 = pad + ((i - 1) / (iters.length - 1)) * (W - 2 * pad);
        const x2 = pad + (i / (iters.length - 1)) * (W - 2 * pad);
        const y1 = pad + (1 - (energies[i - 1] - minE) / range) * (H - 2 * pad);
        const y2 = pad + (1 - (e - minE) / range) * (H - 2 * pad);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3b82f6" strokeWidth={1.5} />;
      })}
      {/* Final point */}
      {iters.length > 0 && (() => {
        const e = energies[energies.length - 1];
        const x = pad + ((iters.length - 1) / Math.max(1, iters.length - 1)) * (W - 2 * pad);
        const y = pad + (1 - (e - minE) / range) * (H - 2 * pad);
        return <circle cx={x} cy={y} r={3} fill="#10b981" />;
      })()}
    </svg>
  );
}

export default function VariationalPage() {
  const [vruns, setVruns] = useState<VariationalRun[]>([]);
  const [selected, setSelected] = useState<VariationalRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filterAlgo, setFilterAlgo] = useState("");

  const [createForm, setCreateForm] = useState<VariationalRunCreate>({
    algorithm: "vqe", n_parameters: 4, n_qubits: 2,
    ansatz_type: "UCCSD", hamiltonian_type: "H2",
  });

  const [iterText, setIterText] = useState("");
  const [addingIter, setAddingIter] = useState(false);

  const load = () => {
    setLoading(true);
    listVariationalRuns({ algorithm: filterAlgo || undefined, limit: 100 })
      .then(r => { setVruns(r); setErr(""); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filterAlgo]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const vr = await createVariationalRun(createForm);
      setVruns(prev => [vr, ...prev]);
      setSelected(vr);
      setShowCreate(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleAddIterations = async () => {
    if (!selected) return;
    setAddingIter(true);
    try {
      const parsed: VariationalIteration[] = JSON.parse(iterText) as VariationalIteration[];
      const updated = await addVariationalIterations(selected.vrun_id, parsed);
      setSelected(updated);
      setVruns(prev => prev.map(v => v.vrun_id === updated.vrun_id ? updated : v));
      setIterText("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingIter(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Variational Convergence Tracker</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? "Cancel" : "+ New Run"}
          </button>
        </div>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>}

      {/* Create form */}
      {showCreate && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header"><h2>Create Variational Run</h2></div>
          <div style={{ padding: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Algorithm</span>
              <select className="input" value={createForm.algorithm} onChange={e => setCreateForm(f => ({ ...f, algorithm: e.target.value as VariationalRunCreate["algorithm"] }))}>
                {ALGORITHMS.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>N Qubits</span>
              <input className="input" type="number" value={createForm.n_qubits} onChange={e => setCreateForm(f => ({ ...f, n_qubits: Number(e.target.value) }))} style={{ width: 80 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>N Parameters</span>
              <input className="input" type="number" value={createForm.n_parameters} onChange={e => setCreateForm(f => ({ ...f, n_parameters: Number(e.target.value) }))} style={{ width: 100 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Ansatz Type</span>
              <input className="input" value={createForm.ansatz_type ?? ""} onChange={e => setCreateForm(f => ({ ...f, ansatz_type: e.target.value }))} placeholder="UCCSD" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Hamiltonian</span>
              <input className="input" value={createForm.hamiltonian_type ?? ""} onChange={e => setCreateForm(f => ({ ...f, hamiltonian_type: e.target.value }))} placeholder="H2" />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 16 }}>
        {/* Run list */}
        <div style={{ flex: "0 0 280px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            <select className="input" style={{ flex: 1 }} value={filterAlgo} onChange={e => setFilterAlgo(e.target.value)}>
              <option value="">All algorithms</option>
              {ALGORITHMS.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
            </select>
          </div>
          {loading ? (
            <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading...</div>
          ) : vruns.length === 0 ? (
            <div className="panel" style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>No variational runs yet.</div>
          ) : (
            vruns.map(vr => (
              <div
                key={vr.vrun_id}
                className="panel"
                onClick={() => setSelected(vr)}
                style={{
                  padding: "10px 14px", cursor: "pointer",
                  borderLeft: selected?.vrun_id === vr.vrun_id ? "3px solid #3b82f6" : "3px solid transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{vr.algorithm.toUpperCase()}</span>
                  <span style={{
                    fontSize: 11, padding: "1px 6px", borderRadius: 3,
                    background: `${STATUS_COLOR[vr.convergence_status] ?? "#6b7280"}22`,
                    color: STATUS_COLOR[vr.convergence_status] ?? "#6b7280",
                  }}>{vr.convergence_status}</span>
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                  {vr.n_qubits}q · {vr.n_parameters} params · {(vr.iterations ?? []).length} iters
                </div>
                {vr.optimal_energy != null && (
                  <div style={{ fontSize: 12, color: "#10b981", marginTop: 2 }}>E = {vr.optimal_energy.toFixed(4)}</div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Detail */}
        <div style={{ flex: 1 }}>
          {selected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="panel">
                <div className="panel-header">
                  <h2>{selected.algorithm.toUpperCase()} — {selected.vrun_id}</h2>
                  <span style={{
                    fontSize: 12, padding: "2px 8px", borderRadius: 4,
                    background: `${STATUS_COLOR[selected.convergence_status] ?? "#6b7280"}22`,
                    color: STATUS_COLOR[selected.convergence_status] ?? "#6b7280",
                  }}>{selected.convergence_status}</span>
                </div>
                <div style={{ padding: 16 }}>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
                    {[
                      { label: "N Qubits", value: selected.n_qubits },
                      { label: "N Parameters", value: selected.n_parameters },
                      { label: "Iterations", value: (selected.iterations ?? []).length },
                      { label: "Ansatz", value: selected.ansatz_type ?? "—" },
                      { label: "Hamiltonian", value: selected.hamiltonian_type ?? "—" },
                      { label: "Optimal Energy", value: selected.optimal_energy?.toFixed(6) ?? "—" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>{label}</div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: "#9ca3af" }}>Energy Convergence</div>
                  <div style={{ overflowX: "auto" }}>{renderChart(selected)}</div>
                </div>
              </div>

              {/* Add iterations */}
              <div className="panel">
                <div className="panel-header"><h2>Add Iterations</h2></div>
                <div style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
                    JSON array of {"{ iter, energy, grad_norm? }"} objects
                  </div>
                  <textarea
                    className="input"
                    rows={4}
                    value={iterText}
                    onChange={e => setIterText(e.target.value)}
                    style={{ fontFamily: "monospace", fontSize: 12, width: "100%", marginBottom: 8 }}
                    placeholder='[{"iter": 0, "energy": -1.2, "grad_norm": 0.5}, ...]'
                  />
                  <button className="btn btn-primary" onClick={handleAddIterations} disabled={addingIter || !iterText}>
                    {addingIter ? "Adding..." : "Add Iterations"}
                  </button>
                </div>
              </div>

              {/* Analysis */}
              {selected.analysis && (
                <div className="panel">
                  <div className="panel-header"><h2>Analysis</h2></div>
                  <div style={{ padding: 16 }}>
                    <pre style={{ fontSize: 12, margin: 0 }}>{JSON.stringify(selected.analysis, null, 2)}</pre>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="panel" style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>
              Select a variational run to see details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
