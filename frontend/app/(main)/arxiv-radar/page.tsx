"use client";
import { useState, useEffect } from "react";
import { createArxivWatch, searchArxivRadar, getArxivAlerts, listArxivWatches, ArxivRadarWatch, ArxivRadarAlert, ArxivRadarPaper } from "../../../lib/api";

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
      setWatches(w?.watches ?? []);
      setAlerts(a?.alerts ?? []);
      setPapers(p?.results ?? []);
    } catch { /* ignore */ }
  }

  async function createWatch() {
    setLoading(true);
    try {
      await createArxivWatch({
        name: watchName,
        keywords: keywords.split(",").map(k => k.trim()),
        categories: ["quant-ph"],
        alert_on_contradiction: true,
        alert_on_confirmation: true,
        min_relevance: minRelevance,
      });
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
      setPapers(r?.results ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  const alertBgColor: Record<string, string> = {
    contradiction: "rgba(239,68,68,0.1)",
    confirmation: "rgba(16,185,129,0.1)",
    citation: "var(--info-bg)",
  };
  const alertTextColor: Record<string, string> = {
    contradiction: "var(--danger)",
    confirmation: "var(--ok)",
    citation: "var(--info-text)",
  };

  return (
    <main className="page">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>arXiv Radar</h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", maxWidth: 600 }}>
            Monitor new papers in your research area. Get alerts when a paper contradicts your hypothesis, confirms your result, or cites your experiment.
          </p>
        </div>
        <button onClick={() => setShowCreate(v => !v)} className={showCreate ? "button secondary" : "button"} style={{ flexShrink: 0 }}>
          {showCreate ? "Cancel" : "+ Create Watch"}
        </button>
      </div>

      {/* Create Watch Form */}
      {showCreate && (
        <div className="panel" style={{ margin: 0 }}>
          <div className="panel-header"><h2>New Watch</h2></div>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Watch Name</label>
                <input value={watchName} onChange={e => setWatchName(e.target.value)} className="input" style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  Min Relevance: {minRelevance.toFixed(1)}
                </label>
                <input type="range" min={0.3} max={0.99} step={0.05} value={minRelevance}
                  onChange={e => setMinRelevance(Number(e.target.value))} style={{ width: "100%", marginTop: 8 }} />
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Keywords (comma-separated)</label>
              <input value={keywords} onChange={e => setKeywords(e.target.value)} className="input" style={{ width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => void createWatch()} disabled={loading} className="button" style={{ fontSize: 13 }}>
                {loading ? "Creating…" : "Create"}
              </button>
              <button onClick={() => setShowCreate(false)} className="button secondary" style={{ fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Alerts</span>
            <span style={{ background: "var(--danger)", color: "#fff", fontSize: 11, borderRadius: 999, padding: "0 6px", fontWeight: 700 }}>{alerts.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
            {alerts.slice(0, 4).map(a => (
              <div key={a.alert_id} style={{
                background: alertBgColor[a.alert_type] ?? "var(--surface)",
                border: `1px solid ${alertTextColor[a.alert_type] ?? "var(--line)"}`,
                borderRadius: 10, padding: "12px 14px",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: alertTextColor[a.alert_type] ?? "var(--muted)", textTransform: "uppercase" }}>{a.alert_type}</span>
                  <span style={{ fontSize: 11, fontFamily: "ui-monospace,monospace", color: "var(--muted)" }}>score: {a.relevance_score.toFixed(2)}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{a.paper_title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{a.summary}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>{a.action_recommended}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && void search()}
          placeholder="Search papers (leave blank for topic feed)…"
          className="input" style={{ flex: 1, minWidth: 200 }} />
        <input value={keywords} onChange={e => setKeywords(e.target.value)}
          placeholder="keywords, comma-separated"
          className="input" style={{ width: 220 }} />
        <button onClick={() => void search()} disabled={loading} className="button" style={{ flexShrink: 0 }}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {/* Main content: papers + watches sidebar */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 20, alignItems: "start" }}>
        {/* Papers list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Papers ({papers.length})
          </div>
          {papers.map(p => {
            const isOpen = selectedPaper?.arxiv_id === p.arxiv_id;
            return (
              <div key={p.arxiv_id}
                onClick={() => setSelectedPaper(isOpen ? null : p)}
                style={{
                  background: "var(--surface)",
                  border: `1px solid ${isOpen ? "var(--strong)" : "var(--line)"}`,
                  borderRadius: 10, padding: "14px 16px",
                  cursor: "pointer", display: "flex", flexDirection: "column", gap: 8,
                }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.4, marginBottom: 4 }}>{p.title}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {(p.authors ?? []).slice(0, 3).join(", ")}{(p.authors ?? []).length > 3 ? " et al." : ""} · {p.submitted}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: "var(--info-text)", fontWeight: 600 }}>
                      {(p.relevance_score * 100).toFixed(0)}%
                    </span>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {p.confirms_hypothesis && <span style={{ fontSize: 10, background: "rgba(16,185,129,0.15)", color: "var(--ok)", padding: "1px 5px", borderRadius: 4 }}>confirms</span>}
                      {p.contradicts_hypothesis && <span style={{ fontSize: 10, background: "rgba(239,68,68,0.15)", color: "var(--danger)", padding: "1px 5px", borderRadius: 4 }}>contradicts</span>}
                      {p.cites_qlab_experiment && <span style={{ fontSize: 10, background: "var(--info-bg)", color: "var(--info-text)", padding: "1px 5px", borderRadius: 4 }}>cites you</span>}
                      {p.circuit_available && <span style={{ fontSize: 10, background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--line)", padding: "1px 5px", borderRadius: 4 }}>circuit</span>}
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>{p.abstract}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 11, color: "var(--muted)" }}>
                      {p.doi && <span>{p.doi}</span>}
                      <span>{p.citations} citations</span>
                      {(p.keywords ?? []).map(k => (
                        <span key={k} style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--muted)", padding: "1px 6px", borderRadius: 999 }}>{k}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Watches sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Watches</div>
          {watches.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>No watches yet. Create one above.</div>
          ) : watches.map(w => (
            <div key={w.watch_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{w.name}</span>
                <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: w.active ? "var(--ok)" : "var(--line)" }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{(w.keywords ?? []).slice(0, 4).join(", ")}</div>
              {w.alert_count > 0 && (
                <div style={{ fontSize: 11, color: "var(--danger)" }}>{w.alert_count} alert{w.alert_count !== 1 ? "s" : ""}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
