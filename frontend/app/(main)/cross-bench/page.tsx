"use client";
import { useState, useEffect } from "react";
import { listBenchmarks, compareToBenchmark, CrossBenchResult } from "@/lib/api";

export default function CrossBenchPage() {
  const [benchmarks, setBenchmarks] = useState<{ benchmark_id: string; name: string; metric: string; description: string; higher_is_better: boolean; sota_value: number }[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [yourValue, setYourValue] = useState("");
  const [nQubits, setNQubits] = useState(5);
  const [backend, setBackend] = useState("ibm_brisbane");
  const [result, setResult] = useState<CrossBenchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listBenchmarks()
      .then(r => {
        const bs = r.benchmarks as { benchmark_id: string; name: string; metric: string; description: string; higher_is_better: boolean; sota_value: number }[];
        setBenchmarks(bs);
        if (bs.length) setSelectedId(bs[0].benchmark_id);
      })
      .catch(e => setError(String(e)));
  }, []);

  async function compare() {
    if (!selectedId || !yourValue) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await compareToBenchmark({ benchmark_id: selectedId, your_value: Number(yourValue), n_qubits: nQubits, backend });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const selected = benchmarks.find(b => b.benchmark_id === selectedId);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Cross-Lab Benchmarking</h1>
      <p className="text-gray-400">Compare your results against published state-of-the-art benchmarks, classical bounds, and the community leaderboard.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div>
          <label className="text-sm text-gray-400">Benchmark</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
            {benchmarks.map(b => <option key={b.benchmark_id} value={b.benchmark_id}>{b.name}</option>)}
          </select>
          {selected && <p className="text-xs text-gray-500 mt-1">{selected.description} · Metric: {selected.metric} · SoTA: {selected.sota_value}</p>}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-gray-400">Your Value ({selected?.metric ?? "metric"})</label>
            <input type="number" value={yourValue} onChange={e => setYourValue(e.target.value)} step="any"
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Qubits</label>
            <input type="number" value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Backend</label>
            <input value={backend} onChange={e => setBackend(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
        </div>

        <button onClick={compare} disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Comparing..." : "Compare to SoTA"}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className={`rounded-lg p-5 text-center ${result.beats_sota ? "bg-yellow-900/30 border border-yellow-600" : result.beats_classical ? "bg-green-900/30 border border-green-700" : "bg-gray-900"}`}>
            <div className="text-2xl font-bold mb-1">{result.verdict}</div>
            <div className="text-gray-400 text-sm">Rank #{result.rank} of {result.total_entries} · {result.your_percentile.toFixed(1)}th percentile</div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {([
              ["Your Value", result.your_value.toFixed(4)],
              ["SoTA", result.sota_value.toFixed(4)],
              ["Gap to SoTA", `${result.gap_to_sota_pct.toFixed(1)}%`],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label} className="bg-gray-900 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">{label}</div>
                <div className="text-lg font-mono font-semibold">{val}</div>
              </div>
            ))}
          </div>

          <div className="bg-gray-900 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 font-medium">Leaderboard</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  {["#", "Label", "Value", "Qubits", "Backend", "Year"].map(h => <th key={h} className="text-left py-2 px-4">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.all_entries.map((e, i) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 px-4 text-gray-500">{i + 1}</td>
                    <td className="py-2 px-4">{e.label}</td>
                    <td className="py-2 px-4 font-mono">{e.value}</td>
                    <td className="py-2 px-4">{e.n_qubits}</td>
                    <td className="py-2 px-4 text-gray-400 text-xs">{e.backend}</td>
                    <td className="py-2 px-4 text-gray-500">{e.year}</td>
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
