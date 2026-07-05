"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  publishDataset,
  listDatasetPublications,
  getDatasetPublication,
  mintDOI,
  DatasetPublication,
  DOIMintResult,
} from "@/lib/api";

const REPOSITORIES = ["zenodo", "figshare", "osf"] as const;
type Repository = (typeof REPOSITORIES)[number];

const LICENSES = ["MIT", "CC-BY-4.0", "CC0"] as const;

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div style={{
      padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5",
      borderRadius: 8, fontSize: 13, color: "#b91c1c", marginBottom: 12, display: "flex", justifyContent: "space-between",
    }}>
      <span>{msg}</span>
      <button onClick={onDismiss} type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 700 }}>×</button>
    </div>
  );
}

const REPO_COLORS: Record<string, { bg: string; color: string }> = {
  zenodo: { bg: "#dbeafe", color: "#1d4ed8" },
  figshare: { bg: "#fef9c3", color: "#854d0e" },
  osf: { bg: "#f3e8ff", color: "#7e22ce" },
};

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending:   { bg: "#f3f4f6", color: "#6b7280", label: "Pending" },
  minting:   { bg: "#dbeafe", color: "#1d4ed8", label: "Minting" },
  published: { bg: "#dcfce7", color: "#15803d", label: "Published" },
  failed:    { bg: "#fee2e2", color: "#b91c1c", label: "Failed" },
};

function RepoBadge({ repo }: { repo: string }) {
  const s = REPO_COLORS[repo] ?? { bg: "var(--panel-2)", color: "var(--text)" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11,
      fontWeight: 700, background: s.bg, color: s.color, textTransform: "capitalize",
    }}>
      {repo}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11,
      fontWeight: 700, background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

function PublicationCard({
  pub: initialPub,
}: {
  pub: DatasetPublication;
}) {
  const [pub, setPub] = useState<DatasetPublication>(initialPub);
  const [minting, setMinting] = useState(false);
  const [mintResult, setMintResult] = useState<DOIMintResult | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Keep in sync if parent prop changes (e.g. new pub added at top of list)
  useEffect(() => { setPub(initialPub); }, [initialPub]);

  async function handleMintDOI() {
    setMinting(true);
    setMintError(null);
    try {
      const result = await mintDOI(pub.pub_id);
      setMintResult(result);
      setPub(prev => ({ ...prev, status: "published", doi: result.doi, url: result.url }));
    } catch (e) {
      setMintError(e instanceof Error ? e.message : "DOI minting failed");
    } finally {
      setMinting(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const updated = await getDatasetPublication(pub.pub_id);
      setPub(updated);
    } catch {
      // silently ignore refresh errors
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 18,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{pub.title}</div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>{pub.description}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
          <RepoBadge repo={pub.repository} />
          <StatusBadge status={pub.status} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
        <span>License: <strong style={{ color: "var(--text)" }}>{pub.license}</strong></span>
        <span>{pub.file_size_mb.toFixed(1)} MB</span>
        <span>{pub.record_count.toLocaleString()} records</span>
        <span>{(pub.run_ids ?? []).length} run{(pub.run_ids ?? []).length !== 1 ? "s" : ""}</span>
        <span>Created {new Date(pub.created_at).toLocaleDateString()}</span>
        {pub.published_at && <span>Published {new Date(pub.published_at).toLocaleDateString()}</span>}
      </div>

      {(pub.keywords ?? []).length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {(pub.keywords ?? []).map(k => (
            <span key={k} style={{
              padding: "2px 8px", borderRadius: 999, fontSize: 11,
              background: "var(--panel-2)", border: "1px solid var(--line)",
            }}>
              {k}
            </span>
          ))}
        </div>
      )}

      {/* DOI display */}
      {(pub.doi || mintResult) && (
        <div style={{
          padding: "10px 14px", background: "#dcfce7", border: "1px solid #86efac",
          borderRadius: 8, fontSize: 13, color: "#15803d",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>DOI: {pub.doi ?? mintResult?.doi}</div>
          {(pub.url ?? mintResult?.url) && (
            <a
              href={pub.url ?? mintResult?.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: "#15803d", textDecoration: "underline", wordBreak: "break-all" }}
            >
              {pub.url ?? mintResult?.url}
            </a>
          )}
        </div>
      )}

      {mintError && <ErrorBanner msg={mintError} onDismiss={() => setMintError(null)} />}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {/* Mint DOI button */}
        {pub.status !== "published" && pub.status !== "failed" && !mintResult && (
          <button
            className="button"
            type="button"
            onClick={() => void handleMintDOI()}
            disabled={minting}
            style={{ height: 30, fontSize: 12 }}
          >
            {minting ? "Minting DOI…" : "Mint DOI"}
          </button>
        )}

        {/* Refresh button */}
        <button
          className="button secondary"
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          style={{ height: 30, fontSize: 12 }}
        >
          {refreshing ? "Refreshing…" : "Refresh Status"}
        </button>
      </div>
    </div>
  );
}

export default function DatasetPublishPage() {
  // Publish form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repository, setRepository] = useState<Repository>("zenodo");
  const [license, setLicense] = useState<typeof LICENSES[number]>("CC-BY-4.0");
  const [keywords, setKeywords] = useState("");
  const [authors, setAuthors] = useState("");
  const [runIds, setRunIds] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [newPub, setNewPub] = useState<DatasetPublication | null>(null);

  // Publications list
  const [publications, setPublications] = useState<DatasetPublication[]>([]);
  const [loadingPubs, setLoadingPubs] = useState(true);
  const [pubsError, setPubsError] = useState<string | null>(null);

  const loadPublications = useCallback(async () => {
    setLoadingPubs(true);
    setPubsError(null);
    try {
      const data = await listDatasetPublications();
      setPublications(data);
    } catch (e) {
      setPubsError(e instanceof Error ? e.message : "Failed to load publications");
    } finally {
      setLoadingPubs(false);
    }
  }, []);

  useEffect(() => { void loadPublications(); }, [loadPublications]);

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    setPublishing(true);
    setPublishError(null);
    setNewPub(null);
    try {
      const pub = await publishDataset({
        title: title.trim(),
        description: description.trim(),
        repository,
        license,
        keywords: keywords.split(",").map(k => k.trim()).filter(Boolean),
        authors: authors.split(",").map(a => a.trim()).filter(Boolean),
        run_ids: runIds.split(",").map(r => r.trim()).filter(Boolean),
      });
      setNewPub(pub);
      setPublications(prev => [pub, ...prev]);
      setTitle(""); setDescription(""); setKeywords(""); setAuthors(""); setRunIds("");
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Dataset Publisher</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 0" }}>
            Publish quantum datasets to Zenodo, Figshare, or OSF with DOI minting
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 20, alignItems: "start" }}>
        {/* LEFT: Publish form */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Publish New Dataset</div>

          {publishError && <ErrorBanner msg={publishError} onDismiss={() => setPublishError(null)} />}

          {newPub && (
            <div style={{
              padding: "12px 14px", background: "#dcfce7", border: "1px solid #86efac",
              borderRadius: 8, fontSize: 13, color: "#15803d", marginBottom: 14,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Published successfully</div>
              <div style={{ fontSize: 12, fontFamily: "monospace", wordBreak: "break-all" }}>
                ID: {newPub.pub_id}
              </div>
              <button onClick={() => setNewPub(null)} type="button"
                style={{ marginTop: 6, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#15803d", textDecoration: "underline" }}>
                Dismiss
              </button>
            </div>
          )}

          <form onSubmit={(e) => void handlePublish(e)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <FormField label="Title *">
              <input className="input" value={title} onChange={e => setTitle(e.target.value)}
                required placeholder="e.g. IBM Brisbane VQE Dataset 2026" style={{ height: 34 }} />
            </FormField>
            <FormField label="Description *">
              <textarea className="input" value={description} onChange={e => setDescription(e.target.value)}
                required rows={3} placeholder="Describe the dataset, methodology, and intended use…"
                style={{ resize: "vertical", fontFamily: "inherit", fontSize: 13 }} />
            </FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="Repository *">
                <select className="input" value={repository} onChange={e => setRepository(e.target.value as Repository)}
                  style={{ height: 34 }}>
                  {REPOSITORIES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </FormField>
              <FormField label="License *">
                <select className="input" value={license} onChange={e => setLicense(e.target.value as typeof LICENSES[number])}
                  style={{ height: 34 }}>
                  {LICENSES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </FormField>
            </div>
            <FormField label="Keywords (comma-separated)">
              <input className="input" value={keywords} onChange={e => setKeywords(e.target.value)}
                placeholder="quantum computing, VQE, noise characterization" style={{ height: 34 }} />
            </FormField>
            <FormField label="Authors (comma-separated) *">
              <input className="input" value={authors} onChange={e => setAuthors(e.target.value)}
                required placeholder="Smith J., Doe A., …" style={{ height: 34 }} />
            </FormField>
            <FormField label="Run IDs (comma-separated)">
              <input className="input" value={runIds} onChange={e => setRunIds(e.target.value)}
                placeholder="run-abc123, run-def456" style={{ height: 34 }} />
            </FormField>
            <button className="button" type="submit" disabled={publishing} style={{ height: 36 }}>
              {publishing ? "Publishing…" : "Publish Dataset"}
            </button>
          </form>
        </div>

        {/* RIGHT: Publications list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              Publications ({publications.length})
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={() => void loadPublications()}
              disabled={loadingPubs}
              style={{ height: 30, fontSize: 12 }}
            >
              {loadingPubs ? "Refreshing…" : "Refresh All"}
            </button>
          </div>

          {pubsError && <ErrorBanner msg={pubsError} onDismiss={() => setPubsError(null)} />}

          {loadingPubs ? (
            <div className="empty">Loading publications…</div>
          ) : publications.length === 0 ? (
            <div className="empty">No datasets published yet. Use the form to publish your first dataset.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {publications.map(pub => (
                <PublicationCard key={pub.pub_id} pub={pub} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
