"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  addMetaStudy,
  listMetaStudies,
  runFullMetaAnalysis,
  listFullMetaAnalyses,
  getFullMetaAnalysis,
  MetaStudy,
  FullMetaAnalysisResult,
} from "@/lib/api";

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div style={{
      padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5",
      borderRadius: 8, fontSize: 13, color: "#b91c1c", marginBottom: 12, display: "flex", justifyContent: "space-between",
    }}>
      <span>{msg}</span>
      <button onClick={onDismiss} type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 700 }}>×</button>
    </div>
  );
}

function StatBlock({ label, value, color = "var(--text)" }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ background: "var(--panel-2)", borderRadius: 8, border: "1px solid var(--line)", padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 18, color }}>{value}</div>
    </div>
  );
}

// SVG Forest Plot
function ForestPlot({ result }: { result: FullMetaAnalysisResult }) {
  const studies = result.forest_plot_data as Array<{
    study_id?: string;
    title?: string;
    effect_size?: number;
    ci_lower?: number;
    ci_upper?: number;
  }>;

  if (!studies || studies.length === 0) return null;

  const allValues = studies.flatMap(s => [s.ci_lower ?? 0, s.ci_upper ?? 0, s.effect_size ?? 0]);
  allValues.push(result.pooled_effect, result.confidence_interval_95[0], result.confidence_interval_95[1]);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const padding = (maxVal - minVal) * 0.15 || 0.2;
  const domainMin = minVal - padding;
  const domainMax = maxVal + padding;
  const domainRange = domainMax - domainMin;

  const svgWidth = 560;
  const leftMargin = 180;
  const rightMargin = 20;
  const plotWidth = svgWidth - leftMargin - rightMargin;
  const rowHeight = 28;
  const topPad = 24;
  const bottomPad = 44;
  const svgHeight = topPad + (studies.length + 1) * rowHeight + bottomPad;

  function xPos(val: number) {
    return leftMargin + ((val - domainMin) / domainRange) * plotWidth;
  }

  const zeroX = xPos(0);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={svgWidth} height={svgHeight} style={{ fontFamily: "inherit", display: "block" }}>
        {/* Grid line at zero */}
        <line x1={zeroX} y1={topPad - 8} x2={zeroX} y2={svgHeight - bottomPad + 4}
          stroke="var(--line)" strokeWidth={1} strokeDasharray="4 3" />

        {/* X-axis labels */}
        {[domainMin, (domainMin + domainMax) / 2, domainMax].map((v, i) => (
          <text key={i} x={xPos(v)} y={svgHeight - bottomPad + 16}
            textAnchor="middle" fontSize={10} fill="var(--muted)">
            {v.toFixed(2)}
          </text>
        ))}

        {/* Column headers */}
        <text x={leftMargin - 6} y={topPad - 6} textAnchor="end" fontSize={10} fontWeight={700} fill="var(--muted)">Study</text>
        <text x={leftMargin + plotWidth / 2} y={topPad - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--muted)">Effect (95% CI)</text>

        {/* Per-study rows */}
        {studies.map((s, i) => {
          const y = topPad + i * rowHeight + rowHeight / 2;
          const cx = xPos(s.effect_size ?? 0);
          const lo = xPos(s.ci_lower ?? (s.effect_size ?? 0));
          const hi = xPos(s.ci_upper ?? (s.effect_size ?? 0));
          const clampedLo = Math.max(leftMargin, lo);
          const clampedHi = Math.min(leftMargin + plotWidth, hi);
          return (
            <g key={i}>
              <text x={leftMargin - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--text)">
                {(s.title ?? s.study_id ?? `Study ${i + 1}`).slice(0, 22)}
              </text>
              {/* CI line */}
              <line x1={clampedLo} y1={y} x2={clampedHi} y2={y} stroke="#818cf8" strokeWidth={1.5} />
              {/* CI caps */}
              <line x1={clampedLo} y1={y - 4} x2={clampedLo} y2={y + 4} stroke="#818cf8" strokeWidth={1.5} />
              <line x1={clampedHi} y1={y - 4} x2={clampedHi} y2={y + 4} stroke="#818cf8" strokeWidth={1.5} />
              {/* Effect square */}
              <rect x={cx - 5} y={y - 5} width={10} height={10} fill="#818cf8" rx={2} />
            </g>
          );
        })}

        {/* Pooled effect diamond */}
        {(() => {
          const y = topPad + studies.length * rowHeight + rowHeight / 2;
          const lo = xPos(result.confidence_interval_95[0]);
          const hi = xPos(result.confidence_interval_95[1]);
          const cx = xPos(result.pooled_effect);
          const clampedLo = Math.max(leftMargin, lo);
          const clampedHi = Math.min(leftMargin + plotWidth, hi);
          return (
            <g>
              <line x1={leftMargin} y1={y} x2={leftMargin + plotWidth} y2={y}
                stroke="var(--line)" strokeWidth={0.5} />
              <text x={leftMargin - 6} y={y + 4} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--text)">
                Pooled
              </text>
              <polygon
                points={`${clampedLo},${y} ${cx},${y - 8} ${clampedHi},${y} ${cx},${y + 8}`}
                fill="#f59e0b" opacity={0.9}
              />
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

function AnalysisResultCard({ result, expanded, onExpand }: {
  result: FullMetaAnalysisResult;
  expanded: boolean;
  onExpand: () => void;
}) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
      <div
        onClick={onExpand}
        style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{result.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {result.metric} · {result.studies.length} studies · {result.model} · {new Date(result.created_at).toLocaleString()}
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>I²</div>
            <div style={{ fontWeight: 700, color: result.i_squared > 75 ? "#ef4444" : result.i_squared > 50 ? "#f59e0b" : "#22c55e" }}>
              {result.i_squared.toFixed(1)}%
            </div>
          </div>
          <div style={{ fontSize: 18, color: "var(--muted)" }}>{expanded ? "▲" : "▼"}</div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--line)", padding: "16px 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
            <StatBlock label="Pooled Effect" value={result.pooled_effect.toFixed(4)} color="var(--strong)" />
            <StatBlock label="Pooled SE" value={result.pooled_se.toFixed(4)} />
            <StatBlock label="I² (Heterogeneity)" value={`${result.i_squared.toFixed(1)}%`}
              color={result.i_squared > 75 ? "#ef4444" : result.i_squared > 50 ? "#f59e0b" : "#22c55e"} />
            <StatBlock label="Q Statistic" value={result.q_statistic.toFixed(3)} />
            <StatBlock label="P-value" value={result.p_value.toFixed(4)} color={result.p_value < 0.05 ? "#22c55e" : "var(--text)"} />
            <StatBlock
              label="95% CI"
              value={`[${result.confidence_interval_95[0].toFixed(3)}, ${result.confidence_interval_95[1].toFixed(3)}]`}
            />
          </div>

          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Forest Plot</div>
          <ForestPlot result={result} />
        </div>
      )}
    </div>
  );
}

type Tab = "studies" | "run" | "results";

export default function MetaAnalysisPage() {
  const [tab, setTab] = useState<Tab>("studies");

  // Studies tab
  const [studyTitle, setStudyTitle] = useState("");
  const [studyAuthors, setStudyAuthors] = useState("");
  const [studyYear, setStudyYear] = useState(new Date().getFullYear().toString());
  const [studyEffectSize, setStudyEffectSize] = useState("");
  const [studyStdError, setStudyStdError] = useState("");
  const [studySampleSize, setStudySampleSize] = useState("");
  const [studyBackend, setStudyBackend] = useState("");
  const [studyMetric, setStudyMetric] = useState("");
  const [studyDoi, setStudyDoi] = useState("");
  const [addingStudy, setAddingStudy] = useState(false);
  const [addStudyError, setAddStudyError] = useState<string | null>(null);
  const [studies, setStudies] = useState<MetaStudy[]>([]);
  const [loadingStudies, setLoadingStudies] = useState(true);
  const [studiesError, setStudiesError] = useState<string | null>(null);

  // Run analysis tab
  const [analysisName, setAnalysisName] = useState("");
  const [analysisMetric, setAnalysisMetric] = useState("");
  const [selectedStudyIds, setSelectedStudyIds] = useState<Set<string>>(new Set());
  const [analysisModel, setAnalysisModel] = useState<"random" | "fixed">("random");
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<FullMetaAnalysisResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Results tab
  const [pastAnalyses, setPastAnalyses] = useState<FullMetaAnalysisResult[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(true);
  const [analysesError, setAnalysesError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedData, setExpandedData] = useState<Record<string, FullMetaAnalysisResult>>({});

  const loadStudies = useCallback(async () => {
    setLoadingStudies(true);
    setStudiesError(null);
    try {
      const data = await listMetaStudies();
      setStudies(data);
    } catch (e) {
      setStudiesError(e instanceof Error ? e.message : "Failed to load studies");
    } finally {
      setLoadingStudies(false);
    }
  }, []);

  const loadAnalyses = useCallback(async () => {
    setLoadingAnalyses(true);
    setAnalysesError(null);
    try {
      const data = await listFullMetaAnalyses();
      setPastAnalyses(data);
    } catch (e) {
      setAnalysesError(e instanceof Error ? e.message : "Failed to load analyses");
    } finally {
      setLoadingAnalyses(false);
    }
  }, []);

  useEffect(() => { void loadStudies(); }, [loadStudies]);
  useEffect(() => { if (tab === "results") void loadAnalyses(); }, [tab, loadAnalyses]);

  async function handleAddStudy(e: React.FormEvent) {
    e.preventDefault();
    setAddingStudy(true);
    setAddStudyError(null);
    try {
      const authors = studyAuthors.split(",").map(a => a.trim()).filter(Boolean);
      const study = await addMetaStudy({
        title: studyTitle.trim(),
        authors,
        year: parseInt(studyYear, 10),
        effect_size: parseFloat(studyEffectSize),
        std_error: parseFloat(studyStdError),
        sample_size: parseInt(studySampleSize, 10),
        backend: studyBackend.trim(),
        metric: studyMetric.trim(),
        doi: studyDoi.trim() || undefined,
      });
      setStudies(prev => [...prev, study]);
      setStudyTitle(""); setStudyAuthors(""); setStudyEffectSize(""); setStudyStdError("");
      setStudySampleSize(""); setStudyBackend(""); setStudyMetric(""); setStudyDoi("");
    } catch (e) {
      setAddStudyError(e instanceof Error ? e.message : "Failed to add study");
    } finally {
      setAddingStudy(false);
    }
  }

  async function handleRunAnalysis(e: React.FormEvent) {
    e.preventDefault();
    if (selectedStudyIds.size === 0) {
      setRunError("Select at least one study to include.");
      return;
    }
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const result = await runFullMetaAnalysis({
        name: analysisName.trim(),
        metric: analysisMetric.trim(),
        study_ids: Array.from(selectedStudyIds),
        model: analysisModel,
      });
      setRunResult(result);
      void loadAnalyses();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setRunning(false);
    }
  }

  function toggleStudy(id: string) {
    setSelectedStudyIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleExpand(analysisId: string) {
    if (expandedId === analysisId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(analysisId);
    if (!expandedData[analysisId]) {
      try {
        const data = await getFullMetaAnalysis(analysisId);
        setExpandedData(prev => ({ ...prev, [analysisId]: data }));
      } catch {
        // keep using the list data
      }
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "studies", label: "Studies" },
    { id: "run", label: "Run Analysis" },
    { id: "results", label: "Results" },
  ];

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Meta-Analysis Engine</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 0" }}>
            DerSimonian-Laird random-effects pooling across quantum experiments
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid var(--line)" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: "none", border: "none",
              borderBottom: tab === t.id ? "2px solid var(--strong)" : "2px solid transparent",
              color: tab === t.id ? "var(--strong)" : "var(--muted)",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* STUDIES TAB */}
      {tab === "studies" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Add study form */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Add Study</div>
            {addStudyError && <ErrorBanner msg={addStudyError} onDismiss={() => setAddStudyError(null)} />}
            <form onSubmit={(e) => void handleAddStudy(e)}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div style={{ gridColumn: "1 / 3" }}>
                  <FormField label="Title">
                    <input className="input" value={studyTitle} onChange={e => setStudyTitle(e.target.value)}
                      required placeholder="Paper title" style={{ height: 34 }} />
                  </FormField>
                </div>
                <FormField label="Year">
                  <input className="input" type="number" value={studyYear} onChange={e => setStudyYear(e.target.value)}
                    required style={{ height: 34 }} />
                </FormField>
                <div style={{ gridColumn: "1 / 3" }}>
                  <FormField label="Authors (comma-separated)">
                    <input className="input" value={studyAuthors} onChange={e => setStudyAuthors(e.target.value)}
                      required placeholder="Smith J., Doe A., …" style={{ height: 34 }} />
                  </FormField>
                </div>
                <FormField label="DOI (optional)">
                  <input className="input" value={studyDoi} onChange={e => setStudyDoi(e.target.value)}
                    placeholder="10.xxxx/…" style={{ height: 34 }} />
                </FormField>
                <FormField label="Effect Size">
                  <input className="input" type="number" step="any" value={studyEffectSize}
                    onChange={e => setStudyEffectSize(e.target.value)} required style={{ height: 34 }} />
                </FormField>
                <FormField label="Std Error">
                  <input className="input" type="number" step="any" value={studyStdError}
                    onChange={e => setStudyStdError(e.target.value)} required style={{ height: 34 }} />
                </FormField>
                <FormField label="Sample Size">
                  <input className="input" type="number" value={studySampleSize}
                    onChange={e => setStudySampleSize(e.target.value)} required style={{ height: 34 }} />
                </FormField>
                <FormField label="Backend">
                  <input className="input" value={studyBackend} onChange={e => setStudyBackend(e.target.value)}
                    required placeholder="ibm_brisbane" style={{ height: 34 }} />
                </FormField>
                <FormField label="Metric">
                  <input className="input" value={studyMetric} onChange={e => setStudyMetric(e.target.value)}
                    required placeholder="e.g. gate_fidelity" style={{ height: 34 }} />
                </FormField>
              </div>
              <button className="button" type="submit" disabled={addingStudy} style={{ height: 34 }}>
                {addingStudy ? "Adding…" : "Add Study"}
              </button>
            </form>
          </div>

          {/* Studies table */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Studies ({studies.length})</div>
            {studiesError && <ErrorBanner msg={studiesError} onDismiss={() => setStudiesError(null)} />}
            {loadingStudies ? (
              <div className="empty" style={{ padding: "20px 0" }}>Loading studies…</div>
            ) : studies.length === 0 ? (
              <div className="empty" style={{ padding: "20px 0" }}>No studies added yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 700 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      {["Title", "Authors", "Year", "Effect Size", "SE", "N", "Metric", "Backend"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {studies.map(s => (
                      <tr key={s.study_id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "8px 10px", fontWeight: 600, maxWidth: 200 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                        </td>
                        <td style={{ padding: "8px 10px", color: "var(--muted)", fontSize: 12 }}>{s.authors.join(", ")}</td>
                        <td style={{ padding: "8px 10px" }}>{s.year}</td>
                        <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{s.effect_size.toFixed(4)}</td>
                        <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{s.std_error.toFixed(4)}</td>
                        <td style={{ padding: "8px 10px" }}>{s.sample_size}</td>
                        <td style={{ padding: "8px 10px" }}>{s.metric}</td>
                        <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace" }}>{s.backend}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* RUN ANALYSIS TAB */}
      {tab === "run" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Run Meta-Analysis</div>
            {runError && <ErrorBanner msg={runError} onDismiss={() => setRunError(null)} />}
            <form onSubmit={(e) => void handleRunAnalysis(e)}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                <FormField label="Analysis Name">
                  <input className="input" value={analysisName} onChange={e => setAnalysisName(e.target.value)}
                    required placeholder="e.g. Gate fidelity meta-2026" style={{ height: 34 }} />
                </FormField>
                <FormField label="Metric">
                  <input className="input" value={analysisMetric} onChange={e => setAnalysisMetric(e.target.value)}
                    required placeholder="e.g. gate_fidelity" style={{ height: 34 }} />
                </FormField>
                <FormField label="Model">
                  <select className="input" value={analysisModel} onChange={e => setAnalysisModel(e.target.value as "random" | "fixed")}
                    style={{ height: 34 }}>
                    <option value="random">Random Effects (DL)</option>
                    <option value="fixed">Fixed Effects</option>
                  </select>
                </FormField>
              </div>

              {/* Study selection */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                  Select Studies ({selectedStudyIds.size} selected)
                </div>
                {loadingStudies ? (
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading studies…</div>
                ) : studies.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>No studies available. Add some in the Studies tab.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                    {studies.map(s => (
                      <label key={s.study_id} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                        background: selectedStudyIds.has(s.study_id) ? "var(--panel-2)" : "transparent",
                        border: `1px solid ${selectedStudyIds.has(s.study_id) ? "var(--strong)" : "var(--line)"}`,
                        borderRadius: 6, cursor: "pointer", fontSize: 13,
                      }}>
                        <input type="checkbox" checked={selectedStudyIds.has(s.study_id)}
                          onChange={() => toggleStudy(s.study_id)} />
                        <span style={{ fontWeight: 600 }}>{s.title}</span>
                        <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto" }}>
                          {s.authors[0]} {s.year} · ES: {s.effect_size.toFixed(3)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <button className="button" type="submit" disabled={running} style={{ height: 36 }}>
                {running ? "Running…" : "Run Meta-Analysis"}
              </button>
            </form>
          </div>

          {/* Result */}
          {runResult && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Result: {runResult.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
                <StatBlock label="Pooled Effect" value={runResult.pooled_effect.toFixed(4)} color="var(--strong)" />
                <StatBlock label="Pooled SE" value={runResult.pooled_se.toFixed(4)} />
                <StatBlock label="I² (%)" value={`${runResult.i_squared.toFixed(1)}%`}
                  color={runResult.i_squared > 75 ? "#ef4444" : runResult.i_squared > 50 ? "#f59e0b" : "#22c55e"} />
                <StatBlock label="Q Statistic" value={runResult.q_statistic.toFixed(3)} />
                <StatBlock label="P-value" value={runResult.p_value.toFixed(4)}
                  color={runResult.p_value < 0.05 ? "#22c55e" : "var(--text)"} />
                <StatBlock
                  label="95% CI"
                  value={`[${runResult.confidence_interval_95[0].toFixed(3)}, ${runResult.confidence_interval_95[1].toFixed(3)}]`}
                />
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Forest Plot</div>
              <ForestPlot result={runResult} />
            </div>
          )}
        </div>
      )}

      {/* RESULTS TAB */}
      {tab === "results" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Past Analyses ({pastAnalyses.length})</div>
          {analysesError && <ErrorBanner msg={analysesError} onDismiss={() => setAnalysesError(null)} />}
          {loadingAnalyses ? (
            <div className="empty">Loading analyses…</div>
          ) : pastAnalyses.length === 0 ? (
            <div className="empty">No analyses run yet.</div>
          ) : (
            pastAnalyses.map(a => {
              const isExpanded = expandedId === a.analysis_id;
              const displayData = expandedData[a.analysis_id] ?? a;
              return (
                <AnalysisResultCard
                  key={a.analysis_id}
                  result={displayData}
                  expanded={isExpanded}
                  onExpand={() => void handleExpand(a.analysis_id)}
                />
              );
            })
          )}
        </div>
      )}
    </main>
  );
}
