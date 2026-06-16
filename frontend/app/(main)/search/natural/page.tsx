"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { nlqSearch, NLQSearchResult, NLQResult, fulltextSearch, FulltextResult } from "../../../../lib/api";

const EXAMPLE_QUERIES = [
  "shallow 5-qubit QAOA circuit with few gates",
  "deep VQE chemistry circuit on IBM backend",
  "non-Clifford circuit with T gates",
  "hardware-efficient 10-qubit ansatz",
  "highly entangled 3-qubit circuit",
  "Clifford-only circuit with low noise",
];

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.75 ? "#22c55e" : score >= 0.55 ? "#6366f1" : score >= 0.35 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ height: 5, width: 80, borderRadius: 3, background: "#e5e7eb", flexShrink: 0 }}>
        <div style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
    </div>
  );
}

function FingerprintChips({ fp }: { fp: NLQResult["fingerprint_summary"] }) {
  const chips: string[] = [];
  if (fp.num_qubits != null) chips.push(`${fp.num_qubits}q`);
  if (fp.depth != null) chips.push(`d=${fp.depth}`);
  if (fp.size != null) chips.push(`${fp.size} gates`);
  if (fp.non_clifford_ratio != null) chips.push(`NC ${(fp.non_clifford_ratio * 100).toFixed(1)}%`);
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {chips.map((c) => (
        <span key={c} style={{ fontSize: 11, background: "#f3f4f6", color: "#374151", padding: "2px 7px", borderRadius: 10 }}>
          {c}
        </span>
      ))}
    </div>
  );
}

function ResultCard({ r, rank }: { r: NLQResult; rank: number }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 14,
      padding: "12px 16px", background: "#fff",
      border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 8,
    }}>
      <span style={{
        width: 24, height: 24, borderRadius: "50%", background: rank < 3 ? "#6366f1" : "#e5e7eb",
        color: rank < 3 ? "#fff" : "#6b7280", fontSize: 11, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {rank + 1}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Link href={`/runs/${r.run_id}`} style={{
            fontWeight: 700, fontSize: 14, color: "#1d6f8f", fontFamily: "monospace", textDecoration: "none",
          }}>
            {r.circuit_name !== r.run_id ? r.circuit_name : r.run_id.slice(0, 14)}
          </Link>
          {r.backend && (
            <span style={{ fontSize: 11, background: "#eff6ff", color: "#1e40af", padding: "2px 7px", borderRadius: 10 }}>
              {r.backend}
            </span>
          )}
          <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto" }}>
            {r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}
          </span>
        </div>
        <div style={{ marginBottom: 6 }}>
          <ScoreBar score={r.score} />
        </div>
        <FingerprintChips fp={r.fingerprint_summary} />
        {r.match_reasons.length > 0 && (
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
            Matched: {r.match_reasons.join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

function ParsedFeaturesBox({ feat }: { feat: Record<string, unknown> }) {
  const entries = Object.entries(feat).filter(([, v]) => v !== undefined && v !== null);
  if (!entries.length) return null;
  return (
    <div style={{
      fontSize: 12, padding: "8px 14px", borderRadius: 6,
      background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe",
      display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
    }}>
      <span style={{ fontWeight: 600 }}>Parsed:</span>
      {entries.map(([k, v]) => (
        <span key={k} style={{ background: "#dbeafe", borderRadius: 4, padding: "1px 6px" }}>
          {k.replace(/_/g, " ")}: <strong>{String(v)}</strong>
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Full-Text Search section components
// ------------------------------------------------------------------

function FTSResultTable({ results }: { results: FulltextResult[] }) {
  if (results.length === 0) {
    return (
      <div className="panel" style={{ padding: "32px", textAlign: "center", color: "#6b7280" }}>
        No results found. Try a different query or append <code>*</code> for prefix matching (e.g. <code>qaoa*</code>).
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
            {["Run ID", "Circuit Name", "Backend", "Project", "Status", "Date"].map((h) => (
              <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.run_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                <Link href={`/runs/${r.run_id}`} style={{ color: "#1d6f8f", textDecoration: "none", fontWeight: 600 }}>
                  {r.run_id.slice(0, 16)}&hellip;
                </Link>
              </td>
              <td style={{ padding: "8px 12px", color: "#111827" }}>{r.circuit_name ?? <em style={{ color: "#9ca3af" }}>—</em>}</td>
              <td style={{ padding: "8px 12px" }}>
                {r.backend ? (
                  <span style={{ fontSize: 11, background: "#eff6ff", color: "#1e40af", padding: "2px 7px", borderRadius: 10 }}>
                    {r.backend}
                  </span>
                ) : <em style={{ color: "#9ca3af" }}>—</em>}
              </td>
              <td style={{ padding: "8px 12px", color: "#374151" }}>{r.project_slug ?? <em style={{ color: "#9ca3af" }}>—</em>}</td>
              <td style={{ padding: "8px 12px" }}>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 600,
                  background: r.status === "completed" ? "#dcfce7" : r.status === "failed" ? "#fee2e2" : "#fef9c3",
                  color: r.status === "completed" ? "#166534" : r.status === "failed" ? "#991b1b" : "#854d0e",
                }}>
                  {r.status}
                </span>
              </td>
              <td style={{ padding: "8px 12px", color: "#6b7280", whiteSpace: "nowrap" }}>
                {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FullTextSearchPanel() {
  const [ftsQuery, setFtsQuery] = useState("");
  const [ftsLimit, setFtsLimit] = useState(20);
  const [ftsData, setFtsData] = useState<{ results: FulltextResult[]; total: number; query: string } | null>(null);
  const [ftsLoading, setFtsLoading] = useState(false);
  const [ftsError, setFtsError] = useState("");

  async function ftsSearch() {
    const q = ftsQuery.trim();
    if (!q) return;
    setFtsLoading(true);
    setFtsError("");
    setFtsData(null);
    try {
      const res = await fulltextSearch(q, ftsLimit);
      setFtsData(res);
    } catch (e) {
      setFtsError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setFtsLoading(false);
    }
  }

  return (
    <>
      <div style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
          Powered by SQLite FTS5. Append <code style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>*</code> for prefix matching (e.g. <code style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>qaoa*</code>).
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <input
            className="input"
            value={ftsQuery}
            onChange={(e) => setFtsQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void ftsSearch(); }}
            placeholder="e.g. ibm_nairobi, qaoa, my-project"
            style={{ flex: 1, fontSize: 14 }}
          />
          <select
            className="input"
            value={ftsLimit}
            onChange={(e) => setFtsLimit(Number(e.target.value))}
            style={{ width: 90, fontSize: 13 }}
          >
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100</option>
          </select>
          <button
            className="button"
            onClick={() => void ftsSearch()}
            disabled={ftsLoading || !ftsQuery.trim()}
            style={{ flexShrink: 0, minWidth: 90 }}
          >
            {ftsLoading ? "Searching…" : "Search"}
          </button>
        </div>
      </div>

      {ftsError && (
        <div style={{ padding: "10px 18px", background: "#fef2f2", color: "#991b1b", fontSize: 13, margin: "0 18px 12px", borderRadius: 6 }}>
          {ftsError}
        </div>
      )}

      {ftsData && (
        <div style={{ padding: "0 0 4px" }}>
          <div style={{ fontSize: 13, color: "#6b7280", padding: "0 18px 10px" }}>
            {ftsData.total} result{ftsData.total !== 1 ? "s" : ""} for &ldquo;{ftsData.query}&rdquo;
          </div>
          <FTSResultTable results={ftsData.results} />
        </div>
      )}

      {!ftsData && !ftsLoading && !ftsError && (
        <div style={{ padding: "36px 24px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
          Enter a term above to search run IDs, circuit names, backends, and project slugs.
        </div>
      )}
    </>
  );
}

export default function NLQSearchPage() {
  const [activeTab, setActiveTab] = useState<"nlq" | "fts">("nlq");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(10);
  const [data, setData] = useState<NLQSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function search(q?: string) {
    const qr = (q ?? query).trim();
    if (!qr) return;
    setQuery(qr);
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await nlqSearch(qr, limit);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 18px",
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    color: active ? "#6366f1" : "#6b7280",
    borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
    background: "none",
    border: "none",
    cursor: "pointer",
  });

  return (
    <main className="page">
      <section className="panel">
        <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", padding: "0 8px" }}>
          <button style={tabStyle(activeTab === "nlq")} onClick={() => setActiveTab("nlq")}>
            Natural Language Search
          </button>
          <button style={tabStyle(activeTab === "fts")} onClick={() => setActiveTab("fts")}>
            Full-Text Search
          </button>
        </div>

        {activeTab === "nlq" && (
          <>
            <div className="panel-header" style={{ borderTop: "none" }}>
              <h2>Natural Language Circuit Retrieval</h2>
              <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 8 }}>
                Describe a circuit in plain English
              </span>
            </div>

            <div style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <input
                  ref={inputRef}
                  className="input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
                  placeholder="e.g. shallow 5-qubit QAOA circuit with few gates"
                  style={{ flex: 1, fontSize: 14 }}
                />
                <select
                  className="input"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  style={{ width: 90, fontSize: 13 }}
                >
                  <option value={5}>Top 5</option>
                  <option value={10}>Top 10</option>
                  <option value={20}>Top 20</option>
                  <option value={50}>Top 50</option>
                </select>
                <button
                  className="button"
                  onClick={() => void search()}
                  disabled={loading || !query.trim()}
                  style={{ flexShrink: 0, minWidth: 90 }}
                >
                  {loading ? "Searching…" : "Search"}
                </button>
              </div>

              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Try an example:</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {EXAMPLE_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => void search(q)}
                    style={{
                      fontSize: 12, padding: "4px 10px", border: "1px solid #d1d5db",
                      borderRadius: 16, background: "#f9fafb", cursor: "pointer", color: "#374151",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === "fts" && (
          <>
            <div className="panel-header" style={{ borderTop: "none" }}>
              <h2>Full-Text Search</h2>
              <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 8 }}>
                Fast keyword search across run IDs, circuit names, backends, and projects
              </span>
            </div>
            <FullTextSearchPanel />
          </>
        )}
      </section>

      {activeTab === "nlq" && (
        <>
          {error && (
            <div className="panel" style={{ padding: "12px 18px", background: "#fef2f2", color: "#991b1b", fontSize: 13 }}>
              {error}
            </div>
          )}

          {data && (
            <>
              <div style={{ padding: "4px 0 10px" }}>
                <ParsedFeaturesBox feat={data.parsed_features} />
              </div>

              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>
                {data.results.length} results from {data.total_searched} circuits
              </div>

              {data.results.length === 0 ? (
                <div className="panel" style={{ padding: "32px", textAlign: "center", color: "#6b7280" }}>
                  No matching circuits found. Try a different query or check that you have runs in the database.
                </div>
              ) : (
                data.results.map((r, i) => <ResultCard key={r.run_id} r={r} rank={i} />)
              )}
            </>
          )}

          {!data && !loading && !error && (
            <div className="panel" style={{ padding: "48px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Search your circuits in plain English</div>
              <div style={{ fontSize: 13, color: "#6b7280", maxWidth: 520, margin: "0 auto", lineHeight: 1.65 }}>
                Describe what you&apos;re looking for — qubit count, circuit family, depth, gate types, noise level, backend — and
                Q-Lab ranks your stored experiments by relevance using fingerprint cosine similarity.
              </div>
              <div style={{ marginTop: 16, fontSize: 12, color: "#9ca3af", maxWidth: 480, margin: "16px auto 0" }}>
                No LLM required. Keywords are mapped to fingerprint dimensions and scored against all stored runs.
                Supports: qubit count, depth, gate count, QAOA/VQE/hardware-efficient families, T-count, backend name, and noise preference.
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
