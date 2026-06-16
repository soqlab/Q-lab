"use client";

import { useEffect, useState } from "react";
import {
  listJobs, submitJob, getJobStats, cancelJob,
  JobSubmission, JobStats, JobSubmitRequest,
} from "../../../lib/api";

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

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobSubmission[]>([]);
  const [stats, setStats] = useState<JobStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterProvider, setFilterProvider] = useState("");

  const [form, setForm] = useState<JobSubmitRequest>({
    provider: "simulator",
    backend: "ibm_brisbane",
    qasm: SAMPLE_QASM,
    shots: 1024,
    circuit_name: "",
    project_slug: "",
  });

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

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const job = await submitJob(form);
      setJobs(prev => [job, ...prev]);
      setShowForm(false);
      setErr("");
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

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Job Execution</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
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

      {/* Submit form */}
      {showForm && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header"><h2>Submit New Job</h2></div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>Provider</span>
                <select className="input" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value as JobSubmitRequest["provider"] }))}>
                  {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 160 }}>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>Backend</span>
                <input className="input" value={form.backend} onChange={e => setForm(f => ({ ...f, backend: e.target.value }))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 100px" }}>
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
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>QASM Circuit</span>
              <textarea
                className="input"
                value={form.qasm}
                onChange={e => setForm(f => ({ ...f, qasm: e.target.value }))}
                rows={10}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Job"}
              </button>
              <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
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
        <div className="text-muted">Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="panel" style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
          No jobs found. Submit your first job above.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {jobs.map(job => (
            <div key={job.job_id} className="panel" style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>
                    {new Date(job.submitted_at).toLocaleString()}
                  </span>
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
