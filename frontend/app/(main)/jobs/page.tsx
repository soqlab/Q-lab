"use client";

import { useEffect, useState } from "react";
import {
  listJobs, submitJob, getJobStats, cancelJob,
  JobSubmission, JobStats, JobSubmitRequest,
} from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

const STATUS_COLOR: Record<string, string> = {
  queued: "#f59e0b", running: "#3b82f6", completed: "#10b981",
  failed: "#ef4444", cancelled: "#6b7280",
};

const PROVIDERS = ["simulator", "ibm", "ionq", "braket"];

const SAMPLE_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface BackendRecommendation {
  backend: string; provider: string; rank: number; score: number;
  estimated_fidelity: number; estimated_cost_usd: number;
  queue_speed: string; n_qubits: number; reasoning: string[];
}
interface RouteResult {
  recommended_backend: string; recommended_provider: string;
  preference: string; circuit_qubits: number; circuit_depth: number;
  circuit_gates: number; rankings: BackendRecommendation[];
}
interface CompileResult {
  compiled_qasm: string; target_backend: string; provider: string;
  optimization_level: number; optimization_description: string;
  original_depth: number; compiled_depth: number;
  original_gate_count: number; compiled_gate_count: number;
  depth_reduction_pct: number; gate_reduction_pct: number;
  estimated_fidelity: number; native_gates_used: string[];
  compile_time_ms: number; warnings: string[];
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatPill({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div style={{ textAlign: "center", padding: "6px 14px", background: highlight ? "#1e293b" : "#0f172a", borderRadius: 8, border: "1px solid #1e293b" }}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: highlight ? "#10b981" : "#e2e8f0", marginTop: 2 }}>{value}</div>
    </div>
  );
}

function BackendCard({ rec, selected, onSelect }: { rec: BackendRecommendation; selected: boolean; onSelect: () => void }) {
  const scoreColor = rec.score > 0.8 ? "#10b981" : rec.score > 0.6 ? "#f59e0b" : "#64748b";
  return (
    <div
      onClick={onSelect}
      style={{
        border: `2px solid ${selected ? "#6366f1" : "#1e293b"}`,
        borderRadius: 10, padding: "12px 14px", cursor: "pointer",
        background: selected ? "#1e1b4b22" : "#0f172a",
        transition: "border-color 0.15s",
        flex: "1 1 200px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13, color: "#e2e8f0" }}>#{rec.rank} {rec.backend}</span>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>{rec.provider} · {rec.n_qubits} qubits</div>
        </div>
        <span style={{ background: `${scoreColor}22`, color: scoreColor, border: `1px solid ${scoreColor}44`, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>
          {(rec.score * 100).toFixed(0)}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>Fidelity: <strong style={{ color: "#e2e8f0" }}>{(rec.estimated_fidelity * 100).toFixed(1)}%</strong></span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>Cost: <strong style={{ color: "#e2e8f0" }}>{rec.estimated_cost_usd === 0 ? "Free" : `$${rec.estimated_cost_usd.toFixed(5)}`}</strong></span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>Queue: <strong style={{ color: "#e2e8f0" }}>{rec.queue_speed}</strong></span>
      </div>
      <div style={{ fontSize: 11, color: "#64748b" }}>{rec.reasoning[0]}</div>
      {selected && <div style={{ marginTop: 6, fontSize: 11, color: "#6366f1", fontWeight: 600 }}>✓ Selected</div>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const { token } = useAuth();
  const [jobs, setJobs] = useState<JobSubmission[]>([]);
  const [stats, setStats] = useState<JobStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterProvider, setFilterProvider] = useState("");

  // Form state
  const [form, setForm] = useState<JobSubmitRequest>({
    provider: "simulator", backend: "simulator",
    qasm: SAMPLE_QASM, shots: 1024,
    circuit_name: "", project_slug: "",
  });

  // Auto-route state
  const [routeMode, setRouteMode] = useState<"manual" | "auto">("manual");
  const [routePref, setRoutePref] = useState<"quality" | "speed" | "cost" | "balanced">("quality");
  const [routing, setRouting] = useState(false);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);

  // Compiler state
  const [compiling, setCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [optLevel, setOptLevel] = useState(2);
  const [compiledAccepted, setCompiledAccepted] = useState(false);

  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  const load = () => {
    setLoading(true);
    Promise.all([
      listJobs({ status: filterStatus || undefined, provider: filterProvider || undefined, limit: 100 }),
      getJobStats(),
    ])
      .then(([j, s]) => { setJobs(j); setStats(s); setErr(""); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filterStatus, filterProvider]);

  // ─── Auto-route ───────────────────────────────────────────────────────────

  const handleRoute = async () => {
    setRouting(true);
    setRouteResult(null);
    try {
      const res = await fetch("/qlab-api/api/v1/jobs/route", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ qasm: form.qasm, shots: form.shots, preference: routePref }),
      });
      if (!res.ok) throw new Error(`Route failed: ${res.status}`);
      const data = await res.json() as RouteResult;
      setRouteResult(data);
      // Auto-select the top recommendation
      setForm(f => ({ ...f, provider: data.recommended_provider as JobSubmitRequest["provider"], backend: data.recommended_backend }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Routing failed");
    } finally {
      setRouting(false);
    }
  };

  // ─── Compiler ─────────────────────────────────────────────────────────────

  const handleCompile = async () => {
    setCompiling(true);
    setCompileResult(null);
    setCompiledAccepted(false);
    try {
      const res = await fetch("/qlab-api/api/v1/circuits/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ qasm: form.qasm, target_backend: form.backend, optimization_level: optLevel }),
      });
      if (!res.ok) throw new Error(`Compile failed: ${res.status}`);
      const data = await res.json() as CompileResult;
      setCompileResult(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Compilation failed");
    } finally {
      setCompiling(false);
    }
  };

  const acceptCompiled = () => {
    if (!compileResult) return;
    setForm(f => ({ ...f, qasm: compileResult.compiled_qasm }));
    setCompiledAccepted(true);
  };

  // ─── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const job = await submitJob(form);
      setJobs(prev => [job, ...prev]);
      setShowForm(false);
      setErr("");
      setRouteResult(null);
      setCompileResult(null);
      setCompiledAccepted(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      const updated = await cancelJob(jobId);
      setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, status: updated.status as JobSubmission["status"] } : j));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const prefBtn = (p: typeof routePref, label: string) => (
    <button
      key={p}
      onClick={() => setRoutePref(p)}
      style={{
        padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
        border: `1px solid ${routePref === p ? "#6366f1" : "#1e293b"}`,
        background: routePref === p ? "#1e1b4b" : "transparent",
        color: routePref === p ? "#a5b4fc" : "#64748b",
      }}
    >{label}</button>
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Job Execution</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={() => { setShowForm(!showForm); setRouteResult(null); setCompileResult(null); }}>
            {showForm ? "Cancel" : "+ Submit Job"}
          </button>
        </div>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>}

      {/* Stats bar */}
      {stats && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { label: "Total Jobs", value: stats.total },
            { label: "Running", value: stats.by_status?.running ?? 0 },
            { label: "Completed", value: stats.by_status?.completed ?? 0 },
            { label: "Failed", value: stats.by_status?.failed ?? 0 },
            { label: "Total Credits", value: stats.total_cost_credits?.toFixed(4) ?? "0" },
          ].map(s => (
            <div key={s.label} className="panel" style={{ padding: "10px 16px", minWidth: 110 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Submit form ─────────────────────────────────────────────────── */}
      {showForm && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header"><h2>Submit New Job</h2></div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 20 }}>

            {/* SECTION 1: Circuit */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ background: "#1e293b", borderRadius: "50%", width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>1</span>
                QASM Circuit
              </div>
              <textarea
                className="input"
                value={form.qasm}
                onChange={e => { setForm(f => ({ ...f, qasm: e.target.value })); setCompileResult(null); setCompiledAccepted(false); }}
                rows={8}
                style={{ fontFamily: "monospace", fontSize: 12, width: "100%", boxSizing: "border-box" }}
              />
              {/* Compiler controls */}
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Optimisation level:</span>
                {[0, 1, 2, 3].map(l => (
                  <button key={l} onClick={() => setOptLevel(l)} style={{
                    padding: "3px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${optLevel === l ? "#6366f1" : "#1e293b"}`,
                    background: optLevel === l ? "#1e1b4b" : "transparent",
                    color: optLevel === l ? "#a5b4fc" : "#64748b",
                  }}>{l}</button>
                ))}
                <button
                  className="btn"
                  onClick={handleCompile}
                  disabled={compiling}
                  style={{ marginLeft: 4, fontSize: 12 }}
                >
                  {compiling ? "Compiling…" : "⚡ Compile & Optimise"}
                </button>
                {compiledAccepted && <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>✓ Using compiled circuit</span>}
              </div>

              {/* Compile result */}
              {compileResult && !compiledAccepted && (
                <div style={{ marginTop: 12, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 10 }}>
                    Compiled for <span style={{ color: "#a5b4fc" }}>{compileResult.target_backend}</span>
                    <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>({compileResult.optimization_description})</span>
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                    <StatPill label="Depth Before" value={compileResult.original_depth} />
                    <StatPill label="Depth After" value={compileResult.compiled_depth} highlight />
                    <StatPill label="Depth Saved" value={`${compileResult.depth_reduction_pct}%`} highlight={compileResult.depth_reduction_pct > 0} />
                    <StatPill label="Gates Before" value={compileResult.original_gate_count} />
                    <StatPill label="Gates After" value={compileResult.compiled_gate_count} highlight />
                    <StatPill label="Est. Fidelity" value={`${(compileResult.estimated_fidelity * 100).toFixed(1)}%`} highlight />
                    <StatPill label="Compile time" value={`${compileResult.compile_time_ms}ms`} />
                  </div>
                  {compileResult.warnings.length > 0 && (
                    <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 8 }}>⚠ {compileResult.warnings.join(" · ")}</div>
                  )}
                  <button className="btn btn-primary" onClick={acceptCompiled} style={{ fontSize: 12 }}>
                    Use Compiled Circuit
                  </button>
                </div>
              )}
            </div>

            {/* SECTION 2: Backend selection */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ background: "#1e293b", borderRadius: "50%", width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>2</span>
                Backend Selection
              </div>

              {/* Mode toggle */}
              <div style={{ display: "flex", gap: 0, marginBottom: 14, border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden", width: "fit-content" }}>
                {(["manual", "auto"] as const).map(m => (
                  <button key={m} onClick={() => { setRouteMode(m); setRouteResult(null); }} style={{
                    padding: "7px 20px", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none",
                    background: routeMode === m ? "#6366f1" : "transparent",
                    color: routeMode === m ? "#fff" : "#64748b",
                  }}>
                    {m === "manual" ? "Manual" : "⚡ Auto-Route"}
                  </button>
                ))}
              </div>

              {routeMode === "manual" ? (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
                    <span style={{ fontSize: 12, color: "#9ca3af" }}>Provider</span>
                    <select className="input" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value as JobSubmitRequest["provider"] }))}>
                      {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 2, minWidth: 180 }}>
                    <span style={{ fontSize: 12, color: "#9ca3af" }}>Backend</span>
                    <input className="input" value={form.backend} onChange={e => setForm(f => ({ ...f, backend: e.target.value }))} placeholder="e.g. ibm_brisbane" />
                  </label>
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>Optimise for:</span>
                    {prefBtn("quality", "Quality")}
                    {prefBtn("speed", "Speed")}
                    {prefBtn("cost", "Cost")}
                    {prefBtn("balanced", "Balanced")}
                    <button className="btn btn-primary" onClick={handleRoute} disabled={routing} style={{ fontSize: 12 }}>
                      {routing ? "Routing…" : "Find Best Backend"}
                    </button>
                  </div>

                  {routeResult && (
                    <div>
                      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
                        Circuit: {routeResult.circuit_qubits} qubits · depth ~{routeResult.circuit_depth} · {routeResult.circuit_gates} gates
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {routeResult.rankings.slice(0, 4).map(rec => (
                          <BackendCard
                            key={rec.backend}
                            rec={rec}
                            selected={form.backend === rec.backend}
                            onSelect={() => setForm(f => ({ ...f, provider: rec.provider as JobSubmitRequest["provider"], backend: rec.backend }))}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SECTION 3: Config */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ background: "#1e293b", borderRadius: "50%", width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>3</span>
                Configuration
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 110px" }}>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>Shots</span>
                  <input className="input" type="number" value={form.shots} onChange={e => setForm(f => ({ ...f, shots: Number(e.target.value) }))} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>Circuit Name</span>
                  <input className="input" value={form.circuit_name} onChange={e => setForm(f => ({ ...f, circuit_name: e.target.value }))} placeholder="optional" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>Project Slug</span>
                  <input className="input" value={form.project_slug} onChange={e => setForm(f => ({ ...f, project_slug: e.target.value }))} placeholder="optional" />
                </label>
              </div>
            </div>

            {/* Selected backend summary */}
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#64748b" }}>Submitting to:</span>
              <span style={{ fontWeight: 700, color: "#e2e8f0" }}>{form.backend}</span>
              <span style={{ fontSize: 12, color: "#64748b" }}>via <span style={{ color: "#a5b4fc" }}>{form.provider}</span></span>
              <span style={{ fontSize: 12, color: "#64748b" }}>·</span>
              <span style={{ fontSize: 12, color: "#64748b" }}>{form.shots} shots</span>
              {compiledAccepted && <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>· compiled circuit ✓</span>}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit Job"}
              </button>
              <button className="btn" onClick={() => { setShowForm(false); setRouteResult(null); setCompileResult(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select className="input" style={{ width: 130 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["queued", "running", "completed", "failed", "cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" style={{ width: 130 }} value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
          <option value="">All providers</option>
          {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Job list */}
      {loading ? (
        <div className="text-muted">Loading jobs…</div>
      ) : jobs.length === 0 ? (
        <div className="panel" style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
          No jobs found. Submit your first job above.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {jobs.map(job => (
            <div key={job.job_id} className="panel" style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: `${STATUS_COLOR[job.status] ?? "#6b7280"}22`,
                    color: STATUS_COLOR[job.status] ?? "#6b7280",
                  }}>{job.status}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: "#9ca3af" }}>{job.job_id}</span>
                  <span style={{ fontWeight: 600 }}>{job.circuit_name || "Untitled"}</span>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>{job.provider} / {job.backend}</span>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>{job.shots} shots</span>
                  {job.cost_credits != null && (
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{job.cost_credits.toFixed(4)} credits</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>{new Date(job.submitted_at).toLocaleString()}</span>
                  <a href={`/jobs/${job.job_id}`} className="btn" style={{ fontSize: 12, padding: "3px 10px" }}>Details</a>
                  {(job.status === "queued" || job.status === "running") && (
                    <button className="btn" style={{ fontSize: 12, padding: "3px 10px", color: "#ef4444" }}
                      onClick={() => handleCancel(job.job_id)}>Cancel</button>
                  )}
                </div>
              </div>
              {job.error_message && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#ef4444" }}>Error: {job.error_message}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
