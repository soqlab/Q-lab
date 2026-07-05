"use client";
import { useState, useEffect } from "react";
import { startBayesOpt, submitBayesResult, getBayesSession, listBayesSessions, BayesOptSession, BayesParamSpec } from "@/lib/api";

export default function BayesOptPage() {
  const [sessions, setSessions] = useState<{ opt_id: string; name: string; status: string; current_iteration: number; best_value: number | null }[]>([]);
  const [activeSession, setActiveSession] = useState<BayesOptSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showStart, setShowStart] = useState(false);
  const [optName, setOptName] = useState("QAOA Parameter Sweep");
  const [objective, setObjective] = useState("cost_function");
  const [minimize, setMinimize] = useState(true);
  const [params, setParams] = useState<BayesParamSpec[]>([
    { name: "gamma", min_val: 0, max_val: 3.14159, param_type: "continuous", log_scale: false },
    { name: "beta", min_val: 0, max_val: 1.5708, param_type: "continuous", log_scale: false },
  ]);
  const [submitValue, setSubmitValue] = useState("");
  const [submitParams, setSubmitParams] = useState<Record<string, string>>({});

  useEffect(() => { loadSessions(); }, []);

  async function loadSessions() {
    try {
      const r = await listBayesSessions();
      setSessions(r.sessions as { opt_id: string; name: string; status: string; current_iteration: number; best_value: number | null }[]);
    } catch { /* ignore */ }
  }

  async function start() {
    setLoading(true); setError("");
    try {
      const sess = await startBayesOpt({ name: optName, parameters: params, objective, minimize });
      setActiveSession(sess);
      const nextP: Record<string, string> = {};
      for (const [k, v] of Object.entries(sess.next_params)) nextP[k] = String(v);
      setSubmitParams(nextP);
      setShowStart(false);
      loadSessions();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function loadSession(id: string) {
    try {
      const s = await getBayesSession(id);
      setActiveSession(s);
      const nextP: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.next_params)) nextP[k] = String(v);
      setSubmitParams(nextP);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function submit() {
    if (!activeSession || !submitValue) return;
    setLoading(true); setError("");
    try {
      const paramsNum: Record<string, number> = {};
      for (const [k, v] of Object.entries(submitParams)) paramsNum[k] = Number(v);
      const s = await submitBayesResult({ opt_id: activeSession.opt_id, params: paramsNum, value: Number(submitValue) });
      setActiveSession(s);
      const nextP: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.next_params)) nextP[k] = String(v);
      setSubmitParams(nextP);
      setSubmitValue("");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Bayesian Optimization</h1>
        <button onClick={() => setShowStart(!showStart)} className="button">
          + New Session
        </button>
      </div>
      <p style={{ color: "var(--muted)" }}>Intelligently explore circuit parameter spaces using Gaussian Process surrogate models and Expected Improvement acquisition.</p>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {showStart && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Session Name</label>
              <input value={optName} onChange={e => setOptName(e.target.value)}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }} />
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Objective</label>
              <input value={objective} onChange={e => setObjective(e.target.value)}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }} />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={minimize} onChange={e => setMinimize(e.target.checked)} />
            Minimize objective
          </label>
          <h3 style={{ fontWeight: 500, fontSize: 13, color: "var(--text)" }}>Parameters</h3>
          {(params ?? []).map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, alignItems: "flex-end" }}>
              <input placeholder="Name" value={p.name} onChange={e => setParams(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                style={{ background: "var(--surface)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }} />
              <input type="number" placeholder="Min" value={p.min_val} onChange={e => setParams(prev => prev.map((x, j) => j === i ? { ...x, min_val: Number(e.target.value) } : x))}
                style={{ background: "var(--surface)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }} />
              <input type="number" placeholder="Max" value={p.max_val} onChange={e => setParams(prev => prev.map((x, j) => j === i ? { ...x, max_val: Number(e.target.value) } : x))}
                style={{ background: "var(--surface)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }} />
              <button onClick={() => setParams(prev => prev.filter((_, j) => j !== i))}
                style={{ padding: "6px 8px", background: "rgba(239,68,68,0.15)", color: "var(--danger)", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Remove</button>
            </div>
          ))}
          <button onClick={() => setParams(prev => [...prev, { name: `param_${prev.length}`, min_val: 0, max_val: 1, param_type: "continuous", log_scale: false }])}
            style={{ padding: "6px 12px", background: "var(--line)", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer", alignSelf: "flex-start" }}>+ Add Parameter</button>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={start} disabled={loading}
              style={{ padding: "8px 16px", background: "rgba(16,185,129,0.2)", color: "var(--ok)", border: "none", borderRadius: 6, fontSize: 13, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>Start</button>
            <button onClick={() => setShowStart(false)}
              style={{ padding: "8px 16px", background: "var(--line)", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)", textTransform: "uppercase" }}>Sessions</h2>
          {(sessions ?? []).map(s => (
            <div key={s.opt_id} onClick={() => loadSession(s.opt_id)}
              style={{
                background: "var(--surface)",
                borderRadius: 8,
                padding: 12,
                cursor: "pointer",
                border: activeSession?.opt_id === s.opt_id ? "1px solid var(--strong)" : "1px solid transparent",
              }}>
              <div style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                <span style={{ color: s.status === "converged" ? "var(--ok)" : s.status === "running" ? "var(--info-text)" : "var(--muted)" }}>{s.status}</span>
                <span>iter {s.current_iteration}</span>
              </div>
              {s.best_value !== null && <div style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: "var(--strong)", marginTop: 4 }}>best: {s.best_value.toFixed(6)}</div>}
            </div>
          ))}
        </div>

        {activeSession && (
          <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {([
                ["Status", activeSession.status, activeSession.status === "converged" ? "var(--ok)" : "var(--info-text)"],
                ["Iteration", String(activeSession.current_iteration), "var(--text)"],
                ["Best Value", activeSession.best_value !== null ? activeSession.best_value.toFixed(6) : "—", "var(--strong)"],
              ] as [string, string, string][]).map(([l, v, c]) => (
                <div key={l} style={{ background: "var(--surface)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{l}</div>
                  <div style={{ fontFamily: "ui-monospace,monospace", fontWeight: 600, marginTop: 4, color: c }}>{v}</div>
                </div>
              ))}
            </div>

            {activeSession.convergence_detected && (
              <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid var(--ok)", borderRadius: 6, padding: 12, color: "var(--ok)", fontSize: 13 }}>
                Convergence detected — optimization has stabilized.
              </div>
            )}

            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ fontWeight: 500, fontSize: 13 }}>Submit Next Evaluation</h3>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>Suggested parameters (edit if needed, then paste your objective value)</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {Object.entries(submitParams).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 13, fontFamily: "ui-monospace,monospace", color: "var(--muted)", width: 96, flexShrink: 0 }}>{k}</span>
                    <input type="number" step="any" value={v}
                      onChange={e => setSubmitParams(prev => ({ ...prev, [k]: e.target.value }))}
                      style={{ flex: 1, background: "var(--surface)", color: "var(--text)", fontFamily: "ui-monospace,monospace", padding: "6px 12px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, fontFamily: "ui-monospace,monospace", color: "var(--muted)", width: 96, flexShrink: 0 }}>value</span>
                <input type="number" step="any" placeholder="Objective value" value={submitValue}
                  onChange={e => setSubmitValue(e.target.value)}
                  style={{ flex: 1, background: "var(--surface)", color: "var(--strong)", fontFamily: "ui-monospace,monospace", padding: "6px 12px", borderRadius: 6, border: "1px solid var(--strong)", fontSize: 13 }} />
              </div>
              <button onClick={submit} disabled={loading}
                style={{ width: "100%", padding: "8px 0", background: "var(--strong)", color: "var(--text)", border: "none", borderRadius: 6, fontSize: 13, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
                {loading ? "Updating model..." : "Submit & Get Next Point"}
              </button>
            </div>

            {(activeSession.history ?? []).length > 0 && (
              <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
                <h3 style={{ fontWeight: 500, fontSize: 13, marginBottom: 12 }}>Optimization History</h3>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
                  {(activeSession.history ?? []).map((h, i) => {
                    const vals = activeSession.history.map(x => x.value);
                    const mn = Math.min(...vals), mx = Math.max(...vals);
                    const pct = mx === mn ? 50 : ((h.value - mn) / (mx - mn)) * 100;
                    const height = activeSession.minimize ? (100 - pct) : pct;
                    return <div key={i} style={{ flex: 1, background: "var(--strong)", borderRadius: "4px 4px 0 0", height: `${Math.max(4, height)}%` }} title={`iter ${h.iteration}: ${h.value.toFixed(4)}`} />;
                  })}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, textAlign: "center" }}>{(activeSession.history ?? []).length} evaluations · EI: {activeSession.expected_improvement.toFixed(4)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
