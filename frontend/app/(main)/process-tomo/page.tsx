"use client";

import { useState, useEffect, useCallback } from "react";
import {
  runQPT,
  listQPTResults,
  getQPTResult,
  QPTResult,
  QPTSummary,
} from "../../../lib/api";

const BACKENDS = ["ibm_brisbane", "ibm_kyoto", "ionq_aria_1", "rigetti_ankaa_2"];
const METHODS = ["standard", "compressed", "direct_fidelity"];

const ERROR_COLORS: Record<string, string> = {
  depolarizing: "#6366f1",
  dephasing: "#3b82f6",
  amplitude_damping: "#f59e0b",
  crosstalk: "#ef4444",
  readout: "#10b981",
  coherent: "#a855f7",
};

function ErrorBreakdownBars({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(([name, val]) => {
        const pct = (val / total) * 100;
        const color = ERROR_COLORS[name] ?? "#6b7280";
        return (
          <div key={name}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
              <span style={{ color: "var(--muted)" }}>{name.replace("_", " ")}</span>
              <span style={{ fontWeight: 600, color }}>{pct.toFixed(1)}%</span>
            </div>
            <div style={{ height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChiMatrixHeatmap({ matrix }: { matrix: number[][] }) {
  if (!matrix || matrix.length === 0) return null;
  const n = matrix.length;

  // Find max absolute value for colour scaling
  let maxVal = 0;
  for (const row of matrix) for (const v of row) if (Math.abs(v) > maxVal) maxVal = Math.abs(v);
  if (maxVal === 0) maxVal = 1;

  const CELL = 58;
  const W = n * CELL;
  const H = n * CELL;

  const toColor = (v: number) => {
    const norm = v / maxVal; // -1 to 1
    if (norm >= 0) {
      const a = norm;
      return `rgba(99, 102, 241, ${0.15 + a * 0.85})`;
    } else {
      const a = -norm;
      return `rgba(239, 68, 68, ${0.15 + a * 0.85})`;
    }
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ marginBottom: 8, fontSize: 11, color: "var(--muted)" }}>
        <span style={{ marginRight: 12 }}>
          <span style={{ display: "inline-block", width: 12, height: 12, background: "rgba(99,102,241,0.8)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />
          Positive
        </span>
        <span>
          <span style={{ display: "inline-block", width: 12, height: 12, background: "rgba(239,68,68,0.8)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />
          Negative
        </span>
      </div>
      <div style={{ display: "inline-grid", gridTemplateColumns: `repeat(${n}, ${CELL}px)`, gap: 2 }}>
        {matrix.map((row, i) =>
          row.map((v, j) => (
            <div
              key={`${i}-${j}`}
              style={{
                width: CELL, height: CELL,
                background: toColor(v),
                border: "1px solid var(--line)",
                borderRadius: 3,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontFamily: "monospace", fontWeight: 600,
                color: Math.abs(v / maxVal) > 0.5 ? "#fff" : "var(--text)",
                userSelect: "none",
                cursor: "default",
              }}
              title={`chi[${i}][${j}] = ${v}`}
            >
              {v.toFixed(3)}
            </div>
          ))
        )}
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: "var(--muted)" }}>
        {n}×{n} chi matrix (real part) — color intensity = |value| / max({maxVal.toFixed(3)})
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: QPTResult }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Stats row */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Process Fidelity</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: result.process_fidelity > 0.95 ? "#10b981" : result.process_fidelity > 0.85 ? "#f59e0b" : "#ef4444" }}>
            {(result.process_fidelity * 100).toFixed(2)}%
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Avg Gate Fidelity</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: result.average_gate_fidelity > 0.99 ? "#10b981" : "#f59e0b" }}>
            {(result.average_gate_fidelity * 100).toFixed(2)}%
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Unitarity</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{result.unitarity.toFixed(4)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Diamond Norm Error</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: result.diamond_norm_error < 0.01 ? "#10b981" : "#ef4444" }}>
            {result.diamond_norm_error.toFixed(4)}
          </div>
        </div>
        <div style={{ alignSelf: "center" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Dominant Error</div>
          <span style={{
            fontSize: 12, padding: "3px 10px", borderRadius: 4, fontWeight: 700,
            background: `${ERROR_COLORS[result.dominant_error_type] ?? "#6b7280"}22`,
            color: ERROR_COLORS[result.dominant_error_type] ?? "#6b7280",
          }}>{result.dominant_error_type}</span>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Circuits Used</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{result.n_circuits_used}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Shots / Circuit</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{result.shots_per_circuit.toLocaleString()}</div>
        </div>
      </div>

      {/* Error breakdown */}
      {Object.keys(result.error_breakdown).length > 0 && (
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>Error Breakdown</div>
          <ErrorBreakdownBars breakdown={result.error_breakdown} />
        </div>
      )}

      {/* Chi matrix */}
      {result.chi_matrix_real && result.chi_matrix_real.length > 0 && (
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>Chi Matrix (Real Part)</div>
          <ChiMatrixHeatmap matrix={result.chi_matrix_real} />
        </div>
      )}
    </div>
  );
}

export default function ProcessTomoPage() {
  const [summaries, setSummaries] = useState<QPTSummary[]>([]);
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [summariesError, setSummariesError] = useState("");

  const [form, setForm] = useState({
    backend: "ibm_brisbane",
    gate_name: "h",
    n_qubits: 1,
    method: "standard",
    shots_per_circuit: 1024,
  });
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [currentResult, setCurrentResult] = useState<QPTResult | null>(null);

  const [selectedResult, setSelectedResult] = useState<QPTResult | null>(null);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [selectedError, setSelectedError] = useState("");

  const displayResult = currentResult ?? selectedResult;

  const loadSummaries = useCallback(async () => {
    setLoadingSummaries(true);
    try {
      const s = await listQPTResults();
      setSummaries(s);
      setSummariesError("");
    } catch (e) {
      setSummariesError(e instanceof Error ? e.message : "Failed to load results");
    } finally {
      setLoadingSummaries(false);
    }
  }, []);

  useEffect(() => { void loadSummaries(); }, []);

  const handleRunQPT = async () => {
    if (!form.gate_name.trim()) { setRunError("Gate name is required"); return; }
    setRunning(true);
    setRunError("");
    setCurrentResult(null);
    try {
      const res = await runQPT({
        backend: form.backend,
        gate_name: form.gate_name.trim(),
        n_qubits: form.n_qubits,
        method: form.method,
        shots_per_circuit: form.shots_per_circuit,
      });
      setCurrentResult(res);
      setSummaries(prev => [{
        result_id: res.result_id,
        backend: res.backend,
        gate_name: res.gate_name,
        process_fidelity: res.process_fidelity,
        average_gate_fidelity: res.average_gate_fidelity,
        diamond_norm_error: res.diamond_norm_error,
        created_at: res.created_at,
      }, ...prev]);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "QPT run failed");
    } finally {
      setRunning(false);
    }
  };

  const handleSelectRow = async (s: QPTSummary) => {
    setLoadingSelected(true);
    setSelectedError("");
    setCurrentResult(null);
    try {
      const res = await getQPTResult(s.result_id);
      setSelectedResult(res);
    } catch (e) {
      setSelectedError(e instanceof Error ? e.message : "Failed to load result");
    } finally {
      setLoadingSelected(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Quantum Process Tomography</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Chi matrix characterisation — measure process fidelity, diamond norm error, and dominant error channels for any gate.
        </p>
      </div>

      {/* Run QPT form */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h2>Run QPT</h2></div>
        <div style={{ padding: 16 }}>
          {runError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fee2e2", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
              {runError}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Backend</span>
              <select className="input" value={form.backend} onChange={e => setForm(f => ({ ...f, backend: e.target.value }))} style={{ height: 34 }}>
                {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Gate Name</span>
              <input className="input" value={form.gate_name} onChange={e => setForm(f => ({ ...f, gate_name: e.target.value }))}
                placeholder="h, cx, t, rx, ..." style={{ height: 34 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Qubits (1–2)</span>
              <select className="input" value={form.n_qubits} onChange={e => setForm(f => ({ ...f, n_qubits: Number(e.target.value) }))} style={{ height: 34 }}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Method</span>
              <select className="input" value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))} style={{ height: 34 }}>
                {METHODS.map(m => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Shots / Circuit</span>
              <input className="input" type="number" min={128} value={form.shots_per_circuit}
                onChange={e => setForm(f => ({ ...f, shots_per_circuit: Number(e.target.value) }))} style={{ height: 34 }} />
            </label>
          </div>
          <button className="button" onClick={() => void handleRunQPT()} disabled={running} style={{ height: 36 }}>
            {running ? "Running QPT…" : "Run QPT"}
          </button>
        </div>
      </div>

      {/* Result panel */}
      {loadingSelected && (
        <div style={{ marginBottom: 20, padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          Loading result…
        </div>
      )}
      {selectedError && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fee2e2", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
          {selectedError}
        </div>
      )}
      {displayResult && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <h2>
              {displayResult.gate_name.toUpperCase()} gate — {displayResult.backend}
            </h2>
            <span style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#e0e7ff",
              color: "#3730a3", fontWeight: 600,
            }}>{displayResult.method}</span>
          </div>
          <div style={{ padding: 16 }}>
            <ResultPanel result={displayResult} />
          </div>
        </div>
      )}

      {/* Results table */}
      <div className="panel">
        <div className="panel-header">
          <h2>All QPT Results</h2>
          <button className="button secondary" onClick={() => void loadSummaries()} disabled={loadingSummaries} style={{ height: 28, fontSize: 12 }}>
            {loadingSummaries ? "Loading…" : "Refresh"}
          </button>
        </div>
        {summariesError ? (
          <div style={{ padding: 16, color: "#b91c1c", fontSize: 13 }}>{summariesError}</div>
        ) : loadingSummaries && summaries.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading results…</div>
        ) : summaries.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No QPT results yet. Run your first characterisation above.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["Backend", "Gate", "Process Fidelity", "Avg Gate Fidelity", "Diamond Norm Err", "Method", "Created"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaries.map(s => {
                  const isActive = displayResult?.result_id === s.result_id;
                  return (
                    <tr
                      key={s.result_id}
                      onClick={() => void handleSelectRow(s)}
                      style={{
                        borderBottom: "1px solid var(--line)", cursor: "pointer",
                        background: isActive ? "#6366f111" : "transparent",
                      }}
                    >
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{s.backend}</td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, color: "#6366f1" }}>
                        {s.gate_name.toUpperCase()}
                      </td>
                      <td style={{ padding: "8px 12px", fontWeight: 700, color: s.process_fidelity > 0.95 ? "#10b981" : s.process_fidelity > 0.85 ? "#f59e0b" : "#ef4444" }}>
                        {(s.process_fidelity * 100).toFixed(2)}%
                      </td>
                      <td style={{ padding: "8px 12px", fontWeight: 600, color: s.average_gate_fidelity > 0.99 ? "#10b981" : "#f59e0b" }}>
                        {(s.average_gate_fidelity * 100).toFixed(2)}%
                      </td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12, color: s.diamond_norm_error < 0.01 ? "#10b981" : "#ef4444" }}>
                        {s.diamond_norm_error.toFixed(4)}
                      </td>
                      <td style={{ padding: "8px 12px", color: "var(--muted)" }}>—</td>
                      <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{new Date(s.created_at).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
