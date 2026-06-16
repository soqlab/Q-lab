"use client";
import { useState, useEffect } from "react";
import { submitHardwareJob, listHardwareJobs, getHardwareJob, listHardwareBackends, HardwareJob } from "@/lib/api";

const DEMO_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[1],q[2];
measure q[0] -> c[0];
measure q[1] -> c[1];
measure q[2] -> c[2];`;

export default function HardwareJobsPage() {
  const [qasm, setQasm] = useState(DEMO_QASM);
  const [backend, setBackend] = useState("ibm_nazca");
  const [nShots, setNShots] = useState(1024);
  const [backends, setBackends] = useState<Array<Record<string, unknown>>>([]);
  const [jobs, setJobs] = useState<HardwareJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    listHardwareBackends().then(r => setBackends(r.backends)).catch(() => {});
    listHardwareJobs().then(r => setJobs(r.jobs)).catch(() => {});
  }, []);

  async function submit() {
    setLoading(true); setError(null);
    try {
      const job = await submitHardwareJob({ qasm, backend, n_shots: nShots });
      setJobs(prev => [job, ...prev]);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function refresh(jobId: string) {
    setPolling(true);
    try {
      const updated = await getHardwareJob(jobId);
      setJobs(prev => prev.map(j => j.job_id === jobId ? updated : j));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPolling(false); }
  }

  const statusColor = (s: string) => s === "completed" ? "#34d399" : s === "running" ? "#fbbf24" : s === "failed" ? "#f87171" : "#94a3b8";

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Submit Job</div>
          <textarea value={qasm} onChange={e => setQasm(e.target.value)}
            style={{ width: "100%", height: 160, background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: 8, fontSize: 11, fontFamily: "monospace", resize: "vertical" }} />
          <select value={backend} onChange={e => setBackend(e.target.value)}
            style={{ width: "100%", marginTop: 8, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {backends.map(b => <option key={String(b.id)} value={String(b.id)}>{String(b.id)} ({String(b.provider)})</option>)}
          </select>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "#64748b" }}>Shots</label>
            <input type="number" value={nShots} onChange={e => setNShots(Number(e.target.value))} min={100} max={65536}
              style={{ flex: 1, padding: "6px 8px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }} />
          </div>
          <button onClick={submit} disabled={loading}
            style={{ marginTop: 12, width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Submitting…" : "Submit to Hardware"}
          </button>
        </div>

        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Available Backends</div>
          {backends.slice(0, 4).map(b => (
            <div key={String(b.id)} style={{ marginBottom: 8, padding: 8, background: "#0f172a", borderRadius: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{String(b.id)}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{String(b.provider)} · {String(b.n_qubits)} qubits · Q{String(b.queue_depth)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}
        <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 16 }}>Jobs ({jobs.length})</div>
        {jobs.map(job => (
          <div key={job.job_id} style={{ background: "#1e293b", borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "#64748b" }}>{job.job_id.slice(0, 16)}…</span>
                <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: `${statusColor(job.status)}22`, color: statusColor(job.status) }}>{job.status}</span>
              </div>
              <button onClick={() => refresh(job.job_id)} disabled={polling}
                style={{ padding: "4px 10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                Refresh
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {[["Backend", job.backend], ["Provider", job.provider], ["Shots", String(job.n_shots)], ["Queue", `${job.queue_position}`]].map(([l, v]) => (
                <div key={l} style={{ background: "#0f172a", borderRadius: 6, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{v}</div>
                </div>
              ))}
            </div>
            {job.status === "completed" && Object.keys(job.counts).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Results (success: {(job.success_probability * 100).toFixed(1)}%)</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Object.entries(job.counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([state, count]) => (
                    <div key={state} style={{ background: "#0f172a", borderRadius: 6, padding: "6px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 12, fontFamily: "monospace", color: "#a78bfa" }}>{state}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#34d399" }}>{count}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {jobs.length === 0 && <div style={{ color: "#475569", textAlign: "center", padding: 40 }}>No jobs yet — submit a circuit above</div>}
      </div>
    </div>
  );
}
