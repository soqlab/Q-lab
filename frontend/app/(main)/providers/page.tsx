"use client";
import { useState } from "react";
import { submitToProviders, listProviders, MultiProviderResult } from "@/lib/api";

export default function ProvidersPage() {
  const [qasm, setQasm] = useState('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];');
  const [shots, setShots] = useState(1024);
  const [result, setResult] = useState<MultiProviderResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await submitToProviders({ qasm, n_shots: shots });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Multi-Provider Execution</h1>
      <p className="text-gray-400">Submit your circuit to IBM, IonQ, Rigetti, Quantinuum, Google and IQM simultaneously — compare fidelity, cost, and consensus.</p>

      <div className="bg-gray-900 rounded-lg p-4 space-y-3">
        <label className="block text-sm text-gray-400">OpenQASM 2.0</label>
        <textarea
          className="w-full h-40 bg-gray-800 text-green-400 font-mono text-sm p-3 rounded border border-gray-700 focus:outline-none focus:border-indigo-500"
          value={qasm} onChange={e => setQasm(e.target.value)}
        />
        <div className="flex items-center gap-4">
          <label className="text-sm text-gray-400">Shots</label>
          <input type="number" min={1} max={100000} value={shots}
            onChange={e => setShots(Number(e.target.value))}
            className="w-32 bg-gray-800 text-white px-3 py-1 rounded border border-gray-700" />
          <button onClick={run} disabled={loading}
            className="ml-auto px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
            {loading ? "Submitting..." : "Submit to All Providers"}
          </button>
        </div>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {([
              ["Best Fidelity", result.best_fidelity_provider],
              ["Lowest Cost", result.lowest_cost_provider],
              ["Fastest", result.fastest_provider],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label} className="bg-gray-900 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase">{label}</div>
                <div className="text-lg font-semibold text-indigo-400 mt-1">{val}</div>
              </div>
            ))}
          </div>

          <div className="bg-gray-900 rounded-lg p-4">
            <div className="text-sm text-gray-400 mb-1">Agreement Score</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-gray-700 rounded-full h-3">
                <div className="bg-indigo-500 h-3 rounded-full" style={{ width: `${result.agreement_score * 100}%` }} />
              </div>
              <span className="text-white font-mono">{(result.agreement_score * 100).toFixed(1)}%</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  {["Provider", "Backend", "Status", "Fidelity", "Cost (USD)", "Queue"].map(h => (
                    <th key={h} className="text-left py-2 px-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.jobs.map(j => (
                  <tr key={j.job_id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 px-3 font-medium">{j.provider_name}</td>
                    <td className="py-2 px-3 text-gray-400 font-mono text-xs">{j.backend}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${j.success ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono">{(j.fidelity_estimate * 100).toFixed(2)}%</td>
                    <td className="py-2 px-3 font-mono">${j.cost_usd.toFixed(4)}</td>
                    <td className="py-2 px-3 text-gray-400">{j.queue_position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
