"use client";

import { useEffect, useState } from "react";
import { Brain, RefreshCw, Sparkles, AlertTriangle, TrendingUp, BookOpen, Target, ChevronRight, Cpu, Zap, GitBranch, ExternalLink, Loader2 } from "lucide-react";
import {
  fetchInsights, generateInsights, getCircuitInsights, getRunLiterature,
  type RunInsights, type InsightRecommendation, type CircuitInsight, type LiteraturePaper,
} from "../../../../lib/api";

// ------------------------------------------------------------------
// Grade badge
// ------------------------------------------------------------------
const GRADE_COLORS: Record<string, { bg: string; color: string }> = {
  "A+": { bg: "#d1fae5", color: "#065f46" },
  "A":  { bg: "#d1fae5", color: "#065f46" },
  "B+": { bg: "#dbeafe", color: "#1e40af" },
  "B":  { bg: "#dbeafe", color: "#1e40af" },
  "C+": { bg: "#fef3c7", color: "#92400e" },
  "C":  { bg: "#fef3c7", color: "#92400e" },
  "D":  { bg: "#fee2e2", color: "#991b1b" },
  "F":  { bg: "#fee2e2", color: "#991b1b" },
};

function GradeBadge({ grade }: { grade: string }) {
  const style = GRADE_COLORS[grade] ?? { bg: "var(--panel-2)", color: "var(--muted)" };
  return (
    <div style={{
      width: 56, height: 56, borderRadius: 12,
      background: style.bg, color: style.color,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 22, fontWeight: 900, flexShrink: 0,
      border: `2px solid ${style.color}44`,
    }}>
      {grade}
    </div>
  );
}

// ------------------------------------------------------------------
// Priority chip
// ------------------------------------------------------------------
const PRIORITY_META = {
  critical: { bg: "#fee2e2", color: "#dc2626", label: "Critical" },
  high:     { bg: "#fef3c7", color: "#d97706", label: "High"     },
  medium:   { bg: "#dbeafe", color: "#2563eb", label: "Medium"   },
  low:      { bg: "var(--panel-2)", color: "var(--muted)", label: "Low" },
};

function PriorityChip({ p }: { p: InsightRecommendation["priority"] }) {
  const m = PRIORITY_META[p] ?? PRIORITY_META.low;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: m.bg, color: m.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {m.label}
    </span>
  );
}

// ------------------------------------------------------------------
// Recommendation card
// ------------------------------------------------------------------
function RecCard({ rec, index }: { rec: InsightRecommendation; index: number }) {
  return (
    <div style={{
      display: "flex", gap: 14, padding: "12px 0",
      borderBottom: "1px solid var(--line)",
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
        background: "var(--strong)", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 700,
      }}>
        {index + 1}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{rec.action}</span>
          <PriorityChip p={rec.priority} />
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 4px", lineHeight: 1.5 }}>{rec.why}</p>
        {rec.expected_impact && (
          <div style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>
            Expected: {rec.expected_impact}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Confidence indicator
// ------------------------------------------------------------------
function ConfidenceBar({ level }: { level: string }) {
  const w = level === "high" ? "100%" : level === "medium" ? "66%" : "33%";
  const color = level === "high" ? "#10b981" : level === "medium" ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <span style={{ color: "var(--muted)" }}>AI confidence</span>
      <div style={{ width: 60, height: 4, background: "var(--panel-2)", borderRadius: 2 }}>
        <div style={{ width: w, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ color, fontWeight: 600 }}>{level}</span>
    </div>
  );
}

// ------------------------------------------------------------------
// Loading state — animated shimmer
// ------------------------------------------------------------------
function GeneratingState() {
  return (
    <div style={{ padding: "32px 24px", textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 12 }}>
        <Brain size={22} style={{ color: "var(--strong)", animation: "pulse 1.5s ease-in-out infinite" }} />
        <span style={{ fontSize: 16, fontWeight: 600 }}>Analysing experiment…</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 380, margin: "0 auto", lineHeight: 1.6 }}>
        Claude is reading your circuit fingerprint, calibration data, health breakdown, and tracked metrics to generate a detailed analysis.
      </div>
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {["Reviewing circuit structure…", "Cross-referencing calibration data…", "Identifying bottlenecks…", "Generating recommendations…"].map((s, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)",
            opacity: 0.5 + i * 0.15,
          }}>
            <ChevronRight size={11} />
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Circuit Analysis sub-panel
// ------------------------------------------------------------------
function GateEfficiencyBar({ score }: { score: number }) {
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "var(--panel-2)", borderRadius: 3 }}>
        <div style={{ width: `${Math.min(100, Math.max(0, score))}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 32 }}>{score}</span>
    </div>
  );
}

function CircuitAnalysisSection({ runId }: { runId: string }) {
  const [data, setData] = useState<CircuitInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setErr(null);
    getCircuitInsights(runId)
      .then(setData)
      .catch(e => setErr(e instanceof Error ? e.message : "Analysis failed"))
      .finally(() => setLoading(false));
  }

  if (!data && !loading && !err) {
    return (
      <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)" }}>
        <button
          className="button secondary"
          onClick={load}
          style={{ height: 30, fontSize: 12, padding: "0 14px" }}
        >
          <Cpu size={12} /> Deep Circuit Analysis
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 20px", borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
        <Cpu size={13} /> Circuit Analysis
        {!loading && (
          <button className="button secondary" onClick={load} style={{ height: 22, fontSize: 10, padding: "0 8px", marginLeft: "auto" }}>
            <RefreshCw size={10} /> Refresh
          </button>
        )}
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
          <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Analysing circuit gates…
        </div>
      )}

      {err && <div style={{ fontSize: 13, color: "var(--danger)" }}>{err}</div>}

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Algorithm + efficiency */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff" }}>
                {data.algorithm_type}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase" }}>Gate Efficiency</div>
            <GateEfficiencyBar score={data.gate_efficiency_score} />
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0", lineHeight: 1.5 }}>{data.gate_efficiency_rationale}</p>
          </div>

          {/* Depth + entanglement */}
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
              <Zap size={11} /> Depth vs Coherence
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.5, margin: "0 0 10px", color: "var(--text)" }}>{data.depth_coherence_ratio}</p>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
              <GitBranch size={11} /> Entanglement
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0, color: "var(--text)" }}>{data.entanglement_structure}</p>
          </div>

          {/* Gate optimizations — full width */}
          {data.gate_optimizations && data.gate_optimizations.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase" }}>Gate-Level Optimizations</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.gate_optimizations.map((opt, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", background: "var(--panel-2)", borderRadius: 6 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, flexShrink: 0,
                      background: opt.priority === "high" ? "#fef3c7" : opt.priority === "medium" ? "#dbeafe" : "var(--panel)",
                      color: opt.priority === "high" ? "#d97706" : opt.priority === "medium" ? "#2563eb" : "var(--muted)",
                    }}>
                      {opt.priority.toUpperCase()}
                    </span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{opt.optimization}</span>
                      <span style={{ fontSize: 12, color: "var(--ok)", marginLeft: 8 }}>({opt.gates_saved})</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Related Literature section
// ------------------------------------------------------------------
function LiteratureSection({ runId }: { runId: string }) {
  const [papers, setPapers] = useState<LiteraturePaper[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    getRunLiterature(runId)
      .then(r => {
        if (r.error && r.papers.length === 0) setFetchError(r.error);
        else setPapers(r.papers);
      })
      .catch(() => setFetchError("Could not load literature suggestions"))
      .finally(() => setLoading(false));
  }, [runId]);

  // Silently hide if no papers and no error worth showing
  if (!loading && !fetchError && papers !== null && papers.length === 0) return null;

  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BookOpen size={16} style={{ color: "#6366f1" }} />
          Related Literature
        </h2>
        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>arXiv suggestions based on circuit analysis</span>
      </div>

      {loading && (
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
          <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Searching arXiv for relevant papers…
        </div>
      )}

      {fetchError && (
        <div style={{ padding: "12px 20px", fontSize: 13, color: "var(--muted)" }}>
          Literature suggestions unavailable: {fetchError}
        </div>
      )}

      {papers && papers.length > 0 && (
        <div style={{ padding: "8px 0" }}>
          {papers.map((paper, i) => (
            <div key={paper.arxiv_id} style={{
              padding: "14px 20px",
              borderBottom: i < papers.length - 1 ? "1px solid var(--line)" : "none",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a
                    href={paper.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 14, fontWeight: 700, color: "var(--strong)", textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}
                  >
                    {paper.title}
                    <ExternalLink size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                  </a>
                  <div style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 6px" }}>
                    {paper.authors.length > 0
                      ? `${paper.authors[0]}${paper.authors.length > 1 ? ` et al.` : ""}`
                      : "Unknown authors"}
                    {" · "}
                    <span style={{ fontFamily: "monospace", fontSize: 11 }}>{paper.arxiv_id}</span>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text)", margin: "0 0 6px", lineHeight: 1.55 }}>
                    {paper.abstract_snippet}
                  </p>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--panel-2)", color: "var(--muted)", fontStyle: "italic" }}>
                    {paper.relevance_reason}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------
// Main panel
// ------------------------------------------------------------------
export default function InsightsPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<RunInsights | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // Try to load cached insights on mount
  useEffect(() => {
    fetchInsights(runId)
      .then(setData)
      .catch(e => {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "fetch_failed") setUnavailable(true);
        // "not_generated" is fine — show generate button
      });
  }, [runId]);

  async function generate(force = false) {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateInsights(runId, force);
      setData(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Generation failed";
      if (msg.includes("not configured") || msg.includes("unavailable")) {
        setUnavailable(true);
      } else {
        setError(msg);
      }
    } finally {
      setGenerating(false);
    }
  }

  // Don't render if API key not configured
  if (unavailable) return null;

  // No insights yet — show generate button
  if (!data && !generating) {
    return (
      <section className="panel" style={{ borderLeft: "3px solid var(--strong)" }}>
        <div style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Sparkles size={22} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>AI Experiment Insights</div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              Get a detailed analysis of this run: performance grading, bottleneck identification, quantified recommendations, and suggested next experiments — powered by Claude.
            </div>
          </div>
          <button
            className="button"
            onClick={() => void generate()}
            style={{ height: 38, fontSize: 14, padding: "0 20px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none", flexShrink: 0 }}
          >
            <Brain size={15} /> Generate Analysis
          </button>
        </div>
        {error && (
          <div style={{ padding: "10px 24px", fontSize: 13, color: "var(--danger)", borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {error}
          </div>
        )}
      </section>
    );
  }

  if (generating) {
    return (
      <section className="panel" style={{ borderLeft: "3px solid #6366f1" }}>
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Brain size={16} style={{ color: "#6366f1" }} /> AI Insight Engine
          </h2>
        </div>
        <GeneratingState />
      </section>
    );
  }

  if (!data) return null;

  const recs = data.recommendations ?? [];
  const criticalRecs = recs.filter(r => r.priority === "critical" || r.priority === "high");

  return (
    <section className="panel" style={{ borderLeft: "3px solid #6366f1" }}>
      {/* Header */}
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Brain size={16} style={{ color: "#6366f1" }} />
          AI Experiment Insights
        </h2>
        <ConfidenceBar level={data.confidence} />
        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
          {data.model} · {data.cached ? "cached" : "just generated"} · {new Date(data.created_at).toLocaleString()}
        </span>
        <button
          className="button secondary"
          onClick={() => void generate(true)}
          style={{ height: 28, fontSize: 11, padding: "0 10px" }}
          title="Regenerate"
        >
          <RefreshCw size={11} /> Regenerate
        </button>
      </div>

      {/* Grade + Summary */}
      <div style={{ padding: "16px 20px", display: "flex", gap: 18, alignItems: "flex-start", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <GradeBadge grade={data.performance_grade} />
          <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", maxWidth: 60, lineHeight: 1.3 }}>AI assessment — not a certification</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{data.grade_rationale}</div>
          <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0, color: "var(--text)" }}>{data.summary}</p>
        </div>
      </div>

      {/* Two columns: findings + bottleneck */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderBottom: "1px solid var(--line)" }}>
        {/* Key findings */}
        <div style={{ padding: "14px 20px", borderRight: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
            <TrendingUp size={13} /> Key Findings
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 6 }}>
            {data.key_findings.map((f, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>{f}</li>
            ))}
          </ul>
        </div>

        {/* Primary bottleneck */}
        <div style={{ padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
            <AlertTriangle size={13} /> Suggested Bottleneck
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 10px", fontWeight: 600, color: "#dc2626" }}>
            {data.primary_bottleneck}
          </p>
          <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0, color: "var(--muted)" }}>
            {data.error_budget_narrative}
          </p>
        </div>
      </div>

      {/* Recommendations */}
      {recs.length > 0 && (
        <div style={{ padding: "14px 20px 0", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
            <Target size={13} /> Recommendations
            {criticalRecs.length > 0 && (
              <span style={{ fontSize: 11, background: "#fee2e2", color: "#dc2626", padding: "1px 8px", borderRadius: 999, fontWeight: 700 }}>
                {criticalRecs.length} critical/high
              </span>
            )}
          </div>
          {recs.map((r, i) => <RecCard key={i} rec={r} index={i} />)}
        </div>
      )}

      {/* Next experiment + publication note */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <div style={{ padding: "14px 20px", borderRight: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
            <Sparkles size={13} /> Next Experiment
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: "var(--text)" }}>{data.next_experiment}</p>
        </div>
        <div style={{ padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
            <BookOpen size={13} /> Publication Note
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: "var(--muted)", fontStyle: "italic" }}>{data.publication_note}</p>
        </div>
      </div>

      {/* Cached circuit_analysis section from deep insights — backward compat: only shows if present */}
      {(data as RunInsights & { circuit_analysis?: { algorithm_type?: string; gate_efficiency?: string; depth_assessment?: string; entanglement_structure?: string } }).circuit_analysis && (() => {
        const ca = (data as RunInsights & { circuit_analysis: { algorithm_type?: string; gate_efficiency?: string; depth_assessment?: string; entanglement_structure?: string } }).circuit_analysis;
        return (
          <div style={{ padding: "14px 20px", borderTop: "1px solid var(--line)", background: "var(--panel-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
              <Cpu size={13} /> Circuit Analysis (from insight)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {ca.algorithm_type && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 3 }}>Algorithm Type</div>
                  <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", fontWeight: 700 }}>
                    {ca.algorithm_type}
                  </span>
                </div>
              )}
              {ca.gate_efficiency && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 3 }}>Gate Efficiency</div>
                  <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5, color: "var(--text)" }}>{ca.gate_efficiency}</p>
                </div>
              )}
              {ca.depth_assessment && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                    <Zap size={10} /> Depth Assessment
                  </div>
                  <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5, color: "var(--text)" }}>{ca.depth_assessment}</p>
                </div>
              )}
              {ca.entanglement_structure && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                    <GitBranch size={10} /> Entanglement Structure
                  </div>
                  <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5, color: "var(--text)" }}>{ca.entanglement_structure}</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Deep circuit analysis — on-demand button, always live */}
      <CircuitAnalysisSection runId={runId} />
    </section>
  );
}

export { LiteratureSection };
