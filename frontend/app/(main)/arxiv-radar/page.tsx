"use client";
import { useState, useEffect } from "react";
import { createArxivWatch, searchArxivRadar, getArxivAlerts, listArxivWatches, ArxivRadarWatch, ArxivRadarAlert, ArxivRadarPaper } from "@/lib/api";

export default function ArxivRadarPage() {
  const [watches, setWatches] = useState<ArxivRadarWatch[]>([]);
  const [alerts, setAlerts] = useState<ArxivRadarAlert[]>([]);
  const [papers, setPapers] = useState<ArxivRadarPaper[]>([]);
  const [query, setQuery] = useState("");
  const [keywords, setKeywords] = useState("VQE, QAOA, quantum sensing");
  const [showCreate, setShowCreate] = useState(false);
  const [watchName, setWatchName] = useState("My Research Watch");
  const [minRelevance, setMinRelevance] = useState(0.7);
  const [loading, setLoading] = useState(false);
  const [selectedPaper, setSelectedPaper] = useState<ArxivRadarPaper | null>(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    try {
      const [w, a, p] = await Promise.all([
        listArxivWatches(),
        getArxivAlerts(),
        searchArxivRadar({ query: "", keywords: [], categories: [] }),
      ]);
      setWatches(w.watches);
      setAlerts(a.alerts);
      setPapers(p.results);
    } catch { /* ignore */ }
  }

  async function createWatch() {
    setLoading(true);
    try {
      await createArxivWatch({ name: watchName, keywords: keywords.split(",").map(k => k.trim()), categories: ["quant-ph"], alert_on_contradiction: true, alert_on_confirmation: true, min_relevance: minRelevance });
      setShowCreate(false);
      loadAll();
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function search() {
    setLoading(true);
    try {
      const kws = keywords.split(",").map(k => k.trim()).filter(Boolean);
      const r = await searchArxivRadar({ query, keywords: kws, categories: [] });
      setPapers(r.results);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  const alertTypeColor: Record<string, string> = {
    contradiction: "bg-red-900/50 border-red-700 text-red-300",
    confirmation: "bg-green-900/50 border-green-700 text-green-300",
    citation: "bg-blue-900/50 border-blue-700 text-blue-300",
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">arXiv Radar</h1>
          <p className="text-gray-400 text-sm">Monitor new papers in your research area. Get instant alerts when a paper contradicts your hypothesis, confirms your result, or cites your experiment.</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium">
          + Create Watch
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-900 rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">New Watch</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400">Watch Name</label>
              <input value={watchName} onChange={e => setWatchName(e.target.value)}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Min Relevance: {minRelevance.toFixed(1)}</label>
              <input type="range" min={0.3} max={0.99} step={0.05} value={minRelevance} onChange={e => setMinRelevance(Number(e.target.value))}
                className="w-full mt-2.5" />
            </div>
            <div className="col-span-2">
              <label className="text-sm text-gray-400">Keywords (comma-separated)</label>
              <input value={keywords} onChange={e => setKeywords(e.target.value)}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={createWatch} disabled={loading} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-700 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-400 uppercase flex items-center gap-2">
            Alerts <span className="bg-red-600 text-white text-xs rounded-full px-1.5 py-0.5">{alerts.length}</span>
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {alerts.slice(0, 4).map(a => (
              <div key={a.alert_id} className={`rounded-lg p-3 border ${alertTypeColor[a.alert_type] ?? "bg-gray-900 border-gray-700"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase">{a.alert_type}</span>
                  <span className="text-xs font-mono">score: {a.relevance_score.toFixed(2)}</span>
                </div>
                <div className="text-sm mt-1 font-medium">{a.paper_title}</div>
                <div className="text-xs mt-1 opacity-80">{a.summary}</div>
                <div className="text-xs mt-2 italic opacity-70">{a.action_recommended}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Search papers (leave blank for topic feed)..."
          className="flex-1 bg-gray-800 text-white px-4 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-indigo-500 text-sm" />
        <input value={keywords} onChange={e => setKeywords(e.target.value)}
          placeholder="keywords"
          className="w-60 bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700" />
        <button onClick={search} disabled={loading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm disabled:opacity-50">
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-medium text-gray-400 uppercase">Papers ({papers.length})</h2>
          {papers.map(p => (
            <div key={p.arxiv_id} onClick={() => setSelectedPaper(selectedPaper?.arxiv_id === p.arxiv_id ? null : p)}
              className={`bg-gray-900 rounded-lg p-4 cursor-pointer border transition-colors ${selectedPaper?.arxiv_id === p.arxiv_id ? "border-indigo-500" : "border-transparent hover:border-gray-600"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="font-medium text-sm leading-snug">{p.title}</div>
                  <div className="text-xs text-gray-500 mt-1">{p.authors.slice(0, 3).join(", ")}{p.authors.length > 3 ? " et al." : ""} · {p.submitted}</div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <div className="text-xs font-mono text-indigo-400">{(p.relevance_score * 100).toFixed(0)}%</div>
                  <div className="flex gap-1">
                    {p.confirms_hypothesis && <span className="text-xs bg-green-900/50 text-green-400 px-1 rounded">confirms</span>}
                    {p.contradicts_hypothesis && <span className="text-xs bg-red-900/50 text-red-400 px-1 rounded">contradicts</span>}
                    {p.cites_qlab_experiment && <span className="text-xs bg-blue-900/50 text-blue-400 px-1 rounded">cites you</span>}
                    {p.circuit_available && <span className="text-xs bg-gray-700 text-gray-400 px-1 rounded">circuit</span>}
                  </div>
                </div>
              </div>
              {selectedPaper?.arxiv_id === p.arxiv_id && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-gray-300 leading-relaxed">{p.abstract}</p>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500">{p.doi}</span>
                    <span className="text-gray-500">{p.citations} citations</span>
                    {p.keywords.map(k => <span key={k} className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">{k}</span>)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-medium text-gray-400 uppercase mb-2">Watches</h2>
            {watches.map(w => (
              <div key={w.watch_id} className="bg-gray-900 rounded-lg p-3 mb-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">{w.name}</div>
                  <span className={`w-2 h-2 rounded-full ${w.active ? "bg-green-400" : "bg-gray-600"}`} />
                </div>
                <div className="text-xs text-gray-500 mt-1">{w.keywords.slice(0, 4).join(", ")}</div>
                {w.alert_count > 0 && (
                  <div className="text-xs text-red-400 mt-1">{w.alert_count} alert{w.alert_count !== 1 ? "s" : ""}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
