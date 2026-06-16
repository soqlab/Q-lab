"use client";

import { useEffect, useState, useCallback } from "react";
import {
  FlaskConical, Plus, CheckCircle, Clock, XCircle, RefreshCw,
  AlertCircle, ExternalLink, Copy,
} from "lucide-react";

// ---------------------------------------------------------------------------
// API helpers (inline)
// ---------------------------------------------------------------------------

const API = "/qlab-api";

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("qlab_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
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

interface ReviewRecord {
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
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CFG: Record<string, { label: string; bg: string; color: string; icon: React.ElementType }> = {
  pending:            { label: "Pending",            bg: "#1e2535", color: "#94a3b8", icon: Clock },
  in_review:          { label: "In Review",          bg: "#1e3a5f", color: "#60c5ff", icon: Clock },
  approved:           { label: "Approved",           bg: "#14532d", color: "#4ade80", icon: CheckCircle },
  revision_requested: { label: "Revision Requested", bg: "#3a2a00", color: "#fbbf24", icon: AlertCircle },
  rejected:           { label: "Rejected",           bg: "#7f1d1d", color: "#f87171", icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending;
  const Icon = cfg.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
    }}>
      <Icon size={11} /> {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Signature viewer modal (inline)
// ---------------------------------------------------------------------------

function SignatureViewer({
  signature, onClose,
}: {
  signature: string; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyHash() {
    await navigator.clipboard.writeText(signature);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 12,
        padding: "28px 32px", maxWidth: 560, width: "100%",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <CheckCircle size={20} color="#4ade80" />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Cryptographic Signature</h3>
        </div>
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, marginBottom: 16 }}>
          This experiment has been peer-reviewed and cryptographically signed using SHA-256.
          The signature below uniquely identifies this review decision and can be independently verified.
        </p>
        <div style={{ background: "#070f1a", border: "1px solid #2d3f55", borderRadius: 8, padding: "12px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: "#4a6f8f", marginBottom: 6 }}>SHA-256 Signature</div>
          <code style={{ fontSize: 11, wordBreak: "break-all", color: "#60c5ff" }}>{signature}</code>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={copyHash} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a2535", border: "1px solid #2d3f55", borderRadius: 6, color: "#e2e8f0", cursor: "pointer", fontSize: 12 }}>
            <Copy size={13} /> {copied ? "Copied!" : "Copy Hash"}
          </button>
          <a
            href={`/qlab-api/api/v1/peer-review/verify/${signature}`}
            target="_blank" rel="noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#14532d", border: "none", borderRadius: 6, color: "#4ade80", cursor: "pointer", fontSize: 12, textDecoration: "none" }}
          >
            <ExternalLink size={13} /> Verify Signature
          </a>
          <button onClick={onClose} style={{ marginLeft: "auto", padding: "7px 14px", background: "transparent", border: "1px solid #2d3f55", borderRadius: 6, color: "#94a3b8", cursor: "pointer", fontSize: 12 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 1: My Review Requests
// ---------------------------------------------------------------------------

function MyReviewRequests({ reviews, loading, error }: {
  reviews: ReviewRecord[];
  loading: boolean;
  error: string | null;
}) {
  const [viewSig, setViewSig] = useState<ReviewRecord | null>(null);

  if (loading) return <div style={{ color: "#7a96b0", padding: 20 }}>Loading reviews…</div>;
  if (error) return <div style={{ color: "#f87171", padding: 12, background: "#2a1515", borderRadius: 6 }}>{error}</div>;

  return (
    <div>
      {viewSig && (
        <SignatureViewer
          signature={viewSig.signature!}
          onClose={() => setViewSig(null)}
        />
      )}

      {reviews.length === 0 ? (
        <div style={{ color: "#7a96b0", padding: "32px 0", textAlign: "center" }}>
          No review requests yet. Submit one below.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {reviews.map(r => (
            <div key={r.review_id} style={{
              background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 10,
              padding: "14px 18px",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{r.reviewer_name}</span>
                    <span style={{ color: "#7a96b0", fontSize: 12 }}>{r.reviewer_institution}</span>
                    <span style={{
                      padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                      background: "#1a2535", color: "#60c5ff",
                    }}>
                      {r.review_type}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#7a96b0" }}>
                    Run: <code style={{ color: "#94a3b8" }}>{r.run_id.slice(0, 20)}…</code>
                    <span style={{ margin: "0 8px" }}>·</span>
                    Requested by <strong style={{ color: "#94a3b8" }}>{r.requester_name}</strong>
                    <span style={{ margin: "0 8px" }}>·</span>
                    {new Date(r.created_at).toLocaleDateString()}
                  </div>
                  {r.reviewer_comments && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8", background: "#111d2b", borderRadius: 6, padding: "8px 12px" }}>
                      <em>"{r.reviewer_comments.slice(0, 200)}{r.reviewer_comments.length > 200 ? "…" : ""}"</em>
                    </div>
                  )}
                  {r.status === "approved" && r.signature && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        onClick={() => setViewSig(r)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", background: "#14532d", border: "none", borderRadius: 6, color: "#4ade80", cursor: "pointer", fontSize: 12 }}
                      >
                        <CheckCircle size={12} /> View Signature
                      </button>
                    </div>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 2: Submit for Review
// ---------------------------------------------------------------------------

function SubmitReviewForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [form, setForm] = useState({
    run_id: "",
    requester_name: "",
    requester_email: "",
    reviewer_name: "",
    reviewer_institution: "",
    review_type: "full" as "reproducibility" | "methodology" | "full",
    message: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ review_id: string; access_token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function set(field: string, val: string) {
    setForm(f => ({ ...f, [field]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setResult(null);
    try {
      const res = await apiFetch(`/api/v1/peer-review/request/${form.run_id.trim()}`, {
        method: "POST",
        body: JSON.stringify({
          requester_name: form.requester_name,
          requester_email: form.requester_email,
          reviewer_name: form.reviewer_name,
          reviewer_institution: form.reviewer_institution,
          review_type: form.review_type,
          message: form.message || null,
        }),
      });
      setResult({ review_id: res.review_id, access_token: res.access_token });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally { setSaving(false); }
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(`https://qlab.app/review/${token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const inputStyle = {
    width: "100%", background: "#070f1a", border: "1px solid #2d3f55",
    borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 13,
  };
  const labelStyle = { fontSize: 12, color: "#7a96b0", display: "block" as const, marginBottom: 4 };

  if (result) {
    const link = `https://qlab.app/review/${result.access_token}`;
    return (
      <div style={{ maxWidth: 580 }}>
        <div style={{ background: "#0f2a1a", border: "1px solid #14532d", borderRadius: 10, padding: "20px 24px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <CheckCircle size={18} color="#4ade80" />
            <span style={{ fontWeight: 700, color: "#4ade80" }}>Review request submitted!</span>
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 14 }}>
            Share this link with your reviewer. They will be able to view the experiment and submit their decision.
          </div>
          <div style={{ background: "#070f1a", border: "1px solid #2d3f55", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <code style={{ flex: 1, fontSize: 12, wordBreak: "break-all", color: "#60c5ff" }}>{link}</code>
            <button onClick={() => copyLink(result.access_token)} style={{ padding: "4px 10px", background: "#1a2535", border: "1px solid #2d3f55", borderRadius: 6, color: "#e2e8f0", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>
              <Copy size={12} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <button
          onClick={() => { setResult(null); setForm({ run_id: "", requester_name: "", requester_email: "", reviewer_name: "", reviewer_institution: "", review_type: "full", message: "" }); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "transparent", border: "1px solid #2d3f55", borderRadius: 6, color: "#94a3b8", cursor: "pointer", fontSize: 13 }}
        >
          <Plus size={14} /> Submit Another Request
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Run ID *</label>
          <input style={inputStyle} value={form.run_id} onChange={e => set("run_id", e.target.value)} required placeholder="e.g. run_abc123" />
        </div>

        <div>
          <label style={labelStyle}>Your Name *</label>
          <input style={inputStyle} value={form.requester_name} onChange={e => set("requester_name", e.target.value)} required placeholder="Dr. Jane Researcher" />
        </div>

        <div>
          <label style={labelStyle}>Your Email *</label>
          <input style={inputStyle} type="email" value={form.requester_email} onChange={e => set("requester_email", e.target.value)} required placeholder="jane@university.edu" />
        </div>

        <div>
          <label style={labelStyle}>Reviewer Name *</label>
          <input style={inputStyle} value={form.reviewer_name} onChange={e => set("reviewer_name", e.target.value)} required placeholder="Prof. John Reviewer" />
        </div>

        <div>
          <label style={labelStyle}>Reviewer Institution *</label>
          <input style={inputStyle} value={form.reviewer_institution} onChange={e => set("reviewer_institution", e.target.value)} required placeholder="Stanford University" />
        </div>

        <div>
          <label style={labelStyle}>Review Type *</label>
          <select style={inputStyle} value={form.review_type} onChange={e => set("review_type", e.target.value)} required>
            <option value="reproducibility">Reproducibility</option>
            <option value="methodology">Methodology</option>
            <option value="full">Full Review</option>
          </select>
        </div>

        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Message to Reviewer</label>
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
            value={form.message}
            onChange={e => set("message", e.target.value)}
            placeholder="Optional context or instructions for the reviewer…"
          />
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "#2a1515", border: "1px solid #7f1d1d", borderRadius: 6, color: "#f87171", fontSize: 13 }}>
          {error}
        </div>
      )}

      <button
        type="submit" disabled={saving}
        style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 7, padding: "9px 20px", background: "#1d6f8f", color: "#fff", border: "none", borderRadius: 7, cursor: saving ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13, opacity: saving ? 0.6 : 1 }}
      >
        <Plus size={15} /> {saving ? "Submitting…" : "Submit for Review"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PeerReviewPage() {
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiFetch("/api/v1/peer-review/my-requests");
      setReviews(data.reviews ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reviews");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <main style={{ padding: "24px 28px", background: "#070f1a", minHeight: "100vh", color: "#e2e8f0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <FlaskConical size={22} color="#60c5ff" />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Peer Review</h1>
        <button
          onClick={load}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "transparent", border: "1px solid #2d3f55", borderRadius: 6, color: "#7a96b0", cursor: "pointer", fontSize: 12 }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Section 1: My Review Requests */}
      <section style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <Clock size={16} color="#60c5ff" /> My Review Requests
          <span style={{ marginLeft: 6, background: "#1a2535", color: "#60c5ff", borderRadius: 12, padding: "1px 9px", fontSize: 12, fontWeight: 600 }}>
            {reviews.length}
          </span>
        </h2>
        <MyReviewRequests
          reviews={reviews}
          loading={loading}
          error={error}
        />
      </section>

      {/* Section 2: Submit for Review */}
      <section style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 12, padding: "20px 24px" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <Plus size={16} color="#60c5ff" /> Submit Experiment for Review
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#7a96b0", lineHeight: 1.6 }}>
          Share an experiment run with an external reviewer. They will receive a unique link to view full
          provenance (circuit, calibration, results) and submit a cryptographically signed decision.
        </p>
        <SubmitReviewForm onSubmitted={load} />
      </section>
    </main>
  );
}
