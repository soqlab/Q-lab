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

const taskBadgeStyle: Record<string, React.CSSProperties> = {
  classification: { background: "rgba(59,130,246,0.15)", color: "var(--info-text)", border: "1px solid rgba(59,130,246,0.4)" },
  regression: { background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.4)" },
  generation: { background: "rgba(16,185,129,0.15)", color: "var(--ok)", border: "1px solid rgba(16,185,129,0.4)" },
  reinforcement: { background: "rgba(249,115,22,0.15)", color: "#f97316", border: "1px solid rgba(249,115,22,0.4)" },
};

const defaultBadgeStyle: React.CSSProperties = { background: "var(--line)", color: "var(--muted)", border: "1px solid var(--line)" };

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
    <div style={{ minHeight: "100vh", background: "var(--surface)", color: "var(--text)", padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>QML Dataset Hub</h1>
          <p style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>Curated quantum machine learning datasets with benchmarking</p>
        </div>
        <button
          onClick={() => setShowUpload((v) => !v)}
          style={{ background: "var(--strong)", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 500, color: "var(--text)", border: "none", cursor: "pointer" }}
        >
          {showUpload ? "Cancel" : "Upload Dataset"}
        </button>
      </div>

      {/* Upload Form */}
      {showUpload && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--strong)" }}>Upload New Dataset</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Name</label>
              <input type="text" value={upName} onChange={(e) => setUpName(e.target.value)} className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Task</label>
              <select value={upTask} onChange={(e) => setUpTask(e.target.value)} className="input" style={{ width: "100%" }}>
                {TASKS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Samples</label>
              <input type="number" min={1} value={upNSamples} onChange={(e) => setUpNSamples(Number(e.target.value))} className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Features</label>
              <input type="number" min={1} value={upNFeatures} onChange={(e) => setUpNFeatures(Number(e.target.value))} className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Qubits</label>
              <input type="number" min={1} value={upNQubits} onChange={(e) => setUpNQubits(Number(e.target.value))} className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Encoding</label>
              <select value={upEncoding} onChange={(e) => setUpEncoding(e.target.value)} className="input" style={{ width: "100%" }}>
                {ENCODINGS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>License</label>
              <input type="text" value={upLicense} onChange={(e) => setUpLicense(e.target.value)} className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Authors (comma-sep)</label>
              <input type="text" value={upAuthors} onChange={(e) => setUpAuthors(e.target.value)} className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Paper DOI</label>
              <input type="text" value={upDOI} onChange={(e) => setUpDOI(e.target.value)} className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Tags (comma-sep)</label>
              <input type="text" value={upTags} onChange={(e) => setUpTags(e.target.value)} className="input" style={{ width: "100%" }} />
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Description</label>
            <textarea value={upDesc} onChange={(e) => setUpDesc(e.target.value)} rows={2} className="input" style={{ width: "100%" }} />
          </div>
          {uploadError && (
            <div style={{ color: "var(--danger)", fontSize: 13, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" }}>{uploadError}</div>
          )}
          <button
            onClick={handleUpload}
            disabled={uploading || !upName || !upDesc}
            style={{ background: "var(--strong)", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: uploading || !upName || !upDesc ? "not-allowed" : "pointer", opacity: uploading || !upName || !upDesc ? 0.5 : 1 }}
          >
            {uploading ? "Uploading…" : "Upload Dataset"}
          </button>
        </div>
      )}

      {/* Dataset Grid */}
      {loading ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading datasets…</div>
      ) : error ? (
        <div style={{ color: "var(--danger)", fontSize: 13, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" }}>{error}</div>
      ) : datasets.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>No datasets available.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
          {datasets.map((ds) => (
            <div key={ds.dataset_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <p style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>{ds.name}</p>
                <span style={{ fontSize: 12, padding: "2px 6px", borderRadius: 999, flexShrink: 0, ...(taskBadgeStyle[ds.task] ?? defaultBadgeStyle) }}>{ds.task}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 12 }}>
                <span style={{ color: "var(--muted)" }}>Samples: <span style={{ color: "var(--text)" }}>{ds.n_samples.toLocaleString()}</span></span>
                <span style={{ color: "var(--muted)" }}>Qubits: <span style={{ color: "var(--text)" }}>{ds.n_qubits}</span></span>
                <span style={{ color: "var(--muted)" }}>Encoding: <span style={{ color: "var(--text)" }}>{ds.encoding}</span></span>
                <span style={{ color: "var(--muted)" }}>Size: <span style={{ color: "var(--text)" }}>{ds.size_mb} MB</span></span>
                <span style={{ color: "var(--muted)" }}>Accuracy: <span style={{ color: "var(--ok)", fontWeight: 500 }}>{(ds.benchmark_accuracy * 100).toFixed(1)}%</span></span>
                <span style={{ color: "var(--muted)" }}>License: <span style={{ color: "var(--text)" }}>{ds.license}</span></span>
              </div>

              {(ds.tags ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(ds.tags ?? []).map((tag) => (
                    <span key={tag} style={{ fontSize: 12, padding: "2px 6px", background: "var(--line)", color: "var(--muted)", borderRadius: 999 }}>{tag}</span>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 4 }}>
                {ds.paper_doi && (
                  <a href={`https://doi.org/${ds.paper_doi}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--strong)", textDecoration: "underline" }}>DOI</a>
                )}
                <a href={ds.download_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--strong)", textDecoration: "underline" }}>Download</a>
                <button
                  onClick={() => handleBenchmarkOpen(ds)}
                  style={{ marginLeft: "auto", background: "var(--strong)", borderRadius: 8, padding: "4px 8px", fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer" }}
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
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--strong)" }}>Benchmark — {selectedDataset.name}</h2>
            <button onClick={() => setBenchmarkPanel(null)} style={{ fontSize: 12, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}>Close</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
            {/* Run benchmark */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Run New Benchmark</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Model Type</label>
                  <select value={benchModelType} onChange={(e) => setBenchModelType(e.target.value)} className="input" style={{ width: "100%" }}>
                    {MODEL_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Optimizer</label>
                  <select value={benchOptimizer} onChange={(e) => setBenchOptimizer(e.target.value)} className="input" style={{ width: "100%" }}>
                    {OPTIMIZERS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Parameters: {benchNParams.toLocaleString()}</label>
                  <input type="range" min={10} max={10000} step={10} value={benchNParams} onChange={(e) => setBenchNParams(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--strong)" } as React.CSSProperties} />
                </div>
              </div>
              <button
                onClick={handleRunBenchmark}
                disabled={benchRunning}
                style={{ width: "100%", background: "var(--strong)", borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 500, border: "none", cursor: benchRunning ? "not-allowed" : "pointer", opacity: benchRunning ? 0.5 : 1 }}
              >
                {benchRunning ? "Running…" : "Run Benchmark"}
              </button>
              {benchError && (
                <div style={{ color: "var(--danger)", fontSize: 13, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" }}>{benchError}</div>
              )}
              {benchResult && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingTop: 4 }}>
                  {[
                    { label: "Accuracy", value: `${(benchResult.accuracy * 100).toFixed(2)}%` },
                    { label: "F1 Score", value: benchResult.f1_score.toFixed(4) },
                    { label: "Train Time", value: `${benchResult.training_time_sec.toFixed(1)}s` },
                    { label: "Qubits Used", value: benchResult.n_qubits_used },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: "var(--line)", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
                      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>{label}</p>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--ok)" }}>{value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Leaderboard */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Leaderboard</h3>
              {leaderboardLoading ? (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading leaderboard…</div>
              ) : leaderboardError ? (
                <div style={{ color: "var(--danger)", fontSize: 13 }}>{leaderboardError}</div>
              ) : leaderboard.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>No benchmarks yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                        <th style={{ paddingBottom: 8, fontWeight: 500 }}>#</th>
                        <th style={{ paddingBottom: 8, fontWeight: 500 }}>Model</th>
                        <th style={{ paddingBottom: 8, fontWeight: 500 }}>Params</th>
                        <th style={{ paddingBottom: 8, fontWeight: 500 }}>Acc</th>
                        <th style={{ paddingBottom: 8, fontWeight: 500 }}>F1</th>
                        <th style={{ paddingBottom: 8, fontWeight: 500 }}>Time</th>
                        <th style={{ paddingBottom: 8, fontWeight: 500 }}>Opt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((run, i) => (
                        <tr key={run.run_id} style={{ borderBottom: "1px solid var(--line)" }}>
                          <td style={{ padding: "6px 8px 6px 0", color: "var(--muted)" }}>{i + 1}</td>
                          <td style={{ padding: "6px 8px 6px 0" }}>{run.model_type}</td>
                          <td style={{ padding: "6px 8px 6px 0" }}>{run.n_params.toLocaleString()}</td>
                          <td style={{ padding: "6px 8px 6px 0", color: "var(--ok)", fontWeight: 500 }}>{(run.accuracy * 100).toFixed(1)}%</td>
                          <td style={{ padding: "6px 8px 6px 0" }}>{run.f1_score.toFixed(3)}</td>
                          <td style={{ padding: "6px 8px 6px 0" }}>{run.training_time_sec.toFixed(0)}s</td>
                          <td style={{ padding: "6px 0" }}>{run.optimizer}</td>
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
