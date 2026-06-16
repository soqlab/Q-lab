"use client";

import { useState } from "react";
import {
  ShieldCheck, AlertTriangle, XCircle, CheckCircle2,
  BookOpen, Loader, ChevronDown, ChevronRight,
} from "lucide-react";
import { qlabApiPath } from "../../../lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FAIRCriterion {
  code: string;
  principle: string;
  name: string;
  passed: boolean;
  score: number; // 0, 1, or 2
  evidence: string;
  recommendation: string | null;
}

interface FAIRReport {
  run_id: string;
  overall_score: number;
  grade: string;
  findable_score: number;
  accessible_score: number;
  interoperable_score: number;
  reusable_score: number;
  criteria: FAIRCriterion[];
  journal_readiness: Record<string, boolean>;
  summary: string;
  generated_at: string;
}

interface ProjectFAIRReport {
  project_slug: string;
  run_count: number;
  overall_score: number;
  grade: string;
  findable_score: number;
  accessible_score: number;
  interoperable_score: number;
  reusable_score: number;
  per_run_scores: Array<{
    run_id: string;
    overall_score: number;
    grade: string;
  }>;
  journal_readiness: Record<string, boolean>;
  summary: string;
}

interface JournalRequirement {
  name: string;
  min_fair_score: number;
  requires_doi: boolean;
  requires_qasm: boolean;
  requires_license: boolean;
  data_repository: string;
  url: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#27ae60";
    case "B": return "#2ecc71";
    case "C": return "#f39c12";
    case "D": return "#e67e22";
    default:  return "#e74c3c";
  }
}

function scoreColor(score: number): string {
  if (score >= 85) return "#27ae60";
  if (score >= 70) return "#2ecc71";
  if (score >= 55) return "#f39c12";
  if (score >= 40) return "#e67e22";
  return "#e74c3c";
}

function criterionIcon(criterion: FAIRCriterion) {
  if (criterion.score === 2)
    return <CheckCircle2 size={15} style={{ color: "#27ae60", flexShrink: 0 }} />;
  if (criterion.score === 1)
    return <AlertTriangle size={15} style={{ color: "#f39c12", flexShrink: 0 }} />;
  return <XCircle size={15} style={{ color: "#e74c3c", flexShrink: 0 }} />;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreGauge({ score, grade }: { score: number; grade: string }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = scoreColor(score);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={136} height={136} viewBox="0 0 136 136">
        <circle cx={68} cy={68} r={r} fill="none" stroke="#e8ecf0" strokeWidth={12} />
        <circle
          cx={68} cy={68} r={r} fill="none"
          stroke={color} strokeWidth={12}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 68 68)"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        <text x={68} y={62} textAnchor="middle" fontSize={26} fontWeight={700} fill={color}>
          {score}
        </text>
        <text x={68} y={80} textAnchor="middle" fontSize={12} fill="#7f8c9a">/ 100</text>
      </svg>
      <span style={{
        fontSize: 22, fontWeight: 700, color: gradeColor(grade),
        background: `${gradeColor(grade)}18`, borderRadius: 8,
        padding: "4px 16px", letterSpacing: 1,
      }}>
        Grade {grade}
      </span>
    </div>
  );
}

function PrincipleBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 140 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        <span style={{ color: "#17202a" }}>{label}</span>
        <span style={{ color }}>{score}%</span>
      </div>
      <div style={{ height: 8, background: "#e8ecf0", borderRadius: 4, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${score}%`, background: color, borderRadius: 4,
          transition: "width 0.5s ease",
        }} />
      </div>
    </div>
  );
}

function CriteriaTable({ criteria }: { criteria: FAIRCriterion[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(code: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  const principles = ["Findable", "Accessible", "Interoperable", "Reusable"];

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--panel-2, #f7f8fa)", borderBottom: "1px solid var(--border)" }}>
            <th style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600, width: 48 }}>Code</th>
            <th style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600, width: 110 }}>Principle</th>
            <th style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600 }}>Criterion</th>
            <th style={{ padding: "9px 12px", textAlign: "center", fontWeight: 600, width: 70 }}>Status</th>
            <th style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600 }}>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {principles.map(principle => {
            const group = criteria.filter(c => c.principle === principle);
            return group.map((c, i) => (
              <>
                <tr
                  key={c.code}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: i % 2 === 0 ? "transparent" : "var(--panel-2, #f7f8fa)",
                    cursor: c.recommendation ? "pointer" : "default",
                  }}
                  onClick={() => c.recommendation && toggle(c.code)}
                >
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 600, fontSize: 12 }}>
                    {c.code}
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 12 }}>{c.principle}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{c.name}</span>
                      {c.recommendation && (
                        expanded.has(c.code)
                          ? <ChevronDown size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
                          : <ChevronRight size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      {criterionIcon(c)}
                    </div>
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 12 }}>{c.evidence}</td>
                </tr>
                {expanded.has(c.code) && c.recommendation && (
                  <tr key={`${c.code}-fix`} style={{ background: "#fffbea", borderBottom: "1px solid var(--border)" }}>
                    <td colSpan={5} style={{ padding: "8px 16px 8px 40px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#7d5a00" }}>
                        <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                        <span><strong>Fix:</strong> {c.recommendation}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

function JournalCard({ name, ready, report }: { name: string; ready: boolean; report: FAIRReport | ProjectFAIRReport }) {
  const isFAIRReport = "run_id" in report;
  return (
    <div style={{
      border: `1px solid ${ready ? "#27ae60" : "#e74c3c"}`,
      borderRadius: 8, padding: "14px 18px",
      background: ready ? "#f0faf4" : "#fef5f5",
      flex: 1, minWidth: 180,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {ready
          ? <CheckCircle2 size={16} style={{ color: "#27ae60" }} />
          : <XCircle size={16} style={{ color: "#e74c3c" }} />
        }
        <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
      </div>
      <div style={{ fontSize: 12, color: ready ? "#155724" : "#721c24" }}>
        {ready ? "Meets data requirements" : "Does not meet requirements"}
      </div>
    </div>
  );
}

function ImprovementsBox({ criteria }: { criteria: FAIRCriterion[] }) {
  const fixable = criteria
    .filter(c => c.score < 2 && c.recommendation)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  if (!fixable.length) {
    return (
      <div style={{ background: "#f0faf4", border: "1px solid #27ae60", borderRadius: 8, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#155724", fontSize: 14 }}>
          <CheckCircle2 size={16} /> All criteria passing — excellent FAIR compliance!
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#fffbea", border: "1px solid #f39c12", borderRadius: 8, padding: "16px 20px" }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: "#7d5a00", marginBottom: 12 }}>
        Top {fixable.length} improvement{fixable.length > 1 ? "s" : ""} for better FAIR compliance
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {fixable.map((c, i) => (
          <div key={c.code} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13 }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              background: "#f39c12", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}>
              {i + 1}
            </span>
            <div>
              <span style={{ fontWeight: 600, color: "#17202a" }}>{c.code} — {c.name}: </span>
              <span style={{ color: "#6c4a00" }}>{c.recommendation}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function FAIRPage() {
  const [mode, setMode] = useState<"run" | "project">("run");
  const [runId, setRunId] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FAIRReport | null>(null);
  const [projectReport, setProjectReport] = useState<ProjectFAIRReport | null>(null);
  const [journals, setJournals] = useState<JournalRequirement[] | null>(null);

  async function loadJournals() {
    if (journals) return;
    try {
      const res = await fetch(qlabApiPath("/api/v1/fair/journal-requirements"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setJournals(data.journals);
      }
    } catch {
      // non-critical
    }
  }

  async function handleCheck() {
    if (mode === "run" && !runId.trim()) return;
    if (mode === "project" && !projectSlug.trim()) return;

    setLoading(true);
    setError(null);
    setReport(null);
    setProjectReport(null);

    try {
      if (mode === "run") {
        const res = await fetch(qlabApiPath(`/api/v1/fair/check/${runId.trim()}`), { cache: "no-store" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as Record<string, string>;
          throw new Error(err.detail ?? `HTTP ${res.status}`);
        }
        const data: FAIRReport = await res.json();
        setReport(data);
        await loadJournals();
      } else {
        const res = await fetch(qlabApiPath(`/api/v1/fair/check/project/${projectSlug.trim()}`), { cache: "no-store" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as Record<string, string>;
          throw new Error(err.detail ?? `HTTP ${res.status}`);
        }
        const data: ProjectFAIRReport = await res.json();
        setProjectReport(data);
        await loadJournals();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const activeReport = report ?? projectReport;

  return (
    <main className="page">
      {/* Header */}
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={18} /> FAIR Data Compliance Checker
          </h2>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Findable · Accessible · Interoperable · Reusable
          </div>
        </div>
        <div style={{ padding: "16px 18px", borderTop: "1px solid var(--border)" }}>
          {/* Mode tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
            {(["run", "project"] as const).map(m => (
              <button
                key={m}
                className={`button ${mode === m ? "" : "secondary"}`}
                style={{ height: 30, fontSize: 12, textTransform: "capitalize" }}
                onClick={() => setMode(m)}
              >
                {m === "run" ? "Single Run" : "Project Bulk"}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            {mode === "run" ? (
              <div style={{ flex: 1, maxWidth: 400 }}>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Run ID
                </label>
                <input
                  className="input"
                  value={runId}
                  onChange={e => setRunId(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCheck()}
                  placeholder="e.g. abc12345-..."
                  style={{ width: "100%" }}
                />
              </div>
            ) : (
              <div style={{ flex: 1, maxWidth: 400 }}>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Project Slug
                </label>
                <input
                  className="input"
                  value={projectSlug}
                  onChange={e => setProjectSlug(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCheck()}
                  placeholder="e.g. my-qpu-experiment"
                  style={{ width: "100%" }}
                />
              </div>
            )}
            <button
              className="button"
              onClick={handleCheck}
              disabled={loading || (mode === "run" ? !runId.trim() : !projectSlug.trim())}
              style={{ height: 36 }}
            >
              {loading ? <Loader size={15} style={{ animation: "spin 1s linear infinite" }} /> : "Check FAIR Compliance"}
            </button>
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "#fef5f5", border: "1px solid #e74c3c", borderRadius: 6, fontSize: 13, color: "#e74c3c" }}>
              {error}
            </div>
          )}
        </div>
      </section>

      {/* Results */}
      {activeReport && (
        <>
          {/* Score Overview */}
          <section className="panel">
            <div className="panel-header">
              <h2>FAIR Score Overview</h2>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {report ? `Run: ${report.run_id.slice(0, 16)}...` : `Project: ${projectReport?.project_slug} (${projectReport?.run_count} runs)`}
              </span>
            </div>
            <div style={{ padding: "20px 18px", display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
              <ScoreGauge score={activeReport.overall_score} grade={activeReport.grade} />
              <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 14 }}>
                <PrincipleBar label="F — Findable" score={activeReport.findable_score} color="#3498db" />
                <PrincipleBar label="A — Accessible" score={activeReport.accessible_score} color="#27ae60" />
                <PrincipleBar label="I — Interoperable" score={activeReport.interoperable_score} color="#9b59b6" />
                <PrincipleBar label="R — Reusable" score={activeReport.reusable_score} color="#e67e22" />
              </div>
              <div style={{ flex: 1, minWidth: 220, maxWidth: 380, fontSize: 14, color: "#17202a", lineHeight: 1.7, padding: "12px 16px", background: "var(--panel-2, #f7f8fa)", borderRadius: 8, border: "1px solid var(--border)" }}>
                {activeReport.summary}
              </div>
            </div>
          </section>

          {/* Criteria Table (run mode only) */}
          {report && (
            <section className="panel">
              <div className="panel-header">
                <h2>Criteria Detail</h2>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {report.criteria.filter(c => c.score === 2).length}/{report.criteria.length} passing
                </span>
              </div>
              <div style={{ padding: "16px 18px" }}>
                <CriteriaTable criteria={report.criteria} />
              </div>
            </section>
          )}

          {/* Project per-run breakdown */}
          {projectReport && projectReport.per_run_scores.length > 0 && (
            <section className="panel">
              <div className="panel-header">
                <h2>Per-Run Scores</h2>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{projectReport.run_count} runs</span>
              </div>
              <div style={{ padding: "16px 18px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "var(--panel-2, #f7f8fa)", borderBottom: "1px solid var(--border)" }}>
                      <th style={{ padding: "8px 12px", textAlign: "left" }}>Run ID</th>
                      <th style={{ padding: "8px 12px", textAlign: "center" }}>Overall</th>
                      <th style={{ padding: "8px 12px", textAlign: "center" }}>Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectReport.per_run_scores.map((r, i) => (
                      <tr key={r.run_id} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--panel-2, #f7f8fa)" }}>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>
                          <a href={`/runs/${r.run_id}`} style={{ color: "#1d6f8f" }}>{r.run_id.slice(0, 20)}...</a>
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          <span style={{ fontWeight: 600, color: scoreColor(r.overall_score) }}>{r.overall_score}%</span>
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          <span style={{ fontWeight: 700, color: gradeColor(r.grade) }}>{r.grade}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Journal Readiness */}
          <section className="panel">
            <div className="panel-header">
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <BookOpen size={16} /> Journal Readiness
              </h2>
            </div>
            <div style={{ padding: "16px 18px", display: "flex", gap: 12, flexWrap: "wrap" }}>
              {Object.entries(activeReport.journal_readiness).map(([name, ready]) => (
                <JournalCard key={name} name={name} ready={ready} report={activeReport} />
              ))}
            </div>
            {journals && (
              <div style={{ padding: "0 18px 16px" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, fontWeight: 600 }}>
                  Detailed Requirements
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {journals.map(j => (
                    <div key={j.name} style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 6 }}>
                      <a href={j.url} target="_blank" rel="noreferrer" style={{ color: "#1d6f8f", fontWeight: 600, minWidth: 180 }}>{j.name}</a>
                      <span>Min score: {j.min_fair_score} | DOI: {j.requires_doi ? "required" : "optional"} | QASM: {j.requires_qasm ? "required" : "optional"} | License: {j.requires_license ? "required" : "optional"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Top Improvements */}
          {report && (
            <section className="panel">
              <div className="panel-header">
                <h2>Improvement Recommendations</h2>
              </div>
              <div style={{ padding: "16px 18px" }}>
                <ImprovementsBox criteria={report.criteria} />
              </div>
            </section>
          )}
        </>
      )}

      {/* Empty state */}
      {!activeReport && !loading && !error && (
        <div className="panel" style={{ padding: "48px 24px", textAlign: "center" }}>
          <ShieldCheck size={44} style={{ color: "#ccd", margin: "0 auto 16px" }} />
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Check FAIR Data Compliance</div>
          <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 480, margin: "0 auto", lineHeight: 1.7 }}>
            Enter a run ID or project slug above to evaluate compliance with FAIR data principles
            (Findable, Accessible, Interoperable, Reusable) — required by Nature, PRL, and major data repositories.
          </div>
        </div>
      )}
    </main>
  );
}
