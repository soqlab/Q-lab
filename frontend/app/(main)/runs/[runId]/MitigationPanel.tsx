"use client";

import { useEffect, useState } from "react";
import { Shield, ChevronDown, ChevronRight } from "lucide-react";
import { fetchMitigationAdvice, MitigationAdvice, MitigationRec } from "../../../../lib/api";
import FeedbackButtons from "./FeedbackButtons";

// ------------------------------------------------------------------
// Severity badge
// ------------------------------------------------------------------
const SEV_META = {
  critical: { color: "#dc2626", bg: "#fee2e2", label: "Critical"  },
  high:     { color: "#d97706", bg: "#fef3c7", label: "High"      },
  moderate: { color: "#2563eb", bg: "#dbeafe", label: "Moderate"  },
  low:      { color: "#6b7280", bg: "#f3f4f6", label: "Low"       },
};

function SeverityBadge({ sev }: { sev: keyof typeof SEV_META }) {
  const m = SEV_META[sev] ?? SEV_META.low;
  return (
    <span style={{ background: m.bg, color: m.color, fontWeight: 700, fontSize: 12, padding: "3px 10px", borderRadius: 999 }}>
      {m.label} noise
    </span>
  );
}

// ------------------------------------------------------------------
// Method badge color
// ------------------------------------------------------------------
const METHOD_COLORS: Record<string, string> = {
  "ZNE": "#6366f1",
  "PEC": "#ec4899",
  "MEM": "#3b82f6",
  "Clifford-Data-Regression": "#f59e0b",
  "Pauli-Twirling": "#10b981",
  "Dynamical-Decoupling": "#8b5cf6",
};

// ------------------------------------------------------------------
// Confidence bar
// ------------------------------------------------------------------
function ConfBar({ conf }: { conf: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <div style={{ width: 80, height: 6, background: "var(--panel-2)", borderRadius: 3 }}>
        <div style={{ width: `${conf * 100}%`, height: "100%", background: "var(--strong)", borderRadius: 3 }} />
      </div>
      <span style={{ color: "var(--muted)" }}>{Math.round(conf * 100)}%</span>
    </div>
  );
}

// ------------------------------------------------------------------
// Recommendation card
// ------------------------------------------------------------------
function RecCard({ rec, runId }: { rec: MitigationRec; runId: string }) {
  const [open, setOpen] = useState(false);
  const color = METHOD_COLORS[rec.method] ?? "#6b7280";

  return (
    <div style={{ borderBottom: "1px solid var(--line)", padding: "12px 18px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* Method chip */}
        <div style={{
          flexShrink: 0, background: color + "22", color, fontWeight: 800,
          fontSize: 11, padding: "4px 8px", borderRadius: 6, letterSpacing: "0.04em",
          border: `1px solid ${color}44`,
        }}>
          {rec.method}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{rec.title}</span>
            <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>
              ~{rec.expected_tvd_reduction_pct}% TVD reduction
            </span>
          </div>
          <div style={{ marginTop: 4 }}>
            <ConfBar conf={rec.confidence} />
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 0", lineHeight: 1.5 }}>
            {rec.reasoning}
          </p>

          {/* Expandable section */}
          <button
            onClick={() => setOpen(o => !o)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 12, padding: "4px 0", display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Parameters &amp; docs
          </button>

          {open && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {rec.docs_hint && (
                <p style={{ fontSize: 12, color: "var(--muted)", background: "var(--panel-2)", padding: "6px 10px", borderRadius: 6, margin: 0 }}>
                  {rec.docs_hint}
                </p>
              )}
              {Object.keys(rec.suggested_parameters).length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Suggested parameters</div>
                  <pre style={{ fontSize: 11, background: "var(--panel-2)", padding: "6px 10px", borderRadius: 6, overflow: "auto", margin: 0 }}>
                    {JSON.stringify(rec.suggested_parameters, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
          <FeedbackButtons runId={runId} feature="mitigation" itemId={rec.method} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Context chip row
// ------------------------------------------------------------------
function ContextRow({ ctx }: { ctx: Record<string, unknown> }) {
  const show = Object.entries(ctx).filter(([, v]) => v !== null && v !== undefined);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 18px", borderTop: "1px solid var(--line)" }}>
      {show.map(([k, v]) => (
        <span key={k} style={{ fontSize: 11, background: "var(--panel-2)", padding: "2px 8px", borderRadius: 999, color: "var(--muted)" }}>
          {k.replace(/_/g, " ")}: <strong style={{ color: "var(--text)" }}>{String(v)}</strong>
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function MitigationPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<MitigationAdvice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMitigationAdvice(runId)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Unavailable"));
  }, [runId]);

  if (error || !data) return null;
  if (data.recommendation_count === 0) return null;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Shield size={16} aria-hidden="true" /> Error Mitigation Advisor
        </h2>
        <SeverityBadge sev={data.overall_severity as keyof typeof SEV_META} />
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
          {data.recommendation_count} recommendation{data.recommendation_count !== 1 ? "s" : ""}
        </span>
        {!data.has_shadow_simulation && (
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>
            · Run shadow simulation for higher-confidence advice
          </span>
        )}
      </div>

      {data.recommendations.map(r => <RecCard key={r.method} rec={r} runId={runId} />)}
      <ContextRow ctx={data.context} />
    </section>
  );
}
