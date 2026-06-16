"use client";

import { useState, useEffect, useCallback } from "react";
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

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-gray-700 text-gray-300",
  queued: "bg-yellow-700 text-yellow-200",
  running: "bg-blue-700 text-blue-200",
  completed: "bg-green-700 text-green-200",
  failed: "bg-red-700 text-red-200",
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
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">HPC Hybrid Bridge</h1>
        <p className="text-gray-400 mt-1">
          Submit classical post-processing jobs to SLURM, PBS, and LSF clusters
        </p>
      </div>

      {/* Clusters */}
      <section>
        <h2 className="text-lg font-semibold text-gray-300 mb-3">Cluster Status</h2>
        {clustersLoading && <p className="text-gray-400 animate-pulse">Loading clusters...</p>}
        {clustersError && (
          <p className="text-red-400 bg-red-950 border border-red-800 rounded px-4 py-2">
            {clustersError}
          </p>
        )}
        {!clustersLoading && !clustersError && (
          <div className="flex flex-wrap gap-3">
            {clusters.map((c) => (
              <div
                key={c.name}
                className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 min-w-48 space-y-1"
              >
                <div className="font-semibold text-white">{c.name}</div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="bg-indigo-800 text-indigo-200 px-2 py-0.5 rounded">
                    {c.scheduler}
                  </span>
                  <span className="text-gray-400">{c.available_nodes} nodes free</span>
                </div>
                <div className="text-xs text-gray-500">Wait: {c.typical_wait_min}min</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.partitions.map((p) => (
                    <span
                      key={p}
                      className="bg-gray-800 text-gray-400 text-xs px-1.5 py-0.5 rounded"
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Job Submission */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-200">Submit Job</h2>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Job Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="post-process-vqe"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Scheduler</label>
              <select
                value={scheduler}
                onChange={(e) => setScheduler(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {SCHEDULER_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Nodes (1–64)
              </label>
              <input
                type="number"
                min={1}
                max={64}
                value={nNodes}
                onChange={(e) => setNNodes(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Cores/Node</label>
              <select
                value={nCores}
                onChange={(e) => setNCores(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {CORES_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Memory (GB)</label>
              <select
                value={memoryGb}
                onChange={(e) => setMemoryGb(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {MEMORY_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Walltime (hours)</label>
              <input
                type="number"
                min={1}
                value={walltimeHours}
                onChange={(e) => setWalltimeHours(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Partition (optional)</label>
              <input
                type="text"
                value={partition}
                onChange={(e) => setPartition(e.target.value)}
                placeholder="gpu"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Quantum Run ID (optional)</label>
            <input
              type="text"
              value={quantumRunId}
              onChange={(e) => setQuantumRunId(e.target.value)}
              placeholder="run_abc123"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Job Script</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={6}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-green-300 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </div>

          {submitError && (
            <p className="text-red-400 bg-red-950 border border-red-800 rounded px-3 py-2 text-sm">
              {submitError}
            </p>
          )}
          {submitSuccess && (
            <p className="text-green-400 bg-green-950 border border-green-800 rounded px-3 py-2 text-sm">
              Job submitted successfully
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2 rounded-lg font-medium transition-colors"
          >
            {submitting ? "Submitting..." : "Submit Job"}
          </button>
        </section>

        {/* Job List */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-200">Jobs</h2>
            <button
              onClick={fetchJobs}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Refresh
            </button>
          </div>

          {jobsLoading && <p className="text-gray-400 animate-pulse">Loading jobs...</p>}
          {jobsError && (
            <p className="text-red-400 bg-red-950 border border-red-800 rounded px-3 py-2 text-sm">
              {jobsError}
            </p>
          )}
          {!jobsLoading && !jobsError && jobs.length === 0 && (
            <p className="text-gray-500 text-sm">No jobs yet.</p>
          )}

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {jobs.map((job) => (
              <div
                key={job.job_id}
                className="bg-gray-800 border border-gray-700 rounded-lg"
              >
                <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-100 text-sm truncate">{job.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {job.slurm_id && <span>ID: {job.slurm_id} · </span>}
                      {job.submitted_at}
                    </div>
                  </div>

                  <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                    {job.scheduler?.toUpperCase()}
                  </span>

                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[job.status] ?? "bg-gray-700 text-gray-300"}`}
                  >
                    {job.status}
                  </span>

                  {job.queue_position != null && (
                    <span className="text-xs text-gray-500">pos {job.queue_position}</span>
                  )}

                  {(job.status === "running" || job.status === "queued") && (
                    <button
                      onClick={() => handleCancel(job.job_id)}
                      disabled={cancellingId === job.job_id}
                      className="text-xs bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-300 px-2 py-0.5 rounded transition-colors"
                    >
                      {cancellingId === job.job_id ? "..." : "Cancel"}
                    </button>
                  )}

                  <button
                    onClick={() => toggleExpand(job.job_id)}
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    {expandedJobs.has(job.job_id) ? "▲" : "▼"}
                  </button>
                </div>

                {expandedJobs.has(job.job_id) && (
                  <div className="border-t border-gray-700 px-4 py-3 space-y-2">
                    {job.node_allocation && (
                      <div className="text-xs text-gray-400">
                        <span className="text-gray-500">Nodes: </span>{job.node_allocation}
                      </div>
                    )}
                    {job.stdout_excerpt && (
                      <pre className="bg-gray-950 rounded p-2 text-xs text-green-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-32">
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
