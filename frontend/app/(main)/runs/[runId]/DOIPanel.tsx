"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Copy, Check, AlertCircle, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DOIRecord {
  doi_record_id: string;
  run_id: string;
  doi: string | null;
  title: string;
  description: string;
  authors: string[];
  keywords: string[];
  license: string;
  status: string;
  minted_at: string | null;
  citation_text: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Inline copy button
// ---------------------------------------------------------------------------

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={copy}
      type="button"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        background: "none", border: "none", cursor: "pointer",
        fontSize: 12, color: "var(--muted)", padding: "2px 0",
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy APA"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Mint form (inline — no modal overlay, fits the panel)
// ---------------------------------------------------------------------------

function MintForm({
  runId,
  onMinted,
  onCancel,
}: {
  runId: string;
  onMinted: (r: DOIRecord) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [authors, setAuthors] = useState("");
  const [keywords, setKeywords] = useState("");
  const [license, setLicense] = useState("cc-by-4.0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputStyle: React.CSSProperties = {
    width: "100%", height: 32,
    background: "var(--input-bg, #0d0d17)",
    border: "1px solid var(--input-border, #2a2a3e)",
    borderRadius: 6, padding: "0 10px",
    color: "var(--text)", fontSize: 12,
    boxSizing: "border-box",
    outline: "none",
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/doi/mint/${runId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          authors: authors.split(",").map((a) => a.trim()).filter(Boolean),
          keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
          license,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      onMinted(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mint failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 10, padding: "14px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Mint DOI for this run</span>
        <button
          onClick={onCancel}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0 }}
          type="button"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Title *</label>
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Experiment title" required />
        </div>
        <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Description</label>
          <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Authors (comma-sep.)</label>
          <input style={inputStyle} value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="Jane Smith, John Doe" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Keywords (comma-sep.)</label>
          <input style={inputStyle} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="quantum, VQE" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>License</label>
          <select style={inputStyle} value={license} onChange={(e) => setLicense(e.target.value)}>
            <option value="cc-by-4.0">CC BY 4.0</option>
            <option value="cc-by-sa-4.0">CC BY-SA 4.0</option>
            <option value="cc0-1.0">CC0 1.0</option>
            <option value="mit">MIT</option>
          </select>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "8px 10px", borderRadius: 6,
          background: "var(--danger-bg, #ef444422)", color: "var(--danger, #ef4444)",
          fontSize: 12, display: "flex", gap: 6, alignItems: "center",
        }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="button" type="submit" disabled={loading || !title.trim()} style={{ height: 32, fontSize: 13 }}>
          {loading ? "Minting…" : "Mint DOI"}
        </button>
        <button className="button secondary" type="button" onClick={onCancel} style={{ height: 32, fontSize: 13 }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Export to ORCID button
// ---------------------------------------------------------------------------

function ExportORCIDButton({ runId }: { runId: string }) {
  const [orcidId, setOrcidId] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    if (!orcidId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/orcid/claim/${runId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orcid_id: orcidId.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      setDone(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <span style={{ fontSize: 12, color: "#22c55e", display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Check size={12} /> Claimed in ORCID
      </span>
    );
  }

  if (!open) {
    return (
      <button
        className="button secondary"
        style={{ height: 28, fontSize: 12, padding: "0 10px" }}
        onClick={() => setOpen(true)}
        type="button"
      >
        Export to ORCID
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          value={orcidId}
          onChange={(e) => setOrcidId(e.target.value)}
          placeholder="0000-0002-1234-5678"
          style={{
            height: 28, background: "var(--input-bg)", border: "1px solid var(--input-border)",
            borderRadius: 5, padding: "0 8px", color: "var(--text)", fontSize: 12, width: 180,
          }}
        />
        <button className="button" style={{ height: 28, fontSize: 12, padding: "0 10px" }} onClick={() => void claim()} disabled={loading} type="button">
          {loading ? "…" : "Claim"}
        </button>
        <button className="button secondary" style={{ height: 28, fontSize: 12, padding: "0 8px" }} onClick={() => setOpen(false)} type="button">
          <X size={12} />
        </button>
      </div>
      {error && <span style={{ fontSize: 11, color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function DOIPanel({ runId }: { runId: string }) {
  const [record, setRecord] = useState<DOIRecord | null | undefined>(undefined); // undefined = loading
  const [showMintForm, setShowMintForm] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/doi/run/${runId}`)
      .then((r) => r.json())
      .then((d: { doi_record: DOIRecord | null }) => setRecord(d.doi_record))
      .catch(() => setRecord(null));
  }, [runId]);

  if (record === undefined) return null; // loading silently

  const statusColor: Record<string, string> = {
    minted: "#22c55e",
    submitted: "#6366f1",
    failed: "#ef4444",
    draft: "#f59e0b",
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          DOI / Research Output
          {record && (
            <span
              style={{
                fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                background: `${statusColor[record.status] ?? "#6b7280"}22`,
                color: statusColor[record.status] ?? "#6b7280",
                textTransform: "uppercase",
              }}
            >
              {record.status}
            </span>
          )}
        </h2>
      </div>

      {/* No DOI yet */}
      {!record && !showMintForm && (
        <div style={{ padding: "14px 18px" }}>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
            No DOI assigned to this run yet. Mint one to make it citable and permanently referenceable.
          </p>
          <button
            className="button"
            style={{ height: 32, fontSize: 13 }}
            onClick={() => setShowMintForm(true)}
            type="button"
          >
            Mint DOI
          </button>
        </div>
      )}

      {/* Mint form (inline) */}
      {!record && showMintForm && (
        <MintForm
          runId={runId}
          onMinted={(r) => { setRecord(r); setShowMintForm(false); }}
          onCancel={() => setShowMintForm(false)}
        />
      )}

      {/* DOI exists */}
      {record && (
        <div style={{ padding: "14px 18px" }}>
          {/* DOI link */}
          {record.doi && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Persistent Identifier</div>
              <a
                href={`https://doi.org/${record.doi}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: 14, color: "#6366f1", fontWeight: 600, textDecoration: "none",
                }}
              >
                <ExternalLink size={13} />
                {record.doi}
              </a>
            </div>
          )}

          {/* Title */}
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", marginBottom: 4 }}>
            {record.title}
          </div>

          {/* APA citation */}
          {record.citation_text && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>APA Citation</div>
              <div
                style={{
                  fontSize: 12, color: "var(--text)", fontStyle: "italic",
                  lineHeight: 1.6, borderLeft: "3px solid #6366f133",
                  paddingLeft: 10, marginBottom: 6,
                }}
              >
                {record.citation_text}
              </div>
              <CopyBtn text={record.citation_text} />
            </div>
          )}

          {/* Demo mode notice */}
          {record.status === "draft" && (
            <div
              style={{
                padding: "8px 10px", borderRadius: 6, marginBottom: 12,
                background: "#f59e0b11", border: "1px solid #f59e0b33",
                fontSize: 12, color: "#f59e0b",
              }}
            >
              Preview DOI (demo mode). Set <code>ZENODO_ACCESS_TOKEN</code> to mint a real DOI.
            </div>
          )}

          {/* Export to ORCID */}
          <div style={{ paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Researcher Attribution</div>
            <ExportORCIDButton runId={runId} />
          </div>
        </div>
      )}
    </section>
  );
}
