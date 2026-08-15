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
  const barColor =
    pct >= 70 ? "var(--danger)" : pct >= 40 ? "#f59e0b" : "var(--muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ height: 6, flex: 1, borderRadius: 999, background: "var(--line)" }}>
        <div style={{ height: 6, borderRadius: 999, background: barColor, width: `${pct}%` }} />
      </div>
      <span style={{ width: 40, textAlign: "right", fontSize: 12, fontFamily: "ui-monospace,monospace", color: "var(--text)" }}>
        {pct}%
      </span>
    </div>
  );
}

function AnalysisView({ result }: { result: CausalAnalysisResult }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ATE stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16 }}>
        <div style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", padding: 16, textAlign: "center" }}>
          <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)", marginBottom: 4 }}>ATE</p>
          <p style={{ fontSize: 30, fontWeight: 900, color: "var(--text)" }}>{result.ate.toFixed(4)}</p>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>± {result.ate_std.toFixed(4)}</p>
        </div>
        <div style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", padding: 16, textAlign: "center" }}>
          <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)", marginBottom: 4 }}>p-value</p>
          <p style={{ fontSize: 30, fontWeight: 900, color: result.p_value < 0.05 ? "var(--ok)" : "#f59e0b" }}>
            {result.p_value.toFixed(4)}
          </p>
        </div>
        <div style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", padding: 16, textAlign: "center" }}>
          <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)", marginBottom: 4 }}>CI Low</p>
          <p style={{ fontSize: 24, fontWeight: 900, color: "var(--text)" }}>
            {result.confidence_interval[0].toFixed(4)}
          </p>
        </div>
        <div style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", padding: 16, textAlign: "center" }}>
          <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)", marginBottom: 4 }}>CI High</p>
          <p style={{ fontSize: 24, fontWeight: 900, color: "var(--text)" }}>
            {result.confidence_interval[1].toFixed(4)}
          </p>
        </div>
      </div>

      {/* Interpretation */}
      <div style={{ borderRadius: 12, border: "1px solid var(--strong)", background: "rgba(99,102,241,0.1)", padding: "16px 20px" }}>
        <p style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--strong)", marginBottom: 8 }}>
          Interpretation
        </p>
        <p style={{ color: "var(--text)", lineHeight: 1.6 }}>{result.interpretation}</p>
      </div>

      {/* Refutations table */}
      <div>
        <p style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>
          Refutation Tests
        </p>
        <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--line)" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--surface)", color: "var(--muted)" }}>
                <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 500 }}>Test Name</th>
                <th style={{ padding: "8px 16px", textAlign: "center", fontWeight: 500 }}>Passed</th>
                <th style={{ padding: "8px 16px", textAlign: "right", fontWeight: 500 }}>p-value</th>
              </tr>
            </thead>
            <tbody>
              {(result.refutation_results ?? []).map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 16px", color: "var(--text)" }}>{r.test}</td>
                  <td style={{ padding: "8px 16px", textAlign: "center" }}>
                    <span style={{ color: r.passed ? "var(--ok)" : "var(--danger)" }}>
                      {r.passed ? "✓" : "✗"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 16px", textAlign: "right", fontFamily: "ui-monospace,monospace", color: "var(--text)" }}>
                    {r.p_value.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confounders detected */}
      {(result.confounders_detected ?? []).length > 0 && (
        <div>
          <p style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>
            Confounders Detected
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(result.confounders_detected ?? []).map((c, i) => (
              <span
                key={i}
                style={{ borderRadius: 999, border: "1px solid #f59e0b", background: "rgba(245,158,11,0.1)", padding: "4px 12px", fontSize: 12, color: "#f59e0b" }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Causal graph edges */}
      {(result.causal_graph_edges ?? []).length > 0 && (
        <div>
          <p style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>
            Causal Graph Edges
          </p>
          <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--line)" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--surface)", color: "var(--muted)" }}>
                  <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 500 }}>From</th>
                  <th style={{ padding: "8px 16px", textAlign: "center", fontWeight: 500 }}>Arrow</th>
                  <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 500 }}>To</th>
                  <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 500 }}>Type</th>
                </tr>
              </thead>
              <tbody>
                {(result.causal_graph_edges ?? []).map((e, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 16px", fontFamily: "ui-monospace,monospace", color: "var(--text)" }}>{e.from}</td>
                    <td style={{ padding: "8px 16px", textAlign: "center", color: "var(--muted)" }}>→</td>
                    <td style={{ padding: "8px 16px", fontFamily: "ui-monospace,monospace", color: "var(--text)" }}>{e.to}</td>
                    <td style={{ padding: "8px 16px" }}>
                      <span style={{ borderRadius: 999, background: "var(--line)", padding: "2px 8px", fontSize: 12, color: "var(--text)" }}>
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

  const labelStyle = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.12em",
    color: "var(--muted)",
    marginBottom: 4,
  };

  const fieldStyle = {
    width: "100%",
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "var(--surface)",
    padding: "8px 12px",
    color: "var(--text)",
    fontSize: 13,
    boxSizing: "border-box" as const,
  };

  const submitBtnStyle = (loading: boolean) => ({
    width: "100%",
    borderRadius: 8,
    background: "var(--strong)",
    padding: "12px 0",
    fontWeight: 600,
    color: "#fff",
    border: "none",
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.5 : 1,
    fontSize: 14,
  });

  return (
    <div className="page">
      <h1 style={{ marginBottom: 4, fontSize: 30, fontWeight: 900, color: "var(--text)" }}>
        Causal Inference Engine
      </h1>
      <p style={{ marginBottom: 16, color: "var(--muted)" }}>
        Discover causation vs correlation in quantum experiments.
      </p>
      <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>⚗️</span>
        <span><strong style={{ color: "#f59e0b" }}>Simulated Preview</strong><span style={{ color: "var(--muted)", marginLeft: 8 }}>Refutation tests are analytically approximated — not true permutation or bootstrap tests.</span></span>
      </div>

      {/* Tab bar */}
      <div style={{ marginBottom: 24, display: "flex", gap: 4, borderBottom: "1px solid var(--line)" }}>
        {(
          [
            { key: "analysis", label: "Causal Analysis" },
            { key: "confounders", label: "Identify Confounders" },
          ] as { key: ActiveTab; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 500,
              background: "none",
              border: "none",
              borderBottom: activeTab === t.key ? "2px solid var(--strong)" : "2px solid transparent",
              color: activeTab === t.key ? "var(--strong)" : "var(--muted)",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Causal Analysis tab */}
      {activeTab === "analysis" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <form
            onSubmit={handleAnalysis}
            style={{ display: "flex", flexDirection: "column", gap: 20, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", padding: 24 }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
              <div>
                <label style={labelStyle}>Treatment</label>
                <select
                  value={treatment}
                  onChange={(e) => setTreatment(e.target.value)}
                  style={fieldStyle}
                >
                  {TREATMENTS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Outcome</label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  style={fieldStyle}
                >
                  {OUTCOMES.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Method</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  style={fieldStyle}
                >
                  {["linear_regression", "propensity_score", "iv"].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ ...labelStyle, marginBottom: 8 }}>Covariates</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {PRESET_COVARIATES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCovariate(c)}
                    style={{
                      borderRadius: 999,
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      border: "none",
                      cursor: "pointer",
                      background: covariates.includes(c) ? "var(--strong)" : "var(--line)",
                      color: covariates.includes(c) ? "#fff" : "var(--text)",
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={labelStyle}>Data (JSON array of experiment records)</label>
              <textarea
                rows={8}
                value={dataJson}
                onChange={(e) => setDataJson(e.target.value)}
                style={{ ...fieldStyle, fontFamily: "ui-monospace,monospace", fontSize: 12, resize: "vertical" }}
              />
            </div>

            {analysisError && (
              <div style={{ borderRadius: 8, border: "1px solid var(--danger)", background: "rgba(239,68,68,0.1)", padding: "12px 16px", fontSize: 13, color: "var(--danger)" }}>
                {analysisError}
              </div>
            )}

            <button
              type="submit"
              disabled={analysisLoading}
              style={submitBtnStyle(analysisLoading)}
            >
              {analysisLoading ? "Running Causal Analysis..." : "Run Causal Analysis"}
            </button>
          </form>

          {analysisResult && <AnalysisView result={analysisResult} />}
        </div>
      )}

      {/* Identify Confounders tab */}
      {activeTab === "confounders" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <form
            onSubmit={handleConfounders}
            style={{ display: "flex", flexDirection: "column", gap: 20, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", padding: 24 }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
              <div>
                <label style={labelStyle}>Variables (comma-separated)</label>
                <input
                  required
                  value={confVariables}
                  onChange={(e) => setConfVariables(e.target.value)}
                  style={fieldStyle}
                  placeholder="backend, n_qubits, gate_error, t2_us"
                />
              </div>
              <div>
                <label style={labelStyle}>Outcome</label>
                <input
                  required
                  value={confOutcome}
                  onChange={(e) => setConfOutcome(e.target.value)}
                  style={fieldStyle}
                  placeholder="fidelity"
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Experiment Log (JSON array)</label>
              <textarea
                rows={8}
                value={confLog}
                onChange={(e) => setConfLog(e.target.value)}
                style={{ ...fieldStyle, fontFamily: "ui-monospace,monospace", fontSize: 12, resize: "vertical" }}
              />
            </div>

            {confError && (
              <div style={{ borderRadius: 8, border: "1px solid var(--danger)", background: "rgba(239,68,68,0.1)", padding: "12px 16px", fontSize: 13, color: "var(--danger)" }}>
                {confError}
              </div>
            )}

            <button
              type="submit"
              disabled={confLoading}
              style={submitBtnStyle(confLoading)}
            >
              {confLoading ? "Identifying Confounders..." : "Identify Confounders"}
            </button>
          </form>

          {confResult && (
            <div style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
                Confounders Found: {confResult.length}
              </h2>
              {confResult.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>No significant confounders detected.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {(confResult ?? []).map((c, i) => (
                    <div
                      key={i}
                      style={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 600, color: "var(--text)" }}>{c.variable}</span>
                        <span style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: "var(--muted)" }}>
                          strength: {(c.strength * 100).toFixed(1)}%
                        </span>
                      </div>
                      <StrengthBar value={c.strength} />
                      <p style={{ fontSize: 13, color: "var(--muted)" }}>{c.evidence}</p>
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
