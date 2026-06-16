"use client";

import { useEffect, useState } from "react";
import { fetchReproScore, ReproScoreResult, FraudFlag, ReproDimension } from "../../../../lib/api";

const TIER_COLOR: Record<string, string> = {
  excellent: "#22c55e",
  good:      "#6366f1",
  fair:      "#f59e0b",
  poor:      "#ef4444",
};

const DIMENSION_LABEL: Record<string, string> = {
  environment_capture:    "Environment Capture",
  circuit_traceability:   "Circuit Traceability",
  calibration_snapshot:   "Calibration Snapshot",
  result_completeness:    "Result Completeness",
  parameter_completeness: "Parameter Completeness",
  timestamp_plausibility: "Timestamp Plausibility",
};

function ScoreGauge({ pct, tier }: { pct: number; tier: string }) {
  const color = TIER_COLOR[tier] ?? "#9ca3af";
  const r = 36, cx = 44, cy = 44;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg width={88} height={88} viewBox="0 0 88 88" style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={8} />
        <circle
          cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
        />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={16} fontWeight={700} fill={color}>
          {pct}%
        </text>
      </svg>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color, marginBottom: 2, textTransform: "capitalize" }}>
          {tier}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Reproducibility Score</div>
      </div>
    </div>
  );
}

function DimensionRow({ name, dim }: { name: string; dim: ReproDimension }) {
  const pct = Math.round(dim.score * 100);
  const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  const label = DIMENSION_LABEL[name] ?? name.replace(/_/g, " ");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: "#374151", width: 180, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#e5e7eb" }}>
        <div style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color, width: 34, textAlign: "right", flexShrink: 0 }}>
        {pct}%
      </span>
      <span style={{ fontSize: 11, color: "#9ca3af", flex: 1 }}>{dim.note}</span>
    </div>
  );
}

function FraudCard({ flag }: { flag: FraudFlag }) {
  const [open, setOpen] = useState(flag.severity === "warning");
  const color = flag.severity === "warning" ? "#d97706" : "#2563eb";
  const bg    = flag.severity === "warning" ? "#fffbeb" : "#eff6ff";

  return (
    <div style={{ border: `1px solid ${color}33`, borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "9px 14px", background: bg, border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 10,
          background: `${color}22`, color, fontWeight: 700, flexShrink: 0, textTransform: "uppercase",
        }}>
          {flag.severity}
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>{flag.code}</span>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, color: "#374151" }}>{flag.title}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "10px 14px", background: "#fff" }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
            {flag.description}
          </p>
          {Object.keys(flag.evidence).length > 0 && (
            <pre style={{
              fontSize: 11, background: "#f9fafb", border: "1px solid #e5e7eb",
              borderRadius: 5, padding: "6px 10px", margin: 0, overflowX: "auto",
            }}>
              {JSON.stringify(flag.evidence, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReproScorePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<ReproScoreResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchReproScore(runId)
      .then(setData)
      .catch(() => setError("repro-score unavailable"));
  }, [runId]);

  if (error || !data) return null;

  const hasFraud = data.fraud_flags.length > 0;

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Reproducibility Score</h2>
        {hasFraud && (
          <span style={{
            fontSize: 11, padding: "2px 8px", borderRadius: 10,
            background: data.fraud_severity === "warning" ? "#fffbeb" : "#eff6ff",
            color: data.fraud_severity === "warning" ? "#d97706" : "#2563eb",
            fontWeight: 600,
          }}>
            {data.fraud_flags.length} fraud signal{data.fraud_flags.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
        <ScoreGauge pct={data.overall_pct} tier={data.tier} />
        <div style={{
          flex: 1, minWidth: 220, padding: "12px 14px", borderRadius: 8,
          background: "#f9fafb", border: "1px solid #e5e7eb", fontSize: 13, color: "#374151", lineHeight: 1.6,
        }}>
          {data.narrative}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>Score Breakdown</div>
        {Object.entries(data.dimensions).map(([k, v]) => (
          <DimensionRow key={k} name={k} dim={v} />
        ))}
      </div>

      {hasFraud && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>
            Fraud / Integrity Signals
          </div>
          {data.fraud_flags.map((f) => (
            <FraudCard key={f.code} flag={f} />
          ))}
        </>
      )}

      {!hasFraud && (
        <div style={{
          padding: "10px 14px", borderRadius: 8,
          background: "#f0fdf4", borderLeft: "3px solid #22c55e",
          fontSize: 13, color: "#166534",
        }}>
          No integrity concerns detected across {data.fraud_flags.length === 0 ? "all" : ""} fraud checks.
        </div>
      )}
    </section>
  );
}
