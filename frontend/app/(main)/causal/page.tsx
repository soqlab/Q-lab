"use client";

import { useState } from "react";
import {
  runCausalAnalysis,
  identifyConfounders,
  CausalAnalysisResult,
} from "@/lib/api";

type ActiveTab = "analysis" | "confounders";

const TREATMENTS = ["backend", "n_qubits", "gate_error", "t2_us", "mitigation_method"];
const OUTCOMES = ["fidelity", "energy", "error_rate"];
const PRESET_COVARIATES = [
  "n_qubits",
  "n_shots",
  "backend",
  "gate_error",
  "t1_us",
  "t2_us",
  "temperature_mk",
  "mitigation_method",
  "circuit_depth",
];

const DEFAULT_DATA = JSON.stringify(
  Array.from({ length: 10 }, (_, i) => ({
    backend: i % 2 === 0 ? "ibm_brisbane" : "ibm_sherbrooke",
    n_qubits: 4 + (i % 4),
    gate_error: 0.001 + i * 0.0005,
    t2_us: 80 + i * 5,
    mitigation_method: i % 3 === 0 ? "zne" : "none",
    fidelity: 0.92 - i * 0.008,
    energy: -1.1 - i * 0.05,
    error_rate: 0.05 + i * 0.004,
    n_shots: 1024,
  })),
  null,
  2
);

const DEFAULT_LOG = JSON.stringify(
  Array.from({ length: 8 }, (_, i) => ({
    backend: i % 2 === 0 ? "ibm_brisbane" : "ibm_sherbrooke",
    n_qubits: 4 + i,
    gate_error: 0.001 + i * 0.0003,
    t2_us: 90 + i * 3,
    fidelity: 0.94 - i * 0.01,
  })),
  null,
  2
);

function StrengthBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 70 ? "bg-red-500" : pct >= 40 ? "bg-yellow-500" : "bg-slate-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-slate-700">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-mono text-slate-300">{pct}%</span>
    </div>
  );
}

function AnalysisView({ result }: { result: CausalAnalysisResult }) {
  return (
    <div className="space-y-6">
      {/* ATE stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">ATE</p>
          <p className="text-3xl font-black text-white">{result.ate.toFixed(4)}</p>
          <p className="text-xs text-slate-500 mt-1">± {result.ate_std.toFixed(4)}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">p-value</p>
          <p
            className={`text-3xl font-black ${
              result.p_value < 0.05 ? "text-emerald-400" : "text-yellow-400"
            }`}
          >
            {result.p_value.toFixed(4)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">CI Low</p>
          <p className="text-2xl font-black text-white">
            {result.confidence_interval[0].toFixed(4)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">CI High</p>
          <p className="text-2xl font-black text-white">
            {result.confidence_interval[1].toFixed(4)}
          </p>
        </div>
      </div>

      {/* Interpretation */}
      <div className="rounded-xl border border-indigo-700 bg-indigo-950/40 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400 mb-2">
          Interpretation
        </p>
        <p className="text-slate-200 leading-relaxed">{result.interpretation}</p>
      </div>

      {/* Refutations table */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Refutation Tests
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/60 text-slate-400">
                <th className="px-4 py-2 text-left font-medium">Test Name</th>
                <th className="px-4 py-2 text-center font-medium">Passed</th>
                <th className="px-4 py-2 text-right font-medium">p-value</th>
              </tr>
            </thead>
            <tbody>
              {result.refutation_results.map((r, i) => (
                <tr key={i} className="border-b border-slate-800 last:border-0">
                  <td className="px-4 py-2 text-slate-300">{r.test}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={r.passed ? "text-emerald-400" : "text-red-400"}>
                      {r.passed ? "✓" : "✗"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-300">
                    {r.p_value.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confounders detected */}
      {result.confounders_detected.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Confounders Detected
          </p>
          <div className="flex flex-wrap gap-2">
            {result.confounders_detected.map((c, i) => (
              <span
                key={i}
                className="rounded-full border border-yellow-700 bg-yellow-950/50 px-3 py-1 text-xs text-yellow-300"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Causal graph edges */}
      {result.causal_graph_edges.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Causal Graph Edges
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/60 text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">From</th>
                  <th className="px-4 py-2 text-center font-medium">Arrow</th>
                  <th className="px-4 py-2 text-left font-medium">To</th>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {result.causal_graph_edges.map((e, i) => (
                  <tr key={i} className="border-b border-slate-800 last:border-0">
                    <td className="px-4 py-2 font-mono text-slate-300">{e.from}</td>
                    <td className="px-4 py-2 text-center text-slate-500">→</td>
                    <td className="px-4 py-2 font-mono text-slate-300">{e.to}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                        {e.type}
                      </span>
                    </td>
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

export default function CausalPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("analysis");

  // Analysis form state
  const [treatment, setTreatment] = useState(TREATMENTS[0]);
  const [outcome, setOutcome] = useState(OUTCOMES[0]);
  const [covariates, setCovariates] = useState<string[]>([]);
  const [dataJson, setDataJson] = useState(DEFAULT_DATA);
  const [method, setMethod] = useState("linear_regression");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<CausalAnalysisResult | null>(null);

  // Confounders form state
  const [confVariables, setConfVariables] = useState("");
  const [confOutcome, setConfOutcome] = useState("fidelity");
  const [confLog, setConfLog] = useState(DEFAULT_LOG);
  const [confLoading, setConfLoading] = useState(false);
  const [confError, setConfError] = useState<string | null>(null);
  const [confResult, setConfResult] = useState<
    { variable: string; evidence: string; strength: number }[] | null
  >(null);

  const toggleCovariate = (c: string) => {
    setCovariates((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const handleAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    try {
      const data = JSON.parse(dataJson) as Record<string, unknown>[];
      const res = await runCausalAnalysis({ treatment, outcome, covariates, data, method });
      setAnalysisResult(res);
    } catch (err: unknown) {
      setAnalysisError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleConfounders = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfLoading(true);
    setConfError(null);
    setConfResult(null);
    try {
      const variables = confVariables
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const experiment_log = JSON.parse(confLog) as Record<string, unknown>[];
      const res = await identifyConfounders({ variables, outcome: confOutcome, experiment_log });
      setConfResult(res.confounders);
    } catch (err: unknown) {
      setConfError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setConfLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-white lg:p-8">
      <h1 className="mb-1 text-3xl font-black tracking-tight text-white">
        Causal Inference Engine
      </h1>
      <p className="mb-8 text-slate-400">
        Discover causation vs correlation in quantum experiments.
      </p>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 border-b border-slate-700">
        {(
          [
            { key: "analysis", label: "Causal Analysis" },
            { key: "confounders", label: "Identify Confounders" },
          ] as { key: ActiveTab; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? "border-b-2 border-indigo-500 text-indigo-400"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Causal Analysis tab */}
      {activeTab === "analysis" && (
        <div className="space-y-8">
          <form
            onSubmit={handleAnalysis}
            className="space-y-5 rounded-xl border border-slate-700 bg-slate-800/60 p-6"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Treatment
                </label>
                <select
                  value={treatment}
                  onChange={(e) => setTreatment(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                >
                  {TREATMENTS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Outcome
                </label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                >
                  {OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Method
                </label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                >
                  {["linear_regression", "propensity_score", "iv"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Covariates
              </label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COVARIATES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCovariate(c)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      covariates.includes(c)
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Data (JSON array of experiment records)
              </label>
              <textarea
                rows={8}
                value={dataJson}
                onChange={(e) => setDataJson(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {analysisError && (
              <div className="rounded-lg border border-red-700 bg-red-950/50 px-4 py-3 text-sm text-red-300">
                {analysisError}
              </div>
            )}

            <button
              type="submit"
              disabled={analysisLoading}
              className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {analysisLoading ? "Running Causal Analysis..." : "Run Causal Analysis"}
            </button>
          </form>

          {analysisResult && <AnalysisView result={analysisResult} />}
        </div>
      )}

      {/* Identify Confounders tab */}
      {activeTab === "confounders" && (
        <div className="space-y-8">
          <form
            onSubmit={handleConfounders}
            className="space-y-5 rounded-xl border border-slate-700 bg-slate-800/60 p-6"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Variables (comma-separated)
                </label>
                <input
                  required
                  value={confVariables}
                  onChange={(e) => setConfVariables(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  placeholder="backend, n_qubits, gate_error, t2_us"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Outcome
                </label>
                <input
                  required
                  value={confOutcome}
                  onChange={(e) => setConfOutcome(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  placeholder="fidelity"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Experiment Log (JSON array)
              </label>
              <textarea
                rows={8}
                value={confLog}
                onChange={(e) => setConfLog(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {confError && (
              <div className="rounded-lg border border-red-700 bg-red-950/50 px-4 py-3 text-sm text-red-300">
                {confError}
              </div>
            )}

            <button
              type="submit"
              disabled={confLoading}
              className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {confLoading ? "Identifying Confounders..." : "Identify Confounders"}
            </button>
          </form>

          {confResult && (
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">
                Confounders Found: {confResult.length}
              </h2>
              {confResult.length === 0 ? (
                <p className="text-slate-400">No significant confounders detected.</p>
              ) : (
                <div className="space-y-4">
                  {confResult.map((c, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{c.variable}</span>
                        <span className="text-xs font-mono text-slate-400">
                          strength: {(c.strength * 100).toFixed(1)}%
                        </span>
                      </div>
                      <StrengthBar value={c.strength} />
                      <p className="text-sm text-slate-400">{c.evidence}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
