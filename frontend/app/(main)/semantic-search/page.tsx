"use client";
import { useEffect, useState } from "react";
import { CircuitSearchResult, CircuitEmbedEntry, searchCircuits, listIndexedCircuits, indexCircuit } from "../../../lib/api";
import { Search, Database, Plus } from "lucide-react";

const PRESET_QUERY = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

const PRESET_INDEX = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[1],q[2];
t q[0];
measure q -> c;`;

function SimilarityBadge({ sim }: { sim: number }) {
  const color = sim > 0.85 ? "#10b981" : sim > 0.65 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ background: color + "22", color, fontWeight: 700, fontSize: "0.78rem", padding: "2px 8px", borderRadius: 99, border: `1px solid ${color}40` }}>
      {(sim * 100).toFixed(1)}%
    </div>
  );
}

export default function SemanticSearchPage() {
  const [queryQasm, setQueryQasm] = useState(PRESET_QUERY);
  const [indexQasm, setIndexQasm] = useState(PRESET_INDEX);
  const [indexName, setIndexName] = useState("GHZ Chain");
  const [minSim, setMinSim] = useState(0.4);
  const [results, setResults] = useState<CircuitSearchResult[] | null>(null);
  const [indexed, setIndexed] = useState<CircuitEmbedEntry[]>([]);
  const [queryDesc, setQueryDesc] = useState("");
  const [totalIndexed, setTotalIndexed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listIndexedCircuits().then(items => { setIndexed(items); setTotalIndexed(items.length); }).catch(() => {});
  }, []);

  const search = async () => {
    setLoading(true); setError(null);
    try {
      const r = await searchCircuits({ query_qasm: queryQasm, min_similarity: minSim });
      setResults(r.results);
      setQueryDesc(r.query_description);
      setTotalIndexed(r.total_indexed);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const addToIndex = async () => {
    setIndexing(true); setError(null);
    try {
      await indexCircuit({ qasm: indexQasm, circuit_name: indexName });
      const items = await listIndexedCircuits();
      setIndexed(items); setTotalIndexed(items.length);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setIndexing(false); }
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Search size={28} color="#f59e0b" /> Quantum Circuit Semantic Search
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Vector embeddings of circuit structure (gate distributions, entanglement density, qubit count).
          Find structurally similar circuits by cosine similarity — not by name or metadata.
        </p>
      </div>
      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: 6 }}>
              <Search size={14} color="#f59e0b" /> Query Circuit
            </h3>
            <textarea value={queryQasm} onChange={e => setQueryQasm(e.target.value)} rows={8}
              style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box", resize: "vertical", marginBottom: 10 }} />
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 12 }}>
              Min similarity: <span style={{ color: "#f59e0b", fontWeight: 700 }}>{(minSim * 100).toFixed(0)}%</span>
              <input type="range" min={0} max={100} step={5} value={minSim * 100} onChange={e => setMinSim(Number(e.target.value) / 100)}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#f59e0b" }} />
            </label>
            <button onClick={search} disabled={loading}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#f59e0b", color: "#0f172a", border: "none", borderRadius: 8, padding: "0.65rem", cursor: "pointer", fontWeight: 700, opacity: loading ? 0.6 : 1 }}>
              <Search size={14} /> {loading ? "Searching…" : "Search Similar Circuits"}
            </button>
          </div>

          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: 6 }}>
              <Plus size={14} color="#10b981" /> Add to Index
            </h3>
            <input value={indexName} onChange={e => setIndexName(e.target.value)} placeholder="Circuit name"
              style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.4rem 0.6rem", fontSize: "0.82rem", boxSizing: "border-box", marginBottom: 8 }} />
            <textarea value={indexQasm} onChange={e => setIndexQasm(e.target.value)} rows={5}
              style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.72rem", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }} />
            <button onClick={addToIndex} disabled={indexing}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#10b981", color: "#fff", border: "none", borderRadius: 8, padding: "0.55rem", cursor: "pointer", fontWeight: 600, opacity: indexing ? 0.6 : 1, fontSize: "0.85rem" }}>
              <Database size={13} /> {indexing ? "Indexing…" : `Index Circuit (${totalIndexed} indexed)`}
            </button>
          </div>
        </div>

        <div>
          {results !== null ? (
            <div>
              {queryDesc && (
                <div style={{ background: "#1e293b", borderRadius: 8, border: "1px solid #334155", padding: "0.6rem 1rem", marginBottom: "1rem", color: "#94a3b8", fontSize: "0.82rem" }}>
                  Query: <span style={{ color: "#f59e0b" }}>{queryDesc}</span> · {totalIndexed} circuits in index
                </div>
              )}
              {results.length === 0 ? (
                <div style={{ textAlign: "center", color: "#475569", padding: "3rem" }}>
                  <Search size={40} style={{ opacity: 0.12, marginBottom: 10 }} />
                  <p>No circuits found above {(minSim * 100).toFixed(0)}% similarity. Try lowering the threshold.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {results.map(r => (
                    <div key={r.embed_id} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.9rem 1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.9rem" }}>{r.circuit_name}</span>
                            {r.tags.map(t => (
                              <span key={t} style={{ background: "#334155", color: "#94a3b8", fontSize: "0.65rem", padding: "1px 5px", borderRadius: 4 }}>{t}</span>
                            ))}
                          </div>
                          <div style={{ color: "#64748b", fontSize: "0.78rem", marginBottom: 4 }}>{r.description}</div>
                          {r.run_id && <div style={{ color: "#475569", fontSize: "0.72rem", fontFamily: "monospace" }}>run: {r.run_id}</div>}
                        </div>
                        <SimilarityBadge sim={r.similarity} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem", marginBottom: "1rem" }}>
                <h3 style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>
                  <Database size={13} style={{ display: "inline", marginRight: 6 }} />
                  Indexed Circuits ({indexed.length})
                </h3>
                {indexed.length === 0 ? (
                  <p style={{ color: "#475569", fontSize: "0.82rem" }}>Index is empty. Search will auto-seed with demo circuits.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {indexed.slice(0, 10).map(e => (
                      <div key={e.embed_id} style={{ color: "#94a3b8", fontSize: "0.8rem", padding: "0.35rem 0", borderBottom: "1px solid #1e293b" }}>
                        <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{e.circuit_name}</span> — {e.description}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, color: "#475569" }}>
                <Search size={40} style={{ opacity: 0.12, marginBottom: 10 }} />
                <p>Search a circuit to find structurally similar ones by vector cosine similarity.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
