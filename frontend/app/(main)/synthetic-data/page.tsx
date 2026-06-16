"use client";

import { useState, useEffect, useCallback } from "react";
import {
  generateSyntheticData,
  listSyntheticDatasets,
  getSyntheticDataset,
  getSyntheticDatasetStats,
  SyntheticDataset,
  SyntheticDatasetStats,
} from "../../../lib/api";

const DATASET_TYPES = ["classification", "regression", "vqe_landscape", "noise_model"];
const BACKEND_MODELS = ["ibm_generic", "ionq_generic", "ideal"];

const TYPE_COLOR: Record<string, string> = {
  classification: "#6366f1",
  regression: "#3b82f6",
  vqe_landscape: "#10b981",
  noise_model: "#f59e0b",
};

function LabelDistributionChart({ dist }: { dist: Record<string, number> }) {
  const entries = Object.entries(dist);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0 || entries.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {entries.map(([label, count]) => {
        const pct = (count / total) * 100;
        return (
          <div key={label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>
              <span>{label}</span>
              <span>{count} ({pct.toFixed(1)}%)</span>
            </div>
            <div style={{ height: 6, background: "var(--line)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "#6366f1", borderRadius: 3 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows || rows.length === 0) return <div style={{ color: "var(--muted)", fontSize: 12 }}>No preview available.</div>;
  const cols = Object.keys(rows[0]);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--line)" }}>
            {cols.map(c => (
              <th key={c} style={{ textAlign: "left", padding: "6px 10px", fontSize: 10, color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 5).map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
              {cols.map(c => (
                <td key={c} style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11 }}>
                  {typeof row[c] === "number" ? (row[c] as number).toFixed(4) : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SyntheticDataPage() {
  const [datasets, setDatasets] = useState<SyntheticDataset[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [datasetsError, setDatasetsError] = useState("");

  const [form, setForm] = useState({
    name: "",
    type: "classification",
    n_samples: 1000,
    n_qubits: 4,
    noise_level: 0.01,
    backend_model: "ibm_generic",
    seed: "",
  });
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generatedDataset, setGeneratedDataset] = useState<SyntheticDataset | null>(null);

  const [selectedDataset, setSelectedDataset] = useState<SyntheticDataset | null>(null);
  const [selectedStats, setSelectedStats] = useState<SyntheticDatasetStats | null>(null);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [selectedError, setSelectedError] = useState("");

  const loadDatasets = useCallback(async () => {
    setLoadingDatasets(true);
    try {
      const ds = await listSyntheticDatasets();
      setDatasets(ds);
      setDatasetsError("");
    } catch (e) {
      setDatasetsError(e instanceof Error ? e.message : "Failed to load datasets");
    } finally {
      setLoadingDatasets(false);
    }
  }, []);

  useEffect(() => { void loadDatasets(); }, []);

  const handleGenerate = async () => {
    if (!form.name.trim()) { setGenerateError("Name is required"); return; }
    setGenerating(true);
    setGenerateError("");
    try {
      const ds = await generateSyntheticData({
        name: form.name.trim(),
        type: form.type,
        n_samples: form.n_samples,
        n_qubits: form.n_qubits,
        noise_level: form.noise_level,
        backend_model: form.backend_model,
        seed: form.seed ? Number(form.seed) : undefined,
      });
      setGeneratedDataset(ds);
      setDatasets(prev => [ds, ...prev]);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectDataset = async (dataset: SyntheticDataset) => {
    setLoadingSelected(true);
    setSelectedError("");
    setSelectedStats(null);
    try {
      const [full, stats] = await Promise.all([
        getSyntheticDataset(dataset.dataset_id),
        getSyntheticDatasetStats(dataset.dataset_id),
      ]);
      setSelectedDataset(full);
      setSelectedStats(stats);
    } catch (e) {
      setSelectedError(e instanceof Error ? e.message : "Failed to load dataset");
    } finally {
      setLoadingSelected(false);
    }
  };

  const displayDataset = generatedDataset ?? selectedDataset;

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Synthetic Quantum Data Generator</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Generate labelled quantum datasets for ML benchmarks, VQE landscape exploration, and noise characterisation.
        </p>
      </div>

      {/* Generator form */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h2>Generate Dataset</h2></div>
        <div style={{ padding: 16 }}>
          {generateError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fee2e2", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
              {generateError}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Dataset Name</span>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. qml_bench_v1" style={{ height: 34 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Type</span>
              <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ height: 34 }}>
                {DATASET_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Samples</span>
              <input className="input" type="number" min={100} max={10000} value={form.n_samples} onChange={e => setForm(f => ({ ...f, n_samples: Number(e.target.value) }))} style={{ height: 34 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Qubits (1–10)</span>
              <input className="input" type="number" min={1} max={10} value={form.n_qubits} onChange={e => setForm(f => ({ ...f, n_qubits: Number(e.target.value) }))} style={{ height: 34 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Backend Model</span>
              <select className="input" value={form.backend_model} onChange={e => setForm(f => ({ ...f, backend_model: e.target.value }))} style={{ height: 34 }}>
                {BACKEND_MODELS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Seed (optional)</span>
              <input className="input" type="number" value={form.seed} onChange={e => setForm(f => ({ ...f, seed: e.target.value }))} placeholder="e.g. 42" style={{ height: 34 }} />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16, maxWidth: 360 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
              Noise Level: <strong style={{ color: "var(--text)" }}>{form.noise_level.toFixed(3)}</strong>
            </span>
            <input
              type="range" min={0} max={0.1} step={0.001}
              value={form.noise_level}
              onChange={e => setForm(f => ({ ...f, noise_level: parseFloat(e.target.value) }))}
              style={{ accentColor: "#6366f1" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)" }}>
              <span>0 (ideal)</span><span>0.1 (noisy)</span>
            </div>
          </label>
          <button className="button" onClick={() => void handleGenerate()} disabled={generating} style={{ height: 36 }}>
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>

      {/* Generated dataset card */}
      {displayDataset && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <h2>{displayDataset.name}</h2>
            <span style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600,
              background: `${TYPE_COLOR[displayDataset.type] ?? "#6b7280"}22`,
              color: TYPE_COLOR[displayDataset.type] ?? "#6b7280",
            }}>{displayDataset.type}</span>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 16 }}>
              {[
                { label: "Samples", value: displayDataset.n_samples.toLocaleString() },
                { label: "Qubits", value: displayDataset.n_qubits },
                { label: "Features", value: displayDataset.n_features },
                { label: "Size", value: `${displayDataset.size_mb.toFixed(2)} MB` },
                { label: "Noise Level", value: displayDataset.noise_level.toFixed(3) },
                { label: "Backend", value: displayDataset.backend_model },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Download</div>
                <a href={displayDataset.download_url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 13, color: "#6366f1", textDecoration: "underline" }}>
                  Download CSV
                </a>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>Label Distribution</div>
                <LabelDistributionChart dist={displayDataset.label_distribution} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>Data Preview (first 5 rows)</div>
                <PreviewTable rows={displayDataset.preview} />
              </div>
            </div>

            {selectedStats && selectedDataset?.dataset_id === displayDataset.dataset_id && (
              <div style={{ marginTop: 16, padding: 12, background: "var(--panel-2)", borderRadius: 6, border: "1px solid var(--line)" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>Dataset Statistics</div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  {[
                    { label: "Mean Fidelity", value: selectedStats.mean_fidelity.toFixed(4) },
                    { label: "Std Fidelity", value: selectedStats.std_fidelity.toFixed(4) },
                    { label: "Circuit Depth Range", value: `${selectedStats.circuit_depth_range[0]}–${selectedStats.circuit_depth_range[1]}` },
                    { label: "Gate Count Range", value: `${selectedStats.gate_count_range[0]}–${selectedStats.gate_count_range[1]}` },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Datasets list */}
      <div className="panel">
        <div className="panel-header">
          <h2>All Datasets</h2>
          <button className="button secondary" onClick={() => void loadDatasets()} style={{ height: 28, fontSize: 12 }}>Refresh</button>
        </div>
        {loadingDatasets ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading datasets…</div>
        ) : datasetsError ? (
          <div style={{ padding: 16, color: "#b91c1c", fontSize: 13 }}>{datasetsError}</div>
        ) : datasets.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No datasets yet. Generate one above.</div>
        ) : (
          <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {datasets.map(ds => (
              <div
                key={ds.dataset_id}
                className="panel"
                style={{
                  padding: 14, cursor: "pointer",
                  border: selectedDataset?.dataset_id === ds.dataset_id ? "1px solid #6366f1" : "1px solid var(--line)",
                  opacity: loadingSelected ? 0.7 : 1,
                }}
                onClick={() => void handleSelectDataset(ds)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ds.name}
                  </div>
                  <span style={{
                    marginLeft: 8, fontSize: 10, padding: "1px 6px", borderRadius: 3, fontWeight: 600, flexShrink: 0,
                    background: `${TYPE_COLOR[ds.type] ?? "#6b7280"}22`,
                    color: TYPE_COLOR[ds.type] ?? "#6b7280",
                  }}>{ds.type}</span>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)" }}>
                  <span>{ds.n_samples.toLocaleString()} samples</span>
                  <span>{ds.n_qubits}q</span>
                  <span>{ds.size_mb.toFixed(2)} MB</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                  {new Date(ds.created_at).toLocaleString()}
                </div>
                {selectedError && selectedDataset?.dataset_id === ds.dataset_id && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "#b91c1c" }}>{selectedError}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
