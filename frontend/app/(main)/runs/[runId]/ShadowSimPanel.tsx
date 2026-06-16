"use client";

import { useEffect, useState } from "react";
import { Waves } from "lucide-react";
import { fetchShadowSim, ShadowSimData } from "../../../../lib/api";

// ------------------------------------------------------------------
// Mini histogram bar for a single bitstring state
// ------------------------------------------------------------------
function Bar({ state, realProb, simProb }: { state: string; realProb: number; simProb: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <code style={{ fontSize: 11, minWidth: 60, textAlign: "right", color: "var(--muted)", fontFamily: "monospace" }}>
        |{state}⟩
      </code>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        {/* Real QPU */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: `${Math.max(realProb * 100, 0.5)}%`, maxWidth: "100%", height: 10, background: "var(--strong, #6366f1)", borderRadius: 3, transition: "width 0.4s ease" }} />
          <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>{(realProb * 100).toFixed(1)}%</span>
        </div>
        {/* Simulation */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: `${Math.max(simProb * 100, 0.5)}%`, maxWidth: "100%", height: 10, background: "var(--warn, #f59e0b)", borderRadius: 3, opacity: 0.8, transition: "width 0.4s ease" }} />
          <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>{(simProb * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// TVD ring gauge
// ------------------------------------------------------------------
function TVDGauge({ tvd, level }: { tvd: number; level: string }) {
  const color = level === "ok" ? "var(--ok)" : level === "warn" ? "var(--warn)" : "var(--danger)";
  const pct = Math.round(tvd * 100);
  const R = 32;
  const circ = 2 * Math.PI * R;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", width: 80, height: 80 }}>
        <svg width={80} height={80} viewBox="0 0 80 80">
          <circle cx={40} cy={40} r={R} fill="none" stroke="var(--line)" strokeWidth={8} />
          <circle
            cx={40} cy={40} r={R} fill="none"
            stroke={color} strokeWidth={8}
            strokeDasharray={`${circ}`}
            strokeDashoffset={`${circ * (1 - tvd)}`}
            strokeLinecap="round"
            transform="rotate(-90 40 40)"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color, lineHeight: 1 }}>{pct}%</span>
          <span style={{ fontSize: 9, color: "var(--muted)", lineHeight: 1, marginTop: 2 }}>TVD</span>
        </div>
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 600 }}>
        {level === "ok" ? "Low noise" : level === "warn" ? "Moderate" : "High noise"}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------
// Normalize counts to probability distributions
// ------------------------------------------------------------------
function normalizeCounts(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((s, v) => s + v, 0) || 1;
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / total]));
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function ShadowSimPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<ShadowSimData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchShadowSim(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const realProbs = normalizeCounts(data.real_counts);
  const simProbs = normalizeCounts(data.sim_counts);
  const allStates = [...new Set([...Object.keys(realProbs), ...Object.keys(simProbs)])].sort();

  // Show top 12 states by max probability
  const topStates = allStates
    .map(s => ({ s, max: Math.max(realProbs[s] ?? 0, simProbs[s] ?? 0) }))
    .sort((a, b) => b.max - a.max)
    .slice(0, 12)
    .map(({ s }) => s);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Waves size={16} aria-hidden="true" />
          Shadow Simulation
        </h2>
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
          {data.sim_backend ?? "AerSimulator"} · {data.shots?.toLocaleString() ?? "—"} shots
        </span>
      </div>

      <div style={{ padding: "16px 18px", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* TVD gauge + interpretation */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, minWidth: 120 }}>
          <TVDGauge tvd={data.tvd} level={data.tvd_level} />
          <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", maxWidth: 120, lineHeight: 1.4 }}>
            {data.tvd_interpretation}
          </div>
          {Object.keys(data.noise_model_summary).length > 0 && (
            <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
              {data.noise_model_summary.gate_error != null &&
                <div>Gate err: {(data.noise_model_summary.gate_error * 100).toFixed(1)}%</div>}
              {data.noise_model_summary.readout_error != null &&
                <div>Readout err: {(data.noise_model_summary.readout_error * 100).toFixed(1)}%</div>}
            </div>
          )}
        </div>

        {/* Histogram comparison */}
        <div style={{ flex: 1, minWidth: 260 }}>
          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 11, color: "var(--muted)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 8, background: "var(--strong, #6366f1)", borderRadius: 2, display: "inline-block" }} />
              Real QPU
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 8, background: "var(--warn, #f59e0b)", borderRadius: 2, opacity: 0.8, display: "inline-block" }} />
              Noise simulation
            </span>
          </div>
          {topStates.map(s => (
            <Bar
              key={s}
              state={s}
              realProb={realProbs[s] ?? 0}
              simProb={simProbs[s] ?? 0}
            />
          ))}
          {allStates.length > 12 && (
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0" }}>
              Showing top 12 of {allStates.length} states
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
