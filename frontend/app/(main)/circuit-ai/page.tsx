"use client";

import { useState } from "react";
import {
  debugCircuitAI,
  optimizeCircuitAI,
  explainCircuitAI,
  AICircuitDebugResult,
  CircuitOptimizeResult,
  CircuitAIExplanation,
} from "@/lib/api";

type Tab = "debug" | "optimize" | "explain";

const DEFAULT_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[1],q[2];
measure q -> c;`;

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-800 text-red-200",
  high: "bg-orange-800 text-orange-200",
  medium: "bg-yellow-800 text-yellow-200",
  low: "bg-gray-700 text-gray-300",
};

export default function CircuitAIPage() {
  const [tab, setTab] = useState<Tab>("debug");
  const [qasm, setQasm] = useState(DEFAULT_QASM);

  // Debug state
  const [debugBackend, setDebugBackend] = useState("ibm_brisbane");
  const [debugResult, setDebugResult] = useState<AICircuitDebugResult | null>(null);
  const [debugging, setDebugging] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);

  // Optimize state
  const [optObjective, setOptObjective] = useState("depth");
  const [optResult, setOptResult] = useState<CircuitOptimizeResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);

  // Explain state
  const [detailLevel, setDetailLevel] = useState("detailed");
  const [explainResult, setExplainResult] = useState<CircuitAIExplanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  async function handleDebug() {
    setDebugError(null);
    setDebugging(true);
    setDebugResult(null);
    try {
      const res = await debugCircuitAI({
        circuit_qasm: qasm,
        backend: debugBackend,
      });
      setDebugResult(res);
    } catch (e) {
      setDebugError(e instanceof Error ? e.message : "Debug failed");
    } finally {
      setDebugging(false);
    }
  }

  async function handleOptimize() {
    setOptError(null);
    setOptimizing(true);
    setOptResult(null);
    try {
      const res = await optimizeCircuitAI({
        circuit_qasm: qasm,
        objective: optObjective,
      });
      setOptResult(res);
    } catch (e) {
      setOptError(e instanceof Error ? e.message : "Optimization failed");
    } finally {
      setOptimizing(false);
    }
  }

  async function handleExplain() {
    setExplainError(null);
    setExplaining(true);
    setExplainResult(null);
    try {
      const res = await explainCircuitAI({
        circuit_qasm: qasm,
        detail_level: detailLevel,
      });
      setExplainResult(res);
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : "Explanation failed");
    } finally {
      setExplaining(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-2xl font-bold mb-1">Circuit AI</h1>
      <p className="text-gray-400 text-sm mb-5">
        AI-powered quantum circuit debugging, optimization, and explanation.
      </p>

      {/* Shared QASM textarea */}
      <div className="bg-gray-800 rounded-xl p-4 mb-5">
        <label className="block text-xs text-gray-400 mb-2">
          Circuit QASM (shared across all tabs)
        </label>
        <textarea
          rows={9}
          spellCheck={false}
          className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-xs text-green-300 font-mono focus:outline-none focus:border-indigo-500 resize-y"
          value={qasm}
          onChange={(e) => setQasm(e.target.value)}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit mb-5">
        {(["debug", "optimize", "explain"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
              tab === t
                ? "bg-indigo-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Debug Tab ── */}
      {tab === "debug" && (
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="w-56">
              <label className="block text-xs text-gray-400 mb-1">Backend</label>
              <select
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                value={debugBackend}
                onChange={(e) => setDebugBackend(e.target.value)}
              >
                <option value="ibm_brisbane">ibm_brisbane</option>
                <option value="ibm_kyoto">ibm_kyoto</option>
                <option value="ionq_aria_1">ionq_aria_1</option>
                <option value="quantinuum_h2">quantinuum_h2</option>
              </select>
            </div>
            <button
              onClick={handleDebug}
              disabled={debugging || !qasm.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {debugging ? "Debugging…" : "Debug Circuit"}
            </button>
          </div>

          {debugError && <p className="text-red-400 text-sm">{debugError}</p>}

          {debugResult && (
            <div className="space-y-4">
              {/* Score badge */}
              <div className="flex items-center gap-4">
                <span
                  className={`text-lg font-bold px-4 py-1 rounded-full ${
                    debugResult.score >= 80
                      ? "bg-green-800 text-green-200"
                      : debugResult.score >= 50
                      ? "bg-yellow-800 text-yellow-200"
                      : "bg-red-800 text-red-200"
                  }`}
                >
                  Score: {debugResult.score}%
                </span>
                <span className="text-sm text-gray-400">
                  {debugResult.bugs.length} bug(s) &middot;{" "}
                  {debugResult.warnings.length} warning(s)
                </span>
              </div>

              {/* Circuit stats */}
              <div className="grid grid-cols-5 gap-2">
                {(
                  [
                    ["Qubits", debugResult.circuit_stats.n_qubits],
                    ["Depth", debugResult.circuit_stats.depth],
                    ["Gates", debugResult.circuit_stats.gate_count],
                    ["2Q gates", debugResult.circuit_stats.two_qubit_gates],
                    ["T gates", debugResult.circuit_stats.t_gates],
                  ] as [string, number][]
                ).map(([label, val]) => (
                  <div
                    key={label}
                    className="bg-gray-800 rounded-lg p-3 text-center"
                  >
                    <div className="text-xl font-bold text-white">{val}</div>
                    <div className="text-xs text-gray-400">{label}</div>
                  </div>
                ))}
              </div>

              {/* Bugs */}
              {debugResult.bugs.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-4">
                  <h3 className="font-semibold text-red-400 mb-3">Bugs</h3>
                  <div className="space-y-3">
                    {debugResult.bugs.map((bug, i) => (
                      <div
                        key={i}
                        className="bg-gray-900 rounded-lg p-3 border-l-2 border-red-600"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-gray-500">
                            Line {bug.line}
                          </span>
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded ${
                              SEVERITY_COLORS[bug.severity] ??
                              "bg-gray-700 text-gray-300"
                            }`}
                          >
                            {bug.severity}
                          </span>
                          <span className="text-xs text-indigo-300 font-medium">
                            {bug.type}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 mb-1">
                          {bug.description}
                        </p>
                        <p className="text-xs text-green-300">
                          Fix: {bug.fix}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {debugResult.warnings.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-4">
                  <h3 className="font-semibold text-yellow-400 mb-3">
                    Warnings
                  </h3>
                  <div className="space-y-2">
                    {debugResult.warnings.map((w, i) => (
                      <div
                        key={i}
                        className="flex gap-3 bg-gray-900 rounded-lg p-3 text-sm"
                      >
                        <span className="text-gray-500 shrink-0">
                          L{w.line}
                        </span>
                        <span className="text-gray-300">{w.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {debugResult.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {debugResult.suggestions.map((s, i) => (
                    <span
                      key={i}
                      className="text-xs bg-gray-800 border border-gray-600 text-indigo-300 px-3 py-1 rounded-full"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Optimize Tab ── */}
      {tab === "optimize" && (
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="w-48">
              <label className="block text-xs text-gray-400 mb-1">
                Objective
              </label>
              <select
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                value={optObjective}
                onChange={(e) => setOptObjective(e.target.value)}
              >
                <option value="depth">depth</option>
                <option value="gates">gates</option>
                <option value="fidelity">fidelity</option>
              </select>
            </div>
            <button
              onClick={handleOptimize}
              disabled={optimizing || !qasm.trim()}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {optimizing ? "Optimizing…" : "Optimize Circuit"}
            </button>
          </div>

          {optError && <p className="text-red-400 text-sm">{optError}</p>}

          {optResult && (
            <div className="space-y-4">
              {/* Before / After */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800 rounded-xl p-4 text-center">
                  <div className="text-xs text-gray-400 mb-1">
                    Original Depth
                  </div>
                  <div className="text-4xl font-bold text-gray-300">
                    {optResult.original_depth}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {optResult.original_gates} gates
                  </div>
                </div>
                <div className="bg-gray-800 rounded-xl p-4 text-center">
                  <div className="text-xs text-gray-400 mb-1">
                    Optimized Depth
                  </div>
                  <div className="text-4xl font-bold text-green-400">
                    {optResult.optimized_depth}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {optResult.optimized_gates} gates
                  </div>
                </div>
              </div>

              {/* Reduction stats */}
              <div className="flex gap-4">
                <div className="bg-gray-800 rounded-lg px-4 py-2 text-center">
                  <div className="text-xl font-bold text-green-400">
                    -{optResult.depth_reduction_pct.toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-400">Depth Reduction</div>
                </div>
                <div className="bg-gray-800 rounded-lg px-4 py-2 text-center">
                  <div className="text-xl font-bold text-indigo-400">
                    +{(optResult.fidelity_improvement * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-400">Fidelity Improvement</div>
                </div>
              </div>

              {/* Optimizations applied chips */}
              {optResult.optimizations_applied.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {optResult.optimizations_applied.map((o, i) => (
                    <span
                      key={i}
                      className="text-xs bg-violet-900 border border-violet-600 text-violet-200 px-3 py-1 rounded-full"
                    >
                      {o}
                    </span>
                  ))}
                </div>
              )}

              {/* Optimized QASM */}
              <div className="bg-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-200 text-sm">
                    Optimized QASM
                  </h3>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(optResult.optimized_qasm)
                    }
                    className="text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <pre className="bg-gray-900 rounded-lg p-3 text-xs text-green-300 font-mono overflow-x-auto whitespace-pre-wrap">
                  {optResult.optimized_qasm}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Explain Tab ── */}
      {tab === "explain" && (
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="w-48">
              <label className="block text-xs text-gray-400 mb-1">
                Detail Level
              </label>
              <select
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                value={detailLevel}
                onChange={(e) => setDetailLevel(e.target.value)}
              >
                <option value="brief">brief</option>
                <option value="detailed">detailed</option>
                <option value="educational">educational</option>
              </select>
            </div>
            <button
              onClick={handleExplain}
              disabled={explaining || !qasm.trim()}
              className="bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {explaining ? "Explaining…" : "Explain Circuit"}
            </button>
          </div>

          {explainError && (
            <p className="text-red-400 text-sm">{explainError}</p>
          )}

          {explainResult && (
            <div className="space-y-4">
              {/* Algorithm detected + use case */}
              <div className="bg-gray-800 rounded-xl p-4 flex items-start gap-4">
                {explainResult.algorithm_detected && (
                  <span className="bg-teal-800 text-teal-200 text-sm font-bold px-3 py-1 rounded-full shrink-0">
                    {explainResult.algorithm_detected}
                  </span>
                )}
                <p className="text-gray-300 text-sm">{explainResult.use_case}</p>
              </div>

              {/* Step-by-step table */}
              {explainResult.step_by_step.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-4">
                  <h3 className="font-semibold text-gray-200 mb-3">
                    Step-by-Step
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 text-xs border-b border-gray-700">
                        <th className="text-left pb-2">Gate</th>
                        <th className="text-left pb-2">Qubits</th>
                        <th className="text-left pb-2">Purpose</th>
                      </tr>
                    </thead>
                    <tbody>
                      {explainResult.step_by_step.map((step, i) => (
                        <tr
                          key={i}
                          className="border-b border-gray-700 last:border-0"
                        >
                          <td className="py-2 font-mono text-teal-300 font-bold">
                            {step.gate}
                          </td>
                          <td className="py-2 text-gray-400 font-mono text-xs">
                            [{step.qubits.join(", ")}]
                          </td>
                          <td className="py-2 text-gray-300">{step.purpose}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Full explanation */}
              <div className="bg-gray-800 rounded-xl p-4">
                <h3 className="font-semibold text-gray-200 mb-2">
                  Full Explanation
                </h3>
                <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                  {explainResult.explanation}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
