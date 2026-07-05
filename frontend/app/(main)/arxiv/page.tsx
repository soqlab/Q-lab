"use client";

import { useState, useEffect } from "react";
import { ArxivSearchResult, ArxivPaper, searchArxiv, getFeaturedPapers } from "../../../lib/api";
import { BookOpen, Search, ExternalLink, Star } from "lucide-react";

function PaperCard({ paper }: { paper: ArxivPaper }) {
  const [showBibtex, setShowBibtex] = useState(false);
  const authors = paper.authors ?? [];
  const displayAuthors = authors.length > 3
    ? authors.slice(0, 3).join(", ") + " et al."
    : authors.join(", ");
  const relevanceColor = paper.relevance_score > 0.7 ? "#10b981" : paper.relevance_score > 0.4 ? "#f59e0b" : "#64748b";

  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem", marginBottom: "0.5rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", marginBottom: "0.25rem" }}>
        <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "0.95rem", flex: 1 }}>{paper.title}</span>
        {paper.doi_url && (
          <a href={paper.doi_url} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", flexShrink: 0 }}>
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.4rem" }}>{displayAuthors}</div>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
        <span style={{ background: "#1d3a6b", color: "#3b82f6", borderRadius: 12, padding: "0.1rem 0.5rem", fontSize: "0.75rem" }}>{paper.year}</span>
        {(paper.categories ?? []).map((cat) => (
          <span key={cat} style={{ background: "#1d3a6b", color: "#3b82f6", borderRadius: 12, padding: "0.1rem 0.5rem", fontSize: "0.75rem" }}>{cat}</span>
        ))}
        <span style={{ color: relevanceColor, fontSize: "0.75rem", fontWeight: 600 }}>
          {(paper.relevance_score * 100).toFixed(0)}% relevance
        </span>
      </div>
      <div style={{ color: "#64748b", fontSize: "0.82rem", marginTop: "0.5rem", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
        {paper.abstract_snippet}
      </div>
      <div style={{ color: "#94a3b8", fontSize: "0.78rem", marginTop: "0.4rem" }}>{paper.citation_count_estimate} estimated citations</div>
      <button
        onClick={() => setShowBibtex(!showBibtex)}
        style={{ marginTop: "0.5rem", background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", cursor: "pointer", padding: "0.25rem 0.6rem", fontSize: "0.78rem" }}
      >
        {showBibtex ? "Hide BibTeX" : "Show BibTeX"}
      </button>
      {showBibtex && (
        <pre style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "0.6rem", color: "#94a3b8", fontSize: "0.75rem", marginTop: "0.5rem", overflowX: "auto", whiteSpace: "pre-wrap" }}>
          {paper.bibtex}
        </pre>
      )}
    </div>
  );
}

export default function ArxivPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [yearFrom, setYearFrom] = useState<number | undefined>(undefined);
  const [yearTo, setYearTo] = useState<number | undefined>(undefined);
  const [maxResults, setMaxResults] = useState(10);
  const [result, setResult] = useState<ArxivSearchResult | null>(null);
  const [featuredPapers, setFeaturedPapers] = useState<ArxivPaper[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFeaturedPapers().then(data => setFeaturedPapers(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await searchArxiv({
        query,
        category: category || undefined,
        year_from: yearFrom,
        year_to: yearTo,
        max_results: maxResults,
      });
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <BookOpen size={28} color="#3b82f6" />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800, color: "#e2e8f0" }}>arXiv Paper Search</h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem" }}>Search quantum computing literature</p>
          </div>
        </div>

        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 100px 100px 120px auto", gap: "0.75rem", alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.35rem" }}>Search Query</label>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="quantum error correction, VQE, Shor..."
                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 0.8rem", color: "#e2e8f0", fontSize: "0.9rem", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ display: "block", color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.35rem" }}>Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="quant-ph, cs.ET..."
                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 0.8rem", color: "#e2e8f0", fontSize: "0.9rem", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ display: "block", color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.35rem" }}>Year From</label>
              <input
                type="number"
                value={yearFrom ?? ""}
                onChange={(e) => setYearFrom(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="2018"
                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 0.8rem", color: "#e2e8f0", fontSize: "0.9rem", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ display: "block", color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.35rem" }}>Year To</label>
              <input
                type="number"
                value={yearTo ?? ""}
                onChange={(e) => setYearTo(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="2025"
                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 0.8rem", color: "#e2e8f0", fontSize: "0.9rem", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ display: "block", color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.35rem" }}>Max Results: {maxResults}</label>
              <input
                type="range"
                min={5}
                max={30}
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              style={{ background: "#3b82f6", border: "none", borderRadius: 8, padding: "0.65rem 1.2rem", cursor: "pointer", fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: "0.4rem", opacity: loading || !query.trim() ? 0.6 : 1 }}
            >
              <Search size={16} />
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "1rem" }}>{error}</div>
        )}

        {result === null ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
              <Star size={18} color="#f59e0b" />
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#e2e8f0" }}>Featured Papers</h2>
            </div>
            {featuredPapers.length === 0 ? (
              <div style={{ textAlign: "center", height: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
                <BookOpen size={48} color="#334155" />
                <p style={{ marginTop: "1rem" }}>Use the search above to find quantum computing papers</p>
              </div>
            ) : (
              featuredPapers.map((paper) => <PaperCard key={paper.arxiv_id} paper={paper} />)
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#e2e8f0" }}>
                  {result.n_results} results for &quot;{result.query}&quot;
                </h2>
                <p style={{ margin: "0.25rem 0 0", color: "#64748b", fontSize: "0.82rem" }}>Search completed in {result.search_time_ms}ms</p>
              </div>
              <button
                onClick={() => setResult(null)}
                style={{ background: "none", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", cursor: "pointer", padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
              >
                Clear
              </button>
            </div>
            {(result.related_topics ?? []).length > 0 && (
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <span style={{ color: "#64748b", fontSize: "0.82rem", alignSelf: "center" }}>Related:</span>
                {(result.related_topics ?? []).map((topic) => (
                  <span
                    key={topic}
                    onClick={() => { setQuery(topic); handleSearch(); }}
                    style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "0.2rem 0.6rem", fontSize: "0.78rem", color: "#3b82f6", cursor: "pointer" }}
                  >
                    {topic}
                  </span>
                ))}
              </div>
            )}
            {(result.results ?? []).length === 0 ? (
              <div style={{ textAlign: "center", height: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
                <Search size={40} color="#334155" />
                <p style={{ marginTop: "1rem" }}>No papers found. Try a different query.</p>
              </div>
            ) : (
              (result.results ?? []).map((paper) => <PaperCard key={paper.arxiv_id} paper={paper} />)
            )}
          </div>
        )}
      </div>
    </main>
  );
}
