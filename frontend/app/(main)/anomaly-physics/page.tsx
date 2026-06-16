"use client";

import { useState } from "react";
import {
  checkPhysicsConstraints,
  compareToLiterature,
  PhysicsCheck,
  LiteratureComparison,
} from "@/lib/api";

type Tab = "physics" | "literature";

type PhysicsForm = {
  t1_us: string;
  t2_us: string;
  gate_fidelity: string;
  readout_fidelity: string;
  fidelity: string;
  backend: string;
  n_qubits: string;
};

type LitForm = {
  metric: string;
  value: string;
  backend: string;
  n_qubits: string;
  algorithm: string;
};

function parseOptFloat(v: string): number | undefined {
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

function parseOptInt(v: string): number | undefined {
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

function GaugeFill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.8
      ? "bg-green-500"
      : value >= 0.5
      ? "bg-yellow-500"
      : "bg-red-500";
  return (
    <div className="flex flex-col items-center">
      <div className="text-4xl font-bold mb-2" style={{ color: "inherit" }}>
        {pct}
      </div>
      <div className="w-40 h-4 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-gray-400 mt-1">Physics Score</div>
    </div>
  );
}

export default function AnomalyPhysicsPage() {
  const [tab, setTab] = useState<Tab>("physics");

  // Physics check state
  const [physForm, setPhysForm] = useState<PhysicsForm>({
    t1_us: "",
    t2_us: "",
    gate_fidelity: "",
    readout_fidelity: "",
    fidelity: "",
    backend: "ibm_brisbane",
    n_qubits: "",
  });
  const [physResult, setPhysResult] = useState<PhysicsCheck | null>(null);
  const [physLoading, setPhysLoading] = useState(false);
  const [physError, setPhysError] = useState<string | null>(null);

  // Literature compare state
  const [litForm, setLitForm] = useState<LitForm>({
    metric: "fidelity",
    value: "",
    backend: "ibm_brisbane",
    n_qubits: "",
    algorithm: "",
  });
  const [litResult, setLitResult] = useState<LiteratureComparison | null>(null);
  const [litLoading, setLitLoading] = useState(false);
  const [litError, setLitError] = useState<string | null>(null);

  async function handlePhysicsCheck() {
    setPhysError(null);
    setPhysLoading(true);
    setPhysResult(null);
    try {
      const res = await checkPhysicsConstraints({
        t1_us: parseOptFloat(physForm.t1_us),
        t2_us: parseOptFloat(physForm.t2_us),
        gate_fidelity: parseOptFloat(physForm.gate_fidelity),
        readout_fidelity: parseOptFloat(physForm.readout_fidelity),
        fidelity: parseOptFloat(physForm.fidelity),
        backend: physForm.backend || undefined,
        n_qubits: parseOptInt(physForm.n_qubits),
      });
      setPhysResult(res);
    } catch (e) {
      setPhysError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setPhysLoading(false);
    }
  }

  async function handleLitCompare() {
    setLitError(null);
    setLitLoading(true);
    setLitResult(null);
    try {
      const res = await compareToLiterature({
        metric: litForm.metric,
        value: parseFloat(litForm.value),
        backend: litForm.backend,
        n_qubits: parseInt(litForm.n_qubits, 10),
        algorithm: litForm.algorithm,
      });
      setLitResult(res);
    } catch (e) {
      setLitError(e instanceof Error ? e.message : "Compare failed");
    } finally {
      setLitLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-2xl font-bold mb-1">Anomaly Physics Engine</h1>
      <p className="text-gray-400 text-sm mb-6">
        Validate experimental results against known quantum physics constraints
        and published literature.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit mb-6">
        {(["physics", "literature"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t
                ? "bg-indigo-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t === "physics" ? "Physics Check" : "Literature Compare"}
          </button>
        ))}
      </div>

      {/* ── Physics Check Tab ── */}
      {tab === "physics" && (
        <div className="flex gap-6">
          <div className="w-72 shrink-0">
            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-xs text-gray-400">
                Leave fields blank to skip those constraints.
              </p>

              {(
                [
                  ["T1 (µs)", "t1_us"],
                  ["T2 (µs)", "t2_us"],
                  ["Gate fidelity", "gate_fidelity"],
                  ["Readout fidelity", "readout_fidelity"],
                  ["Fidelity", "fidelity"],
                  ["Qubits", "n_qubits"],
                ] as [string, keyof PhysicsForm][]
              ).map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-400 mb-1">
                    {label}
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    placeholder="optional"
                    value={physForm[key]}
                    onChange={(e) =>
                      setPhysForm((f) => ({ ...f, [key]: e.target.value }))
                    }
                  />
                </div>
              ))}

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Backend
                </label>
                <select
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={physForm.backend}
                  onChange={(e) =>
                    setPhysForm((f) => ({ ...f, backend: e.target.value }))
                  }
                >
                  <option value="ibm_brisbane">ibm_brisbane</option>
                  <option value="ibm_kyoto">ibm_kyoto</option>
                  <option value="ionq_aria_1">ionq_aria_1</option>
                  <option value="quantinuum_h2">quantinuum_h2</option>
                </select>
              </div>

              <button
                onClick={handlePhysicsCheck}
                disabled={physLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {physLoading ? "Checking…" : "Check Physics"}
              </button>
              {physError && (
                <p className="text-red-400 text-xs">{physError}</p>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-4">
            {!physResult && !physLoading && (
              <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
                Fill in values and click Check Physics.
              </div>
            )}

            {physResult && (
              <>
                {/* Score gauge + overall_valid */}
                <div className="bg-gray-800 rounded-xl p-6 flex items-center gap-8">
                  <GaugeFill value={physResult.physics_score} />
                  <div className="flex flex-col gap-2">
                    <span
                      className={`text-sm font-semibold px-3 py-1 rounded-full w-fit ${
                        physResult.overall_valid
                          ? "bg-green-800 text-green-200"
                          : "bg-red-800 text-red-200"
                      }`}
                    >
                      {physResult.overall_valid ? "Valid" : "Invalid"}
                    </span>
                    <span className="text-xs text-gray-400">
                      {physResult.violations.length} violation(s),{" "}
                      {physResult.warnings.length} warning(s),{" "}
                      {physResult.passed.length} passed
                    </span>
                  </div>
                </div>

                {/* Violations */}
                {physResult.violations.length > 0 && (
                  <div className="bg-gray-800 rounded-xl p-4">
                    <h3 className="font-semibold text-red-400 mb-3">
                      Violations
                    </h3>
                    <div className="space-y-3">
                      {physResult.violations.map((v, i) => (
                        <div
                          key={i}
                          className="bg-gray-900 rounded-lg p-3 border-l-2 border-red-500"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold bg-red-800 text-red-200 px-2 py-0.5 rounded">
                              {v.rule}
                            </span>
                            <span className="text-xs text-gray-400 uppercase">
                              {v.severity}
                            </span>
                          </div>
                          <div className="text-xs text-gray-300 mb-1">
                            Observed: <strong>{v.observed}</strong> | Limit:{" "}
                            <strong>{v.limit}</strong>
                          </div>
                          <div className="text-xs text-gray-400">
                            {v.explanation}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Warnings */}
                {physResult.warnings.length > 0 && (
                  <div className="bg-gray-800 rounded-xl p-4">
                    <h3 className="font-semibold text-yellow-400 mb-3">
                      Warnings
                    </h3>
                    <div className="space-y-2">
                      {physResult.warnings.map((w, i) => (
                        <div
                          key={i}
                          className="bg-gray-900 rounded-lg p-3 border-l-2 border-yellow-500 text-sm"
                        >
                          <span className="text-yellow-300 font-medium">
                            {w.rule}
                          </span>
                          <span className="text-gray-300 ml-2">{w.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Passed */}
                {physResult.passed.length > 0 && (
                  <div className="bg-gray-800 rounded-xl p-4">
                    <h3 className="font-semibold text-green-400 mb-3">
                      Passed Checks
                    </h3>
                    <ul className="space-y-1">
                      {physResult.passed.map((p, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-2 text-sm text-gray-300"
                        >
                          <span className="text-green-400">&#10003;</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Literature Compare Tab ── */}
      {tab === "literature" && (
        <div className="flex gap-6">
          <div className="w-72 shrink-0">
            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Metric
                </label>
                <select
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={litForm.metric}
                  onChange={(e) =>
                    setLitForm((f) => ({ ...f, metric: e.target.value }))
                  }
                >
                  <option value="fidelity">fidelity</option>
                  <option value="energy">energy</option>
                  <option value="error_rate">error_rate</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Value
                </label>
                <input
                  type="number"
                  step="any"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={litForm.value}
                  onChange={(e) =>
                    setLitForm((f) => ({ ...f, value: e.target.value }))
                  }
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Backend
                </label>
                <select
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={litForm.backend}
                  onChange={(e) =>
                    setLitForm((f) => ({ ...f, backend: e.target.value }))
                  }
                >
                  <option value="ibm_brisbane">ibm_brisbane</option>
                  <option value="ibm_kyoto">ibm_kyoto</option>
                  <option value="ionq_aria_1">ionq_aria_1</option>
                  <option value="quantinuum_h2">quantinuum_h2</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Qubits
                </label>
                <input
                  type="number"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={litForm.n_qubits}
                  onChange={(e) =>
                    setLitForm((f) => ({ ...f, n_qubits: e.target.value }))
                  }
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Algorithm
                </label>
                <input
                  type="text"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. VQE, QAOA…"
                  value={litForm.algorithm}
                  onChange={(e) =>
                    setLitForm((f) => ({ ...f, algorithm: e.target.value }))
                  }
                />
              </div>

              <button
                onClick={handleLitCompare}
                disabled={
                  litLoading ||
                  !litForm.value ||
                  !litForm.n_qubits ||
                  !litForm.algorithm
                }
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {litLoading ? "Comparing…" : "Compare to Literature"}
              </button>
              {litError && (
                <p className="text-red-400 text-xs">{litError}</p>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-4">
            {!litResult && !litLoading && (
              <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
                Fill in values and click Compare to Literature.
              </div>
            )}

            {litResult && (
              <>
                {/* Percentile + record badge */}
                <div className="bg-gray-800 rounded-xl p-6 flex items-center gap-8">
                  <div className="text-center">
                    <div className="text-6xl font-bold text-indigo-400">
                      {litResult.percentile}
                      <span className="text-2xl align-super text-gray-400">
                        th
                      </span>
                    </div>
                    <div className="text-sm text-gray-400 mt-1">
                      Percentile Rank
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <p className="text-gray-300 text-sm">{litResult.assessment}</p>
                    <div className="flex gap-2 flex-wrap">
                      {litResult.is_record && (
                        <span className="bg-yellow-700 text-yellow-200 text-xs font-bold px-3 py-1 rounded-full">
                          New Record
                        </span>
                      )}
                      <span className="bg-gray-700 text-gray-200 text-xs px-3 py-1 rounded-full">
                        Better than {litResult.better_than_pct}% of papers
                      </span>
                    </div>
                    {litResult.record_holder && (
                      <p className="text-xs text-gray-400">
                        Current record: {litResult.record_holder}
                      </p>
                    )}
                  </div>
                </div>

                {/* Similar papers table */}
                {litResult.similar_papers.length > 0 && (
                  <div className="bg-gray-800 rounded-xl p-4">
                    <h3 className="font-semibold text-gray-200 mb-3">
                      Similar Papers
                    </h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-400 text-xs border-b border-gray-700">
                          <th className="text-left pb-2">arXiv ID</th>
                          <th className="text-left pb-2">Title</th>
                          <th className="text-right pb-2">Value</th>
                          <th className="text-right pb-2">Year</th>
                        </tr>
                      </thead>
                      <tbody>
                        {litResult.similar_papers.map((p, i) => (
                          <tr
                            key={i}
                            className="border-b border-gray-700 last:border-0"
                          >
                            <td className="py-2 text-indigo-300 font-mono text-xs">
                              {p.arxiv_id}
                            </td>
                            <td className="py-2 text-gray-300 max-w-xs truncate">
                              {p.title}
                            </td>
                            <td className="py-2 text-right text-white">
                              {p.value}
                            </td>
                            <td className="py-2 text-right text-gray-400">
                              {p.year}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
