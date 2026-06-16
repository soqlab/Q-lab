"use client";

import { useEffect, useState } from "react";
import { Network } from "lucide-react";
import { fetchUAFCPT, type UAFCPTResult, type UAFTargetScore } from "../../../../lib/api";

function scoreColor(score: number) {
  if (score >= 80) return "var(--ok)";
  if (score >= 60) return "var(--warn)";
  return "var(--danger)";
}

export default function UAFCPTPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<UAFCPTResult | null>(null);

  useEffect(() => {
    fetchUAFCPT(runId).then(setData).catch(() => setData(null));
  }, [runId]);

  if (!data) return null;

  const fp = data.algorithmic_fingerprint;
  const top = data.targets.slice(0, 4);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Network size={16} aria-hidden="true" />
          UAF-CPT Portability
        </h2>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          Grade {data.portability_grade} · best: {data.best_target ?? "n/a"}
        </span>
      </div>
      <div style={{ padding: "14px 18px", display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
          <Metric label="Semantic hash" value={fp.semantic_hash.slice(0, 12)} mono />
          <Metric label="2Q gates" value={String(fp.two_qubit_gate_count)} />
          <Metric label="Parametric" value={String(fp.parametric_gate_count)} />
          <Metric label="Interaction density" value={`${(fp.interaction_density * 100).toFixed(1)}%`} />
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {top.map((target) => <TargetRow key={target.target} target={target} />)}
        </div>

        <div style={{ fontSize: 11, color: "var(--muted)" }}>{data.note}</div>
      </div>
    </section>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: mono ? "monospace" : undefined }}>{value}</div>
    </div>
  );
}

function TargetRow({ target }: { target: UAFTargetScore }) {
  const color = scoreColor(target.combined_score);
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong style={{ flex: 1, fontSize: 13 }}>{target.target}</strong>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{target.family}</span>
        <span style={{ fontSize: 18, fontWeight: 800, color }}>{target.combined_score.toFixed(0)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, color: "var(--muted)" }}>
        <span>Portability {target.portability_score.toFixed(0)}%</span>
        <span>Fidelity {target.estimated_fidelity_score.toFixed(0)}%</span>
        <span>Overhead +{target.translation_overhead_gates} gates</span>
        <span>2Q translated {target.basis_translation.translated_two_qubit_gate_count}</span>
      </div>
      {target.unsupported_gates.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--danger)" }}>
          Unsupported: {target.unsupported_gates.join(", ")}
        </div>
      )}
    </div>
  );
}
