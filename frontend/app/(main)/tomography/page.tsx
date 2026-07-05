"use client";
import { useState } from "react";
import { runTomography, TomographyJob } from "@/lib/api";

const METHODS = [
  { value: "mle", label: "MLE", desc: "Maximum Likelihood Estimation — exact but slow for large systems" },
  { value: "compressed_sensing", label: "Compressed Sensing", desc: "10–100× fewer measurements via sparsity prior" },
  { value: "shadow", label: "Shadow Tomography", desc: "Classical shadows — O(log d) measurements for local observables" },
  { value: "direct", label: "Direct Inversion", desc: "Fast linear inversion — unphysical states possible" },
];

const DEFAULT_COUNTS = JSON.stringify({ "0": 3200, "1": 1800 }, null, 2);

type Method = { value: string; label: string; desc: string };

function MethodButton({ m, selected, onClick }: { m: Method; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: 12,
        borderRadius: 8,
        border: selected ? "1px solid var(--strong)" : "1px solid var(--line)",
        background: selected ? "rgba(99,102,241,0.15)" : "transparent",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 500, fontSize: 13 }}>{m.label}</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{m.desc}</div>
    </button>
  );
}

export default function TomographyPage() {
  const [nQubits, setNQubits] = useState(1);
  const [method, setMethod] = useState("mle");
  const [nShots, setNShots] = useState(8192);
  const [counts, setCounts] = useState(DEFAULT_COUNTS);
  const [result, setResult] = useState<TomographyJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await runTomography({ method, n_qubits: nQubits, n_shots: nShots, counts: JSON.parse(counts) });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const fidelity = result ? (result.infidelity !== null ? 1 - result.infidelity : null) : null;
  const isPure = result?.purity !== null ? (result?.purity ?? 0) > 0.99 : false;
  const isEntangled = result?.entanglement_entropy !== null ? (result?.entanglement_entropy ?? 0) > 0.01 : false;
  const dm = result?.density_matrix_real;

  return (
    <div className="page" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Quantum State Tomography</h1>
      <p style={{ color: "var(--muted)", marginBottom: 24 }}>Reconstruct the density matrix of your quantum state. Supports MLE, compressed sensing (10–100× fewer measurements), and classical shadow tomography.</p>

      <div className="panel" style={{ marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Qubits</label>
            <input type="number" min={1} max={4} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Shots</label>
            <input type="number" value={nShots} onChange={e => setNShots(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8, display: "block" }}>Method</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {METHODS.map(m => (
              <MethodButton key={m.value} m={m} selected={method === m.value} onClick={() => setMethod(m.value)} />
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Measurement Counts (JSON)</label>
          <textarea value={counts} onChange={e => setCounts(e.target.value)}
            style={{
              width: "100%",
              height: 112,
              marginTop: 4,
              background: "var(--surface)",
              color: "var(--ok)",
              fontFamily: "ui-monospace,monospace",
              fontSize: 13,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              resize: "vertical",
              boxSizing: "border-box",
            }} />
        </div>
        <button onClick={run} disabled={loading} className="button"
          style={{ opacity: loading ? 0.5 : 1, padding: "8px 24px" }}>
          {loading ? "Reconstructing..." : "Reconstruct State"}
        </button>
      </div>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12, marginBottom: 24 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            {([
              ["Purity", result.purity !== null ? result.purity.toFixed(4) : "—", (result.purity ?? 0) > 0.99 ? "var(--ok)" : (result.purity ?? 0) > 0.9 ? "#f59e0b" : "var(--danger)"],
              ["Fidelity", fidelity !== null ? `${(fidelity * 100).toFixed(2)}%` : "—", "var(--strong)"],
              ["Entanglement", (result.entanglement_entropy ?? 0) > 0 ? `${(result.entanglement_entropy ?? 0).toFixed(3)} ebit` : "none", "#a78bfa"],
              ["Negativity", (result.negativity ?? 0) > 0 ? (result.negativity ?? 0).toFixed(4) : "0 (sep.)", (result.negativity ?? 0) > 0 ? "#f97316" : "var(--muted)"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} style={{ background: "var(--surface)", borderRadius: 8, padding: 16, textAlign: "center", border: "1px solid var(--line)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 18, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: c }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="panel">
              <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Density Matrix (Real part)</h2>
              {dm && dm.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ fontSize: 12, fontFamily: "ui-monospace,monospace" }}>
                    <tbody>
                      {dm.map((row, i) => (
                        <tr key={i}>
                          {(row as number[]).map((val, j) => {
                            const intensity = Math.min(1, Math.abs(val));
                            return (
                              <td key={j} style={{
                                width: 48,
                                height: 48,
                                textAlign: "center",
                                border: "1px solid var(--line)",
                                background: `rgba(99,102,241,${intensity * 0.8})`,
                              }}>
                                {val.toFixed(3)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13 }}>State Properties</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>State type</span>
                  <span style={{ color: isPure ? "var(--ok)" : "#f59e0b" }}>{isPure ? "Pure" : "Mixed"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Physical</span>
                  <span style={{ color: result.is_physical ? "var(--ok)" : "var(--danger)" }}>{result.is_physical ? "Yes" : "No"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Entangled</span>
                  <span style={{ color: isEntangled ? "#f97316" : "var(--muted)" }}>{isEntangled ? "Yes" : "No (separable)"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Measurements used</span>
                  <span style={{ fontFamily: "ui-monospace,monospace", color: "var(--text)" }}>{result.measurements_used}</span>
                </div>
                {result.compression_ratio > 1 && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>Compression ratio</span>
                    <span style={{ fontFamily: "ui-monospace,monospace", color: "var(--ok)" }}>{result.compression_ratio.toFixed(1)}×</span>
                  </div>
                )}
              </div>
              {result.bloch_vector && result.n_qubits === 1 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Bloch Vector</div>
                  {(["x", "y", "z"] as const).map((ax, idx) => {
                    const v = result.bloch_vector![idx];
                    return (
                      <div key={ax} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ color: "var(--muted)", fontFamily: "ui-monospace,monospace", width: 12 }}>{ax}</span>
                        <div style={{ flex: 1, background: "var(--line)", borderRadius: 999, height: 8, position: "relative" }}>
                          <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "var(--muted)" }} />
                          <div style={{
                            position: "absolute",
                            top: 0,
                            height: 8,
                            background: "var(--strong)",
                            borderRadius: 999,
                            left: v >= 0 ? "50%" : `${(0.5 + v / 2) * 100}%`,
                            width: `${Math.abs(v) * 50}%`,
                          }} />
                        </div>
                        <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: "var(--text)", width: 56, textAlign: "right" }}>{v.toFixed(4)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {result.warnings && result.warnings.length > 0 && (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 12, color: "#f59e0b" }}>Warnings</div>
                  {result.warnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: "#f59e0b" }}>⚠ {w}</div>)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
