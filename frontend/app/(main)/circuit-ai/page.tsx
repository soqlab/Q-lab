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

const SEVERITY_STYLES: Record<string, React.CSSProperties> = {
  critical: { background: "rgba(239,68,68,0.2)", color: "var(--danger)" },
  high: { background: "rgba(249,115,22,0.2)", color: "#f97316" },
  medium: { background: "rgba(245,158,11,0.2)", color: "#f59e0b" },
  low: { background: "var(--line)", color: "var(--muted)" },
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
    <div className="page">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Circuit AI</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 20 }}>
        AI-powered quantum circuit debugging, optimization, and explanation.
      </p>

      {/* Shared QASM textarea */}
      <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, marginBottom: 20, border: "1px solid var(--line)" }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          Circuit QASM (shared across all tabs)
        </label>
        <textarea
          rows={9}
          spellCheck={false}
          style={{
            width: "100%",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--ok)",
            fontFamily: "ui-monospace,monospace",
            resize: "vertical",
            boxSizing: "border-box",
          }}
          value={qasm}
          onChange={(e) => setQasm(e.target.value)}
        />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, background: "var(--surface)", padding: 4, borderRadius: 8, width: "fit-content", marginBottom: 20, border: "1px solid var(--line)" }}>
        {(["debug", "optimize", "explain"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              textTransform: "capitalize",
              cursor: "pointer",
              border: "none",
              background: tab === t ? "var(--strong)" : "transparent",
              color: tab === t ? "#fff" : "var(--muted)",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Debug Tab ── */}
      {tab === "debug" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div style={{ width: 224 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Backend</label>
              <select
                className="input"
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
              className="button"
              style={{ opacity: debugging || !qasm.trim() ? 0.5 : 1 }}
            >
              {debugging ? "Debugging…" : "Debug Circuit"}
            </button>
          </div>

          {debugError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{debugError}</p>}

          {debugResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Score badge */}
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    padding: "4px 16px",
                    borderRadius: 999,
                    ...(debugResult.score >= 80
                      ? { background: "rgba(16,185,129,0.15)", color: "var(--ok)" }
                      : debugResult.score >= 50
                      ? { background: "rgba(245,158,11,0.15)", color: "#f59e0b" }
                      : { background: "rgba(239,68,68,0.15)", color: "var(--danger)" }),
                  }}
                >
                  Score: {debugResult.score}%
                </span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  {(debugResult.bugs ?? []).length} bug(s) &middot;{" "}
                  {(debugResult.warnings ?? []).length} warning(s)
                </span>
              </div>

              {/* Circuit stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
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
                    style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, textAlign: "center" }}
                  >
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{val}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Bugs */}
              {(debugResult.bugs ?? []).length > 0 && (
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
                  <h3 style={{ fontWeight: 600, color: "var(--danger)", marginBottom: 12 }}>Bugs</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {(debugResult.bugs ?? []).map((bug, i) => (
                      <div
                        key={i}
                        style={{ background: "rgba(239,68,68,0.05)", borderRadius: 8, padding: 12, borderLeft: "2px solid var(--danger)" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            Line {bug.line}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              padding: "2px 8px",
                              borderRadius: 6,
                              ...(SEVERITY_STYLES[bug.severity] ?? { background: "var(--line)", color: "var(--muted)" }),
                            }}
                          >
                            {bug.severity}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--strong)", fontWeight: 500 }}>
                            {bug.type}
                          </span>
                        </div>
                        <p style={{ fontSize: 13, color: "var(--text)", marginBottom: 4 }}>
                          {bug.description}
                        </p>
                        <p style={{ fontSize: 12, color: "var(--ok)" }}>
                          Fix: {bug.fix}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {(debugResult.warnings ?? []).length > 0 && (
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
                  <h3 style={{ fontWeight: 600, color: "#f59e0b", marginBottom: 12 }}>
                    Warnings
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(debugResult.warnings ?? []).map((w, i) => (
                      <div
                        key={i}
                        style={{ display: "flex", gap: 12, background: "rgba(245,158,11,0.05)", borderRadius: 8, padding: 12, fontSize: 13 }}
                      >
                        <span style={{ color: "var(--muted)", flexShrink: 0 }}>
                          L{w.line}
                        </span>
                        <span style={{ color: "var(--text)" }}>{w.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {(debugResult.suggestions ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(debugResult.suggestions ?? []).map((s, i) => (
                    <span
                      key={i}
                      style={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--strong)", padding: "4px 12px", borderRadius: 999 }}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div style={{ width: 192 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                Objective
              </label>
              <select
                className="input"
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
              style={{
                background: "#7c3aed",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 20px",
                borderRadius: 8,
                border: "none",
                cursor: optimizing || !qasm.trim() ? "not-allowed" : "pointer",
                opacity: optimizing || !qasm.trim() ? 0.5 : 1,
              }}
            >
              {optimizing ? "Optimizing…" : "Optimize Circuit"}
            </button>
          </div>

          {optError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{optError}</p>}

          {optResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Before / After */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    Original Depth
                  </div>
                  <div style={{ fontSize: 36, fontWeight: 700, color: "var(--text)" }}>
                    {optResult.original_depth}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    {optResult.original_gates} gates
                  </div>
                </div>
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    Optimized Depth
                  </div>
                  <div style={{ fontSize: 36, fontWeight: 700, color: "var(--ok)" }}>
                    {optResult.optimized_depth}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    {optResult.optimized_gates} gates
                  </div>
                </div>
              </div>

              {/* Reduction stats */}
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ok)" }}>
                    -{optResult.depth_reduction_pct.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Depth Reduction</div>
                </div>
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--strong)" }}>
                    +{(optResult.fidelity_improvement * 100).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Fidelity Improvement</div>
                </div>
              </div>

              {/* Optimizations applied chips */}
              {(optResult.optimizations_applied ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(optResult.optimizations_applied ?? []).map((o, i) => (
                    <span
                      key={i}
                      style={{ fontSize: 12, background: "rgba(109,40,217,0.2)", border: "1px solid #7c3aed", color: "#c4b5fd", padding: "4px 12px", borderRadius: 999 }}
                    >
                      {o}
                    </span>
                  ))}
                </div>
              )}

              {/* Optimized QASM */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <h3 style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>
                    Optimized QASM
                  </h3>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(optResult.optimized_qasm)
                    }
                    style={{ fontSize: 12, color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer" }}
                  >
                    Copy
                  </button>
                </div>
                <pre style={{ fontFamily: "ui-monospace,monospace", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", overflowX: "auto", whiteSpace: "pre-wrap", fontSize: 12, color: "var(--ok)" }}>
                  {optResult.optimized_qasm}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Explain Tab ── */}
      {tab === "explain" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div style={{ width: 192 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                Detail Level
              </label>
              <select
                className="input"
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
              style={{
                background: "#0d9488",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 20px",
                borderRadius: 8,
                border: "none",
                cursor: explaining || !qasm.trim() ? "not-allowed" : "pointer",
                opacity: explaining || !qasm.trim() ? 0.5 : 1,
              }}
            >
              {explaining ? "Explaining…" : "Explain Circuit"}
            </button>
          </div>

          {explainError && (
            <p style={{ color: "var(--danger)", fontSize: 13 }}>{explainError}</p>
          )}

          {explainResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Algorithm detected + use case */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", alignItems: "flex-start", gap: 16 }}>
                {explainResult.algorithm_detected && (
                  <span style={{ background: "rgba(13,148,136,0.2)", color: "#5eead4", fontSize: 13, fontWeight: 700, padding: "4px 12px", borderRadius: 999, flexShrink: 0 }}>
                    {explainResult.algorithm_detected}
                  </span>
                )}
                <p style={{ color: "var(--text)", fontSize: 13 }}>{explainResult.use_case}</p>
              </div>

              {/* Step-by-step table */}
              {(explainResult.step_by_step ?? []).length > 0 && (
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
                  <h3 style={{ fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
                    Step-by-Step
                  </h3>
                  <div className="table-wrap">
                    <table style={{ width: "100%", fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: "var(--muted)", fontSize: 12, borderBottom: "1px solid var(--line)" }}>
                          <th style={{ textAlign: "left", paddingBottom: 8 }}>Gate</th>
                          <th style={{ textAlign: "left", paddingBottom: 8 }}>Qubits</th>
                          <th style={{ textAlign: "left", paddingBottom: 8 }}>Purpose</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(explainResult.step_by_step ?? []).map((step, i, arr) => (
                          <tr
                            key={i}
                            style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : "none" }}
                          >
                            <td style={{ padding: "8px 0", fontFamily: "ui-monospace,monospace", color: "#5eead4", fontWeight: 700 }}>
                              {step.gate}
                            </td>
                            <td style={{ padding: "8px 0", color: "var(--muted)", fontFamily: "ui-monospace,monospace", fontSize: 12 }}>
                              [{(step.qubits ?? []).join(", ")}]
                            </td>
                            <td style={{ padding: "8px 0", color: "var(--text)" }}>{step.purpose}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Full explanation */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
                <h3 style={{ fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                  Full Explanation
                </h3>
                <p style={{ color: "var(--text)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
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
