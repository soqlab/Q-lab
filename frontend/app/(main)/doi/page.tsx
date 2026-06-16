"use client";

import { useEffect, useState } from "react";
import {
  Copy,
  Check,
  ExternalLink,
  BookMarked,
  User,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DOIRecord {
  doi_record_id: string;
  run_id: string;
  doi: string | null;
  zenodo_record_id: string | null;
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

interface ORCIDProfile {
  profile_id: string;
  orcid_id: string;
  display_name: string;
  institution: string | null;
  verified: boolean;
  run_ids: string[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Styles helpers
// ---------------------------------------------------------------------------

const S = {
  page: {
    background: "#0a0a0f",
    minHeight: "100vh",
    padding: "32px 28px",
    color: "#e2e8f0",
  } as React.CSSProperties,
  card: {
    background: "#12121a",
    border: "1px solid #1e1e2e",
    borderRadius: 10,
    padding: "20px 22px",
    marginBottom: 18,
  } as React.CSSProperties,
  badge: (color: string) =>
    ({
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      fontSize: 11,
      fontWeight: 700,
      padding: "3px 9px",
      borderRadius: 999,
      background: `${color}22`,
      color,
      textTransform: "uppercase" as const,
      letterSpacing: "0.04em",
    } as React.CSSProperties),
  btn: (variant: "primary" | "secondary" | "ghost" = "secondary") =>
    ({
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: 32,
      padding: "0 14px",
      borderRadius: 7,
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      border:
        variant === "primary"
          ? "1px solid #6366f1"
          : variant === "ghost"
          ? "none"
          : "1px solid #2a2a3e",
      background:
        variant === "primary"
          ? "#6366f1"
          : variant === "ghost"
          ? "transparent"
          : "#1a1a2e",
      color: variant === "primary" ? "#fff" : "#a0aec0",
    } as React.CSSProperties),
  input: {
    height: 36,
    background: "#0d0d17",
    border: "1px solid #2a2a3e",
    borderRadius: 7,
    padding: "0 12px",
    color: "#e2e8f0",
    fontSize: 13,
    width: "100%",
    outline: "none",
  } as React.CSSProperties,
  label: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 5,
    display: "block",
  } as React.CSSProperties,
  section: {
    marginBottom: 28,
  } as React.CSSProperties,
  h2: {
    fontSize: 15,
    fontWeight: 700,
    color: "#e2e8f0",
    margin: "0 0 14px",
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as React.CSSProperties,
  muted: { color: "#64748b", fontSize: 13 } as React.CSSProperties,
};

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button style={S.btn("ghost")} onClick={copy} type="button">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: string }) {
  const color =
    status === "minted"
      ? "#22c55e"
      : status === "submitted"
      ? "#6366f1"
      : status === "failed"
      ? "#ef4444"
      : "#f59e0b";
  return <span style={S.badge(color)}>{status}</span>;
}

// ---------------------------------------------------------------------------
// DOI Card
// ---------------------------------------------------------------------------

function DOICard({ record }: { record: DOIRecord }) {
  const [expanded, setExpanded] = useState(false);
  const [cites, setCites] = useState<{ apa: string; bibtex: string; ris: string } | null>(null);

  async function loadCites() {
    if (cites) { setExpanded(!expanded); return; }
    try {
      const res = await fetch(`/api/v1/doi/cite/${record.run_id}`);
      if (res.ok) { setCites(await res.json()); }
    } catch { /* ignore */ }
    setExpanded(true);
  }

  return (
    <div style={S.card}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        {/* Left: info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            <StatusChip status={record.status} />
            {record.doi ? (
              <a
                href={`https://doi.org/${record.doi}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 13, color: "#6366f1", fontWeight: 600, textDecoration: "none",
                }}
              >
                <ExternalLink size={12} />
                {record.doi}
              </a>
            ) : (
              <span style={S.muted}>DOI pending</span>
            )}
          </div>

          <div style={{ fontWeight: 700, fontSize: 15, color: "#e2e8f0", marginBottom: 4 }}>
            {record.title}
          </div>
          <div style={{ ...S.muted, marginBottom: 4 }}>
            Run: <code style={{ fontSize: 12, color: "#94a3b8" }}>{record.run_id}</code>
          </div>
          {record.authors.length > 0 && (
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
              {record.authors.join(", ")}
            </div>
          )}
          {record.citation_text && (
            <div
              style={{
                fontSize: 12, color: "#94a3b8", fontStyle: "italic",
                borderLeft: "3px solid #6366f133", paddingLeft: 10, marginTop: 8,
              }}
            >
              {record.citation_text}
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          {record.citation_text && <CopyButton text={record.citation_text} label="Copy APA" />}
          <button
            style={S.btn("ghost")}
            onClick={() => void loadCites()}
            type="button"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            More formats
          </button>
        </div>
      </div>

      {/* Expanded citation block */}
      {expanded && cites && (
        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {(["bibtex", "ris"] as const).map((fmt) => (
            <div key={fmt}>
              <div
                style={{
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
                  {fmt}
                </span>
                <CopyButton text={cites[fmt]} label={`Copy ${fmt.toUpperCase()}`} />
              </div>
              <pre
                style={{
                  background: "#0d0d17", border: "1px solid #1e1e2e", borderRadius: 7,
                  padding: "10px 12px", fontSize: 11, color: "#94a3b8",
                  overflowX: "auto", margin: 0, lineHeight: 1.6,
                }}
              >
                {cites[fmt]}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mint DOI form
// ---------------------------------------------------------------------------

function MintForm({
  onMinted,
  initialRunId,
  onClose,
}: {
  onMinted: (r: DOIRecord) => void;
  initialRunId?: string;
  onClose: () => void;
}) {
  const [runId, setRunId] = useState(initialRunId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [authors, setAuthors] = useState("");
  const [keywords, setKeywords] = useState("");
  const [license, setLicense] = useState("cc-by-4.0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!runId.trim() || !title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/doi/mint/${runId.trim()}`, {
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
      const record: DOIRecord = await res.json();
      onMinted(record);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mint failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "#12121a", border: "1px solid #2a2a3e", borderRadius: 12,
          padding: "28px 26px", width: "100%", maxWidth: 520,
          boxShadow: "0 20px 60px rgba(0,0,0,.6)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>Mint DOI</h3>
          <button onClick={onClose} style={{ ...S.btn("ghost"), padding: "0 8px" }} type="button">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 14 }}>
          {!initialRunId && (
            <div>
              <label style={S.label}>Run ID *</label>
              <input
                style={S.input}
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                placeholder="e.g. a1b2c3d4-..."
                required
              />
            </div>
          )}
          <div>
            <label style={S.label}>Title *</label>
            <input
              style={S.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Experiment title"
              required
            />
          </div>
          <div>
            <label style={S.label}>Description</label>
            <textarea
              style={{ ...S.input, height: 72, resize: "vertical", paddingTop: 8 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the experiment"
            />
          </div>
          <div>
            <label style={S.label}>Authors (comma-separated)</label>
            <input
              style={S.input}
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder="Jane Smith (ORCID: 0000-0002-...), John Doe"
            />
          </div>
          <div>
            <label style={S.label}>Keywords (comma-separated)</label>
            <input
              style={S.input}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="quantum, VQE, error-mitigation"
            />
          </div>
          <div>
            <label style={S.label}>License</label>
            <select
              style={{ ...S.input }}
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            >
              <option value="cc-by-4.0">CC BY 4.0</option>
              <option value="cc-by-sa-4.0">CC BY-SA 4.0</option>
              <option value="cc0-1.0">CC0 1.0 (Public Domain)</option>
              <option value="mit">MIT</option>
              <option value="apache-2.0">Apache 2.0</option>
            </select>
          </div>

          {error && (
            <div
              style={{
                padding: "9px 12px", borderRadius: 7,
                background: "#ef444422", color: "#ef4444", fontSize: 13,
                display: "flex", gap: 8, alignItems: "center",
              }}
            >
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button style={S.btn("primary")} type="submit" disabled={loading}>
              {loading ? "Minting…" : "Mint DOI"}
            </button>
            <button style={S.btn("secondary")} type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My DOIs tab
// ---------------------------------------------------------------------------

function MyDOIsTab() {
  const [records, setRecords] = useState<DOIRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMint, setShowMint] = useState(false);

  useEffect(() => {
    fetch("/api/v1/doi/records")
      .then((r) => r.json())
      .then((d: { records: DOIRecord[] }) => { setRecords(d.records ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function handleMinted(r: DOIRecord) {
    setRecords((prev) => {
      const filtered = prev.filter((x) => x.doi_record_id !== r.doi_record_id);
      return [r, ...filtered];
    });
  }

  return (
    <div>
      {/* Info banner */}
      <div
        style={{
          display: "flex", gap: 10, alignItems: "flex-start",
          padding: "12px 16px", borderRadius: 9,
          background: "#6366f111", border: "1px solid #6366f133",
          marginBottom: 22,
        }}
      >
        <AlertCircle size={15} style={{ color: "#6366f1", flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 13, color: "#a5b4fc", lineHeight: 1.6 }}>
          Real DOIs require a <code style={{ fontSize: 12 }}>ZENODO_ACCESS_TOKEN</code> env var
          on the backend. In demo mode, Q-Lab generates preview DOIs prefixed{" "}
          <code style={{ fontSize: 12 }}>10.5281/qlab.*</code>.
        </p>
      </div>

      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ ...S.h2, marginBottom: 0 }}>
          <BookMarked size={16} aria-hidden="true" /> DOI Records
          {records.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 400, color: "#64748b" }}>({records.length})</span>
          )}
        </h2>
        <button style={S.btn("primary")} onClick={() => setShowMint(true)} type="button">
          + Mint DOI
        </button>
      </div>

      {loading && <p style={S.muted}>Loading DOI records…</p>}

      {!loading && records.length === 0 && (
        <div
          style={{
            textAlign: "center", padding: "48px 24px",
            background: "#12121a", border: "1px solid #1e1e2e",
            borderRadius: 10, color: "#64748b",
          }}
        >
          <BookMarked size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ margin: 0, fontSize: 14 }}>
            No DOIs minted yet. Click <strong style={{ color: "#e2e8f0" }}>+ Mint DOI</strong> to
            assign a persistent identifier to a run.
          </p>
        </div>
      )}

      {records.map((r) => <DOICard key={r.doi_record_id} record={r} />)}

      {showMint && (
        <MintForm
          onMinted={handleMinted}
          onClose={() => setShowMint(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ORCID tab
// ---------------------------------------------------------------------------

function ORCIDTab() {
  const [profile, setProfile] = useState<ORCIDProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Connect form state
  const [orcidInput, setOrcidInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [instInput, setInstInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Claim form state
  const [claimRunId, setClaimRunId] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/v1/orcid/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orcid_id: orcidInput.trim(),
          display_name: nameInput.trim(),
          institution: instInput.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      setProfile(await res.json());
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  async function claimRun(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !claimRunId.trim()) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch(`/api/v1/orcid/claim/${claimRunId.trim()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orcid_id: profile.orcid_id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      setProfile(await res.json());
      setClaimRunId("");
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setClaiming(false);
    }
  }

  function loadProfile(orcidId: string) {
    setLoadingProfile(true);
    fetch(`/api/v1/orcid/profile/${orcidId}`)
      .then((r) => r.json())
      .then((p: ORCIDProfile) => { setProfile(p); setLoadingProfile(false); })
      .catch(() => setLoadingProfile(false));
  }

  // ------------------------------------------------------------------
  // Not connected
  // ------------------------------------------------------------------
  if (!profile) {
    return (
      <div>
        <h2 style={S.h2}>
          <User size={16} aria-hidden="true" /> Connect ORCID
        </h2>

        <p style={{ ...S.muted, marginBottom: 20, lineHeight: 1.6 }}>
          ORCID provides persistent identifiers for researchers. Connect your iD to
          claim quantum experiment runs as your work and build a verifiable research
          portfolio.
        </p>

        <div style={S.card}>
          <form onSubmit={(e) => void connect(e)} style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={S.label}>ORCID iD *</label>
              <input
                style={S.input}
                value={orcidInput}
                onChange={(e) => setOrcidInput(e.target.value)}
                placeholder="0000-0002-1234-5678"
                pattern="^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$"
                title="Format: 0000-0000-0000-000X"
                required
              />
              <span style={{ fontSize: 11, color: "#475569", marginTop: 4, display: "block" }}>
                Format: 0000-0000-0000-000X (find yours at orcid.org)
              </span>
            </div>
            <div>
              <label style={S.label}>Display Name *</label>
              <input
                style={S.input}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Dr. Jane Smith"
                required
              />
            </div>
            <div>
              <label style={S.label}>Institution</label>
              <input
                style={S.input}
                value={instInput}
                onChange={(e) => setInstInput(e.target.value)}
                placeholder="MIT, Caltech, IBM Research…"
              />
            </div>

            {connectError && (
              <div
                style={{
                  padding: "9px 12px", borderRadius: 7,
                  background: "#ef444422", color: "#ef4444",
                  fontSize: 13, display: "flex", gap: 8, alignItems: "center",
                }}
              >
                <AlertCircle size={14} /> {connectError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button style={S.btn("primary")} type="submit" disabled={connecting}>
                {connecting ? "Connecting…" : "Connect ORCID"}
              </button>

              {/* Quick-load existing */}
              <span style={S.muted}>or</span>
              <button
                style={S.btn("secondary")}
                type="button"
                disabled={!orcidInput.trim() || loadingProfile}
                onClick={() => loadProfile(orcidInput.trim())}
              >
                {loadingProfile ? "Loading…" : "Load existing profile"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Profile view
  // ------------------------------------------------------------------
  const verifiedColor = profile.verified ? "#22c55e" : "#f59e0b";
  const verifiedLabel = profile.verified ? "Verified" : "Unverified";

  return (
    <div>
      {/* Profile card */}
      <div style={{ ...S.card, display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* Avatar */}
        <div
          style={{
            width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
            background: "#6366f133", border: `2px solid ${verifiedColor}`,
            display: "grid", placeItems: "center", fontSize: 20, color: "#e2e8f0",
          }}
        >
          {profile.display_name.charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: "#e2e8f0" }}>{profile.display_name}</span>
            <span style={S.badge(verifiedColor)}>{verifiedLabel}</span>
          </div>

          <div style={{ fontSize: 13, color: "#6366f1", fontFamily: "monospace", marginBottom: 4 }}>
            {profile.orcid_id}
          </div>

          {profile.institution && (
            <div style={S.muted}>{profile.institution}</div>
          )}

          {!profile.verified && (
            <div
              style={{
                marginTop: 10, padding: "8px 12px", borderRadius: 7,
                background: "#f59e0b11", border: "1px solid #f59e0b33",
                fontSize: 12, color: "#f59e0b",
              }}
            >
              Profile is unverified. Set <code>ORCID_CLIENT_ID</code> on the backend to
              enable OAuth verification.
            </div>
          )}
        </div>

        <button
          style={S.btn("ghost")}
          onClick={() => setProfile(null)}
          type="button"
          title="Disconnect / switch profile"
        >
          <X size={14} /> Disconnect
        </button>
      </div>

      {/* Claimed runs */}
      <div style={S.section}>
        <h2 style={S.h2}>
          Claimed Runs
          {profile.run_ids.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 400, color: "#64748b" }}>
              ({profile.run_ids.length})
            </span>
          )}
        </h2>

        {profile.run_ids.length === 0 ? (
          <p style={S.muted}>No runs claimed yet. Use the form below to claim a run.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {profile.run_ids.map((rid) => (
              <div
                key={rid}
                style={{
                  padding: "10px 14px", background: "#12121a",
                  border: "1px solid #1e1e2e", borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                }}
              >
                <code style={{ fontSize: 12, color: "#94a3b8" }}>{rid}</code>
                <a
                  href={`/runs/${rid}`}
                  style={{
                    fontSize: 12, color: "#6366f1", textDecoration: "none",
                    display: "inline-flex", alignItems: "center", gap: 4,
                  }}
                >
                  <ExternalLink size={11} /> View
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Claim a run */}
      <div style={S.section}>
        <h2 style={S.h2}>Claim a Run</h2>
        <div style={S.card}>
          <form onSubmit={(e) => void claimRun(e)} style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <input
                style={S.input}
                value={claimRunId}
                onChange={(e) => setClaimRunId(e.target.value)}
                placeholder="Enter run ID to claim…"
                required
              />
            </div>
            <button style={S.btn("primary")} type="submit" disabled={claiming || !claimRunId.trim()}>
              {claiming ? "Claiming…" : "Claim Run"}
            </button>
          </form>
          {claimError && (
            <div
              style={{
                marginTop: 10, padding: "9px 12px", borderRadius: 7,
                background: "#ef444422", color: "#ef4444",
                fontSize: 13, display: "flex", gap: 8, alignItems: "center",
              }}
            >
              <AlertCircle size={14} /> {claimError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type TabId = "dois" | "orcid";

export default function ResearchIdentityPage() {
  const [tab, setTab] = useState<TabId>("dois");

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: "9px 20px",
    borderRadius: "8px 8px 0 0",
    border: "1px solid",
    borderColor: active ? "#2a2a3e" : "transparent",
    borderBottom: active ? "1px solid #0a0a0f" : "1px solid #2a2a3e",
    background: active ? "#0a0a0f" : "transparent",
    color: active ? "#e2e8f0" : "#64748b",
    fontWeight: active ? 700 : 500,
    fontSize: 14,
    cursor: "pointer",
    marginBottom: -1,
    position: "relative",
    zIndex: active ? 1 : 0,
  });

  return (
    <main style={S.page}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", margin: "0 0 6px" }}>
          Research Identity
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>
          Assign persistent DOIs to experiment runs and connect your ORCID researcher profile.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #2a2a3e", marginBottom: 28 }}>
        <button style={TAB_STYLE(tab === "dois")} onClick={() => setTab("dois")} type="button">
          <BookMarked size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
          My DOIs
        </button>
        <button style={TAB_STYLE(tab === "orcid")} onClick={() => setTab("orcid")} type="button">
          <User size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
          ORCID Profile
        </button>
      </div>

      {tab === "dois" && <MyDOIsTab />}
      {tab === "orcid" && <ORCIDTab />}
    </main>
  );
}
