"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronDown, ChevronRight, Brain } from "lucide-react";
import { fetchRCA, RCAResult, RCACause } from "../../../../lib/api";
import FeedbackButtons from "./FeedbackButtons";

const SEVERITY_META: Record<string, { color: string; bg: string; Icon: React.FC<{ size?: number; color?: string }> }> = {
  critical: { color: "var(--danger)", bg: "var(--danger-bg)", Icon: (p) => <AlertCircle {...p} /> },
  high:     { color: "var(--warn,#f59e0b)", bg: "var(--warn-bg,#fef3c7)", Icon: (p) => <AlertTriangle {...p} /> },
  medium:   { color: "var(--info-text,#0284c7)", bg: "var(--info-bg,#e0f2fe)", Icon: (p) => <AlertTriangle {...p} /> },
  low:      { color: "var(--muted)", bg: "var(--panel-2)", Icon: (p) => <Info {...p} /> },
  info:     { color: "var(--muted)", bg: "var(--panel-2)", Icon: (p) => <Info {...p} /> },
};

const PROGNOSIS_META = {
  healthy:  { color: "var(--ok)", label: "Healthy", bg: "var(--ok-bg)" },
  notice:   { color: "var(--muted)", label: "Notice", bg: "var(--panel-2)" },
  warning:  { color: "var(--warn,#f59e0b)", label: "Warning", bg: "var(--warn-bg,#fef3c7)" },
  degraded: { color: "var(--danger)", label: "Degraded", bg: "var(--danger-bg)" },
  critical: { color: "var(--danger)", label: "Critical", bg: "var(--danger-bg)" },
} as const;

const CATEGORY_LABELS: Record<string, string> = {
  execution: "Execution",
  decoherence: "Decoherence",
  gate_errors: "Gate Errors",
  readout: "Readout",
  noise: "Noise",
  circuit_complexity: "Circuit",
  transpilation: "Transpilation",
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "var(--ok)" : pct >= 55 ? "var(--warn,#f59e0b)" : "var(--muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: "var(--line)", borderRadius: 2, maxWidth: 80 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 10, color: "var(--muted)", minWidth: 28 }}>{pct}%</span>
    </div>
  );
}

function CauseCard({ cause, runId }: { cause: RCACause; runId: string }) {
  const [expanded, setExpanded] = useState(false);
  const meta = SEVERITY_META[cause.severity] ?? SEVERITY_META.info;
  const { Icon } = meta;

  return (
    <div style={{
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: "0 6px 6px 0",
      background: meta.bg,
      marginBottom: 10,
      overflow: "hidden",
    }}>
      <div
        style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", cursor: "pointer" }}
        onClick={() => setExpanded(v => !v)}
        role="button"
      >
        <div style={{ flexShrink: 0, marginTop: 1 }}>
          <Icon size={15} color={meta.color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{cause.title}</span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
              background: "var(--panel)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              {CATEGORY_LABELS[cause.category] ?? cause.category}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--text)", margin: "0 0 6px", lineHeight: 1.55 }}>
            {cause.description}
          </p>
          <ConfidenceBar value={cause.confidence} />
        </div>
        <div style={{ flexShrink: 0, color: "var(--muted)" }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 14px 14px 39px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Suggestions */}
          {cause.suggestions.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: meta.color, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Recommendations
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                {cause.suggestions.map((s, i) => (
                  <li key={i} style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Evidence */}
          {Object.keys(cause.evidence).length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Evidence
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(cause.evidence).map(([k, v]) => (
                  <span key={k} style={{
                    fontSize: 11, background: "var(--panel)", border: "1px solid var(--line)",
                    padding: "2px 8px", borderRadius: 5, fontFamily: "monospace",
                    color: "var(--muted)",
                  }}>
                    {k.replace(/_/g, " ")}: <strong style={{ color: "var(--text)" }}>{String(v)}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{ padding: "0 14px 12px 39px" }}>
        <FeedbackButtons runId={runId} feature="rca" itemId={cause.id} />
      </div>
    </div>
  );
}

export default function RootCausePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<RCAResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRCA(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const prognosis = PROGNOSIS_META[data.overall_prognosis] ?? PROGNOSIS_META.notice;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Brain size={16} aria-hidden="true" />
          Root Cause Analysis
        </h2>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {data.cause_count === 0
            ? <CheckCircle2 size={14} color="var(--ok)" />
            : <span style={{ fontSize: 12, color: "var(--muted)" }}>{data.cause_count} issue{data.cause_count !== 1 ? "s" : ""} found</span>
          }
          <span style={{
            fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
            background: prognosis.bg, color: prognosis.color,
          }}>
            {prognosis.label.toUpperCase()}
          </span>
        </div>
      </div>

      <div style={{ padding: "14px 18px" }}>
        {data.cause_count === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--ok-bg)", borderRadius: 6 }}>
            <CheckCircle2 size={16} color="var(--ok)" />
            <span style={{ fontSize: 13, color: "var(--text)" }}>
              No issues detected — circuit looks healthy.
              {!data.has_calibration && " (No calibration data available for deeper analysis.)"}
            </span>
          </div>
        ) : (
          data.causes.map(cause => <CauseCard key={cause.id} cause={cause} runId={runId} />)
        )}

        <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", display: "flex", gap: 16, flexWrap: "wrap" }}>
          {data.circuit_time_us != null && (
            <span>Est. circuit time: <strong>{data.circuit_time_us} µs</strong></span>
          )}
          {data.two_qubit_gate_count > 0 && (
            <span>2Q gates: <strong>{data.two_qubit_gate_count}</strong></span>
          )}
          {data.has_calibration && <span>Calibration: <strong style={{ color: "var(--ok)" }}>used</strong></span>}
          <span style={{ marginLeft: "auto" }}>
            Analysed {new Date(data.analyzed_at).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </section>
  );
}
