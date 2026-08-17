"use client";

import { useState, useEffect, useCallback, CSSProperties } from "react";
import {
  submitHPCJob,
  listHPCJobs,
  cancelHPCJob,
  listHPCClusters,
  HPCJob,
} from "@/lib/api";

const SCHEDULER_OPTIONS = ["slurm", "pbs", "lsf"];
const CORES_OPTIONS = [16, 32, 64, 128];
const MEMORY_OPTIONS = [64, 128, 256, 512];

const DEFAULT_SCRIPT = `#!/bin/bash
#SBATCH --ntasks=32
python post_process.py --run-id $QUANTUM_RUN_ID`;

type ClusterInfo = {
  name: string;
  scheduler: string;
  available_nodes: number;
  typical_wait_min: number;
  partitions: string[];
};

const STATUS_STYLES: Record<string, CSSProperties> = {
  submitted: { background: "var(--line)", color: "var(--text)" },
  queued: { background: "rgba(245,158,11,0.2)", color: "#f59e0b" },
  running: { background: "rgba(59,130,246,0.2)", color: "var(--info-text)" },
  completed: { background: "rgba(16,185,129,0.2)", color: "var(--ok)" },
  failed: { background: "rgba(239,68,68,0.2)", color: "var(--danger)" },
};

export default function HPCBridgePage() {
  const [clusters, setClusters] = useState<ClusterInfo[]>([]);
  const [clustersLoading, setClustersLoading] = useState(true);
  const [clustersError, setClustersError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<HPCJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  // Form state
  const [name, setName] = useState("");
  const [scheduler, setScheduler] = useState("slurm");
  const [nNodes, setNNodes] = useState(1);
  const [nCores, setNCores] = useState(32);
  const [memoryGb, setMemoryGb] = useState(128);
  const [walltimeHours, setWalltimeHours] = useState(4);
  const [partition, setPartition] = useState("");
  const [quantumRunId, setQuantumRunId] = useState("");
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const data = await listHPCJobs();
      setJobs(data.jobs);
      setJobsError(null);
    } catch (e: unknown) {
      setJobsError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    setClustersLoading(true);
    listHPCClusters()
      .then((data) => setClusters(data.clusters))
      .catch((e: unknown) =>
        setClustersError(e instanceof Error ? e.message : "Failed to load clusters")
      )
      .finally(() => setClustersLoading(false));

    fetchJobs();
  }, [fetchJobs]);

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      await submitHPCJob({
        name,
        scheduler,
        n_nodes: nNodes,
        n_cores_per_node: nCores,
        memory_gb: memoryGb,
        walltime_hours: walltimeHours,
        partition: partition || undefined,
        quantum_run_id: quantumRunId || undefined,
        script,
      });
      setSubmitSuccess(true);
      setName("");
      await fetchJobs();
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      await cancelHPCJob(id);
      await fetchJobs();
    } catch {
      // silently ignore or show inline
    } finally {
      setCancellingId(null);
    }
  }

  function toggleExpand(id: string) {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div style={{ minHeight: "100vh", padding: 24, display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
        <span>🖥️</span>
        <span><strong style={{ color: "#6366f1" }}>SSH Submission Ready</strong> — Provide <code style={{ background: "rgba(99,102,241,0.15)", padding: "1px 5px", borderRadius: 4 }}>ssh_host</code>, <code style={{ background: "rgba(99,102,241,0.15)", padding: "1px 5px", borderRadius: 4 }}>ssh_user</code>, and <code style={{ background: "rgba(99,102,241,0.15)", padding: "1px 5px", borderRadius: 4 }}>ssh_key_b64</code> to submit real SLURM jobs to any cluster you have access to.</span>
      </div>
      <div>
        <h1 style={{ fontSize: 30, fontWeight: 700, color: "var(--text)" }}>HPC Hybrid Bridge</h1>
        <p style={{ color: "var(--muted)", marginTop: 4 }}>
          Submit classical post-processing jobs to SLURM, PBS, and LSF clusters
        </p>
      </div>

      {/* Clusters */}
      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Cluster Status</h2>
        {clustersLoading && <p style={{ color: "var(--muted)" }}>Loading clusters...</p>}
        {clustersError && (
          <p style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: "8px 16px" }}>
            {clustersError}
          </p>
        )}
        {!clustersLoading && !clustersError && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {(clusters ?? []).map((c) => (
              <div
                key={c.name}
                style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "12px 16px", minWidth: 192, display: "flex", flexDirection: "column", gap: 4 }}
              >
                <div style={{ fontWeight: 600, color: "var(--text)" }}>{c.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ background: "var(--strong)", color: "var(--info-text)", padding: "2px 8px", borderRadius: 6 }}>
                    {c.scheduler}
                  </span>
                  <span style={{ color: "var(--muted)" }}>{c.available_nodes} nodes free</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Wait: {c.typical_wait_min}min</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  {(c.partitions ?? []).map((p) => (
                    <span
                      key={p}
                      style={{ background: "var(--line)", color: "var(--muted)", fontSize: 12, padding: "2px 6px", borderRadius: 6 }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
        {/* Job Submission */}
        <section style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)" }}>Submit Job</h2>

          <div>
            <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Job Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="post-process-vqe"
              className="input"
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Scheduler</label>
              <select
                value={scheduler}
                onChange={(e) => setScheduler(e.target.value)}
                className="input"
                style={{ width: "100%" }}
              >
                {SCHEDULER_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                Nodes (1–64)
              </label>
              <input
                type="number"
                min={1}
                max={64}
                value={nNodes}
                onChange={(e) => setNNodes(Number(e.target.value))}
                className="input"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Cores/Node</label>
              <select
                value={nCores}
                onChange={(e) => setNCores(Number(e.target.value))}
                className="input"
                style={{ width: "100%" }}
              >
                {CORES_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Memory (GB)</label>
              <select
                value={memoryGb}
                onChange={(e) => setMemoryGb(Number(e.target.value))}
                className="input"
                style={{ width: "100%" }}
              >
                {MEMORY_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Walltime (hours)</label>
              <input
                type="number"
                min={1}
                value={walltimeHours}
                onChange={(e) => setWalltimeHours(Number(e.target.value))}
                className="input"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Partition (optional)</label>
              <input
                type="text"
                value={partition}
                onChange={(e) => setPartition(e.target.value)}
                placeholder="gpu"
                className="input"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Quantum Run ID (optional)</label>
            <input
              type="text"
              value={quantumRunId}
              onChange={(e) => setQuantumRunId(e.target.value)}
              placeholder="run_abc123"
              className="input"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Job Script</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={6}
              className="input"
              style={{ width: "100%", color: "var(--ok)", fontFamily: "ui-monospace,monospace", fontSize: 12, resize: "vertical" }}
            />
          </div>

          {submitError && (
            <p style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: "8px 12px", fontSize: 13 }}>
              {submitError}
            </p>
          )}
          {submitSuccess && (
            <p style={{ color: "var(--ok)", background: "rgba(16,185,129,0.1)", border: "1px solid var(--ok)", borderRadius: 6, padding: "8px 12px", fontSize: 13 }}>
              Job submitted successfully
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
            className="button"
            style={{ width: "100%", opacity: (submitting || !name.trim()) ? 0.5 : 1, cursor: (submitting || !name.trim()) ? "not-allowed" : "pointer" }}
          >
            {submitting ? "Submitting..." : "Submit Job"}
          </button>
        </section>

        {/* Job List */}
        <section style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)" }}>Jobs</h2>
            <button
              onClick={fetchJobs}
              style={{ fontSize: 12, color: "var(--strong)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              Refresh
            </button>
          </div>

          {jobsLoading && <p style={{ color: "var(--muted)" }}>Loading jobs...</p>}
          {jobsError && (
            <p style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: "8px 12px", fontSize: 13 }}>
              {jobsError}
            </p>
          )}
          {!jobsLoading && !jobsError && jobs.length === 0 && (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>No jobs yet.</p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 600, overflowY: "auto", paddingRight: 4 }}>
            {(jobs ?? []).map((job) => (
              <div
                key={job.job_id}
                style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, color: "var(--text)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {job.slurm_id && <span>ID: {job.slurm_id} · </span>}
                      {job.submitted_at}
                    </div>
                  </div>

                  <span style={{ fontSize: 12, background: "var(--line)", color: "var(--text)", padding: "2px 8px", borderRadius: 6 }}>
                    {job.scheduler?.toUpperCase()}
                  </span>

                  <span
                    style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, fontWeight: 500, ...(STATUS_STYLES[job.status] ?? { background: "var(--line)", color: "var(--text)" }) }}
                  >
                    {job.status}
                  </span>

                  {job.queue_position != null && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>pos {job.queue_position}</span>
                  )}

                  {(job.status === "running" || job.status === "queued") && (
                    <button
                      onClick={() => handleCancel(job.job_id)}
                      disabled={cancellingId === job.job_id}
                      style={{ fontSize: 12, background: "rgba(239,68,68,0.1)", color: "var(--danger)", padding: "2px 8px", borderRadius: 6, border: "none", cursor: cancellingId === job.job_id ? "not-allowed" : "pointer", opacity: cancellingId === job.job_id ? 0.5 : 1 }}
                    >
                      {cancellingId === job.job_id ? "..." : "Cancel"}
                    </button>
                  )}

                  <button
                    onClick={() => toggleExpand(job.job_id)}
                    style={{ fontSize: 12, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {expandedJobs.has(job.job_id) ? "▲" : "▼"}
                  </button>
                </div>

                {expandedJobs.has(job.job_id) && (
                  <div style={{ borderTop: "1px solid var(--line)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {job.node_allocation && (
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        <span style={{ color: "var(--muted)" }}>Nodes: </span>{job.node_allocation}
                      </div>
                    )}
                    {job.stdout_excerpt && (
                      <pre style={{ fontFamily: "ui-monospace,monospace", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", overflowX: "auto", whiteSpace: "pre-wrap", fontSize: 12, color: "var(--ok)", maxHeight: 128 }}>
                        {job.stdout_excerpt}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
