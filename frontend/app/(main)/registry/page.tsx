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
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Experiment Registry</h1>
        <button onClick={() => setShowPublish(!showPublish)}
          className="button"
          style={{ padding: "8px 16px", fontWeight: 500 }}>
          Publish Experiment
        </button>
      </div>
      <p style={{ color: "var(--muted)" }}>Discover, star, and fork published quantum experiments from the community.</p>

      <div style={{ display: "flex", gap: 12 }}>
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search(query)}
          placeholder="Search experiments..."
          className="input"
          style={{ flex: 1 }} />
        <button onClick={() => search(query)} className="button secondary">Search</button>
      </div>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>
          {error}
        </div>
      )}

      {showPublish && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontWeight: 600 }}>Publish New Experiment</h2>
          <input placeholder="Title" value={pubTitle} onChange={e => setPubTitle(e.target.value)}
            className="input"
            style={{ width: "100%" }} />
          <textarea placeholder="Description" value={pubDesc} onChange={e => setPubDesc(e.target.value)}
            className="input"
            style={{ width: "100%", height: 96 }} />
          <input placeholder="Tags (comma-separated)" value={pubTags} onChange={e => setPubTags(e.target.value)}
            className="input"
            style={{ width: "100%" }} />
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={publish}
              style={{ padding: "8px 16px", background: "#15803d", borderRadius: 6, fontSize: 13, color: "var(--text)", border: "none", cursor: "pointer" }}>
              Publish
            </button>
            <button onClick={() => setShowPublish(false)}
              style={{ padding: "8px 16px", background: "var(--line)", borderRadius: 6, fontSize: 13, color: "var(--text)", border: "none", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div style={{ color: "var(--muted)" }}>Searching...</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(results ?? []).map(r => (
          <div key={r.registry_id} style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{r.title}</span>
                  {r.reproducibility_badge && (
                    <span style={{ fontSize: 12, background: "rgba(16,185,129,0.1)", color: "var(--ok)", padding: "2px 8px", borderRadius: 6 }}>
                      Reproducible
                    </span>
                  )}
                </div>
                <p style={{ color: "var(--muted)", fontSize: 13 }}>{r.description}</p>
                <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                  <span>{r.author}</span>
                  {r.institution && <span>· {r.institution}</span>}
                  {r.doi && <span>· DOI: {r.doi}</span>}
                  <span>· {r.backend}</span>
                  <span>· {r.n_qubits}q</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {(r.tags ?? []).map(t => (
                    <span key={t} style={{ fontSize: 12, background: "var(--surface)", color: "var(--muted)", padding: "2px 8px", borderRadius: 6, border: "1px solid var(--line)" }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 4 }}>
                <button onClick={() => star(r.registry_id)}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 12px", background: "rgba(245,158,11,0.1)", borderRadius: 6, color: "#f59e0b", fontSize: 13, border: "none", cursor: "pointer" }}>
                  ★ {r.stars}
                </button>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.forks} forks · {r.views} views</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
