"use client";
import { useState, useEffect } from "react";
import { searchRegistry, publishExperiment, starRegistryEntry, RegistryEntry } from "@/lib/api";

export default function RegistryPage() {
  const [results, setResults] = useState<RegistryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPublish, setShowPublish] = useState(false);
  const [pubTitle, setPubTitle] = useState("");
  const [pubDesc, setPubDesc] = useState("");
  const [pubTags, setPubTags] = useState("");

  useEffect(() => { search(""); }, []);

  async function search(q: string) {
    setLoading(true);
    try {
      const r = await searchRegistry({ query: q, max_results: 20, sort_by: "stars" });
      setResults(r.results);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function star(id: string) {
    try {
      await starRegistryEntry(id);
      search(query);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function publish() {
    if (!pubTitle || !pubDesc) return;
    try {
      await publishExperiment({ title: pubTitle, description: pubDesc, tags: pubTags.split(",").map(s => s.trim()).filter(Boolean) });
      setShowPublish(false); setPubTitle(""); setPubDesc(""); setPubTags("");
      search(query);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Experiment Registry</h1>
        <button onClick={() => setShowPublish(!showPublish)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium">
          Publish Experiment
        </button>
      </div>
      <p className="text-gray-400">Discover, star, and fork published quantum experiments from the community.</p>

      <div className="flex gap-3">
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search(query)}
          placeholder="Search experiments..."
          className="flex-1 bg-gray-800 text-white px-4 py-2 rounded border border-gray-700 focus:outline-none focus:border-indigo-500" />
        <button onClick={() => search(query)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">Search</button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {showPublish && (
        <div className="bg-gray-900 rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">Publish New Experiment</h2>
          <input placeholder="Title" value={pubTitle} onChange={e => setPubTitle(e.target.value)}
            className="w-full bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          <textarea placeholder="Description" value={pubDesc} onChange={e => setPubDesc(e.target.value)}
            className="w-full h-24 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          <input placeholder="Tags (comma-separated)" value={pubTags} onChange={e => setPubTags(e.target.value)}
            className="w-full bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          <div className="flex gap-3">
            <button onClick={publish} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm">Publish</button>
            <button onClick={() => setShowPublish(false)} className="px-4 py-2 bg-gray-700 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      {loading && <div className="text-gray-400">Searching...</div>}

      <div className="space-y-3">
        {results.map(r => (
          <div key={r.registry_id} className="bg-gray-900 rounded-lg p-5 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-semibold">{r.title}</span>
                  {r.reproducibility_badge && (
                    <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded">Reproducible</span>
                  )}
                </div>
                <p className="text-gray-400 text-sm">{r.description}</p>
                <div className="flex gap-3 mt-2 text-xs text-gray-500">
                  <span>{r.author}</span>
                  {r.institution && <span>· {r.institution}</span>}
                  {r.doi && <span>· DOI: {r.doi}</span>}
                  <span>· {r.backend}</span>
                  <span>· {r.n_qubits}q</span>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {r.tags.map(t => <span key={t} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">{t}</span>)}
                </div>
              </div>
              <div className="text-right space-y-1">
                <button onClick={() => star(r.registry_id)}
                  className="flex items-center gap-1 px-3 py-1 bg-yellow-900/30 hover:bg-yellow-900/50 rounded text-yellow-400 text-sm">
                  ★ {r.stars}
                </button>
                <div className="text-xs text-gray-500">{r.forks} forks · {r.views} views</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
