"use client";

import { useMemo } from "react";

type CountsDict = Record<string, number>;

function shannon_entropy(probs: number[]): number {
  return -probs.reduce((s, p) => (p > 0 ? s + p * Math.log2(p) : s), 0);
}

function parseResults(results: Record<string, unknown>): CountsDict | null {
  // Qiskit v1: results.counts = {"00": 512, "11": 512}
  if (results.counts && typeof results.counts === "object") {
    return results.counts as CountsDict;
  }
  // Qiskit v2 quasi_dists: [{0: 0.5, 3: 0.5}] (integer keys = bitstring as int)
  if (Array.isArray(results.quasi_dists) && results.quasi_dists.length > 0) {
    const qd = results.quasi_dists[0] as Record<string, number>;
    const numQubits = Math.max(...Object.keys(qd).map(k => Math.floor(Math.log2(Number(k) + 1)) + 1), 1);
    const out: CountsDict = {};
    for (const [k, v] of Object.entries(qd)) {
      if (v > 0) {
        const bitstr = Number(k).toString(2).padStart(numQubits, "0");
        out[bitstr] = Math.round(v * 1000) / 1000; // probability as pseudo-count
      }
    }
    return Object.keys(out).length ? out : null;
  }
  // raw dict at top level with bitstring keys
  const keys = Object.keys(results);
  if (keys.length > 0 && keys.every(k => /^[01 ]+$/.test(k))) {
    return results as CountsDict;
  }
  return null;
}

const COLORS = [
  "var(--strong)", "var(--ok)", "var(--warn)", "var(--danger)",
  "#8b5cf6", "#06b6d4", "#f59e0b", "#10b981",
  "#3b82f6", "#ef4444", "#14b8a6", "#f97316",
];

export default function MeasurementHistogram({ results }: { results: Record<string, unknown> }) {
  const analysis = useMemo(() => {
    const counts = parseResults(results);
    if (!counts) return null;

    const entries = Object.entries(counts)
      .map(([state, count]) => ({ state, count: Number(count) }))
      .sort((a, b) => b.count - a.count);

    if (!entries.length) return null;

    const total = entries.reduce((s, e) => s + e.count, 0);
    const top = entries.slice(0, 16);
    const topTotal = top.reduce((s, e) => s + e.count, 0);
    const probs = entries.map(e => e.count / total);
    const entropy = shannon_entropy(probs);
    const mostProbable = entries[0];
    const successProb = mostProbable.count / total;
    const isQuasiDist = Array.isArray(results.quasi_dists);

    return { top, total, topTotal, entropy, mostProbable, successProb, isQuasiDist, numStates: entries.length };
  }, [results]);

  if (!analysis) return null;

  const { top, total, entropy, mostProbable, successProb, isQuasiDist, numStates } = analysis;
  const maxCount = top[0].count;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Measurement Results</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {isQuasiDist ? "Quasi-probability distribution" : `${total.toLocaleString()} shots · ${numStates} unique states`}
        </span>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, padding: "14px 18px" }}>
        {[
          { label: "Most probable state", value: <code style={{ fontSize: 14, fontFamily: "monospace" }}>{mostProbable.state}</code> },
          { label: "Probability", value: `${(successProb * 100).toFixed(2)}%` },
          { label: "Shannon entropy", value: `${entropy.toFixed(3)} bits` },
          { label: "Unique states", value: numStates.toLocaleString() },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: "var(--panel-2)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              {kpi.label}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{ padding: "0 18px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
        {top.map((entry, i) => {
          const pct = (entry.count / maxCount) * 100;
          const prob = (entry.count / total * 100).toFixed(1);
          const color = COLORS[i % COLORS.length];

          return (
            <div key={entry.state} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <code style={{
                width: 90, flexShrink: 0, fontSize: 12, textAlign: "right",
                color: "var(--text)", fontFamily: "monospace", letterSpacing: "0.05em",
              }}>
                {entry.state}
              </code>
              <div style={{ flex: 1, height: 22, background: "var(--panel-2)", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0,
                  width: `${pct}%`, background: color, borderRadius: 4,
                  opacity: 0.85, transition: "width 0.4s ease",
                }} />
              </div>
              <div style={{ width: 90, flexShrink: 0, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: "var(--muted)" }}>{prob}%</span>
                <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                  {isQuasiDist ? entry.count.toFixed(3) : entry.count.toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
        {numStates > 16 && (
          <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: 4 }}>
            Showing top 16 of {numStates} states
          </div>
        )}
      </div>
    </section>
  );
}
