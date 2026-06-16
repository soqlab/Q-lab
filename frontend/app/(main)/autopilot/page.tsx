"use client";
import { useState, useEffect } from "react";
import { startAutopilot, stepAutopilot, listAutopilotMissions, AutopilotMission } from "@/lib/api";

export default function AutopilotPage() {
  const [missions, setMissions] = useState<{ mission_id: string; name: string; status: string; current_iteration: number; best_value: number | null; estimated_completion_pct: number }[]>([]);
  const [active, setActive] = useState<AutopilotMission | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showStart, setShowStart] = useState(false);
  const [missionName, setMissionName] = useState("VQE Ground State Search");
  const [goal, setGoal] = useState("minimize_energy");
  const [backend, setBackend] = useState("ibm_brisbane");
  const [maxIter, setMaxIter] = useState(30);
  const [targetValue, setTargetValue] = useState(-1.857);
  const [stepValue, setStepValue] = useState("");

  useEffect(() => { loadMissions(); }, []);

  async function loadMissions() {
    try {
      const r = await listAutopilotMissions();
      setMissions(r.missions as typeof missions);
    } catch { /* ignore */ }
  }

  async function start() {
    setLoading(true); setError("");
    try {
      const m = await startAutopilot({ name: missionName, goal, backend, termination: { target_value: targetValue, max_iterations: maxIter, metric: "value", tolerance: 0.001, max_cost_usd: 100, confidence_required: 0.95 } });
      setActive(m);
      setShowStart(false);
      loadMissions();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function step() {
    if (!active || !stepValue) return;
    setLoading(true);
    try {
      const nextParams = { ...active.best_params };
      const m = await stepAutopilot({ mission_id: active.mission_id, value: Number(stepValue), params: nextParams, run_id: `manual_${Date.now()}` });
      setActive(m);
      setStepValue("");
      loadMissions();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const statusColor: Record<string, string> = { running: "text-blue-400", converged: "text-green-400", stopped: "text-gray-500", max_iter: "text-yellow-400" };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Experiment Autopilot</h1>
        <button onClick={() => setShowStart(!showStart)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium">
          + Launch Mission
        </button>
      </div>
      <p className="text-gray-400">Set a target (e.g. "find ground state energy to 1 mHa") and Q-Lab iterates circuits, adjusts parameters, picks backends, and stops when converged.</p>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {showStart && (
        <div className="bg-gray-900 rounded-lg p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400">Mission Name</label>
              <input value={missionName} onChange={e => setMissionName(e.target.value)}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Goal</label>
              <select value={goal} onChange={e => setGoal(e.target.value)}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
                {["minimize_energy", "maximize_fidelity", "maximize_approximation_ratio", "minimize_error"].map(g => (
                  <option key={g} value={g}>{g.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-400">Backend</label>
              <select value={backend} onChange={e => setBackend(e.target.value)}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
                {["ibm_brisbane", "ionq_aria_1", "rigetti_ankaa_2"].map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-400">Target Value</label>
              <input type="number" step="any" value={targetValue} onChange={e => setTargetValue(Number(e.target.value))}
                className="w-full mt-1 bg-gray-800 text-white font-mono px-3 py-2 rounded border border-gray-700" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Max Iterations</label>
              <input type="number" value={maxIter} onChange={e => setMaxIter(Number(e.target.value))}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={start} disabled={loading} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50">Launch</button>
            <button onClick={() => setShowStart(false)} className="px-4 py-2 bg-gray-700 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-400 uppercase">Missions</h2>
          {missions.map(m => (
            <div key={m.mission_id} onClick={() => setActive(m as unknown as AutopilotMission)}
              className={`bg-gray-900 rounded-lg p-3 cursor-pointer border transition-colors ${active?.mission_id === m.mission_id ? "border-indigo-500" : "border-transparent hover:border-gray-600"}`}>
              <div className="font-medium text-sm truncate">{m.name}</div>
              <div className="flex justify-between text-xs mt-1">
                <span className={statusColor[m.status] ?? "text-gray-400"}>{m.status}</span>
                <span className="text-gray-500">iter {m.current_iteration}</span>
              </div>
              <div className="mt-1.5 w-full bg-gray-700 rounded-full h-1.5">
                <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${m.estimated_completion_pct}%` }} />
              </div>
              {m.best_value !== null && <div className="text-xs font-mono text-indigo-400 mt-1">best: {m.best_value.toFixed(6)}</div>}
            </div>
          ))}
        </div>

        {active && (
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {([
                ["Status", active.status, statusColor[active.status] ?? "text-gray-400"],
                ["Iteration", String(active.current_iteration), "text-white"],
                ["Best Value", active.best_value !== null ? active.best_value.toFixed(6) : "—", "text-indigo-400"],
              ] as [string, string, string][]).map(([l, v, c]) => (
                <div key={l} className="bg-gray-900 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500">{l}</div>
                  <div className={`font-mono font-semibold mt-1 ${c}`}>{v}</div>
                </div>
              ))}
            </div>

            <div className="w-full bg-gray-700 rounded-full h-3">
              <div className="bg-indigo-500 h-3 rounded-full transition-all" style={{ width: `${active.estimated_completion_pct}%` }} />
            </div>
            <div className="text-xs text-gray-500 text-center">{active.estimated_completion_pct.toFixed(1)}% complete · ${active.total_cost_usd.toFixed(4)} spent</div>

            {active.converged && (
              <div className="bg-green-900/30 border border-green-700 rounded p-3 text-green-300 text-sm">
                {active.convergence_reason}
              </div>
            )}

            {!active.converged && active.next_action && (
              <div className="bg-gray-900 rounded-lg p-4 space-y-3">
                <h3 className="font-medium text-sm">Next Suggested Point</h3>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(active.next_action.params as Record<string, unknown> || {}).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-400 font-mono">{k}:</span>
                      <span className="font-mono text-indigo-300">{typeof v === "number" ? v.toFixed(4) : String(v)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <input type="number" step="any" placeholder="Your objective value" value={stepValue}
                    onChange={e => setStepValue(e.target.value)}
                    className="flex-1 bg-gray-800 text-white font-mono px-3 py-2 rounded border border-indigo-700 text-sm" />
                  <button onClick={step} disabled={loading || !stepValue}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50">
                    Submit & Iterate
                  </button>
                </div>
              </div>
            )}

            {active.iterations.length > 0 && (
              <div className="bg-gray-900 rounded-lg p-4">
                <h3 className="font-medium text-sm mb-3">Iteration History</h3>
                <div className="flex items-end gap-1 h-20">
                  {(active.iterations as { value: number }[]).map((it, i) => {
                    const vals = (active.iterations as { value: number }[]).map(x => x.value);
                    const mn = Math.min(...vals); const mx = Math.max(...vals);
                    const pct = mx === mn ? 50 : ((it.value - mn) / (mx - mn)) * 100;
                    return <div key={i} className="flex-1 bg-indigo-500 rounded-t" style={{ height: `${Math.max(4, pct)}%` }} title={`iter ${i + 1}: ${it.value.toFixed(4)}`} />;
                  })}
                </div>
              </div>
            )}

            {active.decision_log.length > 0 && (
              <div className="bg-gray-900 rounded-lg p-4 space-y-2 max-h-48 overflow-y-auto">
                <h3 className="font-medium text-sm">Decision Log</h3>
                {(active.decision_log as { iteration: number; decision: string }[]).slice(-5).map((d, i) => (
                  <div key={i} className="text-xs text-gray-400">
                    <span className="text-indigo-400 font-mono">iter {d.iteration}:</span> {d.decision}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
