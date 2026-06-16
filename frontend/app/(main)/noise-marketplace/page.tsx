"use client";
import { useState, useEffect } from "react";
import { listNoiseModels, getNoiseModel, applyNoiseModel, NoiseMarketplaceModel } from "@/lib/api";

export default function NoiseMarketplacePage() {
  const [models, setModels] = useState<NoiseMarketplaceModel[]>([]);
  const [selected, setSelected] = useState<NoiseMarketplaceModel | null>(null);
  const [applyResult, setApplyResult] = useState<{ fidelity_degradation: number; ideal_counts: Record<string, number>; noisy_counts: Record<string, number>; noise_method: string } | null>(null);
  const [qasm, setQasm] = useState('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [snippetTab, setSnippetTab] = useState<"qiskit" | "pennylane" | "qasm">("qiskit");
  const [sortBy, setSortBy] = useState("downloads");

  useEffect(() => { load(); }, [sortBy]);

  async function load() {
    setLoading(true);
    try {
      const r = await listNoiseModels({ sort_by: sortBy });
      setModels(r.models);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function selectModel(id: string) {
    try {
      const m = await getNoiseModel(id);
      setSelected(m); setApplyResult(null);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function apply() {
    if (!selected) return;
    setLoading(true); setError("");
    try {
      const r = await applyNoiseModel({ model_id: selected.model_id, circuit_qasm: qasm });
      setApplyResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Noise Model Marketplace</h1>
      <p className="text-gray-400">Browse, download, and apply community-contributed noise models for realistic quantum simulation.</p>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      <div className="flex gap-3 items-center">
        <span className="text-sm text-gray-400">Sort:</span>
        {(["downloads", "stars"] as const).map(s => (
          <button key={s} onClick={() => setSortBy(s)}
            className={`px-3 py-1 rounded text-sm ${sortBy === s ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400"}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          {models.map(m => (
            <div key={m.model_id}
              onClick={() => selectModel(m.model_id)}
              className={`bg-gray-900 rounded-lg p-4 cursor-pointer border transition-colors ${selected?.model_id === m.model_id ? "border-indigo-500" : "border-transparent hover:border-gray-600"}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-sm">{m.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{m.backend} · {m.n_qubits}q · {m.model_type}</div>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <div>{m.downloads.toLocaleString()} ↓</div>
                  <div>★ {m.stars}</div>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2 line-clamp-2">{m.description}</p>
              <div className="flex gap-1 mt-2 flex-wrap">
                {m.tags.map(t => <span key={t} className="text-xs bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">{t}</span>)}
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div className="bg-gray-900 rounded-lg p-5 space-y-4 sticky top-6">
            <h2 className="font-semibold">{selected.name}</h2>
            <p className="text-sm text-gray-400">{selected.description}</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Author:</span> {selected.author}</div>
              <div><span className="text-gray-500">Fidelity Err:</span> {selected.fidelity_error}</div>
              <div><span className="text-gray-500">Institution:</span> {selected.institution}</div>
              <div><span className="text-gray-500">Captured:</span> {selected.date_captured}</div>
            </div>

            <div className="flex border-b border-gray-700">
              {(["qiskit", "pennylane", "qasm"] as const).map(t => (
                <button key={t} onClick={() => setSnippetTab(t)}
                  className={`px-3 py-2 text-xs ${snippetTab === t ? "border-b-2 border-indigo-500 text-indigo-400" : "text-gray-500"}`}>
                  {t}
                </button>
              ))}
            </div>
            <pre className="text-xs text-green-400 bg-black rounded p-3 overflow-x-auto max-h-40">
              {snippetTab === "qiskit" ? selected.qiskit_snippet : snippetTab === "pennylane" ? selected.pennylane_snippet : selected.qasm_snippet}
            </pre>

            <div>
              <label className="text-xs text-gray-400">Test Circuit (QASM)</label>
              <textarea value={qasm} onChange={e => setQasm(e.target.value)}
                className="w-full h-24 mt-1 bg-black text-green-400 font-mono text-xs px-3 py-2 rounded border border-gray-700" />
            </div>
            <button onClick={apply} disabled={loading}
              className="w-full py-2 bg-purple-700 hover:bg-purple-600 rounded font-medium text-sm disabled:opacity-50">
              {loading ? "Applying..." : "Apply Noise Model"}
            </button>

            {applyResult && (
              <div className="space-y-3">
                <div className="flex gap-4 text-sm">
                  <div><span className="text-gray-500">Fidelity loss:</span> <span className="text-red-400 font-mono">{(applyResult.fidelity_degradation * 100).toFixed(2)}%</span></div>
                  <div><span className="text-gray-500">Method:</span> {applyResult.noise_method}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(["ideal_counts", "noisy_counts"] as const).map(k => (
                    <div key={k} className="bg-gray-800 rounded p-3">
                      <div className="text-xs text-gray-500 mb-2">{k === "ideal_counts" ? "Ideal" : "Noisy"}</div>
                      {Object.entries(applyResult[k]).slice(0, 4).map(([state, count]) => (
                        <div key={state} className="flex justify-between text-xs font-mono">
                          <span>{state}</span><span>{count}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
