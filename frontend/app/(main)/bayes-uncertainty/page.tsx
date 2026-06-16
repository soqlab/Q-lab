"use client";

import { useState } from "react";
import {
  propagateBayesUncertainty,
  compareBayesian,
  type BayesUncertaintyResult,
  type BayesComparison,
} from "@/lib/api";

type Tab = "propagate" | "compare";

// Mini histogram bar chart from posterior_samples
function PosteriorHistogram({ samples }: { samples: number[] }) {
  if (!samples.length) return null;
  const bins = 20;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = max - min || 1;
  const counts = Array<number>(bins).fill(0);
  for (const s of samples) {
    const idx = Math.min(bins - 1, Math.floor(((s - min) / range) * bins));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>
        POSTERIOR DISTRIBUTION ({samples.length.toLocaleString()} samples, 20 bins)
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 72 }}>
        {counts.map((c, i) => (
          <div
            key={i}
            title={`Bin ${i}: ${c}`}
            style={{
              flex: 1,
              height: `${maxCount > 0 ? (c / maxCount) * 100 : 0}%`,
              background: "rgba(99,102,241,0.5)",
              borderRadius: "2px 2px 0 0",
              minWidth: 3,
              transition: "height 0.2s",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginTop: 3 }}>
        <span>{min.toFixed(3)}</span>
        <span>{max.toFixed(3)}</span>
      </div>
    </div>
  );
}

function RangeBar({ low, high, label, color }: { low: number; high: number; label: string; color: string }) {
  // Normalize to [0,1] range for display (assuming values are already 0-1 probabilities)
  const pct = (v: number) => `${Math.min(100, Math.max(0, v * 100)).toFixed(1)}%`;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
        {label}: [{low.toFixed(4)}, {high.toFixed(4)}]
      </div>
      <div style={{ position: "relative", height: 12, background: "var(--line)", borderRadius: 6 }}>
        <div
          style={{
            position: "absolute",
            left: pct(low),
            width: `${Math.max(2, (high - low) * 100)}%`,
            height: "100%",
            background: color,
            borderRadius: 6,
            opacity: 0.7,
          }}
        />
      </div>
    </div>
  );
}

function EvidenceBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "var(--muted)" }}>{label}</span>
        <span style={{ fontWeight: 600, color }}>{value.toFixed(4)}</span>
      </div>
      <div style={{ height: 8, background: "var(--line)", borderRadius: 4 }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 4,
            transition: "width 0.4s",
          }}
        />
      </div>
    </div>
  );
}

function convergenceBadge(converged: boolean) {
  return (
    <span
      style={{
        background: converged ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
        color: converged ? "#4ade80" : "#f87171",
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
      }}
    >
      {converged ? "Converged" : "Not Converged"}
    </span>
  );
}

export default function BayesUncertaintyPage() {
  const [tab, setTab] = useState<Tab>("propagate");

  // Propagate tab state
  const [countsJson, setCountsJson] = useState('{"0": 850, "1": 150}');
  const [nShots, setNShots] = useState(1000);
  const [prior, setPrior] = useState("uniform");
  const [nQubits, setNQubits] = useState(1);
  const [propagating, setPropagating] = useState(false);
  const [propagateError, setPropagateError] = useState<string | null>(null);
  const [propagateResult, setPropagateResult] = useState<BayesUncertaintyResult | null>(null);

  // Compare tab state
  const [countsA, setCountsA] = useState('{"0": 850, "1": 150}');
  const [shotsA, setShotsA] = useState(1000);
  const [countsB, setCountsB] = useState('{"0": 700, "1": 300}');
  const [shotsB, setShotsB] = useState(1000);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<BayesComparison | null>(null);

  async function handlePropagate(e: React.FormEvent) {
    e.preventDefault();
    setPropagating(true);
    setPropagateError(null);
    setPropagateResult(null);
    try {
      const counts = JSON.parse(countsJson) as Record<string, number>;
      const result = await propagateBayesUncertainty({
        counts,
        n_shots: nShots,
        prior,
        n_qubits: nQubits,
      });
      setPropagateResult(result);
    } catch (err: unknown) {
      setPropagateError(err instanceof Error ? err.message : "Propagation failed");
    } finally {
      setPropagating(false);
    }
  }

  async function handleCompare(e: React.FormEvent) {
    e.preventDefault();
    setComparing(true);
    setCompareError(null);
    setCompareResult(null);
    try {
      const parsedA = JSON.parse(countsA) as Record<string, number>;
      const parsedB = JSON.parse(countsB) as Record<string, number>;
      const result = await compareBayesian({
        experiment_a: { counts: parsedA, n_shots: shotsA },
        experiment_b: { counts: parsedB, n_shots: shotsB },
      });
      setCompareResult(result);
    } catch (err: unknown) {
      setCompareError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setComparing(false);
    }
  }

  return (
    <main className="page">
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Bayesian Uncertainty Propagation</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Full posterior analysis with credible intervals, convergence diagnostics, and Bayesian model comparison.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "1px solid var(--line)" }}>
        {(["propagate", "compare"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: "none",
              border: "none",
              padding: "10px 20px",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: tab === t ? 700 : 400,
              color: tab === t ? "#818cf8" : "var(--muted)",
              borderBottom: tab === t ? "2px solid #818cf8" : "2px solid transparent",
              marginBottom: -1,
              textTransform: "capitalize",
            }}
          >
            {t === "propagate" ? "Propagate" : "Compare"}
          </button>
        ))}
      </div>

      {/* Propagate Tab */}
      {tab === "propagate" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
          <section className="panel">
            <div className="panel-header">
              <h3 style={{ fontWeight: 600 }}>Input</h3>
            </div>
            <form
              onSubmit={(e) => { void handlePropagate(e); }}
              style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                  Counts (JSON)
                </label>
                <textarea
                  className="input"
                  value={countsJson}
                  onChange={(e) => setCountsJson(e.target.value)}
                  rows={3}
                  style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
                  required
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                    N Shots
                  </label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={nShots}
                    onChange={(e) => setNShots(parseInt(e.target.value, 10))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                    N Qubits
                  </label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={nQubits}
                    onChange={(e) => setNQubits(parseInt(e.target.value, 10))}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                  Prior
                </label>
                <select className="input" value={prior} onChange={(e) => setPrior(e.target.value)}>
                  <option value="uniform">Uniform</option>
                  <option value="jeffreys">Jeffreys</option>
                  <option value="informative">Informative</option>
                </select>
              </div>
              {propagateError && (
                <div style={{ color: "#f87171", fontSize: 12 }}>{propagateError}</div>
              )}
              <button className="button" type="submit" disabled={propagating}>
                {propagating ? "Propagating…" : "Propagate Uncertainty"}
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3 style={{ fontWeight: 600 }}>Results</h3>
            </div>
            {!propagateResult && (
              <div className="empty" style={{ fontSize: 13 }}>
                Run propagation to see posterior analysis.
              </div>
            )}
            {propagateResult && (
              <div style={{ padding: "14px 18px" }}>
                {/* Main metric */}
                <div
                  style={{
                    textAlign: "center",
                    padding: "20px 0",
                    borderBottom: "1px solid var(--line)",
                    marginBottom: 16,
                  }}
                >
                  <div style={{ fontSize: 38, fontWeight: 800, color: "#818cf8" }}>
                    {propagateResult.posterior_mean.toFixed(4)}
                  </div>
                  <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>
                    ±{propagateResult.posterior_std.toFixed(4)} (posterior std)
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {convergenceBadge(propagateResult.convergence)}
                  </div>
                </div>

                {/* Credible intervals */}
                <RangeBar
                  low={propagateResult.credible_interval_95[0]}
                  high={propagateResult.credible_interval_95[1]}
                  label="95% Credible Interval"
                  color="#818cf8"
                />
                <RangeBar
                  low={propagateResult.credible_interval_68[0]}
                  high={propagateResult.credible_interval_68[1]}
                  label="68% Credible Interval"
                  color="#22d3ee"
                />

                {/* Histogram */}
                {propagateResult.posterior_samples.length > 0 && (
                  <PosteriorHistogram samples={propagateResult.posterior_samples} />
                )}

                {/* Diagnostics */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    marginTop: 16,
                  }}
                >
                  {(
                    [
                      ["ESS", propagateResult.effective_sample_size.toFixed(0)],
                      ["Skewness", propagateResult.skewness.toFixed(4)],
                      ["Kurtosis", propagateResult.kurtosis.toFixed(4)],
                    ] as [string, string][]
                  ).map(([label, val]) => (
                    <div
                      key={label}
                      style={{
                        background: "var(--bg)",
                        borderRadius: 6,
                        padding: "8px 10px",
                        border: "1px solid var(--line)",
                      }}
                    >
                      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{val}</div>
                    </div>
                  ))}
                  <div
                    style={{
                      background: "var(--bg)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>PRIOR USED</div>
                    <div style={{ fontWeight: 700, fontSize: 12, textTransform: "capitalize" }}>
                      {propagateResult.prior_used}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
                  Likelihood: <span style={{ color: "var(--strong)" }}>{propagateResult.likelihood}</span>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Compare Tab */}
      {tab === "compare" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
          <section className="panel">
            <div className="panel-header">
              <h3 style={{ fontWeight: 600 }}>Two Experiments</h3>
            </div>
            <form
              onSubmit={(e) => { void handleCompare(e); }}
              style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}
            >
              {/* Experiment A */}
              <div
                style={{
                  background: "rgba(99,102,241,0.06)",
                  border: "1px solid rgba(99,102,241,0.2)",
                  borderRadius: 8,
                  padding: "12px",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#818cf8", marginBottom: 10 }}>
                  Experiment A
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                      Counts (JSON)
                    </label>
                    <textarea
                      className="input"
                      value={countsA}
                      onChange={(e) => setCountsA(e.target.value)}
                      rows={2}
                      style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                      N Shots
                    </label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      value={shotsA}
                      onChange={(e) => setShotsA(parseInt(e.target.value, 10))}
                    />
                  </div>
                </div>
              </div>

              {/* Experiment B */}
              <div
                style={{
                  background: "rgba(34,211,238,0.06)",
                  border: "1px solid rgba(34,211,238,0.2)",
                  borderRadius: 8,
                  padding: "12px",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#22d3ee", marginBottom: 10 }}>
                  Experiment B
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                      Counts (JSON)
                    </label>
                    <textarea
                      className="input"
                      value={countsB}
                      onChange={(e) => setCountsB(e.target.value)}
                      rows={2}
                      style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                      N Shots
                    </label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      value={shotsB}
                      onChange={(e) => setShotsB(parseInt(e.target.value, 10))}
                    />
                  </div>
                </div>
              </div>

              {compareError && (
                <div style={{ color: "#f87171", fontSize: 12 }}>{compareError}</div>
              )}
              <button className="button" type="submit" disabled={comparing}>
                {comparing ? "Comparing…" : "Compare Bayesian"}
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3 style={{ fontWeight: 600 }}>Comparison Results</h3>
            </div>
            {!compareResult && (
              <div className="empty" style={{ fontSize: 13 }}>
                Submit both experiments to see Bayesian comparison.
              </div>
            )}
            {compareResult && (
              <div style={{ padding: "14px 18px" }}>
                {/* Bayes Factor */}
                <div
                  style={{
                    textAlign: "center",
                    padding: "20px 0",
                    borderBottom: "1px solid var(--line)",
                    marginBottom: 16,
                  }}
                >
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>BAYES FACTOR</div>
                  <div style={{ fontSize: 36, fontWeight: 800, color: "#facc15" }}>
                    {compareResult.bayes_factor.toFixed(3)}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8, fontStyle: "italic" }}>
                    {compareResult.interpretation}
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                  <div
                    style={{
                      background: "var(--bg)",
                      borderRadius: 6,
                      padding: "10px",
                      border: "1px solid var(--line)",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>EFFECT SIZE</div>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>{compareResult.effect_size.toFixed(4)}</div>
                  </div>
                  <div
                    style={{
                      background: "var(--bg)",
                      borderRadius: 6,
                      padding: "10px",
                      border: "1px solid var(--line)",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>POSTERIOR OVERLAP</div>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>
                      {(compareResult.posterior_overlap * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* Evidence bars */}
                <div style={{ marginBottom: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
                  EVIDENCE
                </div>
                <EvidenceBar
                  label="Evidence for A"
                  value={compareResult.evidence_for_a}
                  max={Math.max(compareResult.evidence_for_a, compareResult.evidence_for_b)}
                  color="#818cf8"
                />
                <EvidenceBar
                  label="Evidence for B"
                  value={compareResult.evidence_for_b}
                  max={Math.max(compareResult.evidence_for_a, compareResult.evidence_for_b)}
                  color="#22d3ee"
                />
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
