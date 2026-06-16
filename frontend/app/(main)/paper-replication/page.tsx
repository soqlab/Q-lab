"use client";

import { useEffect, useState } from "react";
import {
  startPaperReplication,
  listPaperReplications,
  type PaperReplicationJob,
} from "@/lib/api";

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; color: string }> = {
    running: { bg: "rgba(34,211,238,0.12)", color: "#22d3ee" },
    completed: { bg: "rgba(74,222,128,0.1)", color: "#4ade80" },
    failed: { bg: "rgba(248,113,113,0.1)", color: "#f87171" },
  };
  const s = cfg[status] ?? { bg: "rgba(161,161,170,0.12)", color: "#a1a1aa" };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {status}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const cfg: Record<string, { bg: string; color: string; label: string }> = {
    replicated: { bg: "rgba(74,222,128,0.1)", color: "#4ade80", label: "Replicated" },
    partially_replicated: { bg: "rgba(250,204,21,0.1)", color: "#facc15", label: "Partially Replicated" },
    failed: { bg: "rgba(248,113,113,0.1)", color: "#f87171", label: "Failed" },
  };
  const s = cfg[verdict] ?? { bg: "rgba(161,161,170,0.12)", color: "#a1a1aa", label: verdict };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 10px",
        borderRadius: 999,
      }}
    >
      {s.label}
    </span>
  );
}

function formatAuthors(authors: string[]): string {
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} et al.`;
}

function JobCard({ job }: { job: PaperReplicationJob }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "16px 18px",
        marginBottom: 12,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{job.paper_title}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {formatAuthors(job.paper_authors)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
          <StatusBadge status={job.status} />
          {job.verdict && <VerdictBadge verdict={job.verdict} />}
        </div>
      </div>

      {/* Main claim */}
      {job.main_claim && (
        <div
          style={{
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.2)",
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--muted)",
            marginBottom: 10,
            fontStyle: "italic",
          }}
        >
          &ldquo;{job.main_claim}&rdquo;
        </div>
      )}

      {/* Stats row */}
      {job.status === "completed" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
            gap: 10,
            marginBottom: 10,
          }}
        >
          {job.original_value !== undefined && (
            <div style={{ background: "var(--bg)", borderRadius: 6, padding: "8px 10px", border: "1px solid var(--line)" }}>
              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>ORIGINAL VALUE</div>
              <div style={{ fontWeight: 700, color: "var(--strong)" }}>{job.original_value.toFixed(4)}</div>
            </div>
          )}
          {job.replicated_value !== undefined && (
            <div style={{ background: "var(--bg)", borderRadius: 6, padding: "8px 10px", border: "1px solid var(--line)" }}>
              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>REPLICATED VALUE</div>
              <div style={{ fontWeight: 700, color: "var(--strong)" }}>{job.replicated_value.toFixed(4)}</div>
            </div>
          )}
          {job.deviation_sigma !== undefined && (
            <div style={{ background: "var(--bg)", borderRadius: 6, padding: "8px 10px", border: "1px solid var(--line)" }}>
              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>DEVIATION |σ|</div>
              <div
                style={{
                  fontWeight: 700,
                  color: Math.abs(job.deviation_sigma) < 2 ? "#4ade80" : Math.abs(job.deviation_sigma) < 3 ? "#facc15" : "#f87171",
                }}
              >
                {Math.abs(job.deviation_sigma).toFixed(2)}σ
              </div>
            </div>
          )}
          {job.p_value !== undefined && (
            <div style={{ background: "var(--bg)", borderRadius: 6, padding: "8px 10px", border: "1px solid var(--line)" }}>
              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>P-VALUE</div>
              <div
                style={{
                  fontWeight: 700,
                  color: job.p_value > 0.05 ? "#4ade80" : "#f87171",
                }}
              >
                {job.p_value.toExponential(2)}
              </div>
            </div>
          )}
          <div style={{ background: "var(--bg)", borderRadius: 6, padding: "8px 10px", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>CIRCUIT RAN</div>
            <div style={{ fontWeight: 700, color: job.circuit_ran ? "#4ade80" : "#f87171" }}>
              {job.circuit_ran ? "Yes" : "No"}
            </div>
          </div>
        </div>
      )}

      {/* Issues */}
      {job.issues && job.issues.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>ISSUES</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {job.issues.map((issue, i) => (
              <li key={i} style={{ fontSize: 12, color: "#f87171", marginBottom: 2 }}>
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
        <span>Backend: <strong style={{ color: "var(--strong)" }}>{job.backend_used}</strong></span>
        {job.n_qubits && <span>Qubits: <strong style={{ color: "var(--strong)" }}>{job.n_qubits}</strong></span>}
        <span>Started: {new Date(job.started_at).toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function PaperReplicationPage() {
  const [jobs, setJobs] = useState<PaperReplicationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form
  const [arxivUrl, setArxivUrl] = useState("");
  const [backend, setBackend] = useState("ibm_sherbrooke");
  const [nShots, setNShots] = useState(8192);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [newJob, setNewJob] = useState<PaperReplicationJob | null>(null);

  useEffect(() => {
    void listPaperReplications()
      .then((r) => setJobs(r.replications))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function handleReplicate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setNewJob(null);
    try {
      const job = await startPaperReplication({
        arxiv_url: arxivUrl,
        backend,
        n_shots: nShots,
      });
      setNewJob(job);
      setJobs((prev) => [job, ...prev]);
      setArxivUrl("");
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Replication failed to start");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>One-Click Paper Replication</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Paste an arXiv URL and Q-Lab automatically extracts the quantum circuit, runs it, and compares against the paper&apos;s claims.
        </p>
      </div>

      {/* Submit Form */}
      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>Replicate a Paper</h3>
        </div>
        <form
          onSubmit={(e) => { void handleReplicate(e); }}
          style={{ padding: "14px 18px" }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 200px 140px",
              gap: 12,
              marginBottom: 14,
              alignItems: "end",
            }}
          >
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                arXiv URL
              </label>
              <input
                className="input"
                value={arxivUrl}
                onChange={(e) => setArxivUrl(e.target.value)}
                placeholder="https://arxiv.org/abs/2301.12345"
                required
                type="url"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                Backend
              </label>
              <select
                className="input"
                value={backend}
                onChange={(e) => setBackend(e.target.value)}
              >
                <option value="ibm_sherbrooke">ibm_sherbrooke</option>
                <option value="ibm_kyoto">ibm_kyoto</option>
                <option value="simulator">simulator</option>
                <option value="aer_simulator">aer_simulator</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                N Shots
              </label>
              <input
                className="input"
                type="number"
                min="100"
                max="100000"
                value={nShots}
                onChange={(e) => setNShots(parseInt(e.target.value, 10))}
              />
            </div>
          </div>
          <button className="button" type="submit" disabled={submitting}>
            {submitting ? "Starting replication…" : "Replicate Paper"}
          </button>
        </form>

        {submitError && (
          <div
            style={{
              margin: "0 18px 14px",
              padding: "10px 14px",
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.3)",
              borderRadius: 8,
              color: "#f87171",
              fontSize: 13,
            }}
          >
            {submitError}
          </div>
        )}

        {newJob && (
          <div style={{ margin: "0 18px 14px" }}>
            <div style={{ fontSize: 12, color: "#4ade80", fontWeight: 600, marginBottom: 8 }}>
              Job created!
            </div>
            <JobCard job={newJob} />
          </div>
        )}
      </section>

      {/* Jobs List */}
      <section className="panel">
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>Replication Jobs</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{jobs.length} total</span>
        </div>

        <div style={{ padding: "14px 18px" }}>
          {loading && <div className="empty">Loading jobs…</div>}
          {error && <div className="empty" style={{ color: "var(--danger)" }}>{error}</div>}
          {!loading && !error && jobs.length === 0 && (
            <div className="empty">No replication jobs yet. Paste an arXiv URL above to get started.</div>
          )}
          {jobs.map((job) => (
            <JobCard key={job.replication_id} job={job} />
          ))}
        </div>
      </section>
    </main>
  );
}
