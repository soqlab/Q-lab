"use client";

import { useState, useEffect } from "react";
import { TensorNetworkResult, analyzeTensorNetwork } from "../../../lib/api";
import { Network, Play, Zap, BarChart3 } from "lucide-react";

const PRESET_QASM = `OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[4];\ncreg c[4];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\ncx q[2],q[3];\nt q[0];\nt q[2];\nmeasure q -> c;`;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

export default function TensorNetworkPage() {
  const [qasm, setQasm] = useState(PRESET_QASM);
  const [maxBondDim, setMaxBondDim] = useState(16);
  const [method, setMethod] = useState<"svd" | "qr">("svd");
  const [result, setResult] = useState<TensorNetworkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRun = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await analyzeTensorNetwork({ qasm, max_bond_dim: maxBondDim, method });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void handleRun(); }, []);

  const renderBondChart = (dims: number[]) => {
    if (!dims || dims.length === 0) return null;
    const W = 560, H = 120, PAD = 30;
    const maxVal = Math.max(...dims, 1);
    const barW = Math.max(8, (W - 2 * PAD) / dims.length - 4);

    return (
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" />
        {dims.map((d, i) => {
          const x = PAD + i * ((W - 2 * PAD) / dims.length) + 2;
          const barH = ((d / maxVal) * (H - 2 * PAD));
          const y = H - PAD - barH;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} fill="#3b82f6" rx={2} opacity={0.85} />
              {barW > 14 && (
                <text x={x + barW / 2} y={y - 3} fontSize={9} fill="#94a3b8" textAnchor="middle">{d}</text>
              )}
            </g>
          );
        })}
        <text x={W / 2} y={H - 4} fontSize={10} fill="#64748b" textAnchor="middle">Bond Index</text>
        <text x={PAD - 4} y={PAD + 4} fontSize={9} fill="#64748b" textAnchor="end">{maxVal}</text>
      </svg>
    );
  };

  const renderEntropyChart = (entropies: number[]) => {
    if (!entropies || entropies.length === 0) return null;
    const W = 560, H = 100, PAD = 30;
    const maxVal = Math.max(...entropies, 0.01);
    const minVal = Math.min(...entropies);

    const points = entropies.map((v, i) => {
      const x = PAD + (i / Math.max(entropies.length - 1, 1)) * (W - 2 * PAD);
      const y = PAD + (1 - (v - minVal) / (maxVal - minVal || 1)) * (H - 2 * PAD);
      return `${x},${y}`;
    }).join(" ");

    return (
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" />
        <text x={PAD - 4} y={PAD + 4} fontSize={9} fill="#64748b" textAnchor="end">{maxVal.toFixed(2)}</text>
        <text x={PAD - 4} y={H - PAD + 4} fontSize={9} fill="#64748b" textAnchor="end">{minVal.toFixed(2)}</text>
        <polyline points={points} fill="none" stroke="#10b981" strokeWidth={2} />
        {entropies.map((v, i) => {
          const x = PAD + (i / Math.max(entropies.length - 1, 1)) * (W - 2 * PAD);
          const y = PAD + (1 - (v - minVal) / (maxVal - minVal || 1)) * (H - 2 * PAD);
          return <circle key={i} cx={x} cy={y} r={3} fill="#10b981" />;
        })}
        <text x={W / 2} y={H - 4} fontSize={10} fill="#64748b" textAnchor="middle">Cut Index</text>
      </svg>
    );
  };

  return (
    <div style={{ padding: 24, background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <Network size={22} color="#8b5cf6" />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Tensor Network Visualizer</h1>
        </div>

        {error && (
          <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>QASM</div>
              <textarea
                rows={10}
                value={qasm}
                onChange={e => setQasm(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  color: "#e2e8f0",
                  fontFamily: "monospace",
                  fontSize: 12,
                  padding: "0.5rem",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                Max Bond Dim: <span style={{ color: "#e2e8f0" }}>D={maxBondDim}</span>
              </div>
              <input
                type="range"
                min={2}
                max={64}
                step={2}
                value={maxBondDim}
                onChange={e => setMaxBondDim(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#8b5cf6" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginTop: 2 }}>
                <span>D=2</span>
                <span>D=64</span>
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Decompose Method</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {([{ id: "svd", label: "SVD" }, { id: "qr", label: "QR" }] as { id: "svd" | "qr"; label: string }[]).map(m => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    style={{
                      border: method === m.id ? "1.5px solid #8b5cf6" : "1.5px solid #334155",
                      borderRadius: 8,
                      padding: "0.55rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      background: method === m.id ? "#8b5cf618" : "#0f172a",
                      color: method === m.id ? "#8b5cf6" : "#94a3b8",
                      fontSize: 14,
                      width: "100%",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{
                border: "none",
                borderRadius: 8,
                padding: "0.7rem",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
                background: loading ? "#3b1f6e" : "#8b5cf6",
                color: "#fff",
                fontSize: 15,
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Play size={16} />
              {loading ? "Analyzing..." : "Analyze Network"}
            </button>
          </div>

          <div>
            {result ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                    <Zap size={13} style={{ display: "inline", marginRight: 4 }} />
                    Memory Comparison
                  </div>
                  <div style={{ display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>Exact (statevector)</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#ef4444" }}>{formatBytes(result.memory_bytes_exact)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>MPS representation</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#10b981" }}>{formatBytes(result.memory_bytes_mps)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>Memory savings</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6" }}>{result.memory_savings_pct.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div style={{ background: "#0f172a", borderRadius: 6, height: 10, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(result.memory_savings_pct, 100)}%`,
                      background: "#3b82f6",
                      borderRadius: 6,
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{
                    flex: 1,
                    background: "#1e293b",
                    borderRadius: 10,
                    border: `1px solid ${result.is_area_law ? "#10b981" : "#f59e0b"}`,
                    padding: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: result.is_area_law ? "#10b981" : "#f59e0b" }}>
                      {result.is_area_law ? "Area Law (MPS efficient)" : result.is_volume_law ? "Volume Law (entanglement-rich)" : "Mixed Entanglement"}
                    </span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  {[
                    { label: "Qubits", value: String(result.n_qubits), color: "#3b82f6" },
                    { label: "Max Bond Dim", value: String(result.max_bond_dim_actual), color: "#8b5cf6" },
                    { label: "Truncation Error", value: result.truncation_error.toFixed(6), color: "#f59e0b" },
                    { label: "Compression", value: `${result.compression_ratio.toFixed(2)}x`, color: "#10b981" },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <BarChart3 size={14} color="#94a3b8" />
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 }}>
                      Bond Dimensions
                    </div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    {renderBondChart(result.bond_dimensions)}
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                    Von Neumann Entropy across cuts
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    {renderEntropyChart(result.entanglement_entropies)}
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                    Network Diagram
                  </div>
                  <pre style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    background: "#0f172a",
                    padding: "0.75rem",
                    borderRadius: 6,
                    overflow: "auto",
                    color: "#94a3b8",
                    margin: 0,
                    lineHeight: 1.5,
                  }}>
                    {result.network_diagram}
                  </pre>
                </div>
              </div>
            ) : (
              <div style={{
                background: "#1e293b",
                borderRadius: 10,
                border: "1px solid #334155",
                height: 420,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
              }}>
                <Network size={48} color="#334155" />
                <div style={{ color: "#64748b", fontSize: 15 }}>Paste a QASM circuit and analyze its tensor network decomposition</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
