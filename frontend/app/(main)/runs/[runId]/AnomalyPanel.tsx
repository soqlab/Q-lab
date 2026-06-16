"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, Info } from "lucide-react";
import { fetchAnomaly, AnomalyResult, AnomalyFlag } from "../../../../lib/api";

// ------------------------------------------------------------------
// Z-score bar: shows ±3σ range, marks current run
// ------------------------------------------------------------------
function ZBar({ z }: { z: number }) {
  const clamped = Math.max(-3, Math.min(3, z));
  const pct = ((clamped + 3) / 6) * 100;
  const color = Math.abs(z) >= 3 ? "#dc2626" : Math.abs(z) >= 2 ? "#d97706" : "#3b82f6";
  return (
    <div style={{ position: "relative", width: 120, height: 8, background: "var(--panel-2)", borderRadius: 4 }}>
      {/* Centre line */}
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--line)" }} />
      {/* Marker */}
      <div style={{
        position: "absolute",
        left: `${pct}%`,
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: 10, height: 10,
        borderRadius: "50%",
        background: color,
        border: "2px solid var(--panel)",
      }} />
    </div>
  );
}

// ------------------------------------------------------------------
// Single flag row
// ------------------------------------------------------------------
function FlagRow({ flag }: { flag: AnomalyFlag }) {
  const isCrit = flag.severity === "critical";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "9px 18px", borderBottom: "1px solid var(--line)",
    }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: isCrit ? "#dc2626" : "#d97706" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{flag.label}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{flag.message}</div>
      </div>
      <ZBar z={flag.z_score} />
      <div style={{ fontSize: 12, color: "var(--muted)", width: 55, textAlign: "right" }}>
        p{flag.percentile}
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
        background: isCrit ? "#fee2e2" : "#fef3c7",
        color: isCrit ? "#dc2626" : "#d97706",
      }}>
        {isCrit ? "OUTLIER" : "WARNING"}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function AnomalyPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<AnomalyResult | null>(null);

  useEffect(() => {
    fetchAnomaly(runId).then(setData).catch(() => null);
  }, [runId]);

  if (!data || !data.sufficient_peers) return null;
  if (data.flags.length === 0 && !data.is_anomaly) return null;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {data.is_anomaly
            ? <AlertTriangle size={16} style={{ color: "#dc2626" }} />
            : <Info size={16} style={{ color: "#d97706" }} />
          }
          Statistical Anomaly Detection
        </h2>
        {data.is_anomaly ? (
          <span style={{ fontSize: 12, background: "#fee2e2", color: "#dc2626", fontWeight: 700, padding: "3px 10px", borderRadius: 999 }}>
            Anomalous Run
          </span>
        ) : (
          <span style={{ fontSize: 12, background: "#fef3c7", color: "#d97706", fontWeight: 700, padding: "3px 10px", borderRadius: 999 }}>
            Unusual Values
          </span>
        )}
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
          {data.peer_count} peer runs on {data.backend ?? "same backend"}
        </span>
      </div>

      {data.flags.map(f => <FlagRow key={f.metric} flag={f} />)}

      <div style={{ padding: "8px 18px", fontSize: 11, color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
        Z-score vs peer runs on the same backend. |z| &gt; 2 = unusual, |z| &gt; 3 = outlier.
        Bar centre = population mean; dot position = this run.
      </div>
    </section>
  );
}
