"use client";

import { useEffect, useState } from "react";
import { fetchBugDatabase, BugDatabaseResult, BugMatch } from "../../../../lib/api";
import FeedbackButtons from "./FeedbackButtons";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#dc2626",
  warning:  "#d97706",
  info:     "#2563eb",
};

const SEVERITY_BG: Record<string, string> = {
  critical: "#fef2f2",
  warning:  "#fffbeb",
  info:     "#eff6ff",
};

const CATEGORY_LABEL: Record<string, string> = {
  coherent_error:    "Coherent Error",
  decoherence:       "Decoherence",
  measurement_error: "Measurement",
  compilation_bug:   "Compilation",
  calibration_drift: "Cal Drift",
  circuit_design:    "Design",
  hardware_mismatch: "HW Mismatch",
};

function VerdictBanner({ data }: { data: BugDatabaseResult }) {
  const color  = SEVERITY_COLOR[data.verdict] ?? "#16a34a";
  const bg     = SEVERITY_BG[data.verdict] ?? "#f0fdf4";
  const border = data.verdict === "clean" ? "#22c55e" : color;

  return (
    <div style={{
      padding: "10px 14px", borderRadius: 8, marginBottom: 14,
      background: bg, borderLeft: `4px solid ${border}`,
      display: "flex", alignItems: "flex-start", gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: data.verdict === "clean" ? "#16a34a" : color, marginBottom: 4 }}>
          {data.verdict === "clean" ? "Clean — no known bug patterns detected" :
           data.verdict === "critical" ? `Critical: ${data.n_critical} critical pattern${data.n_critical !== 1 ? "s" : ""} found` :
           data.verdict === "warning"  ? `Warning: ${data.n_warnings} warning pattern${data.n_warnings !== 1 ? "s" : ""} found` :
           `Info: ${data.n_info} informational pattern${data.n_info !== 1 ? "s" : ""} found`}
        </div>
        <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{data.narrative}</div>
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", flexShrink: 0, textAlign: "right" }}>
        {data.n_matches}/{data.db_size} patterns
      </div>
    </div>
  );
}

function BugCard({ bug, runId }: { bug: BugMatch; runId: string }) {
  const [open, setOpen] = useState(bug.severity === "critical");
  const color = SEVERITY_COLOR[bug.severity] ?? "#6b7280";
  const bg    = SEVERITY_BG[bug.severity] ?? "#f9fafb";
  const catLabel = CATEGORY_LABEL[bug.category] ?? bug.category;

  return (
    <div style={{
      border: `1px solid ${color}33`, borderRadius: 8, marginBottom: 8, overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", background: bg, border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 10,
          background: `${color}22`, color, fontWeight: 700, flexShrink: 0, textTransform: "uppercase",
        }}>
          {bug.severity}
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>{catLabel}</span>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, color: "#374151" }}>{bug.name}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{bug.id}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "12px 14px", background: "#fff" }}>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
            {bug.description}
          </p>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>Triggered by:</div>
            {bug.matched_rules.map((r, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10, marginBottom: 4,
                padding: "5px 10px", borderRadius: 5, background: "#f9fafb", fontSize: 12,
              }}>
                <code style={{ flex: 1, color: "#374151", fontFamily: "monospace", fontSize: 11 }}>{r.path}</code>
                <span style={{ color: "#6b7280" }}>{r.op} {r.threshold}</span>
                <span style={{ fontWeight: 600, color }}>actual: {r.actual !== null && r.actual !== undefined ? String(r.actual) : "n/a"}</span>
              </div>
            ))}
          </div>

          <div style={{
            padding: "8px 12px", borderRadius: 6,
            background: "#f0fdf4", borderLeft: "3px solid #22c55e", fontSize: 12, color: "#166534",
          }}>
            <strong>Fix:</strong> {bug.suggested_fix}
          </div>
          <FeedbackButtons runId={runId} feature="bug_database" itemId={bug.id} />
        </div>
      )}
    </div>
  );
}

export default function BugDatabasePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<BugDatabaseResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchBugDatabase(runId)
      .then(setData)
      .catch(() => setError("bug-database unavailable"));
  }, [runId]);

  if (error || !data) return null;

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Quantum Bug Database</h2>
        <span style={{
          fontSize: 11, padding: "2px 8px", borderRadius: 10,
          background: data.verdict === "clean" ? "#f0fdf4" : SEVERITY_BG[data.verdict],
          color: data.verdict === "clean" ? "#16a34a" : SEVERITY_COLOR[data.verdict],
          fontWeight: 600,
        }}>
          {data.n_matches} match{data.n_matches !== 1 ? "es" : ""}
        </span>
      </div>

      <VerdictBanner data={data} />

      {data.matches.map((bug) => (
        <BugCard key={bug.id} bug={bug} runId={runId} />
      ))}
    </section>
  );
}
