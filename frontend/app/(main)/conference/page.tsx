"use client";

import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import {
  generatePoster,
  generateSlides,
  generateAbstract,
  listConferenceAssets,
  getConferenceAsset,
  type ConferenceAsset,
} from "@/lib/api";

type TabType = "Poster" | "Slides" | "Abstract";

const TAB_LIST: TabType[] = ["Poster", "Slides", "Abstract"];

const TYPE_BADGE_COLORS: Record<string, CSSProperties> = {
  poster:   { background: "rgba(67,56,202,0.35)",  color: "var(--strong)" },
  slides:   { background: "rgba(16,185,129,0.15)", color: "#34d399" },
  abstract: { background: "rgba(245,158,11,0.15)", color: "#f59e0b" },
};

const LABEL_STYLE: CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const INPUT_STYLE: CSSProperties = {
  width: "100%",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  color: "var(--text)",
  boxSizing: "border-box",
};

function TypeBadge({ type }: { type: string }) {
  const colorStyle = TYPE_BADGE_COLORS[type] ?? { background: "var(--surface)", color: "var(--muted)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        ...colorStyle,
      }}
    >
      {type}
    </span>
  );
}

function AssetCard({
  asset,
  onClick,
}: {
  asset: ConferenceAsset;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        width: "100%",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 16,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <TypeBadge type={asset.type} />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(asset.created_at).toLocaleDateString()}</span>
      </div>
      <p
        style={{
          color: "var(--text)",
          fontWeight: 500,
          fontSize: 13,
          lineHeight: 1.3,
          marginBottom: 4,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {asset.title}
      </p>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>{asset.venue}</p>
    </button>
  );
}

function AssetDetail({ asset, onClose }: { asset: ConferenceAsset; onClose: () => void }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          width: "100%",
          maxWidth: 672,
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: 20,
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <TypeBadge type={asset.type} />
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{asset.venue}</span>
            </div>
            <h2 style={{ color: "var(--text)", fontWeight: 600, fontSize: 18 }}>{asset.title}</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
              {asset.file_size_kb} KB &middot; {asset.format} &middot;{" "}
              {(asset.authors ?? []).join(", ")}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              color: "var(--muted)",
              marginLeft: 16,
              fontSize: 20,
              lineHeight: 1,
              cursor: "pointer",
              background: "none",
              border: "none",
            }}
          >
            &times;
          </button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          {asset.download_url && (
            <a
              href={asset.download_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "var(--strong)",
                color: "#fff",
                fontSize: 13,
                padding: "8px 16px",
                borderRadius: 8,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Download File
            </a>
          )}

          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {asset.sections.map((sec, i) => (
              <div key={i} style={{ background: "var(--surface)", borderRadius: 8, border: "1px solid var(--line)" }}>
                <button
                  onClick={() => toggle(i)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    textAlign: "left",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                  }}
                >
                  <span style={{ color: "var(--text)", fontWeight: 500, fontSize: 13 }}>{sec.title}</span>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>{expanded.has(i) ? "▲" : "▼"}</span>
                </button>
                {expanded.has(i) && (
                  <div style={{ padding: "0 16px 16px" }}>
                    <p style={{ color: "var(--muted)", fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{sec.content}</p>
                    {sec.figures && sec.figures.length > 0 && (
                      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {sec.figures.map((fig, fi) => (
                          <div
                            key={fi}
                            style={{
                              background: "var(--line)",
                              borderRadius: 8,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--muted)",
                              fontSize: 12,
                              width: 120,
                              height: 80,
                            }}
                          >
                            Figure {fi + 1}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ConferencePage() {
  const [activeTab, setActiveTab] = useState<TabType>("Poster");
  const [assets, setAssets] = useState<ConferenceAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [generatedAsset, setGeneratedAsset] = useState<ConferenceAsset | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<ConferenceAsset | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Shared form fields
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [authors, setAuthors] = useState("");
  const [experimentIds, setExperimentIds] = useState("");

  // Poster-specific
  const [posterTemplate, setPosterTemplate] = useState<"ieee" | "acm" | "nature">("ieee");
  const [highlightMetric, setHighlightMetric] = useState<"fidelity" | "depth" | "gate_count">("fidelity");

  // Slides-specific
  const [nSlides, setNSlides] = useState(12);
  const [slidesTemplate, setSlidesTemplate] = useState<"clean" | "dark" | "academic">("dark");

  // Abstract-specific
  const [maxWords, setMaxWords] = useState(300);

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true);
    setAssetsError(null);
    try {
      const data = await listConferenceAssets();
      setAssets(data);
    } catch {
      setAssetsError("Failed to load conference assets.");
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  async function handleGenerate() {
    setGenError(null);
    setGenerating(true);
    setGeneratedAsset(null);
    try {
      const base = {
        title,
        venue,
        authors: authors.split(",").map((a) => a.trim()).filter(Boolean),
        experiment_ids: experimentIds.split(",").map((id) => id.trim()).filter(Boolean),
      };
      let result: ConferenceAsset;
      if (activeTab === "Poster") {
        result = await generatePoster({ ...base, template: posterTemplate, highlight_metric: highlightMetric });
      } else if (activeTab === "Slides") {
        result = await generateSlides({ ...base, n_slides: nSlides, template: slidesTemplate });
      } else {
        result = await generateAbstract({ ...base, max_words: maxWords });
      }
      setGeneratedAsset(result);
      void loadAssets();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSelectAsset(id: string) {
    setLoadingDetail(true);
    try {
      const detail = await getConferenceAsset(id);
      setSelectedAsset(detail);
    } catch {
      // fall back to list entry
      const fallback = assets.find((a) => a.asset_id === id) ?? null;
      setSelectedAsset(fallback);
    } finally {
      setLoadingDetail(false);
    }
  }

  const isGenerateDisabled = generating || !title || !venue;

  return (
    <main className="page">
      {selectedAsset && (
        <AssetDetail asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
      )}

      <div style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
        <span>✨</span>
        <span><strong style={{ color: "#6366f1" }}>AI-Generated</strong> — Content is written by Claude based on your experiment data. Review and edit before submitting to venues.</span>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>Conference Asset Builder</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          Auto-generate posters, slides, and abstracts from experiment data.
        </p>
      </div>

      {/* Generator card */}
      <div className="panel" style={{ marginBottom: 32 }}>
        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 24,
            background: "var(--surface)",
            borderRadius: 8,
            padding: 4,
            width: "fit-content",
          }}
        >
          {TAB_LIST.map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setGenError(null); setGeneratedAsset(null); }}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                border: "none",
                background: activeTab === tab ? "var(--strong)" : "transparent",
                color: activeTab === tab ? "#fff" : "var(--muted)",
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Shared form */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={LABEL_STYLE}>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Variational Quantum Eigensolver for H2"
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>Venue</label>
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="IEEE Quantum Week 2025"
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>Authors (comma-separated)</label>
            <input
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder="Alice Smith, Bob Chen"
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>Experiment IDs (comma-separated)</label>
            <input
              value={experimentIds}
              onChange={(e) => setExperimentIds(e.target.value)}
              placeholder="exp-001, exp-002"
              style={INPUT_STYLE}
            />
          </div>
        </div>

        {/* Tab-specific options */}
        {activeTab === "Poster" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <label style={LABEL_STYLE}>Template</label>
              <select
                value={posterTemplate}
                onChange={(e) => setPosterTemplate(e.target.value as "ieee" | "acm" | "nature")}
                style={INPUT_STYLE}
              >
                <option value="ieee">IEEE</option>
                <option value="acm">ACM</option>
                <option value="nature">Nature</option>
              </select>
            </div>
            <div>
              <label style={LABEL_STYLE}>Highlight Metric</label>
              <select
                value={highlightMetric}
                onChange={(e) => setHighlightMetric(e.target.value as "fidelity" | "depth" | "gate_count")}
                style={INPUT_STYLE}
              >
                <option value="fidelity">Fidelity</option>
                <option value="depth">Depth</option>
                <option value="gate_count">Gate Count</option>
              </select>
            </div>
          </div>
        )}

        {activeTab === "Slides" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <label style={LABEL_STYLE}>
                Number of Slides:{" "}
                <span style={{ color: "var(--strong)", fontWeight: 600 }}>{nSlides}</span>
              </label>
              <input
                type="range"
                min={8}
                max={20}
                value={nSlides}
                onChange={(e) => setNSlides(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--strong)" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                <span>8</span><span>20</span>
              </div>
            </div>
            <div>
              <label style={LABEL_STYLE}>Template</label>
              <select
                value={slidesTemplate}
                onChange={(e) => setSlidesTemplate(e.target.value as "clean" | "dark" | "academic")}
                style={INPUT_STYLE}
              >
                <option value="clean">Clean</option>
                <option value="dark">Dark</option>
                <option value="academic">Academic</option>
              </select>
            </div>
          </div>
        )}

        {activeTab === "Abstract" && (
          <div style={{ marginBottom: 16, maxWidth: 384 }}>
            <label style={LABEL_STYLE}>
              Max Words:{" "}
              <span style={{ color: "var(--strong)", fontWeight: 600 }}>{maxWords}</span>
            </label>
            <input
              type="range"
              min={150}
              max={500}
              value={maxWords}
              onChange={(e) => setMaxWords(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--strong)" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              <span>150</span><span>500</span>
            </div>
          </div>
        )}

        {genError && (
          <div
            style={{
              marginBottom: 16,
              background: "rgba(239,68,68,0.1)",
              border: "1px solid var(--danger)",
              color: "var(--danger)",
              borderRadius: 8,
              padding: "12px 16px",
              fontSize: 13,
            }}
          >
            {genError}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={isGenerateDisabled}
          style={{
            background: "var(--strong)",
            color: "#fff",
            fontWeight: 500,
            fontSize: 13,
            padding: "10px 24px",
            borderRadius: 8,
            border: "none",
            cursor: isGenerateDisabled ? "not-allowed" : "pointer",
            opacity: isGenerateDisabled ? 0.5 : 1,
          }}
        >
          {generating ? "Generating…" : `Generate ${activeTab}`}
        </button>

        {/* Generated result */}
        {generatedAsset && (
          <div
            style={{
              marginTop: 24,
              border: "1px solid var(--strong)",
              background: "rgba(99,102,241,0.08)",
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TypeBadge type={generatedAsset.type} />
                <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>{generatedAsset.venue}</span>
              </div>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>{generatedAsset.file_size_kb} KB</span>
            </div>
            <h3 style={{ color: "var(--text)", fontWeight: 600, marginBottom: 4 }}>{generatedAsset.title}</h3>
            <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>{(generatedAsset.authors ?? []).join(", ")}</p>
            {generatedAsset.download_url && (
              <a
                href={generatedAsset.download_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  background: "var(--strong)",
                  color: "#fff",
                  fontSize: 12,
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontWeight: 500,
                  textDecoration: "none",
                  marginBottom: 12,
                }}
              >
                Download
              </a>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {generatedAsset.sections.map((sec, i) => (
                <div key={i} style={{ background: "var(--surface)", borderRadius: 8, padding: 12 }}>
                  <p style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{sec.title}</p>
                  <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>{sec.content}</p>
                  {sec.figures && sec.figures.length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {sec.figures.map((_, fi) => (
                        <div
                          key={fi}
                          style={{
                            background: "var(--line)",
                            borderRadius: 6,
                            width: 96,
                            height: 64,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--muted)",
                            fontSize: 12,
                          }}
                        >
                          Fig {fi + 1}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Assets list */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>All Conference Assets</h2>
        {assetsError && (
          <div
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid var(--danger)",
              color: "var(--danger)",
              borderRadius: 8,
              padding: "12px 16px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {assetsError}
          </div>
        )}
        {assetsLoading ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>Loading assets…</div>
        ) : assets.length === 0 ? (
          <div
            style={{
              color: "var(--muted)",
              fontSize: 13,
              padding: "32px 0",
              textAlign: "center",
              background: "var(--surface)",
              borderRadius: 12,
              border: "1px solid var(--line)",
            }}
          >
            No assets yet. Generate your first one above.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {assets.map((asset) => (
              <div key={asset.asset_id} style={{ position: "relative" }}>
                <AssetCard
                  asset={asset}
                  onClick={() => handleSelectAsset(asset.asset_id)}
                />
                {loadingDetail && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(0,0,0,0.4)",
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
