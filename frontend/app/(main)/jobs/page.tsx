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

function StatCard({ label, before, after }: { label: string; before: number; after: number }) {
  const improved = after < before;
  return (
    <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", minWidth: 110 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 13, color: "var(--muted)", textDecoration: "line-through" }}>{before}</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: improved ? "var(--ok)" : "var(--text)" }}>→ {after}</span>
      </div>
    </div>
  );
}

function BackendCard({ rec, selected, onSelect }: { rec: BackendRecommendation; selected: boolean; onSelect: () => void }) {
  const scoreColor = rec.score > 0.8 ? "var(--ok)" : rec.score > 0.6 ? "var(--warn)" : "var(--muted)";
  return (
    <div
      onClick={onSelect}
      style={{
        border: `2px solid ${selected ? "var(--strong)" : "var(--line)"}`,
        borderRadius: 8, padding: "12px 14px", cursor: "pointer",
        background: selected ? "var(--info-bg)" : "var(--panel)",
        transition: "border-color 0.15s, background 0.15s",
        flex: "1 1 180px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>#{rec.rank} {rec.backend}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{rec.provider} · {rec.n_qubits} qubits</div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor }}>{(rec.score * 100).toFixed(0)}</span>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Fidelity <strong style={{ color: "var(--text)" }}>{(rec.estimated_fidelity * 100).toFixed(1)}%</strong></span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Cost <strong style={{ color: "var(--text)" }}>{rec.estimated_cost_usd === 0 ? "Free" : `$${rec.estimated_cost_usd.toFixed(5)}`}</strong></span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Queue <strong style={{ color: "var(--text)" }}>{rec.queue_speed}</strong></span>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{rec.reasoning[0]}</div>
      {selected && <div style={{ marginTop: 6, fontSize: 11, color: "var(--strong)", fontWeight: 600 }}>✓ Selected</div>}
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

  const [form, setForm] = useState<JobSubmitRequest>({
    provider: "simulator", backend: "simulator",
    qasm: SAMPLE_QASM, shots: 1024,
    circuit_name: "", project_slug: "",
  });

  const [routeMode, setRouteMode] = useState<"manual" | "auto">("manual");
  const [routePref, setRoutePref] = useState<"quality" | "speed" | "cost" | "balanced">("quality");
  const [routing, setRouting] = useState(false);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);

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

  const handleRoute = async () => {
    setRouting(true); setRouteResult(null);
    try {
      const res = await fetch("/qlab-api/api/v1/jobs/route", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ qasm: form.qasm, shots: form.shots, preference: routePref }),
      });
      if (!res.ok) throw new Error(`Route failed: ${res.status}`);
      const data = await res.json() as RouteResult;
      setRouteResult(data);
      setForm(f => ({ ...f, provider: data.recommended_provider as JobSubmitRequest["provider"], backend: data.recommended_backend }));
    } catch (e) { setErr(e instanceof Error ? e.message : "Routing failed"); }
    finally { setRouting(false); }
  };

  const handleCompile = async () => {
    setCompiling(true); setCompileResult(null); setCompiledAccepted(false);
    try {
      const res = await fetch("/qlab-api/api/v1/circuits/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ qasm: form.qasm, target_backend: form.backend, optimization_level: optLevel }),
      });
      if (!res.ok) throw new Error(`Compile failed: ${res.status}`);
      setCompileResult(await res.json() as CompileResult);
    } catch (e) { setErr(e instanceof Error ? e.message : "Compilation failed"); }
    finally { setCompiling(false); }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const job = await submitJob(form);
      setJobs(prev => [job, ...prev]);
      setShowForm(false); setErr("");
      setRouteResult(null); setCompileResult(null); setCompiledAccepted(false);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  };

  const handleCancel = async (jobId: string) => {
    try {
      const updated = await cancelJob(jobId);
      setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, status: updated.status as JobSubmission["status"] } : j));
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const prefOptions: { key: typeof routePref; label: string }[] = [
    { key: "quality", label: "Quality" }, { key: "speed", label: "Speed" },
    { key: "cost", label: "Cost" },       { key: "balanced", label: "Balanced" },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Job Execution</h1>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)" }}>Submit, auto-route, and compile quantum jobs</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={() => { setShowForm(!showForm); setRouteResult(null); setCompileResult(null); }}>
            {showForm ? "Cancel" : "+ Submit Job"}
          </button>
        </div>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>}

      {/* Stats */}
      {stats && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { label: "Total Jobs", value: stats.total },
            { label: "Running",    value: stats.by_status?.running   ?? 0 },
            { label: "Completed",  value: stats.by_status?.completed ?? 0 },
            { label: "Failed",     value: stats.by_status?.failed    ?? 0 },
            { label: "Total Credits", value: stats.total_cost_credits?.toFixed(4) ?? "0" },
          ].map(s => (
            <div key={s.label} className="panel" style={{ padding: "10px 16px", minWidth: 110 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Submit form */}
      {showForm && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header"><h2>Submit New Job</h2></div>
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Step 1 — Circuit */}
            <div>
              <div className="section-label">Step 1 — Circuit</div>
              <textarea
                className="input"
                value={form.qasm}
                onChange={e => { setForm(f => ({ ...f, qasm: e.target.value })); setCompileResult(null); setCompiledAccepted(false); }}
                rows={8}
                style={{ fontFamily: "monospace", fontSize: 12, width: "100%", height: "auto", minWidth: 0 }}
              />
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Optimisation level:</span>
                <select
                  className="input"
                  style={{ height: 32, minWidth: 0, width: 150, fontSize: 12 }}
                  value={optLevel}
                  onChange={e => setOptLevel(Number(e.target.value))}
                >
                  <option value={0}>0 — None</option>
                  <option value={1}>1 — Light</option>
                  <option value={2}>2 — Medium</option>
                  <option value={3}>3 — Heavy</option>
                </select>
                <button className="btn" onClick={handleCompile} disabled={compiling} style={{ height: 32, fontSize: 12 }}>
                  {compiling ? "Compiling…" : "⚡ Compile & Optimise"}
                </button>
                {compiledAccepted && <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>✓ Compiled circuit active</span>}
              </div>

              {compileResult && !compiledAccepted && (
                <div className="panel" style={{ marginTop: 12 }}>
                  <div className="panel-header" style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Compiled for <strong>{compileResult.target_backend}</strong></span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{compileResult.optimization_description}</span>
                  </div>
                  <div style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                      <StatCard label="Depth" before={compileResult.original_depth} after={compileResult.compiled_depth} />
                      <StatCard label="Gates" before={compileResult.original_gate_count} after={compileResult.compiled_gate_count} />
                      <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", minWidth: 110 }}>
                        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Est. Fidelity</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ok)" }}>{(compileResult.estimated_fidelity * 100).toFixed(1)}%</div>
                      </div>
                      <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", minWidth: 110 }}>
                        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Compile time</div>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{compileResult.compile_time_ms}ms</div>
                      </div>
                    </div>
                    {compileResult.warnings.length > 0 && (
                      <div className="alert alert-warn" style={{ marginBottom: 10, fontSize: 12 }}>{compileResult.warnings.join(" · ")}</div>
                    )}
                    <button className="btn btn-primary" onClick={() => { setForm(f => ({ ...f, qasm: compileResult.compiled_qasm })); setCompiledAccepted(true); }} style={{ fontSize: 12 }}>
                      Use Compiled Circuit
                    </button>
                  </div>
                </div>
              )}
            </div>

            <hr className="divider" />

            {/* Step 2 — Backend */}
            <div>
              <div className="section-label">Step 2 — Backend Selection</div>
              <div style={{ display: "flex", gap: 0, marginBottom: 14, border: "1px solid var(--line)", borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
                {(["manual", "auto"] as const).map(m => (
                  <button key={m} onClick={() => { setRouteMode(m); setRouteResult(null); }} style={{
                    padding: "7px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
                    background: routeMode === m ? "var(--strong)" : "var(--input-bg)",
                    color: routeMode === m ? "#fff" : "var(--muted)",
                    transition: "background 0.15s",
                  }}>
                    {m === "manual" ? "Manual" : "⚡ Auto-Route"}
                  </button>
                ))}
              </div>

              {routeMode === "manual" ? (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Provider</span>
                    <select className="input" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value as JobSubmitRequest["provider"] }))}>
                      {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 2, minWidth: 180 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Backend</span>
                    <input className="input" value={form.backend} onChange={e => setForm(f => ({ ...f, backend: e.target.value }))} placeholder="e.g. ibm_brisbane" />
                  </label>
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Optimise for:</span>
                    {prefOptions.map(p => (
                      <button key={p.key} onClick={() => setRoutePref(p.key)} style={{
                        padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${routePref === p.key ? "var(--strong)" : "var(--line)"}`,
                        background: routePref === p.key ? "var(--info-bg)" : "var(--input-bg)",
                        color: routePref === p.key ? "var(--info-text)" : "var(--muted)",
                        transition: "all 0.15s",
                      }}>{p.label}</button>
                    ))}
                    <button className="btn btn-primary" onClick={handleRoute} disabled={routing} style={{ fontSize: 12 }}>
                      {routing ? "Routing…" : "Find Best Backend"}
                    </button>
                  </div>
                  {routeResult && (
                    <div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                        Circuit: {routeResult.circuit_qubits} qubits · depth ~{routeResult.circuit_depth} · {routeResult.circuit_gates} gates
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {routeResult.rankings.slice(0, 4).map(rec => (
                          <BackendCard
                            key={rec.backend} rec={rec}
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

            <hr className="divider" />

            {/* Step 3 — Config */}
            <div>
              <div className="section-label">Step 3 — Configuration</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 110px" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Shots</span>
                  <input className="input" type="number" value={form.shots} onChange={e => setForm(f => ({ ...f, shots: Number(e.target.value) }))} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Circuit Name</span>
                  <input className="input" value={form.circuit_name} onChange={e => setForm(f => ({ ...f, circuit_name: e.target.value }))} placeholder="optional" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Project Slug</span>
                  <input className="input" value={form.project_slug} onChange={e => setForm(f => ({ ...f, project_slug: e.target.value }))} placeholder="optional" />
                </label>
              </div>
            </div>

            <hr className="divider" />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Submitting to <strong style={{ color: "var(--text)" }}>{form.backend}</strong> via{" "}
                <strong style={{ color: "var(--strong)" }}>{form.provider}</strong> · {form.shots} shots
                {compiledAccepted ? " · compiled circuit ✓" : ""}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => { setShowForm(false); setRouteResult(null); setCompileResult(null); }}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit Job"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select className="input" style={{ width: 140, minWidth: 0 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["queued", "running", "completed", "failed", "cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" style={{ width: 140, minWidth: 0 }} value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
          <option value="">All providers</option>
          {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Job list */}
      {loading ? (
        <div className="text-muted">Loading jobs…</div>
      ) : jobs.length === 0 ? (
        <div className="panel" style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
          No jobs found. Submit your first job above.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {jobs.map(job => (
            <div key={job.job_id} className="panel" style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                    background: `${STATUS_COLOR[job.status] ?? "#6b7280"}22`,
                    color: STATUS_COLOR[job.status] ?? "#6b7280",
                  }}>{job.status}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>{job.job_id}</span>
                  <span style={{ fontWeight: 600 }}>{job.circuit_name || "Untitled"}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{job.provider} / {job.backend}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{job.shots} shots</span>
                  {job.cost_credits != null && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{job.cost_credits.toFixed(4)} credits</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(job.submitted_at).toLocaleString()}</span>
                  <a href={`/jobs/${job.job_id}`} className="btn" style={{ fontSize: 12, padding: "3px 10px", height: "auto" }}>Details</a>
                  {(job.status === "queued" || job.status === "running") && (
                    <button className="btn btn-danger" style={{ fontSize: 12, padding: "3px 10px", height: "auto" }}
                      onClick={() => handleCancel(job.job_id)}>Cancel</button>
                  )}
                </div>
              </div>
              {job.error_message && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger)" }}>Error: {job.error_message}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
