"use client";

import { useState } from "react";
import {
  correctMultipleComparisons,
  runPowerAnalysis,
  runMetaAnalysis,
  type MCorrectionResult,
  type PowerAnalysisResult,
  type MetaAnalysisResult,
} from "@/lib/api";

type Tab = "correction" | "power" | "meta";

// ────────────────────────────────────────────
// Correction Tab
// ────────────────────────────────────────────

type PValueRow = { label: string; p: string };

function CorrectionTab() {
  const [rows, setRows] = useState<PValueRow[]>([
    { label: "Gate A", p: "0.032" },
    { label: "Gate B", p: "0.048" },
    { label: "Gate C", p: "0.12" },
  ]);
  const [method, setMethod] = useState("bh");
  const [alpha, setAlpha] = useState(0.05);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MCorrectionResult | null>(null);

  function addRow() {
    setRows((prev) => [...prev, { label: `Test ${prev.length + 1}`, p: "0.05" }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, field: keyof PValueRow, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const pValues = rows.map((r) => parseFloat(r.p));
      const labels = rows.map((r) => r.label);
      const res = await correctMultipleComparisons({ p_values: pValues, method, alpha, labels });
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Correction failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
      <section className="panel">
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>P-Values</h3>
          <button className="button secondary" style={{ height: 28, fontSize: 11 }} type="button" onClick={addRow}>
            + Add Row
          </button>
        </div>
        <form onSubmit={(e) => { void handleSubmit(e); }} style={{ padding: "14px 18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {rows.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  className="input"
                  value={row.label}
                  onChange={(e) => updateRow(i, "label", e.target.value)}
                  placeholder="Label"
                  style={{ flex: 1 }}
                />
                <input
                  className="input"
                  type="number"
                  step="0.0001"
                  min="0"
                  max="1"
                  value={row.p}
                  onChange={(e) => updateRow(i, "p", e.target.value)}
                  placeholder="p-value"
                  style={{ width: 100 }}
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  style={{
                    background: "rgba(248,113,113,0.12)",
                    border: "1px solid rgba(248,113,113,0.3)",
                    color: "#f87171",
                    borderRadius: 6,
                    width: 28,
                    height: 28,
                    cursor: "pointer",
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Method</label>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="bonferroni">Bonferroni</option>
                <option value="holm">Holm</option>
                <option value="bh">Benjamini-Hochberg</option>
                <option value="by">Benjamini-Yekutieli</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Alpha</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0.001"
                max="0.5"
                value={alpha}
                onChange={(e) => setAlpha(parseFloat(e.target.value))}
              />
            </div>
          </div>

          {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <button className="button" type="submit" disabled={running}>
            {running ? "Running…" : "Correct P-Values"}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>Results</h3>
        </div>
        {!result && <div className="empty" style={{ fontSize: 13 }}>Run correction to see results.</div>}
        {result && (
          <div style={{ padding: "14px 18px" }}>
            {/* Summary badges */}
            <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <div
                style={{
                  background: "rgba(74,222,128,0.1)",
                  border: "1px solid rgba(74,222,128,0.3)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 800, color: "#4ade80" }}>
                  {result.n_significant}/{result.n_total}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>SIGNIFICANT</div>
              </div>
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div style={{ fontSize: 12, color: "var(--muted)" }}>FDR q</div>
                <div style={{ fontWeight: 700 }}>{result.fdr_q.toFixed(4)}</div>
              </div>
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div style={{ fontSize: 12, color: "var(--muted)" }}>FWER</div>
                <div style={{ fontWeight: 700 }}>{result.family_wise_error.toFixed(4)}</div>
              </div>
            </div>

            {/* Table */}
            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Original p</th>
                    <th>Corrected p</th>
                    <th style={{ textAlign: "center" }}>Sig.</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((item, i) => (
                    <tr
                      key={i}
                      style={{
                        background: item.significant ? "rgba(74,222,128,0.05)" : undefined,
                      }}
                    >
                      <td style={{ fontWeight: 600 }}>{item.label}</td>
                      <td>{item.original_p.toFixed(4)}</td>
                      <td style={{ color: item.significant ? "#4ade80" : "var(--strong)", fontWeight: 600 }}>
                        {item.corrected_p.toFixed(4)}
                      </td>
                      <td style={{ textAlign: "center", fontSize: 14 }}>
                        {item.significant ? (
                          <span style={{ color: "#4ade80" }}>✓</span>
                        ) : (
                          <span style={{ color: "#f87171" }}>✗</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Recommendations */}
            {result.recommendations.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>
                  RECOMMENDATIONS
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {result.recommendations.map((rec, i) => (
                    <li key={i} style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ────────────────────────────────────────────
// Power Tab
// ────────────────────────────────────────────

function PowerTab() {
  const [effectSize, setEffectSize] = useState(0.5);
  const [alpha, setAlpha] = useState(0.05);
  const [power, setPower] = useState(0.8);
  const [nGroups, setNGroups] = useState(2);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PowerAnalysisResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await runPowerAnalysis({ effect_size: effectSize, alpha, power, n_groups: nGroups });
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Power analysis failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
      <section className="panel">
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>Parameters</h3>
        </div>
        <form onSubmit={(e) => { void handleSubmit(e); }} style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>Effect Size (Cohen&apos;s d)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0.01"
              value={effectSize}
              onChange={(e) => setEffectSize(parseFloat(e.target.value))}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>Alpha</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0.001"
                max="0.5"
                value={alpha}
                onChange={(e) => setAlpha(parseFloat(e.target.value))}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>Power Target</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0.5"
                max="0.999"
                value={power}
                onChange={(e) => setPower(parseFloat(e.target.value))}
              />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>N Groups</label>
            <input
              className="input"
              type="number"
              min="2"
              value={nGroups}
              onChange={(e) => setNGroups(parseInt(e.target.value, 10))}
            />
          </div>
          {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}
          <button className="button" type="submit" disabled={running}>
            {running ? "Calculating…" : "Run Power Analysis"}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>Results</h3>
        </div>
        {!result && <div className="empty" style={{ fontSize: 13 }}>Submit to see power analysis results.</div>}
        {result && (
          <div style={{ padding: "14px 18px" }}>
            <div
              style={{
                textAlign: "center",
                padding: "24px 0",
                borderBottom: "1px solid var(--line)",
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>REQUIRED SAMPLE SIZE</div>
              <div style={{ fontSize: 48, fontWeight: 800, color: "#818cf8" }}>
                n = {result.required_n}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>per group</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div
                style={{
                  background: "var(--bg)",
                  borderRadius: 8,
                  padding: "12px",
                  border: "1px solid var(--line)",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>ACHIEVABLE POWER</div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: result.achievable_power >= 0.8 ? "#4ade80" : "#facc15",
                  }}
                >
                  {(result.achievable_power * 100).toFixed(1)}%
                </div>
              </div>
              <div
                style={{
                  background: "var(--bg)",
                  borderRadius: 8,
                  padding: "12px",
                  border: "1px solid var(--line)",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>MIN DETECTABLE EFFECT</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#22d3ee" }}>
                  {result.minimum_detectable_effect.toFixed(4)}
                </div>
              </div>
            </div>

            {result.current_power !== undefined && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  background: "rgba(250,204,21,0.08)",
                  border: "1px solid rgba(250,204,21,0.2)",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "var(--muted)",
                }}
              >
                Current power: <strong style={{ color: "#facc15" }}>{(result.current_power * 100).toFixed(1)}%</strong>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ────────────────────────────────────────────
// Meta-Analysis Tab
// ────────────────────────────────────────────

type StudyRow = { value: string; uncertainty: string; n_shots: string };

function ForestPlot({ data }: { data: MetaAnalysisResult["forest_data"] }) {
  if (!data.length) return null;
  const allVals = data.flatMap((d) => [d.lower, d.upper]);
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;
  const toX = (v: number) => `${Math.max(0, Math.min(100, ((v - minV) / range) * 100))}%`;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 8 }}>FOREST PLOT</div>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{ width: 90, fontSize: 11, color: "var(--muted)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.study}
          </div>
          <div style={{ flex: 1, position: "relative", height: 16 }}>
            {/* CI line */}
            <div
              style={{
                position: "absolute",
                left: toX(d.lower),
                right: `calc(100% - ${toX(d.upper)})`,
                top: "50%",
                height: 2,
                background: "rgba(99,102,241,0.5)",
                transform: "translateY(-50%)",
              }}
            />
            {/* Point estimate diamond */}
            <div
              style={{
                position: "absolute",
                left: toX(d.value),
                top: "50%",
                transform: "translate(-50%, -50%) rotate(45deg)",
                width: 8,
                height: 8,
                background: "#818cf8",
              }}
            />
          </div>
          <div style={{ width: 60, fontSize: 10, color: "var(--muted)", flexShrink: 0, textAlign: "right" }}>
            {d.value.toFixed(3)}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginTop: 4, paddingLeft: 102 }}>
        <span>{minV.toFixed(3)}</span>
        <span>{maxV.toFixed(3)}</span>
      </div>
    </div>
  );
}

function MetaTab() {
  const [studies, setStudies] = useState<StudyRow[]>([
    { value: "0.85", uncertainty: "0.05", n_shots: "1024" },
    { value: "0.88", uncertainty: "0.04", n_shots: "2048" },
    { value: "0.82", uncertainty: "0.06", n_shots: "512" },
  ]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MetaAnalysisResult | null>(null);

  function addStudy() {
    setStudies((prev) => [...prev, { value: "0.85", uncertainty: "0.05", n_shots: "1024" }]);
  }

  function removeStudy(i: number) {
    setStudies((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateStudy(i: number, field: keyof StudyRow, value: string) {
    setStudies((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await runMetaAnalysis({
        studies: studies.map((s) => ({
          value: parseFloat(s.value),
          uncertainty: parseFloat(s.uncertainty),
          n_shots: parseInt(s.n_shots, 10),
        })),
      });
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Meta-analysis failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
      <section className="panel">
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>Studies</h3>
          <button className="button secondary" style={{ height: 28, fontSize: 11 }} type="button" onClick={addStudy}>
            + Add Study
          </button>
        </div>
        <form onSubmit={(e) => { void handleSubmit(e); }} style={{ padding: "14px 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px 28px", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Value</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Uncertainty</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>N Shots</div>
            <div />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {studies.map((s, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px 28px", gap: 8, alignItems: "center" }}>
                <input
                  className="input"
                  type="number"
                  step="0.001"
                  value={s.value}
                  onChange={(e) => updateStudy(i, "value", e.target.value)}
                />
                <input
                  className="input"
                  type="number"
                  step="0.001"
                  min="0"
                  value={s.uncertainty}
                  onChange={(e) => updateStudy(i, "uncertainty", e.target.value)}
                />
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={s.n_shots}
                  onChange={(e) => updateStudy(i, "n_shots", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeStudy(i)}
                  style={{
                    background: "rgba(248,113,113,0.12)",
                    border: "1px solid rgba(248,113,113,0.3)",
                    color: "#f87171",
                    borderRadius: 6,
                    width: 28,
                    height: 28,
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <button className="button" type="submit" disabled={running || studies.length < 2}>
            {running ? "Running…" : "Run Meta-Analysis"}
          </button>
          {studies.length < 2 && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
              Add at least 2 studies.
            </div>
          )}
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>Results</h3>
        </div>
        {!result && <div className="empty" style={{ fontSize: 13 }}>Submit studies to see meta-analysis.</div>}
        {result && (
          <div style={{ padding: "14px 18px" }}>
            {/* Estimates */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div
                style={{
                  background: "rgba(99,102,241,0.08)",
                  border: "1px solid rgba(99,102,241,0.3)",
                  borderRadius: 8,
                  padding: "12px",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>FIXED EFFECT</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#818cf8" }}>
                  {result.fixed_effect_estimate.toFixed(4)}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>±{result.fixed_effect_se.toFixed(4)}</div>
              </div>
              <div
                style={{
                  background: "rgba(34,211,238,0.08)",
                  border: "1px solid rgba(34,211,238,0.3)",
                  borderRadius: 8,
                  padding: "12px",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>RANDOM EFFECT</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#22d3ee" }}>
                  {result.random_effect_estimate.toFixed(4)}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>±{result.random_effect_se.toFixed(4)}</div>
              </div>
            </div>

            {/* Heterogeneity */}
            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  flex: 1,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>I² (Heterogeneity)</div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 18,
                    color:
                      result.heterogeneity_i2 < 25
                        ? "#4ade80"
                        : result.heterogeneity_i2 < 75
                        ? "#facc15"
                        : "#f87171",
                  }}
                >
                  {result.heterogeneity_i2.toFixed(1)}%
                </div>
              </div>
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  flex: 1,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>τ² (Tau-squared)</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{result.heterogeneity_tau2.toFixed(4)}</div>
              </div>
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  flex: 1,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>P-Value</div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 18,
                    color: result.p_value < 0.05 ? "#4ade80" : "#f87171",
                  }}
                >
                  {result.p_value.toExponential(2)}
                </div>
              </div>
            </div>

            {/* Forest plot */}
            {result.forest_data.length > 0 && <ForestPlot data={result.forest_data} />}
          </div>
        )}
      </section>
    </div>
  );
}

// ────────────────────────────────────────────
// Page
// ────────────────────────────────────────────

export default function MultiComparisonsPage() {
  const [tab, setTab] = useState<Tab>("correction");

  const tabs: { key: Tab; label: string }[] = [
    { key: "correction", label: "Correction" },
    { key: "power", label: "Power Analysis" },
    { key: "meta", label: "Meta-Analysis" },
  ];

  return (
    <main className="page">
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Multiple Comparisons & Statistics</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Bonferroni/BH correction, statistical power analysis, and Bayesian meta-analysis for quantum experiments.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "1px solid var(--line)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: "none",
              border: "none",
              padding: "10px 20px",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? "#818cf8" : "var(--muted)",
              borderBottom: tab === t.key ? "2px solid #818cf8" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "correction" && <CorrectionTab />}
      {tab === "power" && <PowerTab />}
      {tab === "meta" && <MetaTab />}
    </main>
  );
}
