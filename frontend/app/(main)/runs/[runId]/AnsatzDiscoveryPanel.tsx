"use client";

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { fetchAnsatzDiscovery, AnsatzDiscoveryResult, AnsatzRecommendation } from "../../../../lib/api";

const FAMILY_COLOR: Record<string, string> = {
  hardware_efficient: "#6366f1",
  chemistry:          "#22c55e",
  problem_inspired:   "#f59e0b",
  deep_quantum:       "#8b5cf6",
  general:            "#6b7280",
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = score > 0.75 ? "#22c55e" : score > 0.55 ? "#f59e0b" : "#9ca3af";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 80, height: 6, background: "var(--line)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 600 }}>{pct}%</span>
    </div>
  );
}

function AnsatzCard({
  rec,
  isTop,
}: {
  rec: AnsatzRecommendation;
  isTop: boolean;
}) {
  const [open, setOpen] = useState(isTop);
  const familyColor = FAMILY_COLOR[rec.family] ?? "#6b7280";

  return (
    <div style={{
      border: `1px solid ${isTop ? familyColor : "var(--line)"}`,
      borderRadius: 8,
      marginBottom: 8,
      overflow: "hidden",
      boxShadow: isTop ? `0 0 0 2px ${familyColor}22` : "none",
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", background: isTop ? `${familyColor}0a` : "#f9fafb",
          border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          fontSize: 11, padding: "2px 8px", borderRadius: 10,
          background: `${familyColor}22`, color: familyColor, fontWeight: 600, flexShrink: 0,
        }}>
          {rec.family.replace("_", " ")}
        </span>
        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", flex: 1 }}>
          {rec.name}
          {isTop && (
            <span style={{ marginLeft: 8, fontSize: 10, color: "#22c55e", fontWeight: 500 }}>
              ★ TOP PICK
            </span>
          )}
        </span>
        <ScoreBar score={rec.score} />
        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "12px 14px", background: "var(--panel-2)" }}>
          <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, margin: "0 0 12px" }}>
            {rec.description}
          </p>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
            <Stat label="reps" value={String(rec.recommended_reps)} />
            <Stat label="parameters" value={String(rec.parameter_count)} />
            <Stat label="expressibility" value={`${Math.round(rec.expressibility * 100)}%`} />
            <Stat label="entangler" value={rec.entangler} />
            <Stat label="connectivity" value={rec.connectivity.replace("_", " ")} />
            <Stat label="trainability up to" value={`${rec.trainability_ceiling_qubits}q`} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>Expected fidelity:</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {rec.expected_fidelity_range.low} – {rec.expected_fidelity_range.high}
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {rec.best_for.map((tag) => (
              <span key={tag} style={{
                fontSize: 11, padding: "2px 7px", borderRadius: 10,
                background: "var(--surface-2)", color: "var(--muted)",
              }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnsatzDiscoveryPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<AnsatzDiscoveryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetchAnsatzDiscovery(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const ci = data.circuit_info;
  const familyColor = FAMILY_COLOR[data.circuit_family] ?? "#6b7280";
  const visible = showAll ? data.all_recommendations : data.all_recommendations.slice(0, 3);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Cpu size={16} aria-hidden="true" />
          Ansatz Discovery
        </h2>
        <span style={{
          marginLeft: "auto", fontSize: 11, padding: "2px 10px", borderRadius: 999,
          background: `${familyColor}18`, color: familyColor, fontWeight: 600,
          border: `1px solid ${familyColor}44`,
        }}>
          {data.circuit_family.replace("_", " ")}
        </span>
      </div>

      <div style={{ padding: "14px 18px" }}>
        {/* Circuit info strip */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
          <Stat label="qubits"  value={String(ci.n_qubits)} />
          <Stat label="depth"   value={String(ci.depth)} />
          <Stat label="CX count" value={String(ci.cx_count)} />
          <Stat label="NC ratio" value={`${Math.round(ci.nc_ratio * 100)}%`} />
          <Stat label="entanglement density" value={ci.entanglement_density.toFixed(2)} />
        </div>

        {/* Justification */}
        <p style={{
          fontSize: 13, lineHeight: 1.5, color: "var(--text)", margin: "0 0 14px",
          padding: "8px 12px", background: `${familyColor}0d`, borderRadius: 6,
          borderLeft: `3px solid ${familyColor}`,
        }}>
          {data.justification}
        </p>

        {/* Barren plateau warning */}
        {data.barren_plateau_warning && (
          <div style={{
            fontSize: 12, padding: "8px 12px", borderRadius: 6, marginBottom: 12,
            background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a",
          }}>
            ⚠ {data.barren_plateau_warning}
          </div>
        )}

        {/* Ranked ansatz cards */}
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500, marginBottom: 8 }}>
          Ranked recommendations ({data.all_recommendations.length} templates scored)
        </div>

        {visible.map((rec, i) => (
          <AnsatzCard key={rec.name} rec={rec} isTop={i === 0 && !showAll} />
        ))}

        {data.all_recommendations.length > 3 && (
          <button
            onClick={() => setShowAll((s) => !s)}
            style={{
              fontSize: 12, color: "var(--accent)", background: "none", border: "none",
              cursor: "pointer", padding: "4px 0", textDecoration: "underline",
            }}
          >
            {showAll ? "Show less" : `Show all ${data.all_recommendations.length} templates`}
          </button>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{value}</span>
    </div>
  );
}
