"use client";

import { useState } from "react";
import { HypothesisResult, runHypothesisTest } from "../../../lib/api";
import { FlaskConical, Play, CheckCircle, BarChart3 } from "lucide-react";

const TESTS = [
  { id: "chi_squared", label: "Chi-Squared", desc: "Goodness of fit for distributions" },
  { id: "tvd", label: "Total Variation Distance", desc: "Distance between two distributions" },
  { id: "ks_test", label: "KS Test", desc: "Kolmogorov-Smirnov test" },
  { id: "t_test", label: "T-Test", desc: "Means comparison" },
  { id: "quantum_fidelity", label: "Quantum Fidelity", desc: "State overlap test" },
];

const DEFAULT_OBSERVED = "100,120,90,130,110,95,105,115";
const DEFAULT_EXPECTED = "108,108,108,108,108,108,108,108";

export default function HypothesisPage() {
  const [test, setTest] = useState("chi_squared");
  const [alpha, setAlpha] = useState(0.05);
  const [observedText, setObservedText] = useState(DEFAULT_OBSERVED);
  const [expectedText, setExpectedText] = useState(DEFAULT_EXPECTED);
  const [result, setResult] = useState<HypothesisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const parsedObs = observedText.split(",").map((v) => parseFloat(v.trim())).filter((v) => !isNaN(v));
      const parsedExp = expectedText.split(",").map((v) => parseFloat(v.trim())).filter((v) => !isNaN(v));
      const res = await runHypothesisTest({ test, alpha, observed: parsedObs, expected: parsedExp });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <FlaskConical size={28} color="#3b82f6" />
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
              Statistical Hypothesis Engine
            </h1>
            <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.9rem" }}>
              Rigorous hypothesis testing for quantum measurement distributions
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div
            style={{
              background: "#1e293b",
              borderRadius: 12,
              border: "1px solid #334155",
              padding: "1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <div>
              <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
                Statistical Test
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {TESTS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTest(t.id)}
                    style={{
                      width: "100%",
                      border: "none",
                      borderRadius: 8,
                      padding: "0.6rem 0.75rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      textAlign: "left",
                      background: test === t.id ? "#3b82f6" : "#0f172a",
                      color: test === t.id ? "#fff" : "#94a3b8",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ fontSize: "0.8rem" }}>{t.label}</div>
                    <div style={{ fontSize: "0.7rem", opacity: 0.75, fontWeight: 400 }}>{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
                Significance Level (α)
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {[0.01, 0.05, 0.1].map((a) => (
                  <button
                    key={a}
                    onClick={() => setAlpha(a)}
                    style={{
                      flex: 1,
                      border: "none",
                      borderRadius: 8,
                      padding: "0.5rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "0.8rem",
                      background: alpha === a ? "#8b5cf6" : "#0f172a",
                      color: alpha === a ? "#fff" : "#94a3b8",
                      transition: "all 0.15s",
                    }}
                  >
                    {a.toFixed(2)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.5rem" }}>
                Observed counts (comma-separated)
              </label>
              <textarea
                rows={2}
                value={observedText}
                onChange={(e) => setObservedText(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "0.6rem",
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.5rem" }}>
                Expected counts (comma-separated)
              </label>
              <textarea
                rows={2}
                value={expectedText}
                onChange={(e) => setExpectedText(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "0.6rem",
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{
                width: "100%",
                border: "none",
                borderRadius: 8,
                padding: "0.7rem",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
                background: loading ? "#1e3a5f" : "#3b82f6",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                fontSize: "0.9rem",
              }}
            >
              <Play size={16} />
              {loading ? "Running Test..." : "Run Test"}
            </button>

            {error && (
              <div
                style={{
                  background: "#7f1d1d22",
                  border: "1px solid #ef4444",
                  color: "#f87171",
                  borderRadius: 8,
                  padding: "0.75rem",
                  fontSize: "0.85rem",
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {!result ? (
              <div
                style={{
                  background: "#1e293b",
                  borderRadius: 12,
                  border: "1px solid #334155",
                  height: 420,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                  gap: "0.75rem",
                }}
              >
                <BarChart3 size={48} color="#334155" />
                <p style={{ margin: 0, fontSize: "0.95rem" }}>Select a test and click Run Test to see results</p>
              </div>
            ) : (
              <>
                <div
                  style={{
                    background: result.reject_null ? "#7f1d1d33" : "#052e1633",
                    border: `1px solid ${result.reject_null ? "#ef4444" : "#10b981"}`,
                    borderRadius: 12,
                    padding: "1.25rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                  }}
                >
                  <CheckCircle size={24} color={result.reject_null ? "#ef4444" : "#10b981"} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1.05rem", color: result.reject_null ? "#f87171" : "#34d399" }}>
                      {result.reject_null ? "H₀ Rejected — Significant Difference" : "H₀ Not Rejected — No Significant Difference"}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                      {result.test_name} at α = {result.alpha}
                    </div>
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                    <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>p-value</span>
                    <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Reference: α = {result.alpha}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <span
                      style={{
                        fontSize: "2.5rem",
                        fontWeight: 700,
                        color: result.p_value < result.alpha ? "#ef4444" : "#10b981",
                      }}
                    >
                      {result.p_value.toFixed(6)}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ background: "#0f172a", borderRadius: 6, height: 8, position: "relative", overflow: "hidden" }}>
                        <div
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            height: "100%",
                            width: `${Math.min(result.p_value * 100, 100)}%`,
                            background: result.p_value < result.alpha ? "#ef4444" : "#10b981",
                            borderRadius: 6,
                          }}
                        />
                      </div>
                      <div style={{ color: "#64748b", fontSize: "0.75rem", marginTop: "0.3rem" }}>
                        vs α threshold: {result.alpha}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
                  {[
                    { label: "Test Statistic", value: result.test_statistic.toFixed(4), color: "#3b82f6" },
                    { label: "p-value", value: result.p_value.toFixed(6), color: result.p_value < result.alpha ? "#ef4444" : "#10b981" },
                    { label: "Critical Value", value: result.critical_value.toFixed(4), color: "#f59e0b" },
                    { label: result.effect_size_name || "Effect Size", value: result.effect_size.toFixed(4), color: "#8b5cf6" },
                  ].map((card) => (
                    <div
                      key={card.label}
                      style={{
                        background: "#1e293b",
                        borderRadius: 10,
                        border: "1px solid #334155",
                        padding: "0.75rem",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "1.4rem", fontWeight: 700, color: card.color }}>{card.value}</div>
                      <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "0.25rem" }}>{card.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#10b981" }}>
                      {(result.power_at_current_n * 100).toFixed(1)}%
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "0.25rem" }}>Power at Current N</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#f59e0b" }}>
                      {result.minimum_n_for_power_80}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "0.25rem" }}>Min N for 80% Power</div>
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
                    Interpretation
                  </div>
                  <div
                    style={{
                      background: "#0f172a",
                      borderRadius: 8,
                      border: "1px solid #334155",
                      padding: "0.75rem",
                      color: "#e2e8f0",
                      fontSize: "0.85rem",
                      lineHeight: 1.6,
                    }}
                  >
                    {result.interpretation}
                  </div>
                  {result.recommendation && (
                    <div style={{ marginTop: "0.75rem", color: "#94a3b8", fontSize: "0.85rem", lineHeight: 1.6 }}>
                      <strong style={{ color: "#f59e0b" }}>Recommendation:</strong> {result.recommendation}
                    </div>
                  )}
                </div>

                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
                    Confidence Interval
                  </div>
                  <div style={{ fontSize: "1.1rem", color: "#e2e8f0", fontFamily: "monospace" }}>
                    [{result.confidence_interval[0].toFixed(4)}, {result.confidence_interval[1].toFixed(4)}]
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
