"use client";

import { useState } from "react";
import { fetchEvoOptimizer, EvoOptimizerResult, EvoCandidate } from "../../../../lib/api";

const MUTATION_LABELS: Record<string, string> = {
  gate_cancel:    "Gate cancel",
  layer_merge:    "Layer merge",
  t_to_clifford:  "T→Clifford",
  cx_reduction:   "CX reduction",
  rz_absorption:  "RZ absorption",
  noop_removal:   "Noop removal",
};

function DeltaChip({ label, delta }: { label: string; delta: number }) {
  if (delta === 0) return null;
  const better = delta < 0;
  const color = better ? "#16a34a" : "#dc2626";
  const bg    = better ? "#f0fdf4" : "#fef2f2";
  return (
    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 10, background: bg, color, fontWeight: 600 }}>
      {label} {delta > 0 ? "+" : ""}{delta}
    </span>
  );
}

function CandidateCard({ cand, rank, baseline }: { cand: EvoCandidate; rank: number; baseline: EvoOptimizerResult["baseline"] }) {
  const [open, setOpen] = useState(rank === 0);
  const improved = cand.improvement_pct > 0;
  const borderColor = improved ? "#22c55e" : "#e5e7eb";

  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", background: improved ? "#f0fdf4" : "#f9fafb",
          border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          width: 22, height: 22, borderRadius: "50%", background: improved ? "#22c55e" : "#9ca3af",
          color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {rank + 1}
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
          Candidate {rank + 1}
          {cand.mutations_applied.length > 0 && (
            <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 400, marginLeft: 8 }}>
              via {cand.mutations_applied.map((m) => MUTATION_LABELS[m] ?? m).join(", ")}
            </span>
          )}
        </span>
        <span style={{
          fontSize: 12, fontWeight: 700,
          color: improved ? "#16a34a" : "#6b7280",
        }}>
          {cand.improvement_pct > 0 ? "+" : ""}{cand.improvement_pct}%
        </span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          fitness {cand.fitness.toFixed(3)}
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "12px 14px", background: "#fff" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <DeltaChip label="depth"    delta={cand.deltas.depth} />
            <DeltaChip label="gates"    delta={cand.deltas.size} />
            <DeltaChip label="CX"       delta={cand.deltas.cx_count} />
            {cand.deltas.non_clifford_ratio !== 0 && (
              <span style={{
                fontSize: 11, padding: "2px 7px", borderRadius: 10, fontWeight: 600,
                background: cand.deltas.non_clifford_ratio < 0 ? "#f0fdf4" : "#fef2f2",
                color: cand.deltas.non_clifford_ratio < 0 ? "#16a34a" : "#dc2626",
              }}>
                T-ratio {cand.deltas.non_clifford_ratio > 0 ? "+" : ""}{(cand.deltas.non_clifford_ratio * 100).toFixed(1)}%
              </span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            {(["depth", "size", "cx_count", "non_clifford_ratio"] as const).map((k) => {
              const bv = baseline[k as keyof typeof baseline];
              const cv = cand.fingerprint[k as keyof typeof cand.fingerprint];
              return (
                <div key={k} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                  borderRadius: 6, background: "#f9fafb", border: "1px solid #f3f4f6",
                }}>
                  <span style={{ fontSize: 11, color: "#6b7280", flex: 1 }}>
                    {k.replace(/_/g, " ")}
                  </span>
                  <span style={{ fontSize: 12, color: "#9ca3af", textDecoration: "line-through" }}>
                    {typeof bv === "number" && bv < 1 ? bv.toFixed(3) : bv}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                    {typeof cv === "number" && cv < 1 ? cv.toFixed(3) : cv}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.55 }}>{cand.summary}</div>
        </div>
      )}
    </div>
  );
}

export default function EvoOptimizerPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<EvoOptimizerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generations, setGenerations] = useState(20);

  const run = async () => {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await fetchEvoOptimizer(runId, generations);
      setData(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Evolutionary Circuit Optimizer</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <label style={{ fontSize: 12, color: "#6b7280" }}>Generations:</label>
          <select
            value={generations}
            onChange={(e) => setGenerations(Number(e.target.value))}
            style={{ fontSize: 12, padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: 6 }}
          >
            <option value={10}>10 (fast)</option>
            <option value={20}>20 (default)</option>
            <option value={50}>50 (thorough)</option>
            <option value={100}>100 (deep)</option>
          </select>
          <button
            onClick={run}
            disabled={loading}
            style={{
              padding: "6px 14px", background: "#6366f1", color: "#fff",
              border: "none", borderRadius: 6, fontSize: 13, cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Optimizing…" : "Run Optimizer"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: "#991b1b", background: "#fef2f2", padding: "8px 12px", borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {data && (
        <>
          <div style={{
            fontSize: 13, lineHeight: 1.55, padding: "10px 14px", borderRadius: 6, marginBottom: 16,
            background: data.candidates[0]?.improvement_pct > 0 ? "#f0fdf4" : "#f9fafb",
            borderLeft: `3px solid ${data.candidates[0]?.improvement_pct > 0 ? "#22c55e" : "#9ca3af"}`,
            color: "#374151",
          }}>
            {data.narrative}
          </div>

          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
            Baseline fitness: <strong style={{ color: "#374151" }}>{data.baseline_fitness.toFixed(3)}</strong>
            {" · "}{data.generations} generations · pop={data.pop_size} · {data.n_qubits} qubits
          </div>

          {data.candidates.map((c, i) => (
            <CandidateCard key={i} cand={c} rank={i} baseline={data.baseline} />
          ))}
        </>
      )}

      {!data && !loading && !error && (
        <div style={{
          padding: "24px", textAlign: "center", background: "#f9fafb",
          border: "1px dashed #d1d5db", borderRadius: 8, color: "#6b7280", fontSize: 13,
        }}>
          Click &ldquo;Run Optimizer&rdquo; to evolve candidate circuit variants with reduced depth, gate count, and T-count.
        </div>
      )}
    </section>
  );
}
