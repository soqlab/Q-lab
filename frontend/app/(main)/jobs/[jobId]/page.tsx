"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getJob, syncJob, cancelJob, JobSubmission } from "../../../../lib/api";

const STATUS_COLOR: Record<string, string> = {
  queued: "#f59e0b", running: "#3b82f6", completed: "#10b981",
  failed: "#ef4444", cancelled: "#6b7280",
};

export default function JobDetailPage() {
  const params = useParams();
  const jobId = String(params.jobId ?? "");
  const [job, setJob] = useState<JobSubmission | null>(null);
  const [err, setErr] = useState("");
  const [streaming, setStreaming] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const load = () => {
    getJob(jobId)
      .then(j => { setJob(j); setErr(""); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => { load(); }, [jobId]);

  const startStream = () => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`/qlab-api/api/v1/jobs/${jobId}/stream`);
    esRef.current = es;
    setStreaming(true);

    es.addEventListener("job.updated", (evt) => {
      try { setJob(JSON.parse((evt as MessageEvent).data) as JobSubmission); } catch { /* ignore */ }
    });
    es.addEventListener("done", () => {
      setStreaming(false);
      es.close();
    });
    es.onerror = () => {
      setStreaming(false);
      es.close();
    };
  };

  useEffect(() => () => { esRef.current?.close(); }, []);

  const handleSync = async () => {
    try {
      const updated = await syncJob(jobId);
      setJob(updated);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCancel = async () => {
    try {
      const res = await cancelJob(jobId);
      setJob(prev => prev ? { ...prev, status: res.status as JobSubmission["status"] } : prev);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (!job && !err) return <div style={{ padding: 24 }}>Loading job...</div>;
  if (!job) return <div style={{ padding: 24, color: "#ef4444" }}>Error: {err}</div>;

  const terminal = ["completed", "failed", "cancelled"].includes(job.status);

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ marginBottom: 8, fontSize: 13, color: "#9ca3af" }}>
        <a href="/jobs" style={{ color: "#6b7280" }}>Jobs</a> / {jobId}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{job.circuit_name || "Untitled Job"}</h1>
        <span style={{
          padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600,
          background: `${STATUS_COLOR[job.status] ?? "#6b7280"}22`,
          color: STATUS_COLOR[job.status] ?? "#6b7280",
        }}>{job.status}</span>
        {streaming && <span style={{ fontSize: 12, color: "#3b82f6", animation: "pulse 1s infinite" }}>● Live</span>}
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className="btn" onClick={handleSync}>Sync Status</button>
        {!terminal && !streaming && (
          <button className="btn btn-primary" onClick={startStream}>Watch Live</button>
        )}
        {streaming && <button className="btn" onClick={() => { esRef.current?.close(); setStreaming(false); }}>Stop Stream</button>}
        {!terminal && (
          <button className="btn" style={{ color: "#ef4444" }} onClick={handleCancel}>Cancel Job</button>
        )}
        {job.run_id && (
          <a href={`/runs/${job.run_id}`} className="btn btn-primary">View Run</a>
        )}
      </div>

      {/* Info grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Job ID", value: job.job_id },
          { label: "Provider", value: job.provider },
          { label: "Backend", value: job.backend },
          { label: "Shots", value: job.shots.toLocaleString() },
          { label: "Cost Credits", value: job.cost_credits?.toFixed(6) ?? "—" },
          { label: "Project", value: job.project_slug ?? "—" },
          { label: "Provider Job ID", value: job.provider_job_id ?? "—" },
          { label: "Run ID", value: job.run_id ?? "—" },
          { label: "Submitted", value: new Date(job.submitted_at).toLocaleString() },
          { label: "Completed", value: job.completed_at ? new Date(job.completed_at).toLocaleString() : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="panel" style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
            <div style={{ fontFamily: "monospace", fontSize: 12, marginTop: 3, wordBreak: "break-all" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Error */}
      {job.error_message && (
        <div className="panel" style={{ padding: 16, marginBottom: 16, borderLeft: "3px solid #ef4444" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#ef4444", marginBottom: 4 }}>Error</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, color: "#ef4444" }}>{job.error_message}</div>
        </div>
      )}

      {/* Results */}
      {job.result && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header"><h2>Results</h2></div>
          <div style={{ padding: 16 }}>
            <pre style={{ fontSize: 12, overflow: "auto", maxHeight: 300, margin: 0 }}>
              {JSON.stringify(job.result, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* QASM */}
      {job.qasm && (
        <div className="panel">
          <div className="panel-header"><h2>QASM Circuit</h2></div>
          <div style={{ padding: 16 }}>
            <pre style={{ fontFamily: "monospace", fontSize: 12, overflow: "auto", maxHeight: 300, margin: 0 }}>
              {job.qasm}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
