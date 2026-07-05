"use client";
import { useState } from "react";
import { generateMethods, listMethodsTemplates, MethodsGenResult } from "@/lib/api";

export default function MethodsGenPage() {
  const [runIds, setRunIds] = useState("");
  const [template, setTemplate] = useState("nature");
  const [expType, setExpType] = useState("variational");
  const [result, setResult] = useState<MethodsGenResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"methods" | "calibration" | "bibtex" | "checklist">("methods");
  const [copied, setCopied] = useState(false);

  async function generate() {
    const ids = runIds.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!ids.length) { setError("Enter at least one run ID"); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await generateMethods({ run_ids: ids, template, experiment_type: expType, include_calibration_table: true, cite_qiskit: true });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ padding: 24, maxWidth: 896, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Methods Section Generator</h1>
      <p style={{ color: "var(--muted)" }}>Auto-generate publication-ready methods sections from your experiment runs, formatted for Nature, PRL, arXiv, and more.</p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Journal Template</label>
            <select value={template} onChange={e => setTemplate(e.target.value)}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }}>
              {["nature", "prl", "arxiv", "thesis", "science"].map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Experiment Type</label>
            <select value={expType} onChange={e => setExpType(e.target.value)}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }}>
              {["variational", "sensing", "error_correction", "benchmarking", "simulation"].map(t => (
                <option key={t} value={t}>{t.replace("_", " ")}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Run IDs (one per line or comma-separated)</label>
          <textarea value={runIds} onChange={e => setRunIds(e.target.value)} placeholder="run_abc123&#10;run_def456"
            style={{ width: "100%", height: 96, marginTop: 4, background: "var(--surface)", color: "var(--text)", fontFamily: "ui-monospace,monospace", fontSize: 13, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", display: "block", boxSizing: "border-box" }} />
        </div>
        <button onClick={generate} disabled={loading}
          style={{ padding: "8px 24px", background: "var(--strong)", borderRadius: 6, fontWeight: 500, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer", border: "none", color: "var(--text)", alignSelf: "flex-start" }}>
          {loading ? "Generating..." : "Generate Methods Section"}
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ background: "var(--surface)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
            {(["methods", "calibration", "bibtex", "checklist"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{
                  padding: "12px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  background: "none",
                  border: "none",
                  borderBottom: tab === t ? "2px solid var(--strong)" : "2px solid transparent",
                  color: tab === t ? "var(--strong)" : "var(--muted)",
                  cursor: "pointer",
                }}>
                {t === "methods" ? "Methods" : t === "calibration" ? "Calibration Table" : t === "bibtex" ? "BibTeX" : "Checklist"}
              </button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", padding: "0 16px" }}>
              <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 12 }}>{result.word_count} words</span>
              <button onClick={() => copy(tab === "methods" ? result.methods_text : tab === "calibration" ? result.calibration_table_md : tab === "bibtex" ? result.bibtex : (result.reproducibility_checklist ?? []).map(c => `[${c.done ? "x" : " "}] ${c.item}`).join("\n"))}
                style={{ padding: "4px 12px", background: "var(--line)", borderRadius: 6, fontSize: 12, border: "none", color: "var(--text)", cursor: "pointer" }}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            {tab === "methods" && <pre style={{ fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", fontFamily: "Georgia, serif", lineHeight: 1.6 }}>{result.methods_text}</pre>}
            {tab === "calibration" && <pre style={{ fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", fontFamily: "ui-monospace,monospace" }}>{result.calibration_table_md}</pre>}
            {tab === "bibtex" && <pre style={{ fontSize: 12, color: "var(--ok)", whiteSpace: "pre-wrap", fontFamily: "ui-monospace,monospace" }}>{result.bibtex}</pre>}
            {tab === "checklist" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(result.reproducibility_checklist ?? []).map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 16,
                      height: 16,
                      borderRadius: 6,
                      border: item.done ? "1px solid var(--ok)" : "1px solid var(--line)",
                      background: item.done ? "rgba(16,185,129,0.1)" : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {item.done && <span style={{ color: "var(--ok)", fontSize: 12 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 13, color: item.done ? "var(--text)" : "var(--muted)" }}>{item.item}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
