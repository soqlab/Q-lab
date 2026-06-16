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
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Methods Section Generator</h1>
      <p className="text-gray-400">Auto-generate publication-ready methods sections from your experiment runs, formatted for Nature, PRL, arXiv, and more.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400">Journal Template</label>
            <select value={template} onChange={e => setTemplate(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {["nature", "prl", "arxiv", "thesis", "science"].map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Experiment Type</label>
            <select value={expType} onChange={e => setExpType(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {["variational", "sensing", "error_correction", "benchmarking", "simulation"].map(t => (
                <option key={t} value={t}>{t.replace("_", " ")}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm text-gray-400">Run IDs (one per line or comma-separated)</label>
          <textarea value={runIds} onChange={e => setRunIds(e.target.value)} placeholder="run_abc123&#10;run_def456"
            className="w-full h-24 mt-1 bg-gray-800 text-white font-mono text-sm px-3 py-2 rounded border border-gray-700" />
        </div>
        <button onClick={generate} disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Generating..." : "Generate Methods Section"}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="bg-gray-900 rounded-lg overflow-hidden">
          <div className="flex border-b border-gray-700">
            {(["methods", "calibration", "bibtex", "checklist"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-medium ${tab === t ? "border-b-2 border-indigo-500 text-indigo-400" : "text-gray-400 hover:text-white"}`}>
                {t === "methods" ? "Methods" : t === "calibration" ? "Calibration Table" : t === "bibtex" ? "BibTeX" : "Checklist"}
              </button>
            ))}
            <div className="ml-auto flex items-center px-4">
              <span className="text-xs text-gray-500 mr-3">{result.word_count} words</span>
              <button onClick={() => copy(tab === "methods" ? result.methods_text : tab === "calibration" ? result.calibration_table_md : tab === "bibtex" ? result.bibtex : result.reproducibility_checklist.map(c => `[${c.done ? "x" : " "}] ${c.item}`).join("\n"))}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div className="p-5">
            {tab === "methods" && <pre className="text-sm text-gray-200 whitespace-pre-wrap font-serif leading-relaxed">{result.methods_text}</pre>}
            {tab === "calibration" && <pre className="text-sm text-gray-200 whitespace-pre-wrap font-mono">{result.calibration_table_md}</pre>}
            {tab === "bibtex" && <pre className="text-xs text-green-400 whitespace-pre-wrap font-mono">{result.bibtex}</pre>}
            {tab === "checklist" && (
              <div className="space-y-2">
                {result.reproducibility_checklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${item.done ? "bg-green-600 border-green-500" : "border-gray-600"}`}>
                      {item.done && <span className="text-white text-xs">✓</span>}
                    </div>
                    <span className={`text-sm ${item.done ? "text-gray-300" : "text-gray-500"}`}>{item.item}</span>
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
