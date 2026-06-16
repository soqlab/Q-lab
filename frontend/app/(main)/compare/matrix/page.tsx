"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, X, ExternalLink } from "lucide-react";
import { fetchRun, QLabRun, healthColor } from "../../../../lib/api";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
type RunState = { id: string; status: "loading" | "ok" | "error"; run?: QLabRun; error?: string };

// ------------------------------------------------------------------
// Metric rows to compare
// ------------------------------------------------------------------
type MetricDef = {
  label: string;
  group: string;
  get: (r: QLabRun) => number | string | null;
  numeric?: boolean;
  higherIsBetter?: boolean;
  lowerIsBetter?: boolean;
  fmt?: (v: number | string | null) => string;
};

const pct = (v: number | string | null) => v !== null ? `${(Number(v) * 100).toFixed(2)}%` : "—";
const num = (v: number | string | null) => v !== null ? String(Number(v).toLocaleString()) : "—";

const METRICS: MetricDef[] = [
  { label: "Status",      group: "Overview", get: r => r.status },
  { label: "Backend",     group: "Overview", get: r => r.backend },
  { label: "Project",     group: "Overview", get: r => r.project },
  { label: "Health Score", group: "Overview", get: r => r.health_score, numeric: true, higherIsBetter: true },
  { label: "Qubits",      group: "Circuit",  get: r => r.fingerprint.num_qubits ?? null, numeric: true },
  { label: "Depth",       group: "Circuit",  get: r => r.fingerprint.depth ?? null, numeric: true, lowerIsBetter: true },
  { label: "Gates",       group: "Circuit",  get: r => r.fingerprint.size ?? null, numeric: true, lowerIsBetter: true },
  { label: "Non-Clifford", group: "Circuit", get: r => r.fingerprint.non_clifford_ratio ?? null, numeric: true, lowerIsBetter: true, fmt: pct },
  { label: "CX gates",    group: "Circuit",  get: r => r.fingerprint.gate_counts?.cx ?? r.fingerprint.gate_counts?.ecr ?? null, numeric: true, lowerIsBetter: true },
  { label: "Shots",       group: "Execution", get: r => (r.results?.shots as number | null) ?? (r.parameters?.shots as number | null) ?? null, numeric: true },
  { label: "Success Prob", group: "Results",  get: r => (r.results?.success_probability as number | null) ?? null, numeric: true, higherIsBetter: true, fmt: pct },
  { label: "Transpile ms", group: "Transpiler", get: r => ((r.transpiler as Record<string, unknown>)?.duration_ms as number | null) ?? null, numeric: true, lowerIsBetter: true, fmt: num },
  { label: "T1 avg (µs)", group: "Calibration", get: r => {
    const t1 = (r.calibration as Record<string, unknown>)?.t1_us as Record<string, number> | undefined;
    if (!t1 || !Object.keys(t1).length) return null;
    const vals = Object.values(t1).map(Number).filter(v => !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, numeric: true, higherIsBetter: true, fmt: v => v !== null ? Number(v).toFixed(1) : "—" },
  { label: "Avg gate err", group: "Calibration", get: r => {
    const ge = (r.calibration as Record<string, unknown>)?.gate_errors as Record<string, number> | undefined;
    if (!ge || !Object.keys(ge).length) return null;
    const vals = Object.values(ge).map(Number).filter(v => !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, numeric: true, lowerIsBetter: true, fmt: v => v !== null ? `${(Number(v) * 100).toFixed(4)}%` : "—" },
];

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function bestIdx(values: (number | null)[], higherIsBetter?: boolean, lowerIsBetter?: boolean): number {
  const valid = values.map((v, i) => ({ v, i })).filter(({ v }) => v !== null) as { v: number; i: number }[];
  if (!valid.length) return -1;
  if (higherIsBetter) return valid.reduce((best, cur) => cur.v > best.v ? cur : best).i;
  if (lowerIsBetter) return valid.reduce((best, cur) => cur.v < best.v ? cur : best).i;
  return -1;
}

function worstIdx(values: (number | null)[], higherIsBetter?: boolean, lowerIsBetter?: boolean): number {
  const valid = values.map((v, i) => ({ v, i })).filter(({ v }) => v !== null) as { v: number; i: number }[];
  if (!valid.length) return -1;
  if (higherIsBetter) return valid.reduce((worst, cur) => cur.v < worst.v ? cur : worst).i;
  if (lowerIsBetter) return valid.reduce((worst, cur) => cur.v > worst.v ? cur : worst).i;
  return -1;
}

function formatValue(metric: MetricDef, run: QLabRun): string {
  const v = metric.get(run);
  if (v === null || v === undefined) return "—";
  if (metric.fmt) return metric.fmt(v as number);
  if (metric.numeric) return typeof v === "number" ? v.toLocaleString() : String(v);
  return String(v);
}

// ------------------------------------------------------------------
// Cell
// ------------------------------------------------------------------
function Cell({ children, isBest, isWorst }: { children: React.ReactNode; isBest: boolean; isWorst: boolean }) {
  return (
    <td style={{
      padding: "7px 12px",
      fontSize: 13,
      borderBottom: "1px solid var(--line)",
      background: isBest ? "var(--ok-bg)" : isWorst ? "var(--danger-bg)" : undefined,
      color: isBest ? "var(--ok)" : isWorst ? "var(--danger)" : "var(--text)",
      fontWeight: isBest || isWorst ? 700 : undefined,
      textAlign: "center",
    }}>
      {children}
    </td>
  );
}

// ------------------------------------------------------------------
// Group header row
// ------------------------------------------------------------------
function GroupRow({ label, colCount }: { label: string; colCount: number }) {
  return (
    <tr>
      <td colSpan={colCount + 1} style={{
        padding: "6px 12px",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--muted)",
        background: "var(--panel-2)",
        borderBottom: "1px solid var(--line)",
      }}>
        {label}
      </td>
    </tr>
  );
}

// ------------------------------------------------------------------
// Run column header
// ------------------------------------------------------------------
function RunHeader({ state, onRemove }: { state: RunState; onRemove: () => void }) {
  if (state.status === "loading") {
    return (
      <th style={{ padding: "10px 12px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", textAlign: "center", minWidth: 150 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</span>
      </th>
    );
  }
  if (state.status === "error" || !state.run) {
    return (
      <th style={{ padding: "10px 12px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", textAlign: "center", minWidth: 150 }}>
        <span style={{ fontSize: 12, color: "var(--danger)" }}>{state.error ?? "Error"}</span>
        <button onClick={onRemove} style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: "var(--danger)" }}><X size={12} /></button>
      </th>
    );
  }
  const run = state.run;
  const hc = healthColor(run.health_score);
  return (
    <th style={{ padding: "10px 12px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", textAlign: "center", minWidth: 160, verticalAlign: "top" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Link href={`/runs/${run.run_id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--strong)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={run.circuit_name ?? run.run_id}>
            {run.circuit_name ?? run.run_id.slice(0, 12)}
          </Link>
          <Link href={`/runs/${run.run_id}`} style={{ color: "var(--muted)", flexShrink: 0 }} target="_blank">
            <ExternalLink size={11} />
          </Link>
        </div>
        {run.health_score !== null && (
          <span style={{ fontSize: 18, fontWeight: 700, color: hc, lineHeight: 1 }}>{run.health_score}</span>
        )}
        <div style={{ fontSize: 10, color: "var(--muted)" }}>{new Date(run.created_at).toLocaleDateString()}</div>
        <button onClick={onRemove} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0 }} title="Remove">
          <X size={12} />
        </button>
      </div>
    </th>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------
export default function CompareMatrixPage() {
  const [input, setInput] = useState("");
  const [runs, setRuns] = useState<RunState[]>([]);

  function addRunIds(raw: string) {
    const ids = raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    for (const id of ids) {
      if (runs.find(r => r.id === id)) continue;
      const state: RunState = { id, status: "loading" };
      setRuns(prev => [...prev, state]);
      void fetchRun(id)
        .then(run => setRuns(prev => prev.map(r => r.id === id ? { ...r, status: "ok", run } : r)))
        .catch(err => setRuns(prev => prev.map(r => r.id === id ? { ...r, status: "error", error: err instanceof Error ? err.message : "Not found" } : r)));
    }
    setInput("");
  }

  function removeRun(id: string) {
    setRuns(prev => prev.filter(r => r.id !== id));
  }

  const loadedRuns = runs.filter(r => r.status === "ok" && r.run).map(r => r.run!);

  // Build groups
  const groups = [...new Set(METRICS.map(m => m.group))];

  // Rendering
  const colCount = runs.length;

  return (
    <main className="page">
      <div className="toolbar">
        <Link className="button secondary" href="/"><ArrowLeft size={17} /> Back</Link>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>Run Comparison Matrix</h1>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Add Runs</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Enter run IDs (comma or space separated) — compare up to 8 runs side-by-side</span>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", gap: 10 }}>
          <input
            className="input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addRunIds(input); }}
            placeholder="run-id-1, run-id-2, …"
            style={{ flex: 1 }}
          />
          <button className="button" onClick={() => addRunIds(input)} disabled={!input.trim()}>
            <Plus size={15} /> Add
          </button>
        </div>
        {runs.length > 0 && (
          <div style={{ padding: "0 18px 14px", display: "flex", flexWrap: "wrap", gap: 8 }}>
            {runs.map(r => (
              <span key={r.id} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: r.status === "error" ? "var(--danger-bg)" : "var(--info-bg)",
                color: r.status === "error" ? "var(--danger)" : "var(--info-text)",
                padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 500,
              }}>
                {r.run?.circuit_name ?? r.id.slice(0, 10)}
                {r.status === "loading" && " …"}
                <button onClick={() => removeRun(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, lineHeight: 1 }}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </section>

      {runs.length === 0 && (
        <div className="empty" style={{ marginTop: 32 }}>
          Add at least 2 run IDs to start comparing.
        </div>
      )}

      {runs.length >= 1 && (
        <section className="panel" style={{ marginTop: 18, overflowX: "auto" }}>
          <div className="panel-header">
            <h2>Comparison Table</h2>
            <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
              Green = best · Red = worst (for numeric metrics)
            </span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ padding: "10px 12px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", textAlign: "left", fontSize: 12, color: "var(--muted)", minWidth: 130 }}>
                  Metric
                </th>
                {runs.map(r => (
                  <RunHeader key={r.id} state={r} onRemove={() => removeRun(r.id)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(group => {
                const groupMetrics = METRICS.filter(m => m.group === group);
                return (
                  <>
                    <GroupRow key={`g-${group}`} label={group} colCount={colCount} />
                    {groupMetrics.map(metric => {
                      const values = runs.map(r => {
                        if (!r.run || r.status !== "ok") return null;
                        const v = metric.get(r.run);
                        return metric.numeric && v !== null ? Number(v) : null;
                      });
                      const best = metric.numeric ? bestIdx(values, metric.higherIsBetter, metric.lowerIsBetter) : -1;
                      const worst = metric.numeric ? worstIdx(values, metric.higherIsBetter, metric.lowerIsBetter) : -1;

                      return (
                        <tr key={metric.label}>
                          <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>
                            {metric.label}
                          </td>
                          {runs.map((r, colIdx) => {
                            if (r.status === "loading") return <Cell key={r.id} isBest={false} isWorst={false}><span style={{ color: "var(--muted)", fontSize: 11 }}>…</span></Cell>;
                            if (r.status === "error" || !r.run) return <Cell key={r.id} isBest={false} isWorst={false}><span style={{ color: "var(--muted)" }}>—</span></Cell>;
                            return (
                              <Cell key={r.id} isBest={colIdx === best} isWorst={colIdx === worst}>
                                {formatValue(metric, r.run)}
                              </Cell>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {loadedRuns.length >= 2 && (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panel-header"><h2>Quick Compare Links</h2></div>
          <div style={{ padding: "14px 18px", display: "flex", flexWrap: "wrap", gap: 8 }}>
            {loadedRuns.flatMap((a, i) => loadedRuns.slice(i + 1).map(b => (
              <Link
                key={`${a.run_id}-${b.run_id}`}
                href={`/compare?left=${a.run_id}&right=${b.run_id}`}
                className="button secondary"
                style={{ fontSize: 12, height: 30, padding: "0 10px" }}
              >
                {a.circuit_name ?? a.run_id.slice(0, 8)} vs {b.circuit_name ?? b.run_id.slice(0, 8)}
              </Link>
            )))}
          </div>
        </section>
      )}
    </main>
  );
}
