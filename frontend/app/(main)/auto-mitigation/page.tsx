"use client";

import { useState } from "react";
import {
  selectMitigation,
  applyMitigationStrategy,
  MitigationRecommendation,
  MitigationApplication,
} from "@/lib/api";

type FormState = {
  n_qubits: number;
  circuit_depth: number;
  backend: string;
  budget_overhead: number;
  target_fidelity: number;
};

export default function AutoMitigationPage() {
  const [form, setForm] = useState<FormState>({
    n_qubits: 8,
    circuit_depth: 50,
    backend: "ibm_brisbane",
    budget_overhead: 3.0,
    target_fidelity: 0.9,
  });

  const [rec, setRec] = useState<MitigationRecommendation | null>(null);
  const [applied, setApplied] = useState<MitigationApplication | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function handleSelect() {
    setError(null);
    setLoading(true);
    setRec(null);
    setApplied(null);
    try {
      const result = await selectMitigation({
        n_qubits: form.n_qubits,
        circuit_depth: form.circuit_depth,
        backend: form.backend,
        budget_overhead: form.budget_overhead,
        target_fidelity: form.target_fidelity,
      });
      setRec(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Selection failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!rec) return;
    setApplyError(null);
    setApplying(true);
    try {
      const result = await applyMitigationStrategy({
        recommendation_id: rec.recommendation_id,
        circuit_counts: { "0": 850, "1": 150 },
      });
      setApplied(result);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  }

  const maxContrib = applied
    ? Math.max(...Object.values(applied.technique_contributions), 0.001)
    : 1;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-2xl font-bold mb-1">Auto-Mitigation Selector</h1>
      <p className="text-gray-400 text-sm mb-6">
        ML-driven selection of optimal error-mitigation strategy combinations.
      </p>

      <div className="flex gap-6">
        {/* ── Left: Form ── */}
        <div className="w-72 shrink-0">
          <div className="bg-gray-800 rounded-xl p-4 space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Backend</label>
              <select
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                value={form.backend}
                onChange={(e) => setForm((f) => ({ ...f, backend: e.target.value }))}
              >
                <option value="ibm_brisbane">ibm_brisbane</option>
                <option value="ibm_kyoto">ibm_kyoto</option>
                <option value="ionq_aria_1">ionq_aria_1</option>
                <option value="quantinuum_h2">quantinuum_h2</option>
              </select>
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">Qubits</label>
                <input
                  type="number"
                  min={1}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={form.n_qubits}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, n_qubits: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">Depth</label>
                <input
                  type="number"
                  min={1}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={form.circuit_depth}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, circuit_depth: Number(e.target.value) }))
                  }
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Budget overhead: {form.budget_overhead.toFixed(1)}x
              </label>
              <input
                type="range"
                min={1.0}
                max={10.0}
                step={0.1}
                className="w-full accent-indigo-500"
                value={form.budget_overhead}
                onChange={(e) =>
                  setForm((f) => ({ ...f, budget_overhead: Number(e.target.value) }))
                }
              />
              <div className="flex justify-between text-xs text-gray-500 mt-0.5">
                <span>1.0x</span>
                <span>10.0x</span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Target fidelity: {form.target_fidelity.toFixed(2)}
              </label>
              <input
                type="range"
                min={0.8}
                max={0.99}
                step={0.01}
                className="w-full accent-indigo-500"
                value={form.target_fidelity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, target_fidelity: Number(e.target.value) }))
                }
              />
              <div className="flex justify-between text-xs text-gray-500 mt-0.5">
                <span>0.80</span>
                <span>0.99</span>
              </div>
            </div>

            <button
              onClick={handleSelect}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? "Selecting…" : "Select Mitigation"}
            </button>

            {error && <p className="text-red-400 text-xs">{error}</p>}
          </div>
        </div>

        {/* ── Right: Results ── */}
        <div className="flex-1 space-y-5">
          {!rec && !loading && (
            <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
              Configure parameters and click Select Mitigation.
            </div>
          )}

          {rec && (
            <>
              {/* Strategy card */}
              <div className="bg-gray-800 rounded-xl p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-2xl font-bold text-indigo-300">
                      {rec.strategy}
                    </div>
                    <div className="text-sm text-gray-400 mt-0.5">
                      Recommended strategy
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-green-400">
                      {Math.round(rec.predicted_fidelity * 100)}%
                    </div>
                    <div className="text-xs text-gray-400">predicted fidelity</div>
                  </div>
                </div>

                {/* Confidence bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Confidence</span>
                    <span>{Math.round(rec.confidence * 100)}%</span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full"
                      style={{ width: `${rec.confidence * 100}%` }}
                    />
                  </div>
                </div>

                {/* Overhead */}
                <div className="text-sm text-gray-300 mb-4">
                  Combined overhead:{" "}
                  <span className="text-yellow-300 font-semibold">
                    {rec.combined_overhead.toFixed(2)}x
                  </span>
                </div>

                {/* Reasoning */}
                <p className="text-sm text-gray-300 bg-gray-900 rounded-lg p-3">
                  {rec.reasoning}
                </p>
              </div>

              {/* Techniques list */}
              <div className="bg-gray-800 rounded-xl p-5">
                <h3 className="font-semibold text-gray-200 mb-3">Techniques</h3>
                <div className="space-y-3">
                  {rec.techniques.map((t, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 bg-gray-900 rounded-lg p-3"
                    >
                      <span className="w-6 h-6 rounded-full bg-indigo-700 text-indigo-200 text-xs font-bold flex items-center justify-center shrink-0">
                        {t.order}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-white truncate">
                          {t.name}
                        </div>
                        <div className="text-xs text-gray-400">
                          Overhead: {t.overhead.toFixed(2)}x
                        </div>
                      </div>
                      <span className="text-green-400 text-sm font-semibold shrink-0">
                        +{(t.expected_improvement * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Alternatives table */}
              {rec.alternatives.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-5">
                  <h3 className="font-semibold text-gray-200 mb-3">
                    Alternative Strategies
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 text-xs border-b border-gray-700">
                        <th className="text-left pb-2">Strategy</th>
                        <th className="text-right pb-2">Fidelity</th>
                        <th className="text-right pb-2">Overhead</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.alternatives.map((alt, i) => (
                        <tr
                          key={i}
                          className="border-b border-gray-700 last:border-0"
                        >
                          <td className="py-2 text-gray-300">{alt.strategy}</td>
                          <td className="py-2 text-right text-white">
                            {Math.round(alt.fidelity * 100)}%
                          </td>
                          <td className="py-2 text-right text-yellow-300">
                            {alt.overhead.toFixed(2)}x
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Apply button */}
              <div className="bg-gray-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-200">
                    Apply to Sample Counts
                  </h3>
                  <button
                    onClick={handleApply}
                    disabled={applying}
                    className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
                  >
                    {applying ? "Applying…" : "Apply"}
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  Uses circuit_counts = &#123;&quot;0&quot;: 850, &quot;1&quot;: 150&#125;
                </p>
                {applyError && (
                  <p className="text-red-400 text-xs mt-2">{applyError}</p>
                )}

                {applied && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-gray-900 rounded-lg p-3">
                        <div className="text-xl font-bold text-green-400">
                          {applied.mitigated_value.toFixed(4)}
                        </div>
                        <div className="text-xs text-gray-400">Mitigated</div>
                      </div>
                      <div className="bg-gray-900 rounded-lg p-3">
                        <div className="text-xl font-bold text-gray-300">
                          {applied.raw_value.toFixed(4)}
                        </div>
                        <div className="text-xs text-gray-400">Raw</div>
                      </div>
                      <div className="bg-gray-900 rounded-lg p-3">
                        <div className="text-xl font-bold text-indigo-400">
                          +{(applied.improvement_pct * 100).toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-400">Improvement</div>
                      </div>
                    </div>

                    {/* Technique contributions bar chart */}
                    <div className="bg-gray-900 rounded-lg p-3">
                      <p className="text-xs text-gray-400 mb-3">
                        Technique Contributions
                      </p>
                      <div className="space-y-2">
                        {Object.entries(applied.technique_contributions).map(
                          ([name, val]) => (
                            <div key={name}>
                              <div className="flex justify-between text-xs text-gray-300 mb-0.5">
                                <span>{name}</span>
                                <span>{(val * 100).toFixed(1)}%</span>
                              </div>
                              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-indigo-500 rounded-full"
                                  style={{
                                    width: `${(val / maxContrib) * 100}%`,
                                  }}
                                />
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
