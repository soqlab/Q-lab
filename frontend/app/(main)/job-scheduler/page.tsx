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

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Job Scheduler</h1>
      <p className="text-gray-400">Optimally assign a batch of circuits across multiple backends. Minimizes cost, wait time, or maximizes fidelity — respecting budget constraints.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Circuit Batch</h2>
          <button onClick={addCircuit} className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded">+ Add Circuit</button>
        </div>
        <div className="space-y-2">
          {circuits.map((c, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 items-end bg-gray-800 rounded-lg p-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-400">Circuit ID</label>
                <input value={c.circuit_id} onChange={e => updateCircuit(i, "circuit_id", e.target.value)}
                  className="w-full mt-0.5 bg-gray-700 text-white text-sm px-2 py-1.5 rounded border border-gray-600 font-mono" />
              </div>
              <div>
                <label className="text-xs text-gray-400">Qubits</label>
                <input type="number" value={c.n_qubits} onChange={e => updateCircuit(i, "n_qubits", Number(e.target.value))}
                  className="w-full mt-0.5 bg-gray-700 text-white text-sm px-2 py-1.5 rounded border border-gray-600" />
              </div>
              <div>
                <label className="text-xs text-gray-400">Depth</label>
                <input type="number" value={c.circuit_depth} onChange={e => updateCircuit(i, "circuit_depth", Number(e.target.value))}
                  className="w-full mt-0.5 bg-gray-700 text-white text-sm px-2 py-1.5 rounded border border-gray-600" />
              </div>
              <div>
                <label className="text-xs text-gray-400">Shots</label>
                <input type="number" value={c.n_shots} onChange={e => updateCircuit(i, "n_shots", Number(e.target.value))}
                  className="w-full mt-0.5 bg-gray-700 text-white text-sm px-2 py-1.5 rounded border border-gray-600" />
              </div>
              <div className="flex gap-1 items-end">
                <div className="flex-1">
                  <label className="text-xs text-gray-400">Priority</label>
                  <select value={c.priority} onChange={e => updateCircuit(i, "priority", e.target.value)}
                    className="w-full mt-0.5 bg-gray-700 text-white text-sm px-2 py-1.5 rounded border border-gray-600">
                    {["high", "normal", "low"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <button onClick={() => removeCircuit(i)} className="text-red-400 hover:text-red-300 px-2 pb-1">×</button>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400">Objective</label>
            <select value={objective} onChange={e => setObjective(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700 text-sm">
              {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Budget (USD)</label>
            <input type="number" step="0.1" value={budget} onChange={e => setBudget(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700 text-sm" />
          </div>
        </div>
        <button onClick={schedule} disabled={loading || circuits.length === 0}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Scheduling..." : "Optimize Schedule"}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {([
              ["Total Cost", `$${result.total_cost_usd.toFixed(4)}`, result.total_cost_usd <= budget ? "text-green-400" : "text-red-400"],
              ["Makespan", `${result.makespan_min.toFixed(0)} min`, "text-white"],
              ["Avg Fidelity", `${(result.average_fidelity * 100).toFixed(2)}%`, "text-indigo-400"],
              ["Savings vs Random", `$${result.savings_vs_random_usd.toFixed(4)}`, "text-green-400"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} className="bg-gray-900 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">{l}</div>
                <div className={`text-lg font-mono font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          <div className="bg-gray-900 rounded-lg p-5">
            <h2 className="font-semibold text-sm mb-4">Assignment Table</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-700">
                    <th className="text-left py-2 pr-4">Circuit</th>
                    <th className="text-left pr-4">Backend</th>
                    <th className="text-right pr-4">Fidelity</th>
                    <th className="text-right pr-4">Cost</th>
                    <th className="text-right pr-4">Queue Pos.</th>
                    <th className="text-right pr-4">Score</th>
                    <th className="text-left">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.assignments.map((a: ScheduleAssignment, i: number) => (
                    <tr key={i} className="border-b border-gray-800">
                      <td className="py-2 pr-4 font-mono text-sm">{a.circuit_id}</td>
                      <td className="pr-4 font-mono text-indigo-300 text-xs">{a.backend}</td>
                      <td className="text-right pr-4 font-mono">{(a.estimated_fidelity * 100).toFixed(2)}%</td>
                      <td className="text-right pr-4 font-mono text-yellow-400">${a.estimated_cost_usd.toFixed(4)}</td>
                      <td className="text-right pr-4 font-mono text-gray-400">#{a.queue_position}</td>
                      <td className="text-right pr-4 font-mono text-indigo-400">{a.score.toFixed(3)}</td>
                      <td className="text-gray-400 text-xs">{a.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.recommendations && result.recommendations.length > 0 && (
            <div className="bg-gray-900 rounded-lg p-4 space-y-1">
              <h2 className="font-semibold text-sm mb-2">Recommendations</h2>
              {result.recommendations.map((r, i) => <div key={i} className="text-sm text-gray-300">• {r}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
