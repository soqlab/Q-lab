"use client";

import { useState } from "react";
import { QMLResult, QMLTrainEpoch, runQML } from "../../../lib/api";
import { Brain, Play, BarChart3, Zap } from "lucide-react";

const DATASETS = [
  { id: "moons", label: "Two Moons", color: "#3b82f6" },
  { id: "circles", label: "Circles", color: "#8b5cf6" },
  { id: "xor", label: "XOR", color: "#10b981" },
  { id: "iris2", label: "Iris (2-class)", color: "#f59e0b" },
];
const ENCODINGS = ["angle", "amplitude", "IQP"];
const OPTIMIZERS = ["adam", "cobyla", "spsa"];

export default function QMLPage() {
  const [dataset, setDataset] = useState("moons");
  const [encoding, setEncoding] = useState("angle");
  const [nQubits, setNQubits] = useState(4);
  const [nLayers, setNLayers] = useState(2);
  const [optimizer, setOptimizer] = useState("adam");
  const [nEpochs, setNEpochs] = useState(50);
  const [result, setResult] = useState<QMLResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await runQML({
        dataset,
        encoding,
        n_qubits: nQubits,
        n_layers: nLayers,
        optimizer,
        n_epochs: nEpochs,
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const selectedDataset = DATASETS.find((d) => d.id === dataset);

  const W = 560;
  const H = 160;
  const PAD = 36;
  const history: QMLTrainEpoch[] = result?.training_history ?? [];

  const lossVals = history.map((h) => h.loss);
  const lossMin = lossVals.length ? Math.min(...lossVals) : 0;
  const lossMax = lossVals.length ? Math.max(...lossVals) : 1;
  const lossRange = lossMax - lossMin || 1;

  const epochMin = history.length ? history[0].epoch : 0;
  const epochMax = history.length ? history[history.length - 1].epoch : 1;
  const epochRange = epochMax - epochMin || 1;

  function px(epoch: number) {
    return PAD + ((epoch - epochMin) / epochRange) * (W - PAD * 2);
  }
  function pyLoss(loss: number) {
    const norm = (loss - lossMin) / lossRange;
    return H - PAD - norm * (H - PAD * 2);
  }
  function pyAcc(acc: number) {
    return H - PAD - acc * (H - PAD * 2);
  }

  const lossPoints = history.map((h) => `${px(h.epoch)},${pyLoss(h.loss)}`).join(" ");
  const accPoints = history.map((h) => `${px(h.epoch)},${pyAcc(h.accuracy)}`).join(" ");

  const gap = result ? result.quantum_vs_classical_accuracy_gap : 0;

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <Brain size={28} color="#7c3aed" />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800 }}>QML Workbench</h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem" }}>Train quantum machine learning classifiers and evaluate performance</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Dataset</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {DATASETS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDataset(d.id)}
                    style={{
                      width: "100%",
                      border: dataset === d.id ? `2px solid ${d.color}` : "2px solid #334155",
                      borderRadius: 8,
                      padding: "0.5rem 0.75rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "0.82rem",
                      background: dataset === d.id ? `${d.color}22` : "#0f172a",
                      color: dataset === d.id ? d.color : "#94a3b8",
                      textAlign: "left",
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Encoding</div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {ENCODINGS.map((enc) => (
                  <button
                    key={enc}
                    onClick={() => setEncoding(enc)}
                    style={{
                      flex: 1,
                      border: encoding === enc ? "2px solid #7c3aed" : "2px solid #334155",
                      borderRadius: 8,
                      padding: "0.45rem 0.3rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      background: encoding === enc ? "#7c3aed22" : "#0f172a",
                      color: encoding === enc ? "#a78bfa" : "#94a3b8",
                    }}
                  >
                    {enc.charAt(0).toUpperCase() + enc.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Qubits</span>
                <span style={{ fontSize: "0.9rem", color: "#e2e8f0", fontWeight: 700 }}>{nQubits}</span>
              </div>
              <input type="range" min={2} max={6} value={nQubits} onChange={(e) => setNQubits(Number(e.target.value))} style={{ width: "100%", accentColor: "#7c3aed" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748b" }}>
                <span>2</span><span>6</span>
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Layers</span>
                <span style={{ fontSize: "0.9rem", color: "#e2e8f0", fontWeight: 700 }}>{nLayers}</span>
              </div>
              <input type="range" min={1} max={4} value={nLayers} onChange={(e) => setNLayers(Number(e.target.value))} style={{ width: "100%", accentColor: "#7c3aed" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748b" }}>
                <span>1</span><span>4</span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Optimizer</div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {OPTIMIZERS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setOptimizer(opt)}
                    style={{
                      flex: 1,
                      border: optimizer === opt ? "2px solid #7c3aed" : "2px solid #334155",
                      borderRadius: 8,
                      padding: "0.45rem 0.3rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      background: optimizer === opt ? "#7c3aed22" : "#0f172a",
                      color: optimizer === opt ? "#a78bfa" : "#94a3b8",
                      textTransform: "uppercase",
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Epochs</span>
                <span style={{ fontSize: "0.9rem", color: "#e2e8f0", fontWeight: 700 }}>{nEpochs}</span>
              </div>
              <input type="range" min={10} max={100} step={10} value={nEpochs} onChange={(e) => setNEpochs(Number(e.target.value))} style={{ width: "100%", accentColor: "#7c3aed" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748b" }}>
                <span>10</span><span>100</span>
              </div>
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{ width: "100%", border: "none", borderRadius: 8, padding: "0.7rem", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, background: loading ? "#4c1d95" : "#7c3aed", color: "#fff", fontSize: "0.95rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
            >
              <Play size={16} />
              {loading ? "Training..." : "Run QML"}
            </button>

            {error && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.7rem", fontSize: "0.82rem" }}>{error}</div>
            )}
          </div>

          <div>
            {!result ? (
              <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#64748b" }}>
                <Brain size={48} color="#334155" />
                <div style={{ marginTop: "1rem", fontSize: "1rem" }}>Configure and run a QML experiment to see results</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "#1e293b", border: "1px solid #7c3aed", borderRadius: 12, padding: "1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.2rem" }}>Final Test Accuracy</div>
                    <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#a78bfa", lineHeight: 1 }}>
                      {(result.final_test_accuracy * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700, marginBottom: "0.2rem" }}>vs Classical</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: 800, color: gap >= 0 ? "#10b981" : "#ef4444" }}>
                      {gap >= 0 ? "▲" : "▼"} {Math.abs(gap * 100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{selectedDataset?.label}</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#3b82f6" }}>{result.final_train_accuracy.toFixed(3)}</div>
                    <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>Train Acc</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#8b5cf6" }}>{result.final_test_accuracy.toFixed(3)}</div>
                    <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>Test Acc</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#f59e0b" }}>{result.final_train_loss.toFixed(3)}</div>
                    <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>Train Loss</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#ef4444" }}>{result.final_test_loss.toFixed(3)}</div>
                    <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>Test Loss</div>
                  </div>
                </div>

                {history.length > 1 && (
                  <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem" }}>
                    <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.5rem", display: "flex", gap: "1.5rem" }}>
                      <span><span style={{ color: "#f59e0b" }}>—</span> Loss (normalized)</span>
                      <span><span style={{ color: "#3b82f6" }}>—</span> Accuracy</span>
                    </div>
                    <svg width={W} height={H} style={{ overflow: "visible" }}>
                      <text x={PAD} y={H - 8} fill="#64748b" fontSize={10}>{epochMin}</text>
                      <text x={W - PAD} y={H - 8} fill="#64748b" fontSize={10} textAnchor="end">{epochMax}</text>
                      <text x={PAD} y={PAD - 6} fill="#64748b" fontSize={10}>1.0</text>
                      <text x={PAD} y={H - PAD + 4} fill="#64748b" fontSize={10}>0.0</text>
                      {history.length > 1 && (
                        <>
                          <polyline points={lossPoints} fill="none" stroke="#f59e0b" strokeWidth={2} />
                          <polyline points={accPoints} fill="none" stroke="#3b82f6" strokeWidth={2} />
                        </>
                      )}
                    </svg>
                  </div>
                )}

                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem" }}>
                  <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.75rem" }}>Circuit Info</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
                    <div>
                      <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Parameters</div>
                      <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{result.n_parameters}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.72rem", color: "#64748b" }}>CX Gates/Eval</div>
                      <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{result.n_cx_gates_per_eval}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Circuit Depth</div>
                      <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{result.circuit_depth}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Train Samples</div>
                      <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{result.n_training_samples}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Test Samples</div>
                      <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{result.n_test_samples}</div>
                    </div>
                    {result.kernel_matrix !== null && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ background: "#05200e", border: "1px solid #10b981", color: "#34d399", borderRadius: 6, padding: "0.2rem 0.5rem", fontSize: "0.75rem", fontWeight: 700 }}>
                          Kernel Matrix
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
