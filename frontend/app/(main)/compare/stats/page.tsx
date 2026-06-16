"use client";

import { useState } from "react";
import { BarChart2, Plus, Trash2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { runStatsCompare, type StatsCompareResult } from "../../../../lib/api";

const METRICS = ["health_score", "depth", "size", "num_qubits", "non_clifford_ratio", "success_probability"] as const;

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ background: "var(--panel-2, #f7f8fa)", borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--muted, #5f6f80)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function DescriptiveBlock({ label, d }: { label: string; d: StatsCompareResult["descriptive"]["group_a"] }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--fg, #17202a)" }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <StatCard label="n" value={d.n} />
        <StatCard label="Mean" value={d.mean.toFixed(4)} />
        <StatCard label="Median" value={d.median.toFixed(4)} />
        <StatCard label="Std dev" value={d.std.toFixed(4)} />
        <StatCard label="P25" value={d.p25.toFixed(4)} />
        <StatCard label="P75" value={d.p75.toFixed(4)} />
        <StatCard label="Min" value={d.min.toFixed(4)} />
        <StatCard label="Max" value={d.max.toFixed(4)} />
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const configs: Record<string, { label: string; color: string; bg: string }> = {
    statistically_significant_meaningful_effect: { label: "Significant (meaningful)", color: "#1f8a5b", bg: "#eaf6ef" },
    statistically_significant_small_effect: { label: "Significant (small effect)", color: "#f39c12", bg: "#fef9ec" },
    no_meaningful_difference: { label: "No meaningful difference", color: "#7f8c8d", bg: "#f4f4f4" },
    insufficient_data: { label: "Insufficient data", color: "#e74c3c", bg: "#fdecea" },
  };
  const c = configs[verdict] ?? { label: verdict, color: "#888", bg: "#f4f4f4" };
  return (
    <span style={{
      padding: "3px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600,
      background: c.bg, color: c.color,
    }}>
      {c.label}
    </span>
  );
}

function DirectionIcon({ direction }: { direction: string }) {
  if (direction.includes(">")) return <TrendingUp size={16} color="#1f8a5b" />;
  if (direction.includes("<")) return <TrendingDown size={16} color="#e74c3c" />;
  return <Minus size={16} color="#888" />;
}

function RunIdList({ label, ids, onAdd, onRemove }: {
  label: string;
  ids: string[];
  onAdd: (id: string) => void;
  onRemove: (i: number) => void;
}) {
  const [input, setInput] = useState("");

  function add() {
    const id = input.trim();
    if (!id) return;
    onAdd(id);
    setInput("");
  }

  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--fg, #17202a)" }}>{label}</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          className="input"
          placeholder="Paste run ID…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          style={{ flex: 1, fontSize: 13 }}
        />
        <button className="button" type="button" onClick={add} style={{ height: 36, padding: "0 12px" }}>
          <Plus size={14} />
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {ids.map((id, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--panel-2, #f7f8fa)", borderRadius: 6, padding: "5px 10px" }}>
            <code style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{id}</code>
            <button
              className="button secondary"
              type="button"
              onClick={() => onRemove(i)}
              style={{ height: 26, padding: "0 8px", flexShrink: 0 }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {ids.length === 0 && (
          <div style={{ fontSize: 12, color: "#aaa", padding: "8px 0" }}>Add at least 2 run IDs</div>
        )}
      </div>
    </div>
  );
}

export default function StatsComparePage() {
  const [groupA, setGroupA] = useState<string[]>([]);
  const [groupB, setGroupB] = useState<string[]>([]);
  const [metric, setMetric] = useState("health_score");
  const [result, setResult] = useState<StatsCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await runStatsCompare({ group_a: groupA, group_b: groupB, metric });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BarChart2 size={17} /> Statistical Comparison
          </h2>
        </div>
        <div style={{ padding: "16px 18px" }}>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--muted, #5f6f80)", lineHeight: 1.6 }}>
            Compare two groups of runs using Welch&apos;s t-test, Cohen&apos;s d effect size, and bootstrap 95% confidence intervals.
            Suitable for publication-quality significance testing between experimental configurations.
          </p>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "var(--muted, #5f6f80)", display: "block", marginBottom: 6 }}>Metric</label>
              <select
                className="input"
                value={metric}
                onChange={e => setMetric(e.target.value)}
                style={{ width: 220 }}
              >
                {METRICS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
              <RunIdList
                label="Group A"
                ids={groupA}
                onAdd={id => setGroupA(a => [...a, id])}
                onRemove={i => setGroupA(a => a.filter((_, j) => j !== i))}
              />
              <RunIdList
                label="Group B"
                ids={groupB}
                onAdd={id => setGroupB(a => [...a, id])}
                onRemove={i => setGroupB(a => a.filter((_, j) => j !== i))}
              />
            </div>
            <button
              className="button"
              type="submit"
              disabled={loading || groupA.length < 2 || groupB.length < 2}
            >
              <BarChart2 size={15} /> {loading ? "Computing…" : "Run Statistical Test"}
            </button>
          </form>
          {error && <div className="auth-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </section>

      {result && (
        <>
          <section className="panel">
            <div className="panel-header">
              <h2>Result: <code style={{ fontSize: 14 }}>{result.metric}</code></h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <DirectionIcon direction={result.descriptive.direction} />
                <span style={{ fontSize: 13 }}>{result.descriptive.direction}</span>
                <VerdictBadge verdict={result.verdict} />
              </div>
            </div>
            <div style={{ padding: "16px 18px" }}>
              <div style={{
                background: "var(--panel-2, #f7f8fa)", borderRadius: 8, padding: "12px 16px",
                fontSize: 14, lineHeight: 1.7, marginBottom: 16, fontStyle: "italic", color: "var(--muted, #5f6f80)",
              }}>
                {result.interpretation}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
                <StatCard label="t statistic" value={result.welch_t_test.t?.toFixed(4) ?? "N/A"} />
                <StatCard label="Degrees of freedom" value={result.welch_t_test.df?.toFixed(1) ?? "N/A"} />
                <StatCard label="p-value" value={
                  <span style={{ color: (result.welch_t_test.p_value ?? 1) < 0.05 ? "#1f8a5b" : "#e74c3c" }}>
                    {result.welch_t_test.p_value?.toFixed(4) ?? "N/A"}
                  </span>
                } />
                <StatCard label={`Cohen's d (${result.effect_size.magnitude})`} value={result.effect_size.cohens_d?.toFixed(4) ?? "N/A"} />
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Bootstrap 95% CI for mean difference (A − B)</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{
                    padding: "8px 16px", borderRadius: 8, fontSize: 14, fontWeight: 600,
                    background: result.bootstrap_ci_95.contains_zero ? "#f4f4f4" : "#eaf6ef",
                    color: result.bootstrap_ci_95.contains_zero ? "#888" : "#1f8a5b",
                    border: "1px solid",
                    borderColor: result.bootstrap_ci_95.contains_zero ? "#ddd" : "#c0e8d0",
                  }}>
                    [{result.bootstrap_ci_95.lower.toFixed(4)}, {result.bootstrap_ci_95.upper.toFixed(4)}]
                  </div>
                  <span style={{ fontSize: 13, color: "var(--muted, #5f6f80)" }}>
                    Mean diff: <strong>{result.descriptive.mean_difference.toFixed(4)}</strong>
                    {result.bootstrap_ci_95.contains_zero
                      ? " — CI includes zero (consistent with no effect)"
                      : " — CI excludes zero (real effect)"}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 20 }}>
                <DescriptiveBlock label={`Group A (n=${result.group_a.usable_n})`} d={result.descriptive.group_a} />
                <DescriptiveBlock label={`Group B (n=${result.group_b.usable_n})`} d={result.descriptive.group_b} />
              </div>

              {(result.group_a.missing.length > 0 || result.group_b.missing.length > 0) && (
                <div style={{ marginTop: 12, fontSize: 12, color: "#e67e22" }}>
                  {result.group_a.missing.length > 0 && <div>Group A: {result.group_a.missing.length} run(s) not found</div>}
                  {result.group_b.missing.length > 0 && <div>Group B: {result.group_b.missing.length} run(s) not found</div>}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header"><h2>How to cite this test</h2></div>
            <pre style={{ margin: 0, padding: "14px 18px", fontSize: 13, background: "var(--panel-2, #f7f8fa)", borderRadius: "0 0 8px 8px", overflow: "auto" }}>
{`We compared ${result.metric} between two experimental configurations using Welch's t-test
(t(${result.welch_t_test.df?.toFixed(1)}) = ${result.welch_t_test.t?.toFixed(3)}, p = ${result.welch_t_test.p_value?.toFixed(4)},
Cohen's d = ${result.effect_size.cohens_d?.toFixed(3)} [${result.effect_size.magnitude} effect],
95% bootstrap CI: [${result.bootstrap_ci_95.lower.toFixed(4)}, ${result.bootstrap_ci_95.upper.toFixed(4)}]).
Group A: n=${result.group_a.usable_n}, μ=${result.descriptive.group_a.mean.toFixed(4)} ± ${result.descriptive.group_a.std.toFixed(4)}.
Group B: n=${result.group_b.usable_n}, μ=${result.descriptive.group_b.mean.toFixed(4)} ± ${result.descriptive.group_b.std.toFixed(4)}.`}
            </pre>
          </section>
        </>
      )}
    </main>
  );
}
