"use client";

import { useState, useEffect, useCallback } from "react";
import {
  generateFAIRRecord,
  listFAIRRecords,
  FAIRRecord,
  FAIRScore,
} from "@/lib/api";

const BACKENDS = ["ibm_brisbane", "ibm_sherbrooke", "ibm_kyoto", "simulator", "ionq_aria", "quantinuum_h1"];

const METADATA_TABS = [
  { key: "ro_crate", label: "RO-Crate JSON" },
  { key: "datacite", label: "DataCite XML" },
  { key: "zenodo", label: "Zenodo Metadata JSON" },
] as const;

type MetadataTab = typeof METADATA_TABS[number]["key"];

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 80 ? "bg-emerald-500" : value >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-white">{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-700">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function CopyBadge({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-2 rounded-full border border-indigo-500 bg-indigo-950 px-4 py-1.5 font-mono text-sm text-indigo-300 hover:bg-indigo-900 transition-colors"
    >
      {text}
      <span className="text-xs text-indigo-400">{copied ? "Copied!" : "Click to copy"}</span>
    </button>
  );
}

function RecordResult({ record }: { record: FAIRRecord }) {
  const [activeTab, setActiveTab] = useState<MetadataTab>("ro_crate");
  const [copiedTab, setCopiedTab] = useState(false);

  const tabContent: Record<MetadataTab, string> = {
    ro_crate: JSON.stringify(record.ro_crate_json, null, 2),
    datacite: record.datacite_xml,
    zenodo: JSON.stringify(record.zenodo_metadata, null, 2),
  };

  const handleCopyTab = () => {
    navigator.clipboard.writeText(tabContent[activeTab]).then(() => {
      setCopiedTab(true);
      setTimeout(() => setCopiedTab(false), 2000);
    });
  };

  const score: FAIRScore = record.fair_score;

  return (
    <div className="space-y-6 rounded-xl border border-slate-700 bg-slate-800/60 p-6">
      {/* DOI */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">DOI</p>
        <CopyBadge text={record.doi} />
      </div>

      {/* Total score */}
      <div className="text-center">
        <p className="text-6xl font-black text-white">{score.total}</p>
        <p className="text-slate-400 text-sm mt-1">FAIR Total Score / 100</p>
      </div>

      {/* Score bars */}
      <div className="space-y-3">
        <ScoreBar label="Findable" value={score.findable} />
        <ScoreBar label="Accessible" value={score.accessible} />
        <ScoreBar label="Interoperable" value={score.interoperable} />
        <ScoreBar label="Reusable" value={score.reusable} />
      </div>

      {/* Checklist */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Checklist</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {record.checklist.map((item, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-slate-700/50 px-3 py-2">
              <span className={item.done ? "text-emerald-400 mt-0.5" : "text-slate-500 mt-0.5"}>
                {item.done ? "✓" : "○"}
              </span>
              <span className={`text-sm ${item.done ? "text-slate-200" : "text-slate-400"}`}>{item.item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Landing page */}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">Landing Page</p>
        <a
          href={record.landing_page_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 hover:text-indigo-300 underline text-sm break-all"
        >
          {record.landing_page_url}
        </a>
      </div>

      {/* Metadata tabs */}
      <div>
        <div className="flex gap-1 border-b border-slate-700 mb-4">
          {METADATA_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? "border-b-2 border-indigo-500 text-indigo-400"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <button
            onClick={handleCopyTab}
            className="absolute right-2 top-2 rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
          >
            {copiedTab ? "Copied!" : "Copy"}
          </button>
          <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-300 font-mono whitespace-pre-wrap break-words">
            {tabContent[activeTab]}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function FAIRDataPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [algorithm, setAlgorithm] = useState("");
  const [backend, setBackend] = useState(BACKENDS[0]);
  const [nQubits, setNQubits] = useState(5);
  const [nShots, setNShots] = useState(1024);
  const [fidelity, setFidelity] = useState("");
  const [runIds, setRunIds] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FAIRRecord | null>(null);

  const [pastRecords, setPastRecords] = useState<FAIRRecord[]>([]);
  const [pastLoading, setPastLoading] = useState(true);

  const loadPast = useCallback(async () => {
    setPastLoading(true);
    try {
      const data = await listFAIRRecords();
      setPastRecords(data.records);
    } catch {
      // non-blocking
    } finally {
      setPastLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPast();
  }, [loadPast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const req = {
        title,
        description,
        algorithm,
        backend,
        n_qubits: nQubits,
        n_shots: nShots,
        ...(fidelity !== "" ? { fidelity: parseFloat(fidelity) } : {}),
        ...(runIds.trim() !== ""
          ? { run_ids: runIds.split(",").map((s) => s.trim()).filter(Boolean) }
          : {}),
      };
      const rec = await generateFAIRRecord(req);
      setResult(rec);
      loadPast();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        <h1 className="mb-1 text-3xl font-black tracking-tight text-white">FAIR Data Compliance Engine</h1>
        <p className="mb-8 text-slate-400">
          Make your experiments Findable, Accessible, Interoperable, Reusable.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-700 bg-slate-800/60 p-6 mb-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Title *
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="Experiment title"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Algorithm *
              </label>
              <input
                required
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="e.g. VQE, QAOA"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
              Description *
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              placeholder="Describe the experiment..."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Backend *
              </label>
              <select
                value={backend}
                onChange={(e) => setBackend(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
              >
                {BACKENDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Qubits *
              </label>
              <input
                type="number"
                min={1}
                max={127}
                required
                value={nQubits}
                onChange={(e) => setNQubits(parseInt(e.target.value) || 1)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Shots *
              </label>
              <input
                type="number"
                min={1}
                required
                value={nShots}
                onChange={(e) => setNShots(parseInt(e.target.value) || 1024)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Fidelity (optional)
              </label>
              <input
                type="number"
                step="0.001"
                min={0}
                max={1}
                value={fidelity}
                onChange={(e) => setFidelity(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="0.0 – 1.0"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Run IDs (comma-separated, optional)
              </label>
              <input
                value={runIds}
                onChange={(e) => setRunIds(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="run-abc, run-def"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-700 bg-red-950/50 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {loading ? "Generating FAIR Record..." : "Generate FAIR Record"}
          </button>
        </form>

        {result && <RecordResult record={result} />}
      </div>

      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-slate-700 bg-slate-900 p-5 lg:block">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">Past Records</h2>
        {pastLoading ? (
          <p className="text-slate-500 text-sm">Loading...</p>
        ) : pastRecords.length === 0 ? (
          <p className="text-slate-500 text-sm">No records yet.</p>
        ) : (
          <div className="space-y-3">
            {pastRecords.map((r) => (
              <div
                key={r.record_id}
                className="rounded-lg border border-slate-700 bg-slate-800 p-3"
              >
                <p className="font-mono text-xs text-indigo-400 break-all mb-1">{r.doi}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">FAIR Score</span>
                  <span
                    className={`text-sm font-bold ${
                      r.fair_score.total >= 80
                        ? "text-emerald-400"
                        : r.fair_score.total >= 50
                        ? "text-yellow-400"
                        : "text-red-400"
                    }`}
                  >
                    {r.fair_score.total}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
