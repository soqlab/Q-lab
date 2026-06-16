"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listQMLDatasetHub,
  getQMLDatasetEntry,
  uploadQMLDataset,
  benchmarkQMLDataset,
  getQMLDatasetBenchmarks,
  QMLDatasetEntry,
  QMLBenchmarkRun,
} from "@/lib/api";

const taskBadge: Record<string, string> = {
  classification: "bg-blue-900/40 text-blue-400 border border-blue-800",
  regression: "bg-purple-900/40 text-purple-400 border border-purple-800",
  generation: "bg-green-900/40 text-green-400 border border-green-800",
  reinforcement: "bg-orange-900/40 text-orange-400 border border-orange-800",
};

const MODEL_TYPES = ["vqc", "qnn", "hybrid_cnn", "classical_baseline"];
const OPTIMIZERS = ["adam", "sgd", "adagrad"];
const ENCODINGS = ["amplitude", "angle", "basis"];
const TASKS = ["classification", "regression", "generation", "reinforcement"];

export default function QMLDatasetsPage() {
  const [datasets, setDatasets] = useState<QMLDatasetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedDataset, setSelectedDataset] = useState<QMLDatasetEntry | null>(null);
  const [benchmarkPanel, setBenchmarkPanel] = useState<string | null>(null); // dataset_id
  const [benchModelType, setBenchModelType] = useState("vqc");
  const [benchNParams, setBenchNParams] = useState(100);
  const [benchOptimizer, setBenchOptimizer] = useState("adam");
  const [benchRunning, setBenchRunning] = useState(false);
  const [benchResult, setBenchResult] = useState<QMLBenchmarkRun | null>(null);
  const [benchError, setBenchError] = useState<string | null>(null);

  const [leaderboard, setLeaderboard] = useState<QMLBenchmarkRun[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  // Upload form
  const [showUpload, setShowUpload] = useState(false);
  const [upName, setUpName] = useState("");
  const [upDesc, setUpDesc] = useState("");
  const [upTask, setUpTask] = useState("classification");
  const [upNSamples, setUpNSamples] = useState(1000);
  const [upNFeatures, setUpNFeatures] = useState(16);
  const [upNQubits, setUpNQubits] = useState(4);
  const [upEncoding, setUpEncoding] = useState("amplitude");
  const [upLicense, setUpLicense] = useState("MIT");
  const [upAuthors, setUpAuthors] = useState("");
  const [upDOI, setUpDOI] = useState("");
  const [upTags, setUpTags] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listQMLDatasetHub();
      setDatasets(data);
    } catch {
      setError("Failed to load datasets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  const handleBenchmarkOpen = async (dataset: QMLDatasetEntry) => {
    setSelectedDataset(dataset);
    setBenchmarkPanel(dataset.dataset_id);
    setBenchResult(null);
    setBenchError(null);
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    try {
      const runs = await getQMLDatasetBenchmarks(dataset.dataset_id);
      const sorted = [...runs].sort((a, b) => b.accuracy - a.accuracy);
      setLeaderboard(sorted);
    } catch {
      setLeaderboardError("Failed to load benchmarks.");
    } finally {
      setLeaderboardLoading(false);
    }
  };

  const handleRunBenchmark = async () => {
    if (!benchmarkPanel) return;
    setBenchRunning(true);
    setBenchError(null);
    setBenchResult(null);
    try {
      const result = await benchmarkQMLDataset({
        dataset_id: benchmarkPanel,
        model_type: benchModelType,
        n_params: benchNParams,
        optimizer: benchOptimizer,
      });
      setBenchResult(result);
      // Refresh leaderboard
      const runs = await getQMLDatasetBenchmarks(benchmarkPanel);
      setLeaderboard([...runs].sort((a, b) => b.accuracy - a.accuracy));
    } catch (e: unknown) {
      setBenchError(e instanceof Error ? e.message : "Benchmark failed.");
    } finally {
      setBenchRunning(false);
    }
  };

  const handleUpload = async () => {
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(false);
    try {
      await uploadQMLDataset({
        name: upName,
        description: upDesc,
        task: upTask,
        n_samples: upNSamples,
        n_features: upNFeatures,
        n_qubits: upNQubits,
        encoding: upEncoding,
        license: upLicense,
        authors: upAuthors ? upAuthors.split(",").map((s) => s.trim()) : [],
        paper_doi: upDOI || undefined,
        tags: upTags ? upTags.split(",").map((s) => s.trim()) : [],
      });
      setUploadSuccess(true);
      setShowUpload(false);
      setUpName(""); setUpDesc(""); setUpAuthors(""); setUpDOI(""); setUpTags("");
      loadDatasets();
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">QML Dataset Hub</h1>
          <p className="text-gray-400 mt-1 text-sm">Curated quantum machine learning datasets with benchmarking</p>
        </div>
        <button
          onClick={() => setShowUpload((v) => !v)}
          className="bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        >
          {showUpload ? "Cancel" : "Upload Dataset"}
        </button>
      </div>

      {/* Upload Form */}
      {showUpload && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-indigo-400">Upload New Dataset</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Name</label>
              <input type="text" value={upName} onChange={(e) => setUpName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Task</label>
              <select value={upTask} onChange={(e) => setUpTask(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                {TASKS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Samples</label>
              <input type="number" min={1} value={upNSamples} onChange={(e) => setUpNSamples(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Features</label>
              <input type="number" min={1} value={upNFeatures} onChange={(e) => setUpNFeatures(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Qubits</label>
              <input type="number" min={1} value={upNQubits} onChange={(e) => setUpNQubits(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Encoding</label>
              <select value={upEncoding} onChange={(e) => setUpEncoding(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                {ENCODINGS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">License</label>
              <input type="text" value={upLicense} onChange={(e) => setUpLicense(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Authors (comma-sep)</label>
              <input type="text" value={upAuthors} onChange={(e) => setUpAuthors(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Paper DOI</label>
              <input type="text" value={upDOI} onChange={(e) => setUpDOI(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Tags (comma-sep)</label>
              <input type="text" value={upTags} onChange={(e) => setUpTags(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea value={upDesc} onChange={(e) => setUpDesc(e.target.value)} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
          </div>
          {uploadError && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{uploadError}</div>}
          <button onClick={handleUpload} disabled={uploading || !upName || !upDesc} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-4 py-2 text-sm font-medium transition-colors">
            {uploading ? "Uploading…" : "Upload Dataset"}
          </button>
        </div>
      )}

      {/* Dataset Grid */}
      {loading ? (
        <div className="text-sm text-gray-400 animate-pulse">Loading datasets…</div>
      ) : error ? (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</div>
      ) : datasets.length === 0 ? (
        <div className="text-sm text-gray-500">No datasets available.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {datasets.map((ds) => (
            <div key={ds.dataset_id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-sm leading-tight">{ds.name}</p>
                <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${taskBadge[ds.task] ?? "bg-gray-700 text-gray-400"}`}>{ds.task}</span>
              </div>

              <div className="grid grid-cols-2 gap-1 text-xs">
                <span className="text-gray-400">Samples: <span className="text-gray-200">{ds.n_samples.toLocaleString()}</span></span>
                <span className="text-gray-400">Qubits: <span className="text-gray-200">{ds.n_qubits}</span></span>
                <span className="text-gray-400">Encoding: <span className="text-gray-200">{ds.encoding}</span></span>
                <span className="text-gray-400">Size: <span className="text-gray-200">{ds.size_mb} MB</span></span>
                <span className="text-gray-400">Accuracy: <span className="text-green-400 font-medium">{(ds.benchmark_accuracy * 100).toFixed(1)}%</span></span>
                <span className="text-gray-400">License: <span className="text-gray-200">{ds.license}</span></span>
              </div>

              {ds.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {ds.tags.map((tag) => (
                    <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded-full">{tag}</span>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-auto pt-1">
                {ds.paper_doi && (
                  <a href={`https://doi.org/${ds.paper_doi}`} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:text-indigo-300 underline">DOI</a>
                )}
                <a href={ds.download_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:text-indigo-300 underline">Download</a>
                <button
                  onClick={() => handleBenchmarkOpen(ds)}
                  className="ml-auto bg-indigo-600 hover:bg-indigo-500 rounded-md px-2 py-1 text-xs font-medium transition-colors"
                >
                  Benchmark
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Benchmark + Leaderboard Panel */}
      {benchmarkPanel && selectedDataset && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-indigo-400">Benchmark — {selectedDataset.name}</h2>
            <button onClick={() => setBenchmarkPanel(null)} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Run benchmark */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-300">Run New Benchmark</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Model Type</label>
                  <select value={benchModelType} onChange={(e) => setBenchModelType(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                    {MODEL_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Optimizer</label>
                  <select value={benchOptimizer} onChange={(e) => setBenchOptimizer(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                    {OPTIMIZERS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Parameters: {benchNParams.toLocaleString()}</label>
                  <input type="range" min={10} max={10000} step={10} value={benchNParams} onChange={(e) => setBenchNParams(Number(e.target.value))} className="w-full accent-indigo-500" />
                </div>
              </div>
              <button onClick={handleRunBenchmark} disabled={benchRunning} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg py-2 text-sm font-medium transition-colors">
                {benchRunning ? "Running…" : "Run Benchmark"}
              </button>
              {benchError && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{benchError}</div>}
              {benchResult && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {[
                    { label: "Accuracy", value: `${(benchResult.accuracy * 100).toFixed(2)}%` },
                    { label: "F1 Score", value: benchResult.f1_score.toFixed(4) },
                    { label: "Train Time", value: `${benchResult.training_time_sec.toFixed(1)}s` },
                    { label: "Qubits Used", value: benchResult.n_qubits_used },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-gray-800 rounded-lg px-3 py-2 text-center">
                      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                      <p className="text-sm font-semibold text-green-400">{value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Leaderboard */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-300">Leaderboard</h3>
              {leaderboardLoading ? (
                <div className="text-sm text-gray-400 animate-pulse">Loading leaderboard…</div>
              ) : leaderboardError ? (
                <div className="text-red-400 text-sm">{leaderboardError}</div>
              ) : leaderboard.length === 0 ? (
                <div className="text-sm text-gray-500">No benchmarks yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-800">
                        <th className="pb-2 font-medium">#</th>
                        <th className="pb-2 font-medium">Model</th>
                        <th className="pb-2 font-medium">Params</th>
                        <th className="pb-2 font-medium">Acc</th>
                        <th className="pb-2 font-medium">F1</th>
                        <th className="pb-2 font-medium">Time</th>
                        <th className="pb-2 font-medium">Opt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((run, i) => (
                        <tr key={run.run_id} className="border-b border-gray-800/50">
                          <td className="py-1.5 pr-2 text-gray-400">{i + 1}</td>
                          <td className="py-1.5 pr-2">{run.model_type}</td>
                          <td className="py-1.5 pr-2">{run.n_params.toLocaleString()}</td>
                          <td className="py-1.5 pr-2 text-green-400 font-medium">{(run.accuracy * 100).toFixed(1)}%</td>
                          <td className="py-1.5 pr-2">{run.f1_score.toFixed(3)}</td>
                          <td className="py-1.5 pr-2">{run.training_time_sec.toFixed(0)}s</td>
                          <td className="py-1.5">{run.optimizer}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
