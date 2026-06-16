"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { fetchMagic, MagicResult } from "../../../../lib/api";

const COST_COLOR: Record<string, string> = {
  polynomial: "#22c55e",
  "sub-exponential (t-sim)": "#f59e0b",
  exponential: "#e74c3c",
};

export default function MagicPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<MagicResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMagic(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const costColor = COST_COLOR[data.classical_simulation_cost] ?? "#aaa";
  const magicPct = Math.round(data.magic_score * 100);
  const cliffordPct = Math.round(data.clifford_fraction * 100);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={16} aria-hidden="true" />
          Non-Stabilizerness (Magic)
        </h2>
        {data.quantum_advantage_regime && (
          <span style={{
            marginLeft: "auto", fontSize: 11, padding: "2px 8px", borderRadius: 999,
            background: "#f5f0ff", color: "#7c3aed", fontWeight: 600, border: "1px solid #d8b4fe",
          }}>
            quantum advantage regime
          </span>
        )}
      </div>

      <div style={{ padding: "12px 18px" }}>
        {/* Main stats */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
          <Stat label="T-count" value={String(data.t_count)} />
          <Stat label="Non-Clifford gates" value={String(data.nc_count)} />
          <Stat label="Magic score" value={`${magicPct}%`} accent={magicPct > 30 ? "#7c3aed" : undefined} />
          <Stat label="Clifford fraction" value={`${cliffordPct}%`} accent={cliffordPct > 80 ? "#22c55e" : undefined} />
          <Stat
            label="Stabilizer rank bound"
            value={data.stabilizer_rank_bound >= 1e15 ? "≥10¹⁵" : `2^${data.t_count >> 1}`}
          />
        </div>

        {/* Simulation cost badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 12px", borderRadius: 6,
          background: `${costColor}18`, border: `1px solid ${costColor}44`,
          marginBottom: 12,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: costColor, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: costColor }}>
            Classical cost: {data.classical_simulation_cost}
          </span>
        </div>

        {/* Interpretation */}
        <p style={{ fontSize: 13, color: "var(--text)", margin: "0 0 12px", lineHeight: 1.5 }}>
          {data.t_count_interpretation}
        </p>

        {/* Fraction bar */}
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, fontWeight: 500 }}>
            Gate composition
          </div>
          <div style={{ height: 10, borderRadius: 6, overflow: "hidden", background: "var(--line)", display: "flex" }}>
            <div style={{ width: `${cliffordPct}%`, background: "#22c55e", transition: "width 0.4s" }} />
            <div style={{ width: `${magicPct}%`, background: "#7c3aed", transition: "width 0.4s" }} />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#22c55e", display: "inline-block" }} />
              Clifford ({cliffordPct}%)
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#7c3aed", display: "inline-block" }} />
              Non-Clifford ({magicPct}%)
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</span>
    </div>
  );
}
