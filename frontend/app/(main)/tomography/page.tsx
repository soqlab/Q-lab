"use client";
import { useState } from "react";
import { runTomography, TomographyJob } from "@/lib/api";

const METHODS = [
  { value: "mle", label: "MLE", desc: "Maximum Likelihood Estimation — exact but slow for large systems" },
  { value: "compressed_sensing", label: "Compressed Sensing", desc: "10–100× fewer measurements via sparsity prior" },
  { value: "shadow", label: "Shadow Tomography", desc: "Classical shadows — O(log d) measurements for local observables" },
  { value: "direct", label: "Direct Inversion", desc: "Fast linear inversion — unphysical states possible" },
];

const DEFAULT_COUNTS = JSON.stringify({ "0": 3200, "1": 1800 }, null, 2);

export default function TomographyPage() {
  const [nQubits, setNQubits] = useState(1);
  const [method, setMethod] = useState("mle");
  const [nShots, setNShots] = useState(8192);
  const [counts, setCounts] = useState(DEFAULT_COUNTS);
  const [result, setResult] = useState<TomographyJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await runTomography({ method, n_qubits: nQubits, n_shots: nShots, counts: JSON.parse(counts) });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const fidelity = result ? (result.infidelity !== null ? 1 - result.infidelity : null) : null;
  const isPure = result?.purity !== null ? (result?.purity ?? 0) > 0.99 : false;
  const isEntangled = result?.entanglement_entropy !== null ? (result?.entanglement_entropy ?? 0) > 0.01 : false;
  const dm = result?.density_matrix_real;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Quantum State Tomography</h1>
      <p className="text-gray-400">Reconstruct the density matrix of your quantum state. Supports MLE, compressed sensing (10–100× fewer measurements), and classical shadow tomography.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400">Qubits</label>
            <input type="number" min={1} max={4} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Shots</label>
            <input type="number" value={nShots} onChange={e => setNShots(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
        </div>
        <div>
          <label className="text-sm text-gray-400 mb-2 block">Method</label>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map(m => (
              <button key={m.value} onClick={() => setMethod(m.value)}
                className={`p-3 rounded-lg border text-left transition-colors ${method === m.value ? "border-indigo-500 bg-indigo-900/30" : "border-gray-700 hover:border-gray-500"}`}>
                <div className="font-medium text-sm">{m.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm text-gray-400">Measurement Counts (JSON)</label>
          <textarea value={counts} onChange={e => setCounts(e.target.value)}
            className="w-full h-28 mt-1 bg-gray-800 text-green-400 font-mono text-sm px-3 py-2 rounded border border-gray-700" />
        </div>
        <button onClick={run} disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Reconstructing..." : "Reconstruct State"}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {([
              ["Purity", result.purity !== null ? result.purity.toFixed(4) : "—", (result.purity ?? 0) > 0.99 ? "text-green-400" : (result.purity ?? 0) > 0.9 ? "text-yellow-400" : "text-red-400"],
              ["Fidelity", fidelity !== null ? `${(fidelity * 100).toFixed(2)}%` : "—", "text-indigo-400"],
              ["Entanglement", (result.entanglement_entropy ?? 0) > 0 ? `${(result.entanglement_entropy ?? 0).toFixed(3)} ebit` : "none", "text-purple-400"],
              ["Negativity", (result.negativity ?? 0) > 0 ? (result.negativity ?? 0).toFixed(4) : "0 (sep.)", (result.negativity ?? 0) > 0 ? "text-orange-400" : "text-gray-400"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} className="bg-gray-900 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">{l}</div>
                <div className={`text-lg font-mono font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="font-semibold text-sm mb-3">Density Matrix (Real part)</h2>
              {dm && dm.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="text-xs font-mono">
                    <tbody>
                      {dm.map((row, i) => (
                        <tr key={i}>
                          {(row as number[]).map((val, j) => {
                            const intensity = Math.min(1, Math.abs(val));
                            return (
                              <td key={j} className="w-12 h-12 text-center border border-gray-700"
                                style={{ background: `rgba(99,102,241,${intensity * 0.8})` }}>
                                {val.toFixed(3)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-gray-900 rounded-lg p-4 space-y-3">
              <h2 className="font-semibold text-sm">State Properties</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">State type</span> <span className={isPure ? "text-green-400" : "text-yellow-400"}>{isPure ? "Pure" : "Mixed"}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Physical</span> <span className={result.is_physical ? "text-green-400" : "text-red-400"}>{result.is_physical ? "Yes" : "No"}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Entangled</span> <span className={isEntangled ? "text-orange-400" : "text-gray-300"}>{isEntangled ? "Yes" : "No (separable)"}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Measurements used</span> <span className="font-mono text-gray-300">{result.measurements_used}</span></div>
                {result.compression_ratio > 1 && (
                  <div className="flex justify-between"><span className="text-gray-400">Compression ratio</span> <span className="font-mono text-green-400">{result.compression_ratio.toFixed(1)}×</span></div>
                )}
              </div>
              {result.bloch_vector && result.n_qubits === 1 && (
                <div className="mt-3">
                  <div className="text-xs text-gray-400 mb-2">Bloch Vector</div>
                  {(["x", "y", "z"] as const).map((ax, idx) => {
                    const v = result.bloch_vector![idx];
                    return (
                      <div key={ax} className="flex items-center gap-2 mb-1">
                        <span className="text-gray-400 font-mono w-3">{ax}</span>
                        <div className="flex-1 bg-gray-700 rounded-full h-2 relative">
                          <div className="absolute inset-y-0 left-1/2 w-px bg-gray-500" />
                          <div className="absolute top-0 h-2 bg-indigo-500 rounded-full" style={{
                            left: v >= 0 ? "50%" : `${(0.5 + v / 2) * 100}%`,
                            width: `${Math.abs(v) * 50}%`
                          }} />
                        </div>
                        <span className="font-mono text-xs text-gray-300 w-14 text-right">{v.toFixed(4)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {result.warnings && result.warnings.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-xs text-yellow-400">Warnings</div>
                  {result.warnings.map((w, i) => <div key={i} className="text-xs text-yellow-300">⚠ {w}</div>)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
