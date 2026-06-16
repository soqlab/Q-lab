"use client";
import { useState } from "react";
import { estimateProviderCost, getCostHistory, CostEstimateResult } from "@/lib/api";

export default function CostOraclePage() {
  const [nQubits, setNQubits] = useState(5);
  const [depth, setDepth] = useState(20);
  const [shots, setShots] = useState(8192);
  const [nCircuits, setNCircuits] = useState(10);
  const [result, setResult] = useState<CostEstimateResult | null>(null);
  const [history, setHistory] = useState<{ history: object[]; total_usd: number; by_provider: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function estimate() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await estimateProviderCost({ n_qubits: nQubits, circuit_depth: depth, n_shots: shots, n_circuits: nCircuits });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function loadHistory() {
    try {
      const h = await getCostHistory();
      setHistory(h);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Cost Oracle</h1>
      <p className="text-gray-400">Estimate and compare quantum cloud execution costs across providers before submitting jobs.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {([
            ["Qubits", nQubits, setNQubits, 1, 500, 1],
            ["Circuit Depth", depth, setDepth, 1, 10000, 1],
            ["Shots", shots, setShots, 100, 100000, 100],
            ["# Circuits", nCircuits, setNCircuits, 1, 1000, 1],
          ] as [string, number, (n: number) => void, number, number, number][]).map(([label, val, set, min, max, step]) => (
            <div key={label}>
              <label className="text-sm text-gray-400">{label}</label>
              <input type="number" min={min} max={max} step={step} value={val}
                onChange={e => set(Number(e.target.value))}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={estimate} disabled={loading}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
            {loading ? "Estimating..." : "Estimate Cost"}
          </button>
          <button onClick={loadHistory}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
            View Spend History
          </button>
        </div>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-green-900/30 rounded-lg p-4 border border-green-700">
              <div className="text-xs text-green-400 uppercase mb-1">Cheapest Option</div>
              <div className="text-xl font-bold text-green-300">{result.cheapest_provider}</div>
              <div className="text-2xl font-mono text-green-400">${result.cheapest_cost_usd.toFixed(4)}</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="text-xs text-gray-400 uppercase mb-1">All Providers Total</div>
              <div className="text-2xl font-mono text-white">${result.total_if_all_providers_usd.toFixed(2)}</div>
              <div className="text-xs text-gray-500 mt-1">{result.n_shots.toLocaleString()} shots × {result.n_circuits} circuits</div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                  {["Provider", "Cost/Circuit", "Total", "Queue (min)", "Free Tier"].map(h => (
                    <th key={h} className="text-left py-3 px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.providers.map((p, i) => (
                  <tr key={p.provider_id} className={`border-b border-gray-800 ${i === 0 ? "bg-green-900/10" : ""}`}>
                    <td className="py-2 px-4 font-medium">{p.provider_name}</td>
                    <td className="py-2 px-4 font-mono">${p.cost_per_circuit_usd.toFixed(5)}</td>
                    <td className="py-2 px-4 font-mono font-semibold">${p.cost_total_usd.toFixed(4)}</td>
                    <td className="py-2 px-4 text-gray-400">{p.estimated_queue_min}</td>
                    <td className="py-2 px-4">{p.free_tier ? <span className="text-green-400">Yes</span> : <span className="text-gray-600">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.recommendations.length > 0 && (
            <div className="bg-yellow-900/20 rounded-lg p-4 space-y-1">
              {result.recommendations.map((r, i) => (
                <div key={i} className="text-yellow-300 text-sm">• {r}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {history && (
        <div className="bg-gray-900 rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">Spend History</h2>
          <div className="text-2xl font-mono text-indigo-400">${history.total_usd.toFixed(4)} total</div>
          <div className="space-y-2">
            {Object.entries(history.by_provider).map(([provider, cost]) => (
              <div key={provider} className="flex items-center gap-3">
                <span className="text-sm text-gray-400 w-32">{provider}</span>
                <div className="flex-1 bg-gray-700 rounded-full h-2">
                  <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${(cost / Math.max(history.total_usd, 0.0001)) * 100}%` }} />
                </div>
                <span className="font-mono text-sm">${(cost as number).toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
