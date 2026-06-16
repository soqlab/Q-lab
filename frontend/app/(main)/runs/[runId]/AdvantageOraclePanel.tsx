"use client";

import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { fetchAdvantageOracle, AdvantageOracleResult, StrategyDetail } from "../../../../lib/api";

const TIER_CONFIG = {
  easy:        { color: "#22c55e", label: "Classically easy",        bg: "#dcfce7" },
  moderate:    { color: "#f59e0b", label: "Classically moderate",    bg: "#fef3c7" },
  hard:        { color: "#ef4444", label: "Classically hard",        bg: "#fee2e2" },
  intractable: { color: "#7c3aed", label: "Classically intractable", bg: "#f5f0ff" },
};

const STRATEGY_LABEL: Record<string, string> = {
  stabilizer_rank: "Stabilizer rank (Bravyi et al.)",
  tensor_network:  "Tensor network contraction",
  mps_simulation:  "MPS / DMRG simulation",
  statevector:     "Brute-force statevector",
  clifford_t:      "Clifford + T decomposition",
};

function StrategyRow({ name, detail, isBest }: { name: string; detail: StrategyDetail; isBest: boolean }) {
  const cfg = TIER_CONFIG[detail.tier];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "7px 10px",
      borderRadius: 6, background: isBest ? `${cfg.color}0d` : "transparent",
      border: isBest ? `1px solid ${cfg.color}33` : "1px solid transparent",
      marginBottom: 4,
    }}>
      <span style={{
        fontSize: 10, padding: "1px 6px", borderRadius: 8,
        background: cfg.bg, color: cfg.color, fontWeight: 600, flexShrink: 0,
      }}>
        {detail.tier}
      </span>
      <span style={{ fontSize: 12, flex: 1, color: "var(--text)" }}>
        {STRATEGY_LABEL[name] ?? name.replace(/_/g, " ")}
        {isBest && <span style={{ marginLeft: 6, fontSize: 10, color: cfg.color, fontWeight: 600 }}>← best</span>}
      </span>
      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>
        {detail.human}
      </span>
    </div>
  );
}

function AdvantageGauge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 60 ? "#7c3aed" : pct >= 35 ? "#f59e0b" : "#22c55e";
  const label = pct >= 60 ? "Strong advantage signal" : pct >= 35 ? "Moderate signal" : "Weak signal";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>Quantum advantage score</span>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{pct}% — {label}</span>
      </div>
      <div style={{ height: 12, borderRadius: 6, background: "var(--line)", overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", borderRadius: 6,
          background: `linear-gradient(90deg, #6366f1, ${color})`,
          transition: "width 0.5s",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--muted)", marginTop: 2 }}>
        <span>Classically easy</span>
        <span>Quantum advantage</span>
      </div>
    </div>
  );
}

export default function AdvantageOraclePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<AdvantageOracleResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStrategies, setShowStrategies] = useState(false);

  useEffect(() => {
    fetchAdvantageOracle(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const tier = data.hardness_tier;
  const cfg = TIER_CONFIG[tier];

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={16} aria-hidden="true" />
          Quantum Advantage Oracle
        </h2>
        <span style={{
          marginLeft: "auto", fontSize: 11, padding: "2px 10px", borderRadius: 999,
          background: cfg.bg, color: cfg.color, fontWeight: 600,
          border: `1px solid ${cfg.color}44`,
        }}>
          {cfg.label}
        </span>
      </div>

      <div style={{ padding: "14px 18px" }}>
        {/* Advantage gauge */}
        <div style={{ marginBottom: 16 }}>
          <AdvantageGauge score={data.advantage_score} />
        </div>

        {/* Circuit stats row */}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
          <Stat label="qubits"  value={String(data.n_qubits)} />
          <Stat label="depth"   value={String(data.depth)} />
          <Stat label="T-count" value={String(data.t_count)} />
          <Stat label="CX count" value={String(data.cx_count)} />
          <Stat label="entanglement width" value={String(data.entanglement_width)} />
          {data.heavy_output_fraction != null && (
            <Stat
              label="heavy output"
              value={`${(data.heavy_output_fraction * 100).toFixed(0)}%`}
              color={data.heavy_output_fraction > 2/3 ? "#7c3aed" : undefined}
            />
          )}
        </div>

        {/* Best classical cost */}
        <div style={{
          padding: "10px 14px", borderRadius: 6, marginBottom: 12,
          background: `${cfg.color}0a`, border: `1px solid ${cfg.color}33`,
        }}>
          <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, marginBottom: 4 }}>
            Best classical strategy: <strong style={{ color: "var(--text)" }}>{STRATEGY_LABEL[data.best_classical_strategy] ?? data.best_classical_strategy}</strong>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: cfg.color, fontFamily: "monospace" }}>
            {data.best_classical_cost_human}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            Limiting factor: {data.limiting_factor}
          </div>
        </div>

        {/* Narrative */}
        <p style={{
          fontSize: 13, lineHeight: 1.55, color: "var(--text)", margin: "0 0 12px",
          padding: "8px 12px", background: `${cfg.color}08`, borderRadius: 6,
          borderLeft: `3px solid ${cfg.color}`,
        }}>
          {data.narrative}
        </p>

        {/* Contributing factors */}
        {data.contributing_factors.length > 0 && (
          <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
            {data.contributing_factors.map((f, i) => (
              <li key={i} style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                {f}
              </li>
            ))}
          </ul>
        )}

        {/* Strategy breakdown toggle */}
        <button
          onClick={() => setShowStrategies((s) => !s)}
          style={{
            fontSize: 12, color: "var(--accent)", background: "none", border: "none",
            cursor: "pointer", padding: "2px 0", textDecoration: "underline",
          }}
        >
          {showStrategies ? "Hide" : "Show"} all classical strategies
        </button>

        {showStrategies && (
          <div style={{ marginTop: 10 }}>
            {Object.entries(data.strategies)
              .sort((a, b) => a[1].log10_flops - b[1].log10_flops)
              .map(([name, detail]) => (
                <StrategyRow
                  key={name}
                  name={name}
                  detail={detail}
                  isBest={name === data.best_classical_strategy}
                />
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</span>
    </div>
  );
}
