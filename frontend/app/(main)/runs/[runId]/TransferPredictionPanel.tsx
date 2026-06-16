"use client";

import { useEffect, useState } from "react";
import { fetchTransferPrediction, TransferPredictionResult, TransferPrediction } from "../../../../lib/api";

const TIER_COLOR: Record<string, string> = {
  excellent: "#22c55e",
  good:      "#6366f1",
  fair:      "#f59e0b",
  poor:      "#ef4444",
};

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: "#e5e7eb", flex: 1, minWidth: 60 }}>
      <div style={{ height: "100%", borderRadius: 3, width: `${Math.round(value * 100)}%`, background: color, transition: "width 0.4s" }} />
    </div>
  );
}

function ComponentRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: "#6b7280", width: 140, flexShrink: 0 }}>{label}</span>
      <ScoreBar value={value} color={color} />
      <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", width: 36, textAlign: "right", flexShrink: 0 }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function PredictionCard({ pred, rank }: { pred: TransferPrediction; rank: number }) {
  const [open, setOpen] = useState(rank === 0);
  const tierColor = TIER_COLOR[pred.tier] ?? "#9ca3af";
  const pct = Math.round(pred.transfer_score * 100);

  return (
    <div style={{
      border: `1px solid ${tierColor}44`, borderRadius: 8, marginBottom: 8, overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", background: `${tierColor}0a`, border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          width: 22, height: 22, borderRadius: "50%", background: tierColor,
          color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {rank + 1}
        </span>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, fontFamily: "monospace" }}>
          {pred.target_backend}
        </span>
        <span style={{
          fontSize: 11, padding: "2px 8px", borderRadius: 10,
          background: `${tierColor}22`, color: tierColor, fontWeight: 700, flexShrink: 0,
        }}>
          {pred.tier}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: tierColor, width: 40, textAlign: "right", flexShrink: 0 }}>
          {pct}%
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "12px 14px", background: "#fff" }}>
          <div style={{ marginBottom: 10 }}>
            <ComponentRow label="Calibration similarity" value={pred.component_scores.calibration_similarity} color="#6366f1" />
            <ComponentRow label="Gate compatibility"     value={pred.component_scores.gate_compatibility}     color="#22c55e" />
            <ComponentRow label="Structural fit"         value={pred.component_scores.structural_fit}         color="#f59e0b" />
            <ComponentRow label="Noise compatibility"    value={pred.component_scores.noise_compatibility}    color="#8b5cf6" />
          </div>

          {pred.gates_needing_decomposition.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 12, color: "#92400e", background: "#fef3c7", borderRadius: 6, padding: "6px 10px" }}>
              Gates needing transpilation:{" "}
              {pred.gates_needing_decomposition.map((g) => (
                <code key={g} style={{ marginRight: 6, background: "#fde68a", borderRadius: 3, padding: "1px 4px" }}>{g}</code>
              ))}
            </div>
          )}

          {pred.target_n_qubits !== "unknown" && (
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
              Target qubit count: <strong style={{ color: "#374151" }}>{pred.target_n_qubits}</strong>
              {" · "}Family: <strong style={{ color: "#374151" }}>{pred.target_family}</strong>
              {pred.has_calibration_data ? "" : " · "}
              {!pred.has_calibration_data && <span style={{ color: "#9ca3af" }}>(no calibration data)</span>}
            </div>
          )}

          <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.55, borderTop: "1px solid #f3f4f6", paddingTop: 8, marginTop: 4 }}>
            {pred.reason}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TransferPredictionPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<TransferPredictionResult | null>(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetchTransferPrediction(runId)
      .then(setData)
      .catch(() => setError("transfer-prediction unavailable"));
  }, [runId]);

  if (error || !data) return null;

  const visible = showAll ? data.predictions : data.predictions.slice(0, 3);

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Cross-Backend Transfer Prediction</h2>
        <span style={{
          fontSize: 11, padding: "2px 8px", borderRadius: 10,
          background: "#eff6ff", color: "#1e40af", fontWeight: 600,
        }}>
          {data.source_backend}
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto" }}>
          {data.n_qubits}q · {data.circuit_family}
        </span>
      </div>

      {data.predictions.length > 0 && (
        <div style={{
          marginBottom: 14, padding: "10px 14px", borderRadius: 8,
          background: "#f0fdf4", borderLeft: "3px solid #22c55e", fontSize: 13, color: "#374151",
        }}>
          Best transfer target: <strong style={{ color: "#16a34a", fontFamily: "monospace" }}>{data.top_recommendation}</strong>
          {" "}&mdash; {Math.round(data.top_score * 100)}% compatibility
        </div>
      )}

      {visible.map((pred, i) => (
        <PredictionCard key={pred.target_backend} pred={pred} rank={i} />
      ))}

      {data.predictions.length > 3 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          style={{
            width: "100%", padding: "8px", background: "#f9fafb",
            border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13, cursor: "pointer", color: "#6b7280",
          }}
        >
          {showAll ? "Show fewer backends" : `Show all ${data.predictions.length} backends`}
        </button>
      )}
    </section>
  );
}
