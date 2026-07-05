"use client";
import { useState } from "react";
import { generatePaperDraft, PaperDraft } from "@/lib/api";

const TABS = ["abstract", "introduction", "results", "methods", "latex", "bibtex"] as const;
type Tab = typeof TABS[number];

export default function PaperDraftPage() {
  const [title, setTitle] = useState("Heisenberg-Limited Phase Estimation via Adaptive VQE on 12 Qubits");
  const [keyMetric, setKeyMetric] = useState("fidelity");
  const [keyValue, setKeyValue] = useState(0.987);
  const [algorithm, setAlgorithm] = useState("VQE");
  const [backend, setBackend] = useState("ibm_brisbane");
  const [nQubits, setNQubits] = useState(12);
  const [runIds, setRunIds] = useState("");
  const [journal, setJournal] = useState("Physical Review Letters");
  const [result, setResult] = useState<PaperDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("abstract");
  const [copied, setCopied] = useState(false);

  async function draft() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await generatePaperDraft({ title, experiment_type: algorithm, backend, n_qubits: nQubits, run_ids: runIds ? runIds.split(",").map(s => s.trim()) : [], journal_target: journal, key_metric: keyMetric, key_value: keyValue });
      setResult(r);
      setTab("abstract");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  function getContent(t: Tab): string {
    if (!result) return "";
    switch (t) {
      case "abstract": return result.abstract_text;
      case "introduction": return result.introduction;
      case "results": return result.results;
      case "methods": return result.methods_section;
      case "latex": return result.latex_source;
      case "bibtex": return result.bibtex;
      default: return "";
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(getContent(tab));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Paper Draft Generator</h1>
      <p style={{ color: "var(--muted)" }}>Generate a full research paper draft — abstract, introduction, results, methods, LaTeX source, and BibTeX — from your Q-Lab experiment data.</p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ gridColumn: "span 2" }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Paper Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="input" style={{ display: "block", width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Algorithm / Experiment Type</label>
            <input value={algorithm} onChange={e => setAlgorithm(e.target.value)}
              className="input" style={{ display: "block", width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Backend</label>
            <input value={backend} onChange={e => setBackend(e.target.value)}
              className="input" style={{ display: "block", width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Qubits</label>
            <input type="number" value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              className="input" style={{ display: "block", width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Target Journal</label>
            <select value={journal} onChange={e => setJournal(e.target.value)}
              className="input" style={{ display: "block", width: "100%", marginTop: 4 }}>
              {["Physical Review Letters", "Nature Physics", "npj Quantum Information", "PRX Quantum", "Quantum", "arXiv"].map(j => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Key Metric</label>
            <select value={keyMetric} onChange={e => setKeyMetric(e.target.value)}
              className="input" style={{ display: "block", width: "100%", marginTop: 4 }}>
              {["fidelity", "energy", "approximation_ratio", "error_rate"].map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Key Value</label>
            <input type="number" step="any" value={keyValue} onChange={e => setKeyValue(Number(e.target.value))}
              className="input" style={{ display: "block", width: "100%", marginTop: 4, fontFamily: "ui-monospace,monospace" }} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Run IDs (comma-separated, optional)</label>
            <input value={runIds} onChange={e => setRunIds(e.target.value)} placeholder="run-abc123, run-def456"
              className="input" style={{ display: "block", width: "100%", marginTop: 4, fontFamily: "ui-monospace,monospace", fontSize: 13 }} />
          </div>
        </div>
        <button onClick={draft} disabled={loading || !title} className="button"
          style={{ opacity: (loading || !title) ? 0.5 : 1, cursor: (loading || !title) ? "not-allowed" : "pointer" }}>
          {loading ? "Drafting paper..." : "Generate Full Draft"}
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            {([
              ["Word Count", result.word_count.toLocaleString(), "var(--text)"],
              ["Est. Pages", `~${result.estimated_pages}`, "var(--text)"],
              ["Figures", String((result.figures ?? []).length), "#a78bfa"],
              ["Novelty", `${(result.novelty_score * 100).toFixed(0)}%`, "var(--strong)"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} style={{ background: "var(--surface)", borderRadius: 8, padding: 12, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 20, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: c }}>{v}</div>
              </div>
            ))}
          </div>

          {result.suggested_journals && result.suggested_journals.length > 0 && (
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Suggested journals:</span>
              {(result.suggested_journals ?? []).map(j => (
                <span key={j} style={{ fontSize: 13, color: "var(--strong)", background: "rgba(99,102,241,0.15)", padding: "2px 8px", borderRadius: 6 }}>{j}</span>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)" }}>{result.impact_estimate}</span>
            </div>
          )}

          {result.checklist && result.checklist.length > 0 && (
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Submission Checklist</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(result.checklist ?? []).map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ color: c.done ? "var(--ok)" : "var(--muted)" }}>{c.done ? "✓" : "○"}</span>
                    <span style={{ color: c.done ? "var(--text)" : "var(--muted)" }}>{c.item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: "var(--surface)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
              {TABS.map(t => (
                <button key={t} onClick={() => setTab(t)}
                  style={{
                    padding: "10px 16px",
                    fontSize: 13,
                    textTransform: "capitalize",
                    background: tab === t ? "var(--line)" : "transparent",
                    color: tab === t ? "var(--text)" : "var(--muted)",
                    border: "none",
                    borderBottom: tab === t ? "2px solid var(--strong)" : "2px solid transparent",
                    cursor: "pointer",
                  }}>
                  {t}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button onClick={copy} style={{ padding: "8px 16px", fontSize: 12, color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer" }}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre style={{ padding: 20, fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.6, maxHeight: 384, overflowY: "auto", fontFamily: "ui-monospace,monospace" }}>
              {getContent(tab)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
