"use client";

import { useEffect, useState } from "react";
import { PieChart } from "lucide-react";
import { fetchErrorBudget, ErrorBudget } from "../../../../lib/api";

// ------------------------------------------------------------------
// Segmented horizontal bar
// ------------------------------------------------------------------
function BudgetBar({ components, totalError }: { components: ErrorBudget["components"]; totalError: number }) {
  if (totalError <= 0) return null;
  return (
    <div style={{ display: "flex", height: 20, borderRadius: 6, overflow: "hidden", width: "100%", gap: 1 }}>
      {components.filter(c => c.error_contribution > 0).map(c => (
        <div
          key={c.source}
          title={`${c.label}: ${(c.error_contribution * 100).toFixed(2)}% error (${c.pct_of_total.toFixed(1)}% of budget)`}
          style={{
            flex: c.error_contribution,
            background: c.color,
            transition: "flex 0.5s ease",
          }}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Row in the breakdown table
// ------------------------------------------------------------------
function ComponentRow({ c, totalError }: { c: ErrorBudget["components"][number]; totalError: number }) {
  const errPct = c.error_contribution * 100;
  const barWidth = totalError > 0 ? (c.error_contribution / totalError) * 100 : 0;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "160px 1fr 70px 60px",
      alignItems: "center",
      gap: 12,
      padding: "8px 0",
      borderBottom: "1px solid var(--line)",
      fontSize: 13,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: c.color, flexShrink: 0, display: "inline-block" }} />
        <span style={{ color: "var(--text)", fontWeight: 500 }}>{c.label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, height: 6, background: "var(--line)", borderRadius: 3 }}>
          <div style={{ width: `${barWidth}%`, height: "100%", background: c.color, borderRadius: 3, transition: "width 0.5s" }} />
        </div>
      </div>
      <div style={{ textAlign: "right", fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {errPct < 0.01 ? "<0.01" : errPct.toFixed(2)}%
      </div>
      <div style={{ textAlign: "right", color: "var(--muted)", fontSize: 12 }}>
        {c.pct_of_total.toFixed(0)}%
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Fidelity ring
// ------------------------------------------------------------------
function FidelityRing({ fidelity }: { fidelity: number }) {
  const color = fidelity >= 0.9 ? "var(--ok)" : fidelity >= 0.7 ? "var(--warn,#f59e0b)" : "var(--danger)";
  const R = 30;
  const circ = 2 * Math.PI * R;
  const pct = Math.round(fidelity * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ position: "relative", width: 72, height: 72 }}>
        <svg width={72} height={72} viewBox="0 0 72 72">
          <circle cx={36} cy={36} r={R} fill="none" stroke="var(--line)" strokeWidth={7} />
          <circle
            cx={36} cy={36} r={R} fill="none"
            stroke={color} strokeWidth={7}
            strokeDasharray={`${circ}`}
            strokeDashoffset={`${circ * (1 - fidelity)}`}
            strokeLinecap="round"
            transform="rotate(-90 36 36)"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color, lineHeight: 1 }}>{pct}%</span>
        </div>
      </div>
      <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Combined Fidelity
      </span>
    </div>
  );
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function ErrorBudgetPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<ErrorBudget | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchErrorBudget(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const totalErrPct = (data.total_error_budget * 100).toFixed(1);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PieChart size={16} aria-hidden="true" />
          Error Budget
        </h2>
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
          {data.has_calibration ? "Calibration-based" : "Estimated (no calibration)"}
        </span>
      </div>

      <div style={{ padding: "16px 18px", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>

        {/* Fidelity ring + summary */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <FidelityRing fidelity={data.combined_fidelity} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--danger)", fontVariantNumeric: "tabular-nums" }}>
              {totalErrPct}%
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Total error
            </div>
          </div>
          {data.dominant_source && (
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 999,
              background: "var(--danger-bg)", color: "var(--danger-text)",
            }}>
              Dominant: {data.components.find(c => c.source === data.dominant_source)?.label ?? data.dominant_source}
            </span>
          )}
        </div>

        {/* Breakdown */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <BudgetBar components={data.components} totalError={data.total_error_budget} />

          <div style={{ marginTop: 12 }}>
            <div style={{
              display: "grid", gridTemplateColumns: "160px 1fr 70px 60px", gap: 12,
              fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.05em", padding: "0 0 6px", borderBottom: "1px solid var(--line)",
            }}>
              <span>Source</span>
              <span>Contribution</span>
              <span style={{ textAlign: "right" }}>Error</span>
              <span style={{ textAlign: "right" }}>Share</span>
            </div>
            {data.components.map(c => (
              <ComponentRow key={c.source} c={c} totalError={data.total_error_budget} />
            ))}
          </div>

          {/* Calibration footnote */}
          {data.has_calibration && (
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", display: "flex", gap: 16, flexWrap: "wrap" }}>
              {data.calibration_used.avg_t1_us != null &&
                <span>T1 avg: <strong>{data.calibration_used.avg_t1_us} µs</strong></span>}
              {data.calibration_used.avg_t2_us != null &&
                <span>T2 avg: <strong>{data.calibration_used.avg_t2_us} µs</strong></span>}
              {data.calibration_used.avg_gate_error != null &&
                <span>Gate err: <strong>{(data.calibration_used.avg_gate_error * 100).toFixed(3)}%</strong></span>}
              {data.calibration_used.avg_readout_error != null &&
                <span>Readout err: <strong>{(data.calibration_used.avg_readout_error * 100).toFixed(2)}%</strong></span>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
