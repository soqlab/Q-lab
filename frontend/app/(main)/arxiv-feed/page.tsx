"use client";
import { useState, useEffect } from "react";
import { searchArxivFeed, ArxivFeedPaper, ArxivFeedResult } from "../../../lib/api";

function PaperCard({ paper }: { paper: ArxivFeedPaper }) {
  const [showAbstract, setShowAbstract] = useState(false);
  const [showBibtex, setShowBibtex] = useState(false);
  const bibtex = `@article{${paper.arxiv_id.replace(".", "_")},
  title={${paper.title}},
  author={${(paper.authors ?? []).join(" and ")}},
  journal={${paper.journal}},
  year={${paper.date.slice(0, 4)}},
  eprint={${paper.arxiv_id}},
  archivePrefix={arXiv}
}`;

  return (
    <div style={{ background: "#1e293b", borderRadius: 8, padding: 16, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{paper.title}</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{(paper.authors ?? []).join(", ")} &middot; {paper.journal} &middot; {paper.date}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {(paper.categories ?? []).map(c => (
              <span key={c} style={{ padding: "2px 6px", borderRadius: 10, background: "#0f172a", color: "#94a3b8", fontSize: 11 }}>{c}</span>
            ))}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#6366f1" }}>{paper.citations}</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>citations</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={() => setShowAbstract(!showAbstract)}
          style={{ padding: "4px 10px", background: "#0f172a", color: "#94a3b8", border: "1px solid #334155", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
          {showAbstract ? "Hide" : "Abstract"}
        </button>
        <button onClick={() => setShowBibtex(!showBibtex)}
          style={{ padding: "4px 10px", background: "#0f172a", color: "#94a3b8", border: "1px solid #334155", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
          BibTeX
        </button>
      </div>

      {showAbstract && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#94a3b8", lineHeight: 1.6, borderTop: "1px solid #334155", paddingTop: 10 }}>
          {paper.abstract}
        </div>
      )}
      {showBibtex && (
        <pre style={{ marginTop: 10, background: "#0f172a", borderRadius: 6, padding: 10, fontSize: 11, color: "#e2e8f0", fontFamily: "monospace", overflowX: "auto" }}>
          {bibtex}
        </pre>
      )}
    </div>
  );
}

export default function ArxivFeedPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ArxivFeedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("citations");

  useEffect(() => {
    searchArxivFeed({ query: "", max_results: 15, sort_by: "citations" }).then(setResult).catch(() => {});
  }, []);

  async function search() {
    setLoading(true); setError(null);
    try { setResult(await searchArxivFeed({ query, max_results: 20, sort_by: sortBy })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Search Papers</div>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="topic, author, keyword…" onKeyDown={e => e.key === "Enter" && search()}
            style={{ width: "100%", padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, marginBottom: 10 }} />
          <label style={{ fontSize: 11, color: "#64748b" }}>Sort by</label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 10, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            <option value="citations">Citations</option>
            <option value="date">Date</option>
          </select>
          <button onClick={search} disabled={loading}
            style={{ width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {result && (
          <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Stats</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Papers indexed: <span style={{ color: "#e2e8f0" }}>{result.stats?.total_papers_indexed}</span></div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Avg citations: <span style={{ color: "#e2e8f0" }}>{result.stats?.avg_citations}</span></div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>Most cited:</div>
            <div style={{ fontSize: 11, color: "#a78bfa", lineHeight: 1.4 }}>{result.stats?.most_cited?.slice(0, 60)}…</div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
        {result && (
          <>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
              {result.returned} results {query && `for "${query}"`}
            </div>
            {(result.papers ?? []).map(p => <PaperCard key={p.arxiv_id} paper={p} />)}
          </>
        )}
      </div>
    </div>
  );
}
