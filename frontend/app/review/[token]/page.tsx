"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp,
  ExternalLink, AlertTriangle, Microscope,
} from "lucide-react";

// ---------------------------------------------------------------------------
// API helpers (no auth — public page)
// ---------------------------------------------------------------------------

const API = "/qlab-api";

async function publicFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunProvenance {
  run_id: string;
  circuit_name: string | null;
  backend: string | null;
  status: string;
  project_slug: string | null;
  created_at: string | null;
  qasm: string | null;
  fingerprint: Record<string, unknown>;
  parameters: Record<string, unknown>;
  execution: Record<string, unknown>;
  calibration: Record<string, unknown>;
  transpiler: Record<string, unknown>;
  timing: Record<string, unknown>;
  results: Record<string, unknown>;
  tags: string[];
  health_score: number | null;
}

interface ReviewData {
  review_id: string;
  run_id: string;
  requester_name: string;
  reviewer_name: string;
  reviewer_institution: string;
  review_type: string;
  message: string | null;
  access_token: string;
  status: string;
  reviewer_comments: string | null;
  signature: string | null;
  signed_at: string | null;
  created_at: string;
  run: RunProvenance | null;
}

interface Decision {
  decision: "approved" | "revision_requested" | "rejected";
  comments: string;
  reviewer_name: string;
  reviewer_institution: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function healthColor(score: number | null | undefined): string {
  if (score == null) return "#94a3b8";
  if (score >= 70) return "#4ade80";
  if (score >= 40) return "#fbbf24";
  return "#f87171";
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1e2d3d", fontSize: 13 }}>
      <span style={{ color: "#7a96b0" }}>{label}</span>
      <span style={{ fontWeight: 500, maxWidth: "55%", textAlign: "right", wordBreak: "break-all" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 10, padding: "18px 22px", marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{title}</h3>
      {children}
    </div>
  );
}

function CollapsibleQASM({ qasm }: { qasm: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#60c5ff", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: open ? 10 : 0 }}
      >
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        {open ? "Hide" : "Show"} QASM Circuit
      </button>
      {open && (
        <pre style={{
          background: "#070f1a", border: "1px solid #2d3f55", borderRadius: 8,
          padding: "12px 16px", fontSize: 11, overflow: "auto",
          maxHeight: 320, color: "#94a3b8", margin: 0,
        }}>
          {qasm}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decision form
// ---------------------------------------------------------------------------

function DecisionForm({
  token, review, onDecided,
}: {
  token: string;
  review: ReviewData;
  onDecided: (updated: ReviewData) => void;
}) {
  const [form, setForm] = useState<Decision>({
    decision: "approved",
    comments: "",
    reviewer_name: review.reviewer_name,
    reviewer_institution: review.reviewer_institution,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof Decision, val: string) {
    setForm(f => ({ ...f, [field]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.comments.trim()) { setError("Comments are required."); return; }
    setSubmitting(true); setError(null);
    try {
      const updated = await publicFetch(`/api/v1/peer-review/token/${token}/decide`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      onDecided(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally { setSubmitting(false); }
  }

  const inputStyle = {
    width: "100%", background: "#070f1a", border: "1px solid #2d3f55",
    borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 13,
  };
  const labelStyle = { fontSize: 12, color: "#7a96b0", display: "block" as const, marginBottom: 5 };

  const DECISIONS: Array<{ value: Decision["decision"]; label: string; color: string }> = [
    { value: "approved", label: "Approved", color: "#4ade80" },
    { value: "revision_requested", label: "Revision Requested", color: "#fbbf24" },
    { value: "rejected", label: "Rejected", color: "#f87171" },
  ];

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={labelStyle}>Decision *</label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {DECISIONS.map(d => (
            <label key={d.value} style={{
              display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
              padding: "8px 16px", borderRadius: 8,
              border: `2px solid ${form.decision === d.value ? d.color : "#2d3f55"}`,
              background: form.decision === d.value ? `${d.color}18` : "transparent",
              color: form.decision === d.value ? d.color : "#94a3b8",
              fontWeight: form.decision === d.value ? 700 : 400, fontSize: 13,
              transition: "all 0.15s",
            }}>
              <input
                type="radio" name="decision" value={d.value}
                checked={form.decision === d.value}
                onChange={() => set("decision", d.value)}
                style={{ display: "none" }}
              />
              {d.value === "approved" && <CheckCircle size={14} />}
              {d.value === "revision_requested" && <AlertCircle size={14} />}
              {d.value === "rejected" && <XCircle size={14} />}
              {d.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Your Name *</label>
          <input style={inputStyle} value={form.reviewer_name} onChange={e => set("reviewer_name", e.target.value)} required />
        </div>
        <div>
          <label style={labelStyle}>Institution *</label>
          <input style={inputStyle} value={form.reviewer_institution} onChange={e => set("reviewer_institution", e.target.value)} required />
        </div>
      </div>

      <div>
        <label style={labelStyle}>Comments *</label>
        <textarea
          style={{ ...inputStyle, resize: "vertical", minHeight: 120 }}
          value={form.comments}
          onChange={e => set("comments", e.target.value)}
          required
          placeholder="Provide your review comments, methodology evaluation, and any reproducibility concerns…"
        />
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "#2a1515", border: "1px solid #7f1d1d", borderRadius: 6, color: "#f87171", fontSize: 13 }}>
          {error}
        </div>
      )}

      <button
        type="submit" disabled={submitting}
        style={{
          padding: "10px 24px", background: form.decision === "approved" ? "#15803d" : form.decision === "rejected" ? "#991b1b" : "#92400e",
          color: "#fff", border: "none", borderRadius: 8, cursor: submitting ? "not-allowed" : "pointer",
          fontWeight: 700, fontSize: 14, opacity: submitting ? 0.6 : 1,
          display: "flex", alignItems: "center", gap: 8, alignSelf: "flex-start",
        }}
      >
        {form.decision === "approved" && <CheckCircle size={16} />}
        {form.decision === "revision_requested" && <AlertCircle size={16} />}
        {form.decision === "rejected" && <XCircle size={16} />}
        {submitting ? "Submitting…" : `Submit Decision: ${DECISIONS.find(d => d.value === form.decision)?.label}`}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Approved banner
// ---------------------------------------------------------------------------

function ApprovedBanner({ signature, reviewerName, signedAt }: {
  signature: string; reviewerName: string; signedAt: string | null;
}) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #0a2a15 0%, #14532d 100%)",
      border: "2px solid #4ade80", borderRadius: 12, padding: "24px 28px", marginBottom: 24,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <CheckCircle size={28} color="#4ade80" />
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#4ade80" }}>
            Peer-Reviewed and Cryptographically Signed
          </div>
          <div style={{ fontSize: 13, color: "#86efac", marginTop: 2 }}>
            Signed by {reviewerName}{signedAt ? ` on ${new Date(signedAt).toLocaleDateString()}` : ""}
          </div>
        </div>
      </div>
      <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px" }}>
        <div style={{ fontSize: 10, color: "#4ade80", marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em" }}>
          SHA-256 SIGNATURE
        </div>
        <code style={{ fontSize: 11, wordBreak: "break-all", color: "#86efac" }}>{signature}</code>
      </div>
      <a
        href={`/qlab-api/api/v1/peer-review/verify/${signature}`}
        target="_blank" rel="noreferrer"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, color: "#4ade80", fontSize: 12, textDecoration: "none" }}
      >
        <ExternalLink size={13} /> Verify this signature independently
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ReviewPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicFetch(`/api/v1/peer-review/token/${token}`)
      .then((d: ReviewData) => { setData(d); setLoading(false); })
      .catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [token]);

  const alreadyDecided = data && ["approved", "revision_requested", "rejected"].includes(data.status);

  return (
    <div style={{ minHeight: "100vh", background: "#070f1a", fontFamily: "Inter, Segoe UI, Arial, sans-serif", color: "#e2e8f0" }}>
      {/* Header */}
      <header style={{
        background: "#0d1b2a", borderBottom: "1px solid #1e2d3d",
        padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Microscope size={20} color="#60c5ff" />
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.5px" }}>Q-Lab</span>
          <span style={{ background: "#1a2535", color: "#60c5ff", fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 12 }}>
            Peer Review
          </span>
        </div>
        <a href="/" style={{ color: "#7a96b0", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}>
          <ExternalLink size={13} /> Open Q-Lab
        </a>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", color: "#7a96b0", padding: "80px 0", fontSize: 16 }}>
            Loading review…
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <AlertTriangle size={48} style={{ color: "#f87171", marginBottom: 16, margin: "0 auto 16px" }} />
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Review not found</div>
            <div style={{ color: "#7a96b0" }}>{error}</div>
            <a href="/" style={{ display: "inline-block", marginTop: 20, color: "#60c5ff" }}>Go to Q-Lab →</a>
          </div>
        )}

        {data && (
          <>
            {/* Approved banner */}
            {data.status === "approved" && data.signature && (
              <ApprovedBanner
                signature={data.signature}
                reviewerName={data.reviewer_name}
                signedAt={data.signed_at}
              />
            )}

            {/* Review header */}
            <div style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 12, padding: "22px 26px", marginBottom: 20 }}>
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: "#7a96b0", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {data.review_type} Review Request
                </span>
              </div>
              <h1 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800 }}>
                {data.run?.circuit_name ?? data.run_id}
              </h1>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, color: "#7a96b0" }}>
                <span>Backend: <strong style={{ color: "#e2e8f0" }}>{data.run?.backend ?? "—"}</strong></span>
                <span>Project: <strong style={{ color: "#e2e8f0" }}>{data.run?.project_slug ?? "—"}</strong></span>
                <span>Status: <strong style={{ color: data.run?.status === "completed" ? "#4ade80" : data.run?.status === "failed" ? "#f87171" : "#fbbf24" }}>{data.run?.status ?? "—"}</strong></span>
                {data.run?.health_score != null && (
                  <span>Health: <strong style={{ color: healthColor(data.run.health_score) }}>{data.run.health_score}</strong></span>
                )}
              </div>

              {data.message && (
                <div style={{ marginTop: 14, padding: "10px 14px", background: "#111d2b", borderRadius: 8, fontSize: 13, color: "#94a3b8", borderLeft: "3px solid #2d3f55" }}>
                  <strong style={{ color: "#e2e8f0" }}>Message from {data.requester_name}:</strong> {data.message}
                </div>
              )}
            </div>

            {/* Run details */}
            {data.run && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
                {/* Circuit Fingerprint */}
                <Section title="Circuit Fingerprint">
                  <StatRow label="Qubits" value={String(data.run.fingerprint?.num_qubits ?? "—")} />
                  <StatRow label="Depth" value={String(data.run.fingerprint?.depth ?? "—")} />
                  <StatRow label="Gate count" value={String(data.run.fingerprint?.size ?? "—")} />
                  <StatRow label="Non-Clifford ratio"
                    value={data.run.fingerprint?.non_clifford_ratio != null
                      ? `${((data.run.fingerprint.non_clifford_ratio as number) * 100).toFixed(1)}%` : "—"} />
                </Section>

                {/* Execution Parameters */}
                <Section title="Execution Parameters">
                  {Object.keys(data.run.parameters).length === 0 && Object.keys(data.run.execution).length === 0 ? (
                    <div style={{ color: "#7a96b0", fontSize: 13 }}>No parameters recorded.</div>
                  ) : (
                    <>
                      {Object.entries(data.run.parameters).slice(0, 5).map(([k, v]) => (
                        <StatRow key={k} label={k} value={typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v)} />
                      ))}
                      {Object.entries(data.run.execution).slice(0, 3).map(([k, v]) => (
                        <StatRow key={k} label={k} value={typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v)} />
                      ))}
                    </>
                  )}
                </Section>

                {/* Results */}
                <Section title="Results">
                  {Object.keys(data.run.results).length === 0 ? (
                    <div style={{ color: "#7a96b0", fontSize: 13 }}>No results recorded.</div>
                  ) : (
                    Object.entries(data.run.results).slice(0, 8).map(([k, v]) => (
                      <StatRow key={k} label={k} value={typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v)} />
                    ))
                  )}
                </Section>

                {/* Calibration */}
                <Section title="Calibration Snapshot">
                  {Object.keys(data.run.calibration).length === 0 ? (
                    <div style={{ color: "#7a96b0", fontSize: 13 }}>No calibration data.</div>
                  ) : (
                    Object.entries(data.run.calibration).slice(0, 6).map(([k, v]) => (
                      <StatRow key={k} label={k} value={typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v)} />
                    ))
                  )}
                </Section>
              </div>
            )}

            {/* QASM circuit */}
            {data.run?.qasm && (
              <div style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 10, padding: "16px 22px", marginBottom: 16 }}>
                <CollapsibleQASM qasm={data.run.qasm} />
              </div>
            )}

            {/* Existing decision (already completed) */}
            {alreadyDecided && data.status !== "approved" && (
              <div style={{
                background: data.status === "rejected" ? "#2a1515" : "#1a1500",
                border: `1px solid ${data.status === "rejected" ? "#7f1d1d" : "#854d0e"}`,
                borderRadius: 12, padding: "20px 24px", marginBottom: 24,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  {data.status === "rejected" ? <XCircle size={20} color="#f87171" /> : <AlertCircle size={20} color="#fbbf24" />}
                  <span style={{ fontWeight: 700, color: data.status === "rejected" ? "#f87171" : "#fbbf24", fontSize: 16 }}>
                    {data.status === "rejected" ? "Rejected" : "Revision Requested"}
                  </span>
                </div>
                {data.reviewer_comments && (
                  <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>{data.reviewer_comments}</p>
                )}
              </div>
            )}

            {/* Review form (only if not yet decided) */}
            {!alreadyDecided && (
              <div style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 12, padding: "24px 28px" }}>
                <h2 style={{ margin: "0 0 20px", fontSize: 17, fontWeight: 700 }}>Submit Your Review Decision</h2>
                <DecisionForm token={token} review={data} onDecided={(updated) => setData({ ...data, ...updated })} />
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{ marginTop: 32, textAlign: "center", fontSize: 12, color: "#4a6f8f" }}>
          Q-Lab Peer Review Platform · Cryptographic verification powered by SHA-256
        </div>
      </main>
    </div>
  );
}
