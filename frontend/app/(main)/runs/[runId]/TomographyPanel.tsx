"use client";

import { useState } from "react";
import { runTomographyForRun, getTomography, TomographyResult } from "../../../../lib/api";

function DensityMatrixHeatmap({ re, im }: { re: number[][]; im: number[][] }) {
  const n = re.length;
  if (n === 0) return null;
  const all = re.flat().concat(im.flat()).map(Math.abs);
  const maxVal = Math.max(...all, 0.001);
  const cell = Math.min(40, Math.floor(260 / n));

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {[{ label: "Re(ρ)", mat: re }, { label: "Im(ρ)", mat: im }].map(({ label, mat }) => (
        <div key={label}>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>{label}</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, ${cell}px)`, gap: 1 }}>
            {mat.map((row, i) => row.map((val, j) => {
              const intensity = Math.abs(val) / maxVal;
              const color = val >= 0 ? `rgba(59,130,246,${intensity})` : `rgba(239,68,68,${intensity})`;
              return (
                <div key={`${i}-${j}`} title={`ρ[${i},${j}] = ${val.toFixed(4)}`}
                  style={{ width: cell, height: cell, background: color, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {cell >= 28 && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.7)" }}>{val.toFixed(2)}</span>}
                </div>
              );
            }))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BlochSphere({ bv }: { bv: [number, number, number] }) {
  const [x, y, z] = bv;
  const CX = 60, CY = 60, R = 50;
  const px = CX + x * R * 0.7;
  const py = CY - z * R;

  return (
    <svg width={120} height={120}>
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="#374151" strokeWidth={1.5} />
      <ellipse cx={CX} cy={CY} rx={R} ry={R * 0.3} fill="none" stroke="#374151" strokeWidth={1} strokeDasharray="3,2" />
      <line x1={CX} y1={CY - R - 6} x2={CX} y2={CY + R + 6} stroke="#374151" strokeWidth={1} />
      <line x1={CX - R - 6} y1={CY} x2={CX + R + 6} y2={CY} stroke="#374151" strokeWidth={1} />
      <text x={CX} y={CY - R - 8} fontSize={10} fill="#9ca3af" textAnchor="middle">|0⟩</text>
      <text x={CX} y={CY + R + 16} fontSize={10} fill="#9ca3af" textAnchor="middle">|1⟩</text>
      <line x1={CX} y1={CY} x2={px} y2={py} stroke="#3b82f6" strokeWidth={2} />
      <circle cx={px} cy={py} r={4} fill="#3b82f6" />
      <text x={px + 6} y={py + 4} fontSize={9} fill="#3b82f6">({x.toFixed(2)}, {y.toFixed(2)}, {z.toFixed(2)})</text>
    </svg>
  );
}

export default function TomographyPanel({ runId }: { runId: string }) {
  const [result, setResult] = useState<TomographyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"run" | "load">("run");

  const handleRun = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await runTomographyForRun(runId);
      setResult(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await getTomography(runId);
      setResult(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const pauliPairs = result
    ? Object.entries(result.pauli_expectations).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 12)
    : [];

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Quantum State Tomography</h2>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn" style={{ fontSize: 12 }} onClick={handleLoad} disabled={loading}>Load Existing</button>
          <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={handleRun} disabled={loading}>
            {loading ? "Running..." : "Run Tomography"}
          </button>
        </div>
      </div>

      {err && <div className="alert alert-error" style={{ margin: "8px 16px" }}>{err}</div>}

      {!result && !loading && (
        <div style={{ padding: 24, color: "#6b7280", fontSize: 13 }}>
          Run state tomography to reconstruct the density matrix ρ from Pauli basis measurements.
          Supported for up to 3 qubits.
        </div>
      )}

      {result && (
        <div style={{ padding: 16 }}>
          {/* Stats row */}
          <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
            {[
              { label: "Qubits", value: result.n_qubits },
              { label: "Purity Tr(ρ²)", value: result.purity?.toFixed(4) ?? "—" },
              { label: "Fidelity", value: result.fidelity_to_ideal != null ? `${(result.fidelity_to_ideal * 100).toFixed(1)}%` : "—" },
              { label: "Concurrence", value: result.concurrence?.toFixed(4) ?? "—" },
              { label: "State", value: result.purity != null ? (result.purity > 0.95 ? "Pure" : result.purity > 0.5 ? "Mixed" : "Highly mixed") : "—" },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {/* Density matrix */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", marginBottom: 8 }}>Density Matrix ρ</div>
              <DensityMatrixHeatmap re={result.density_matrix_re} im={result.density_matrix_im} />
            </div>

            {/* Bloch sphere for 1 qubit */}
            {result.bloch_vector && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", marginBottom: 8 }}>Bloch Vector</div>
                <BlochSphere bv={result.bloch_vector} />
              </div>
            )}

            {/* Pauli expectations */}
            {pauliPairs.length > 0 && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", marginBottom: 8 }}>Pauli Expectations ⟨P⟩</div>
                {pauliPairs.map(([basis, val]) => (
                  <div key={basis} style={{ marginBottom: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 1 }}>
                      <span style={{ fontFamily: "monospace" }}>{basis}</span>
                      <span style={{ color: val >= 0 ? "#3b82f6" : "#ef4444" }}>{val.toFixed(3)}</span>
                    </div>
                    <div style={{ height: 5, background: "#1f2937", borderRadius: 3 }}>
                      <div style={{
                        height: "100%", width: `${Math.abs(val) * 50}%`,
                        background: val >= 0 ? "#3b82f6" : "#ef4444",
                        marginLeft: val < 0 ? `${50 - Math.abs(val) * 50}%` : "50%",
                        borderRadius: 3,
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
