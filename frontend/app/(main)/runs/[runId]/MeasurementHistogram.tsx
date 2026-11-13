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

const bits = (k: string) => k.replace(/ /g, "");

/**
 * The measured distribution in one ink. When the run's answer knows which outcomes the noise-free
 * circuit can produce (`expected`), those bars are filled and the rest are outlines, so the chart
 * shows exactly what the answer's percentage counts.
 */
export default function MeasurementHistogram({ results, expected }: { results: Record<string, unknown>; expected?: string[] | null }) {
  const analysis = useMemo(() => {
    const counts = parseResults(results);
    if (!counts) return null;

    const entries = Object.entries(counts)
      .map(([state, count]) => ({ state, count: Number(count) }))
      .sort((a, b) => b.count - a.count);

    if (!entries.length) return null;

    const total = entries.reduce((s, e) => s + e.count, 0);
    const top = entries.slice(0, 16);
    const probs = entries.map(e => e.count / total);
    const entropy = shannon_entropy(probs);
    const mostProbable = entries[0];
    const successProb = mostProbable.count / total;
    const isQuasiDist = Array.isArray(results.quasi_dists);

    return { top, total, entropy, mostProbable, successProb, isQuasiDist, numStates: entries.length };
  }, [results]);

  if (!analysis) return null;

  const { top, total, entropy, mostProbable, successProb, isQuasiDist, numStates } = analysis;
  const maxCount = top[0].count;
  const width = expected && expected.length ? Math.max(...expected.map((e) => e.length)) : 0;
  const isExpected = (state: string) => !!expected && expected.includes(bits(state).padStart(width, "0"));

  return (
    <section className="frame" aria-labelledby="hist-h">
      <div className="frame-head">
        <h2 id="hist-h" className="inst-label">What was measured</h2>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
          {isQuasiDist ? "quasi-probabilities" : `${total.toLocaleString()} shots · ${numStates} different outcomes`}
        </span>
      </div>

      <dl className="readouts d-expert" style={{ margin: "12px 14px 0" }}>
        <div className="readout"><dt>Most probable outcome</dt><dd>{mostProbable.state}<small>{(successProb * 100).toFixed(2)}% of shots</small></dd></div>
        <div className="readout"><dt>Shannon entropy</dt><dd>{entropy.toFixed(3)}<small>bits</small></dd></div>
        <div className="readout"><dt>Different outcomes</dt><dd>{numStates.toLocaleString()}</dd></div>
      </dl>

      <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 5 }}>
        {top.map((entry) => {
          const pct = (entry.count / maxCount) * 100;
          const prob = (entry.count / total * 100).toFixed(1);
          const exp = isExpected(entry.state);
          return (
            <div key={entry.state} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <code className="mono" style={{ width: 90, flexShrink: 0, fontSize: 12, textAlign: "right", color: exp || !expected ? "var(--text)" : "var(--muted)" }}>
                {entry.state}
              </code>
              <div style={{ flex: 1, height: 18, position: "relative" }}>
                <div
                  title={expected ? (exp ? "An outcome the noise-free circuit can produce" : "An outcome the noise-free circuit never produces: noise") : undefined}
                  style={{
                    position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(pct, 0.6)}%`,
                    background: exp || !expected ? "var(--text)" : "transparent",
                    border: exp || !expected ? "none" : "1px solid var(--muted)",
                    opacity: exp || !expected ? 0.85 : 1,
                  }} />
              </div>
              <div className="num" style={{ width: 110, flexShrink: 0, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: "var(--muted)" }}>{prob}%</span>
                <span style={{ color: "var(--text)" }}>{isQuasiDist ? entry.count.toFixed(3) : entry.count.toLocaleString()}</span>
              </div>
            </div>
          );
        })}
        {numStates > 16 && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Showing the 16 most frequent of {numStates} outcomes.</div>
        )}
        {expected && expected.length > 0 && (
          <div className="mono" style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 14, height: 8, background: "var(--text)", opacity: 0.85, display: "inline-block" }} /> expected outcome</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 14, height: 8, border: "1px solid var(--muted)", display: "inline-block" }} /> not produced by the noise-free circuit (noise)</span>
          </div>
        )}
      </div>
    </section>
  );
}
