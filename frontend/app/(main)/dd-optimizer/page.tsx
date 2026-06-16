"use client";
import { useState } from "react";
import { optimizeDDSequence, DDReport, DDPulseSchedule } from "@/lib/api";

export default function DDOptimizerPage() {
  const [backend, setBackend] = useState("ibm_brisbane");
  const [noiseType, setNoiseType] = useState("1/f");
  const [t1, setT1] = useState(150.0);
  const [t2, setT2] = useState(80.0);
  const [idleTime, setIdleTime] = useState(5.0);
  const [result, setResult] = useState<DDReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await optimizeDDSequence({ backend, noise_type: noiseType, t1_us: t1, t2_us: t2 });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const t2Improvement = result ? result.estimated_t2_with_dd / Math.max(result.estimated_t2_without_dd, 0.001) : 1;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Dynamical Decoupling Optimizer</h1>
      <p className="text-gray-400">Compare all DD sequences (Hahn, CPMG, XY-4, XY-8, KDD, UDD, CDD) for your hardware and noise profile. Get the optimal sequence and predicted T2 improvement.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-gray-400">Backend</label>
            <select value={backend} onChange={e => setBackend(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {["ibm_brisbane", "ibm_kyoto", "ionq_aria_1", "rigetti_ankaa_2"].map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Noise Type</label>
            <select value={noiseType} onChange={e => setNoiseType(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {["1/f", "white", "telegraph", "mixed"].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">T1 (μs)</label>
            <input type="number" step="any" value={t1} onChange={e => setT1(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">T2 (μs)</label>
            <input type="number" step="any" value={t2} onChange={e => setT2(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Idle Time (μs)</label>
            <input type="number" step="any" value={idleTime} onChange={e => setIdleTime(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Optimizing..." : "Compare All Sequences"}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="bg-indigo-900/30 border border-indigo-700 rounded-lg p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-indigo-400 uppercase mb-1">Optimal Sequence</div>
              <div className="text-2xl font-bold text-white">{result.recommended_sequence.toUpperCase()}</div>
              <div className="text-sm text-gray-400 mt-1">{result.reason}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400">T2 improvement</div>
              <div className="text-3xl font-mono font-bold text-green-400">{t2Improvement.toFixed(2)}×</div>
              <div className="text-xs text-gray-500">{result.estimated_t2_without_dd.toFixed(1)} → {result.estimated_t2_with_dd.toFixed(1)} μs</div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-5">
            <h2 className="font-semibold text-sm mb-4">Sequence Comparison</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-700">
                    <th className="text-left py-2 pr-4">Sequence</th>
                    <th className="text-right pr-4">T2 Improv.</th>
                    <th className="text-right pr-4">T1 Improv.</th>
                    <th className="text-right pr-4">Gate Overhead</th>
                    <th className="text-right pr-4">Time OH%</th>
                    <th className="text-right pr-4">Fidelity +%</th>
                  </tr>
                </thead>
                <tbody>
                  {result.sequences.sort((a: DDPulseSchedule, b: DDPulseSchedule) => b.t2_improvement_factor - a.t2_improvement_factor).map((seq: DDPulseSchedule) => (
                    <tr key={seq.sequence_type} className={`border-b border-gray-800 ${seq.sequence_type === result.recommended_sequence ? "bg-indigo-900/20" : ""}`}>
                      <td className="py-2 pr-4 font-mono font-medium">
                        {seq.sequence_type === result.recommended_sequence && <span className="text-indigo-400 mr-1">★</span>}
                        {seq.sequence_type.toUpperCase()}
                      </td>
                      <td className="text-right pr-4 font-mono">
                        <span className={seq.t2_improvement_factor > 1.5 ? "text-green-400" : seq.t2_improvement_factor > 1.1 ? "text-yellow-400" : "text-gray-400"}>
                          {seq.t2_improvement_factor.toFixed(2)}×
                        </span>
                      </td>
                      <td className="text-right pr-4 font-mono text-blue-400">{seq.t1_improvement_factor.toFixed(2)}×</td>
                      <td className="text-right pr-4 font-mono text-gray-400">{seq.gate_overhead}×</td>
                      <td className="text-right pr-4 font-mono text-gray-400">{seq.time_overhead_pct.toFixed(0)}%</td>
                      <td className="text-right pr-4 font-mono text-indigo-400">+{seq.fidelity_improvement_pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.sequences.length > 0 && result.sequences[0].pulses.length > 0 && (
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="font-semibold text-sm mb-3">Optimal Pulse Sequence ({result.recommended_sequence.toUpperCase()})</h2>
              <div className="flex gap-1 items-center flex-wrap">
                {result.sequences.find((s: DDPulseSchedule) => s.sequence_type === result.recommended_sequence)?.pulses.map((pulse: string, i: number) => (
                  <span key={i} className={`px-2 py-1 rounded text-xs font-mono ${pulse === "wait" ? "bg-gray-700 text-gray-400" : pulse.includes("X") ? "bg-blue-700 text-blue-200" : pulse.includes("Y") ? "bg-purple-700 text-purple-200" : "bg-indigo-700 text-indigo-200"}`}>
                    {pulse}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
