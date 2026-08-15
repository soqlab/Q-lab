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
    <div className="page" style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Auto-Mitigation Selector</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        ML-driven selection of optimal error-mitigation strategy combinations.
      </p>
      <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>⚗️</span>
        <span><strong style={{ color: "#f59e0b" }}>Simulated Preview</strong><span style={{ color: "var(--muted)", marginLeft: 8 }}>Strategy selection and fidelity estimates are analytical — not measured on real hardware.</span></span>
      </div>

      <div style={{ display: "flex", gap: 24 }}>
        {/* ── Left: Form ── */}
        <div style={{ width: 288, flexShrink: 0 }}>
          <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Backend</label>
              <select
                className="input"
                style={{ width: "100%" }}
                value={form.backend}
                onChange={(e) => setForm((f) => ({ ...f, backend: e.target.value }))}
              >
                <option value="ibm_brisbane">ibm_brisbane</option>
                <option value="ibm_kyoto">ibm_kyoto</option>
                <option value="ionq_aria_1">ionq_aria_1</option>
                <option value="quantinuum_h2">quantinuum_h2</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Qubits</label>
                <input
                  type="number"
                  min={1}
                  className="input"
                  style={{ width: "100%" }}
                  value={form.n_qubits}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, n_qubits: Number(e.target.value) }))
                  }
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Depth</label>
                <input
                  type="number"
                  min={1}
                  className="input"
                  style={{ width: "100%" }}
                  value={form.circuit_depth}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, circuit_depth: Number(e.target.value) }))
                  }
                />
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                Budget overhead: {form.budget_overhead.toFixed(1)}x
              </label>
              <input
                type="range"
                min={1.0}
                max={10.0}
                step={0.1}
                style={{ width: "100%" }}
                value={form.budget_overhead}
                onChange={(e) =>
                  setForm((f) => ({ ...f, budget_overhead: Number(e.target.value) }))
                }
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                <span>1.0x</span>
                <span>10.0x</span>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                Target fidelity: {form.target_fidelity.toFixed(2)}
              </label>
              <input
                type="range"
                min={0.8}
                max={0.99}
                step={0.01}
                style={{ width: "100%" }}
                value={form.target_fidelity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, target_fidelity: Number(e.target.value) }))
                }
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                <span>0.80</span>
                <span>0.99</span>
              </div>
            </div>

            <button
              onClick={handleSelect}
              disabled={loading}
              className="button"
              style={{ width: "100%", opacity: loading ? 0.5 : 1 }}
            >
              {loading ? "Selecting…" : "Select Mitigation"}
            </button>

            {error && <p style={{ color: "var(--danger)", fontSize: 12 }}>{error}</p>}
          </div>
        </div>

        {/* ── Right: Results ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
          {!rec && !loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 256, color: "var(--muted)", fontSize: 13 }}>
              Configure parameters and click Select Mitigation.
            </div>
          )}

          {rec && (
            <>
              {/* Strategy card */}
              <div className="panel" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "var(--strong)" }}>
                      {rec.strategy}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                      Recommended strategy
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 30, fontWeight: 700, color: "var(--ok)" }}>
                      {Math.round(rec.predicted_fidelity * 100)}%
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>predicted fidelity</div>
                  </div>
                </div>

                {/* Confidence bar */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    <span>Confidence</span>
                    <span>{Math.round(rec.confidence * 100)}%</span>
                  </div>
                  <div style={{ height: 8, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
                    <div
                      style={{ height: "100%", background: "var(--strong)", borderRadius: 999, width: `${rec.confidence * 100}%` }}
                    />
                  </div>
                </div>

                {/* Overhead */}
                <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 16 }}>
                  Combined overhead:{" "}
                  <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                    {rec.combined_overhead.toFixed(2)}x
                  </span>
                </div>

                {/* Reasoning */}
                <p style={{ fontSize: 13, color: "var(--text)", background: "var(--surface)", borderRadius: 8, padding: 12 }}>
                  {rec.reasoning}
                </p>
              </div>

              {/* Techniques list */}
              <div className="panel" style={{ padding: 20 }}>
                <h3 style={{ fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Techniques</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {(rec.techniques ?? []).map((t, i) => (
                    <div
                      key={i}
                      style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--surface)", borderRadius: 8, padding: 12 }}
                    >
                      <span style={{ width: 24, height: 24, borderRadius: 999, background: "rgba(79,70,229,0.5)", color: "var(--strong)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {t.order}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.name}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          Overhead: {t.overhead.toFixed(2)}x
                        </div>
                      </div>
                      <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                        +{(t.expected_improvement * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Alternatives table */}
              {(rec.alternatives ?? []).length > 0 && (
                <div className="panel" style={{ padding: 20 }}>
                  <h3 style={{ fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
                    Alternative Strategies
                  </h3>
                  <div className="table-wrap">
                    <table style={{ width: "100%", fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: "var(--muted)", fontSize: 12, borderBottom: "1px solid var(--line)" }}>
                          <th style={{ textAlign: "left", paddingBottom: 8 }}>Strategy</th>
                          <th style={{ textAlign: "right", paddingBottom: 8 }}>Fidelity</th>
                          <th style={{ textAlign: "right", paddingBottom: 8 }}>Overhead</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(rec.alternatives ?? []).map((alt, i) => (
                          <tr
                            key={i}
                            style={{ borderBottom: i < (rec.alternatives ?? []).length - 1 ? "1px solid var(--line)" : "none" }}
                          >
                            <td style={{ paddingTop: 8, paddingBottom: 8, color: "var(--text)" }}>{alt.strategy}</td>
                            <td style={{ paddingTop: 8, paddingBottom: 8, textAlign: "right", color: "var(--text)" }}>
                              {Math.round(alt.fidelity * 100)}%
                            </td>
                            <td style={{ paddingTop: 8, paddingBottom: 8, textAlign: "right", color: "#f59e0b" }}>
                              {alt.overhead.toFixed(2)}x
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Apply button */}
              <div className="panel" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <h3 style={{ fontWeight: 600, color: "var(--text)" }}>
                    Apply to Sample Counts
                  </h3>
                  <button
                    onClick={handleApply}
                    disabled={applying}
                    className="button"
                    style={{ background: "rgba(16,185,129,0.8)", opacity: applying ? 0.5 : 1, fontSize: 13, fontWeight: 500, padding: "6px 16px" }}
                  >
                    {applying ? "Applying…" : "Apply"}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--muted)" }}>
                  Uses circuit_counts = &#123;&quot;0&quot;: 850, &quot;1&quot;: 150&#125;
                </p>
                {applyError && (
                  <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{applyError}</p>
                )}

                {applied && (
                  <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, textAlign: "center" }}>
                      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ok)" }}>
                          {applied.mitigated_value.toFixed(4)}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>Mitigated</div>
                      </div>
                      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
                          {applied.raw_value.toFixed(4)}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>Raw</div>
                      </div>
                      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--strong)" }}>
                          +{(applied.improvement_pct * 100).toFixed(1)}%
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>Improvement</div>
                      </div>
                    </div>

                    {/* Technique contributions bar chart */}
                    <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12 }}>
                      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                        Technique Contributions
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {Object.entries(applied.technique_contributions).map(
                          ([name, val]) => (
                            <div key={name}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text)", marginBottom: 2 }}>
                                <span>{name}</span>
                                <span>{(val * 100).toFixed(1)}%</span>
                              </div>
                              <div style={{ height: 8, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
                                <div
                                  style={{
                                    height: "100%",
                                    background: "var(--strong)",
                                    borderRadius: 999,
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
