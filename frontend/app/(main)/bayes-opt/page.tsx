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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Bayesian Optimization</h1>
        <button onClick={() => setShowStart(!showStart)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium">
          + New Session
        </button>
      </div>
      <p className="text-gray-400">Intelligently explore circuit parameter spaces using Gaussian Process surrogate models and Expected Improvement acquisition.</p>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {showStart && (
        <div className="bg-gray-900 rounded-lg p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400">Session Name</label>
              <input value={optName} onChange={e => setOptName(e.target.value)}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Objective</label>
              <input value={objective} onChange={e => setObjective(e.target.value)}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={minimize} onChange={e => setMinimize(e.target.checked)} />
            Minimize objective
          </label>
          <h3 className="font-medium text-sm text-gray-300">Parameters</h3>
          {params.map((p, i) => (
            <div key={i} className="grid grid-cols-4 gap-2 items-end">
              <input placeholder="Name" value={p.name} onChange={e => setParams(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                className="bg-gray-800 text-white px-2 py-1.5 rounded border border-gray-700 text-sm" />
              <input type="number" placeholder="Min" value={p.min_val} onChange={e => setParams(prev => prev.map((x, j) => j === i ? { ...x, min_val: Number(e.target.value) } : x))}
                className="bg-gray-800 text-white px-2 py-1.5 rounded border border-gray-700 text-sm" />
              <input type="number" placeholder="Max" value={p.max_val} onChange={e => setParams(prev => prev.map((x, j) => j === i ? { ...x, max_val: Number(e.target.value) } : x))}
                className="bg-gray-800 text-white px-2 py-1.5 rounded border border-gray-700 text-sm" />
              <button onClick={() => setParams(prev => prev.filter((_, j) => j !== i))}
                className="px-2 py-1.5 bg-red-900 hover:bg-red-800 rounded text-xs">Remove</button>
            </div>
          ))}
          <button onClick={() => setParams(prev => [...prev, { name: `param_${prev.length}`, min_val: 0, max_val: 1, param_type: "continuous", log_scale: false }])}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm">+ Add Parameter</button>
          <div className="flex gap-3">
            <button onClick={start} disabled={loading} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50">Start</button>
            <button onClick={() => setShowStart(false)} className="px-4 py-2 bg-gray-700 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-400 uppercase">Sessions</h2>
          {sessions.map(s => (
            <div key={s.opt_id} onClick={() => loadSession(s.opt_id)}
              className={`bg-gray-900 rounded-lg p-3 cursor-pointer border transition-colors ${activeSession?.opt_id === s.opt_id ? "border-indigo-500" : "border-transparent hover:border-gray-600"}`}>
              <div className="font-medium text-sm truncate">{s.name}</div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span className={s.status === "converged" ? "text-green-400" : s.status === "running" ? "text-blue-400" : "text-gray-500"}>{s.status}</span>
                <span>iter {s.current_iteration}</span>
              </div>
              {s.best_value !== null && <div className="text-xs font-mono text-indigo-400 mt-1">best: {s.best_value.toFixed(6)}</div>}
            </div>
          ))}
        </div>

        {activeSession && (
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {([
                ["Status", activeSession.status, activeSession.status === "converged" ? "text-green-400" : "text-blue-400"],
                ["Iteration", String(activeSession.current_iteration), "text-white"],
                ["Best Value", activeSession.best_value !== null ? activeSession.best_value.toFixed(6) : "—", "text-indigo-400"],
              ] as [string, string, string][]).map(([l, v, c]) => (
                <div key={l} className="bg-gray-900 rounded-lg p-3">
                  <div className="text-xs text-gray-500">{l}</div>
                  <div className={`font-mono font-semibold mt-1 ${c}`}>{v}</div>
                </div>
              ))}
            </div>

            {activeSession.convergence_detected && (
              <div className="bg-green-900/30 border border-green-700 rounded p-3 text-green-300 text-sm">
                Convergence detected — optimization has stabilized.
              </div>
            )}

            <div className="bg-gray-900 rounded-lg p-4 space-y-3">
              <h3 className="font-medium text-sm">Submit Next Evaluation</h3>
              <p className="text-xs text-gray-500">Suggested parameters (edit if needed, then paste your objective value)</p>
              <div className="space-y-2">
                {Object.entries(submitParams).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-400 w-24">{k}</span>
                    <input type="number" step="any" value={v}
                      onChange={e => setSubmitParams(prev => ({ ...prev, [k]: e.target.value }))}
                      className="flex-1 bg-gray-800 text-white font-mono px-3 py-1.5 rounded border border-gray-700 text-sm" />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-gray-400 w-24">value</span>
                <input type="number" step="any" placeholder="Objective value" value={submitValue}
                  onChange={e => setSubmitValue(e.target.value)}
                  className="flex-1 bg-gray-800 text-indigo-400 font-mono px-3 py-1.5 rounded border border-indigo-700 text-sm" />
              </div>
              <button onClick={submit} disabled={loading}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50">
                {loading ? "Updating model..." : "Submit & Get Next Point"}
              </button>
            </div>

            {activeSession.history.length > 0 && (
              <div className="bg-gray-900 rounded-lg p-4">
                <h3 className="font-medium text-sm mb-3">Optimization History</h3>
                <div className="flex items-end gap-1 h-20">
                  {activeSession.history.map((h, i) => {
                    const vals = activeSession.history.map(x => x.value);
                    const mn = Math.min(...vals), mx = Math.max(...vals);
                    const pct = mx === mn ? 50 : ((h.value - mn) / (mx - mn)) * 100;
                    const height = activeSession.minimize ? (100 - pct) : pct;
                    return <div key={i} className="flex-1 bg-indigo-500 rounded-t" style={{ height: `${Math.max(4, height)}%` }} title={`iter ${h.iteration}: ${h.value.toFixed(4)}`} />;
                  })}
                </div>
                <div className="text-xs text-gray-500 mt-1 text-center">{activeSession.history.length} evaluations · EI: {activeSession.expected_improvement.toFixed(4)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
