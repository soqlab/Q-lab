"use client";

import { useState, useEffect, useCallback } from "react";
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

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    poster: "bg-indigo-900/60 text-indigo-300",
    slides: "bg-emerald-900/60 text-emerald-300",
    abstract: "bg-amber-900/60 text-amber-300",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${colors[type] ?? "bg-gray-800 text-gray-300"}`}>
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
      className="text-left w-full bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-indigo-600 transition-colors"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <TypeBadge type={asset.type} />
        <span className="text-xs text-gray-500">{new Date(asset.created_at).toLocaleDateString()}</span>
      </div>
      <p className="text-gray-100 font-medium text-sm leading-snug mb-1 line-clamp-2">{asset.title}</p>
      <p className="text-gray-500 text-xs">{asset.venue}</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-gray-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TypeBadge type={asset.type} />
              <span className="text-xs text-gray-500">{asset.venue}</span>
            </div>
            <h2 className="text-gray-100 font-semibold text-lg">{asset.title}</h2>
            <p className="text-gray-500 text-xs mt-1">
              {asset.file_size_kb} KB &middot; {asset.format} &middot;{" "}
              {(asset.authors ?? []).join(", ")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 ml-4 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-5 space-y-2">
          {asset.download_url && (
            <a
              href={asset.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Download File
            </a>
          )}

          <div className="mt-4 space-y-2">
            {asset.sections.map((sec, i) => (
              <div key={i} className="bg-gray-900 rounded-lg border border-gray-800">
                <button
                  onClick={() => toggle(i)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-gray-100 font-medium text-sm">{sec.title}</span>
                  <span className="text-gray-500 text-sm">{expanded.has(i) ? "▲" : "▼"}</span>
                </button>
                {expanded.has(i) && (
                  <div className="px-4 pb-4">
                    <p className="text-gray-400 text-sm whitespace-pre-wrap leading-relaxed">{sec.content}</p>
                    {sec.figures && sec.figures.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {sec.figures.map((fig, fi) => (
                          <div
                            key={fi}
                            className="bg-gray-800 rounded-lg flex items-center justify-center text-gray-600 text-xs"
                            style={{ width: 120, height: 80 }}
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

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      {selectedAsset && (
        <AssetDetail asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Conference Asset Builder</h1>
        <p className="text-gray-500 text-sm mt-1">
          Auto-generate posters, slides, and abstracts from experiment data.
        </p>
      </div>

      {/* Generator card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-950 rounded-lg p-1 w-fit">
          {TAB_LIST.map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setGenError(null); setGeneratedAsset(null); }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Shared form */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Variational Quantum Eigensolver for H2"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Venue</label>
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="IEEE Quantum Week 2025"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Authors (comma-separated)</label>
            <input
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder="Alice Smith, Bob Chen"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Experiment IDs (comma-separated)</label>
            <input
              value={experimentIds}
              onChange={(e) => setExperimentIds(e.target.value)}
              placeholder="exp-001, exp-002"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Tab-specific options */}
        {activeTab === "Poster" && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Template</label>
              <select
                value={posterTemplate}
                onChange={(e) => setPosterTemplate(e.target.value as "ieee" | "acm" | "nature")}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="ieee">IEEE</option>
                <option value="acm">ACM</option>
                <option value="nature">Nature</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Highlight Metric</label>
              <select
                value={highlightMetric}
                onChange={(e) => setHighlightMetric(e.target.value as "fidelity" | "depth" | "gate_count")}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="fidelity">Fidelity</option>
                <option value="depth">Depth</option>
                <option value="gate_count">Gate Count</option>
              </select>
            </div>
          </div>
        )}

        {activeTab === "Slides" && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">
                Number of Slides: <span className="text-indigo-400 font-semibold">{nSlides}</span>
              </label>
              <input
                type="range"
                min={8}
                max={20}
                value={nSlides}
                onChange={(e) => setNSlides(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-0.5"><span>8</span><span>20</span></div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Template</label>
              <select
                value={slidesTemplate}
                onChange={(e) => setSlidesTemplate(e.target.value as "clean" | "dark" | "academic")}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="clean">Clean</option>
                <option value="dark">Dark</option>
                <option value="academic">Academic</option>
              </select>
            </div>
          </div>
        )}

        {activeTab === "Abstract" && (
          <div className="mb-4 max-w-sm">
            <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">
              Max Words: <span className="text-indigo-400 font-semibold">{maxWords}</span>
            </label>
            <input
              type="range"
              min={150}
              max={500}
              value={maxWords}
              onChange={(e) => setMaxWords(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-0.5"><span>150</span><span>500</span></div>
          </div>
        )}

        {genError && (
          <div className="mb-4 bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
            {genError}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={generating || !title || !venue}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-colors"
        >
          {generating ? "Generating…" : `Generate ${activeTab}`}
        </button>

        {/* Generated result */}
        {generatedAsset && (
          <div className="mt-6 border border-indigo-800 bg-indigo-950/30 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TypeBadge type={generatedAsset.type} />
                <span className="text-gray-300 text-sm font-medium">{generatedAsset.venue}</span>
              </div>
              <span className="text-gray-500 text-xs">{generatedAsset.file_size_kb} KB</span>
            </div>
            <h3 className="text-gray-100 font-semibold mb-1">{generatedAsset.title}</h3>
            <p className="text-gray-500 text-xs mb-3">{(generatedAsset.authors ?? []).join(", ")}</p>
            {generatedAsset.download_url && (
              <a
                href={generatedAsset.download_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors mb-3"
              >
                Download
              </a>
            )}
            <div className="space-y-2 mt-3">
              {generatedAsset.sections.map((sec, i) => (
                <div key={i} className="bg-gray-900 rounded-lg p-3">
                  <p className="text-gray-100 text-xs font-bold mb-1">{sec.title}</p>
                  <p className="text-gray-400 text-xs leading-relaxed">{sec.content}</p>
                  {sec.figures && sec.figures.length > 0 && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {sec.figures.map((_, fi) => (
                        <div key={fi} className="bg-gray-800 rounded w-24 h-16 flex items-center justify-center text-gray-600 text-xs">
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
        <h2 className="text-lg font-semibold text-gray-100 mb-3">All Conference Assets</h2>
        {assetsError && (
          <div className="bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm mb-4">
            {assetsError}
          </div>
        )}
        {assetsLoading ? (
          <div className="text-gray-500 text-sm py-8 text-center">Loading assets…</div>
        ) : assets.length === 0 ? (
          <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
            No assets yet. Generate your first one above.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {assets.map((asset) => (
              <div key={asset.asset_id} className="relative">
                <AssetCard
                  asset={asset}
                  onClick={() => handleSelectAsset(asset.asset_id)}
                />
                {loadingDetail && (
                  <div className="absolute inset-0 bg-gray-950/60 rounded-xl flex items-center justify-center">
                    <span className="text-xs text-gray-400">Loading…</span>
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
