"use client";
import { useState } from "react";
import { runMitigation, MitigationJob } from "@/lib/api";

const METHODS = [
  { value: "zne_richardson", label: "ZNE Richardson", desc: "Zero-noise extrapolation — extrapolates to λ=0 from scaled noise points" },
  { value: "zne_exponential", label: "ZNE Exponential", desc: "Exponential fit — better for deep circuits with large noise" },
  { value: "pec", label: "PEC", desc: "Probabilistic Error Cancellation — quasi-probability decomposition" },
  { value: "cdr", label: "CDR", desc: "Clifford Data Regression — trains linear model on Clifford circuits" },
  { value: "m3", label: "M3", desc: "Matrix-free Measurement Mitigation — efficient readout correction" },
  { value: "symmetry", label: "Symmetry Verification", desc: "Post-selects on symmetry sector — no overhead but some shot waste" },
];

export default function ZnePecPage() {
  const [method, setMethod] = useState("zne_richardson");
  const [nQubits, setNQubits] = useState(5);
  const [depth, setDepth] = useState(20);
  const [noiseModel, setNoiseModel] = useState("depolarizing");
  const [noiseFactors, setNoiseFactors] = useState("1.0, 1.5, 2.0, 2.5, 3.0");
  const [result, setResult] = useState<MitigationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const factors = noiseFactors.split(",").map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
      const r = await runMitigation({ method, n_qubits: nQubits, circuit_depth: depth, backend: noiseModel, noise_factors: factors });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">ZNE / PEC Error Mitigation</h1>
      <p className="text-gray-400">Apply Zero-Noise Extrapolation, Probabilistic Error Cancellation, or other advanced mitigation methods to recover near-ideal expectation values from noisy hardware.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-2 mb-2">
          {METHODS.map(m => (
            <button key={m.value} onClick={() => setMethod(m.value)}
              className={`p-3 rounded-lg border text-left text-sm transition-colors ${method === m.value ? "border-indigo-500 bg-indigo-900/30" : "border-gray-700 hover:border-gray-500"}`}>
              <div className="font-medium">{m.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{m.desc}</div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-gray-400">Qubits</label>
            <input type="number" min={1} max={20} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Circuit Depth</label>
            <input type="number" min={1} value={depth} onChange={e => setDepth(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Noise Model (backend)</label>
            <select value={noiseModel} onChange={e => setNoiseModel(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {["depolarizing", "thermal_relaxation", "ibm_brisbane", "ionq_aria_1"].map(n => (
                <option key={n} value={n}>{n.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <label className="text-sm text-gray-400">Noise Scale Factors (comma-separated)</label>
            <input value={noiseFactors} onChange={e => setNoiseFactors(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white font-mono px-3 py-2 rounded border border-gray-700" />
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Mitigating..." : "Run Mitigation"}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {([
              ["Noisy Value", result.noisy_value.toFixed(6), "text-red-400"],
              ["Mitigated Value", result.mitigated_value.toFixed(6), "text-green-400"],
              ["True Estimate", result.estimated_true_value.toFixed(6), "text-indigo-400"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} className="bg-gray-900 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">{l}</div>
                <div className={`text-xl font-mono font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          <div className="bg-gray-900 rounded-lg p-5">
            <h2 className="font-semibold text-sm mb-4">Mitigation Performance</h2>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Overhead factor</span>
                  <span className="font-mono text-yellow-400">{result.mitigation_overhead.toFixed(2)}×</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2.5">
                  <div className="bg-yellow-500 h-2.5 rounded-full" style={{ width: `${Math.min(100, (result.mitigation_overhead - 1) * 20)}%` }} />
                </div>
              </div>
              {result.confidence_interval && result.confidence_interval.length === 2 && (
                <div className="text-sm text-gray-400">
                  95% CI: [{result.confidence_interval[0].toFixed(6)}, {result.confidence_interval[1].toFixed(6)}]
                </div>
              )}
            </div>

            {result.zne && result.zne.noise_factors.length > 0 && (
              <div className="mt-5">
                <h3 className="text-xs text-gray-400 mb-3 uppercase">ZNE Extrapolation Curve (R² = {result.zne.r_squared.toFixed(3)})</h3>
                <div className="flex items-end gap-2 h-24 bg-gray-800 rounded p-2">
                  {result.zne.noise_factors.map((lam, i) => {
                    const vals = result.zne!.raw_values;
                    const mn = Math.min(...vals); const mx = Math.max(...vals);
                    const pct = mx === mn ? 50 : ((vals[i] - mn) / (mx - mn)) * 100;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full bg-indigo-500 rounded-t" style={{ height: `${Math.max(4, pct)}%` }} />
                        <div className="text-xs font-mono text-gray-500">λ={lam}</div>
                      </div>
                    );
                  })}
                  <div className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-green-400 rounded-t opacity-70" style={{ height: "10%" }} title="λ=0 extrapolated" />
                    <div className="text-xs font-mono text-green-400">λ=0*</div>
                  </div>
                </div>
              </div>
            )}
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
