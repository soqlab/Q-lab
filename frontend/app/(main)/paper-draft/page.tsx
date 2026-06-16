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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Paper Draft Generator</h1>
      <p className="text-gray-400">Generate a full research paper draft — abstract, introduction, results, methods, LaTeX source, and BibTeX — from your Q-Lab experiment data.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-sm text-gray-400">Paper Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Algorithm / Experiment Type</label>
            <input value={algorithm} onChange={e => setAlgorithm(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Backend</label>
            <input value={backend} onChange={e => setBackend(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Qubits</label>
            <input type="number" value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Target Journal</label>
            <select value={journal} onChange={e => setJournal(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {["Physical Review Letters", "Nature Physics", "npj Quantum Information", "PRX Quantum", "Quantum", "arXiv"].map(j => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Key Metric</label>
            <select value={keyMetric} onChange={e => setKeyMetric(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {["fidelity", "energy", "approximation_ratio", "error_rate"].map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Key Value</label>
            <input type="number" step="any" value={keyValue} onChange={e => setKeyValue(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white font-mono px-3 py-2 rounded border border-gray-700" />
          </div>
          <div className="col-span-2">
            <label className="text-sm text-gray-400">Run IDs (comma-separated, optional)</label>
            <input value={runIds} onChange={e => setRunIds(e.target.value)} placeholder="run-abc123, run-def456"
              className="w-full mt-1 bg-gray-800 text-white font-mono text-sm px-3 py-2 rounded border border-gray-700" />
          </div>
        </div>
        <button onClick={draft} disabled={loading || !title}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Drafting paper..." : "Generate Full Draft"}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {([
              ["Word Count", result.word_count.toLocaleString(), "text-white"],
              ["Est. Pages", `~${result.estimated_pages}`, "text-gray-300"],
              ["Figures", String(result.figures.length), "text-purple-400"],
              ["Novelty", `${(result.novelty_score * 100).toFixed(0)}%`, "text-indigo-400"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} className="bg-gray-900 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500 mb-1">{l}</div>
                <div className={`text-xl font-mono font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          {result.suggested_journals && result.suggested_journals.length > 0 && (
            <div className="bg-gray-900 rounded-lg p-4 flex gap-3 items-center">
              <span className="text-sm text-gray-400">Suggested journals:</span>
              {result.suggested_journals.map(j => <span key={j} className="text-sm text-indigo-300 bg-indigo-900/30 px-2 py-0.5 rounded">{j}</span>)}
              <span className="ml-auto text-sm text-gray-400">{result.impact_estimate}</span>
            </div>
          )}

          {result.checklist && result.checklist.length > 0 && (
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="font-semibold text-sm mb-3">Submission Checklist</h2>
              <div className="grid grid-cols-2 gap-2">
                {result.checklist.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={c.done ? "text-green-400" : "text-gray-500"}>{c.done ? "✓" : "○"}</span>
                    <span className={c.done ? "text-gray-300" : "text-gray-500"}>{c.item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-900 rounded-lg overflow-hidden">
            <div className="flex border-b border-gray-700">
              {TABS.map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-2.5 text-sm capitalize transition-colors ${tab === t ? "bg-gray-800 text-white border-b-2 border-indigo-500" : "text-gray-400 hover:text-gray-200"}`}>
                  {t}
                </button>
              ))}
              <div className="flex-1" />
              <button onClick={copy} className="px-4 py-2 text-xs text-gray-400 hover:text-white">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="p-5 text-sm text-gray-200 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto font-mono">
              {getContent(tab)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
