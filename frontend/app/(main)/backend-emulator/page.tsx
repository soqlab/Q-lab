"use client";
import { useState } from "react";
import { emulateOnBackend, EmulationJob } from "@/lib/api";

const BACKENDS = ["ibm_brisbane", "ibm_kyoto", "ibm_osaka", "ionq_aria_1", "ionq_forte_1", "rigetti_ankaa_2", "quantinuum_h2", "aws_sv1"];

export default function BackendEmulatorPage() {
  const [source, setSource] = useState("ibm_brisbane");
  const [target, setTarget] = useState("ionq_aria_1");
  const [nQubits, setNQubits] = useState(5);
  const [depth, setDepth] = useState(30);
  const [nShots, setNShots] = useState(8192);
  const [result, setResult] = useState<EmulationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (source === target) { setError("Source and target backends must be different"); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await emulateOnBackend({ source_backend: source, target_backend: target, n_qubits: nQubits, circuit_depth: depth, n_shots: nShots });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Cross-Backend Emulator</h1>
      <p className="text-gray-400">Predict how your circuit will perform when moved from one hardware platform to another. Accounts for gate set, connectivity, noise profile, and SWAP overhead.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400">Source Backend (currently calibrated on)</label>
            <select value={source} onChange={e => setSource(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Target Backend (emulate performance)</label>
            <select value={target} onChange={e => setTarget(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Qubits</label>
            <input type="number" min={1} max={30} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Circuit Depth</label>
            <input type="number" min={1} value={depth} onChange={e => setDepth(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Shots</label>
            <input type="number" value={nShots} onChange={e => setNShots(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Emulating..." : "Emulate on Target"}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-lg p-5">
              <h2 className="font-semibold text-sm mb-4 text-blue-400">{source}</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Fidelity</span><span className="font-mono text-white">{(result.source_fidelity * 100).toFixed(3)}%</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Depth</span><span className="font-mono">{result.circuit_depth}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Qubits</span><span className="font-mono">{result.n_qubits}</span></div>
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg p-5">
              <h2 className="font-semibold text-sm mb-4 text-purple-400">{target} (emulated)</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Fidelity</span>
                  <span className={`font-mono ${result.emulated_fidelity >= result.source_fidelity ? "text-green-400" : "text-red-400"}`}>
                    {(result.emulated_fidelity * 100).toFixed(3)}%
                  </span>
                </div>
                <div className="flex justify-between"><span className="text-gray-400">SWAP overhead</span><span className="font-mono text-yellow-400">{result.swap_overhead.toFixed(2)}×</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Connectivity penalty</span><span className="font-mono text-orange-400">{(result.connectivity_penalty * 100).toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Agreement</span><span className="font-mono">{(result.cross_backend_agreement * 100).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Confidence</span><span className="font-mono">{(result.confidence * 100).toFixed(1)}%</span></div>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-5">
            <h2 className="font-semibold text-sm mb-4">Fidelity Delta</h2>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{source}</span><span>{(result.source_fidelity * 100).toFixed(2)}%</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-3">
                  <div className="bg-blue-500 h-3 rounded-full" style={{ width: `${result.source_fidelity * 100}%` }} />
                </div>
              </div>
              <div className="text-lg font-bold" style={{ color: result.fidelity_delta >= 0 ? "#4ade80" : "#f87171" }}>
                {result.fidelity_delta >= 0 ? "+" : ""}{(result.fidelity_delta * 100).toFixed(3)}%
              </div>
              <div className="flex-1">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{target}</span><span>{(result.emulated_fidelity * 100).toFixed(2)}%</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-3">
                  <div className="bg-purple-500 h-3 rounded-full" style={{ width: `${result.emulated_fidelity * 100}%` }} />
                </div>
              </div>
            </div>
          </div>

          {result.warnings && result.warnings.length > 0 && (
            <div className="space-y-2">
              {result.warnings.map((w, i) => (
                <div key={i} className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 text-sm text-yellow-300">⚠ {w}</div>
              ))}
            </div>
          )}

          {result.noise_model_mapping && Object.keys(result.noise_model_mapping).length > 0 && (
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="font-semibold text-sm mb-3">Noise Model Mapping</h2>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(result.noise_model_mapping).map(([k, v]) => (
                  <div key={k} className="bg-gray-800 rounded p-2 text-sm">
                    <div className="text-xs text-gray-400">{k}</div>
                    <div className="font-mono text-indigo-300">{typeof v === "number" ? v.toFixed(4) : String(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
