"use client";
import { useState, useEffect } from "react";
import { TomoResult, BlochVector, analyzeStateTomography } from "../../../lib/api";
import { Atom, ZapOff, Zap } from "lucide-react";

const PRESET = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

const TARGET_OPTIONS = [
  { value: "", label: "None" },
  { value: "bell", label: "Bell (Φ+)" },
  { value: "ghz", label: "GHZ" },
  { value: "uniform", label: "Uniform" },
];

function BlochSphere({ bv }: { bv: BlochVector }) {
  const W = 120; const CX = 60; const CY = 65; const R = 45;
  const px = CX + R * bv.x;
  const py = CY - R * bv.z;
  const color = bv.purity > 0.9 ? "#10b981" : bv.purity > 0.6 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={W} height={130} style={{ display: "block" }}>
      <ellipse cx={CX} cy={CY + 22} rx={R} ry={12} fill="none" stroke="#334155" strokeWidth={1} strokeDasharray="3 2" />
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="#334155" strokeWidth={1.5} />
      <line x1={CX} y1={CY - R - 8} x2={CX} y2={CY + R + 8} stroke="#475569" strokeWidth={1} />
      <line x1={CX - R - 8} y1={CY} x2={CX + R + 8} y2={CY} stroke="#475569" strokeWidth={1} />
      <line x1={CX} y1={CY} x2={px} y2={py} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={px} cy={py} r={5} fill={color} />
      <text x={CX} y={CY - R - 10} fill="#94a3b8" fontSize={9} textAnchor="middle">|0⟩</text>
      <text x={CX} y={CY + R + 18} fill="#94a3b8" fontSize={9} textAnchor="middle">|1⟩</text>
      <text x={CX} y={130} fill={color} fontSize={10} textAnchor="middle" fontWeight="bold">q{bv.qubit} p={bv.purity.toFixed(2)}</text>
    </svg>
  );
}

function DensityMatrix({ dm }: { dm: { re: number[][]; im: number[][] } }) {
  if (!dm.re?.length) return null;
  const cells = dm.re.flatMap((row, i) => row.map((v, j) => ({ i, j, re: v, im: dm.im[i]?.[j] ?? 0 })));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4 }}>
      {cells.map(({ i, j, re, im }) => {
        const mag = Math.sqrt(re * re + im * im);
        const color = mag > 0.4 ? "#10b981" : mag > 0.1 ? "#f59e0b" : "#334155";
        return (
          <div key={`${i}-${j}`} style={{ background: "#0f172a", borderRadius: 6, padding: "0.5rem", border: `1px solid ${color}40`, textAlign: "center" }}>
            <div style={{ color: "#64748b", fontSize: "0.68rem" }}>ρ[{i},{j}]</div>
            <div style={{ color, fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 700 }}>
              {re.toFixed(3)}{im !== 0 ? `${im >= 0 ? "+" : ""}${im.toFixed(3)}i` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StateTomographyPage() {
  const [qasm, setQasm] = useState(PRESET);
  const [nQubits, setNQubits] = useState(2);
  const [target, setTarget] = useState("");
  const [shots, setShots] = useState(1024);
  const [result, setResult] = useState<TomoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    try { setResult(await analyzeStateTomography({ qasm, n_qubits: nQubits, target_state: target || undefined, shots })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Atom size={28} color="#8b5cf6" /> Quantum State Tomography
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Reconstructs the full density matrix ρ from simulated Pauli measurements across X, Y, Z bases.
          Computes purity, von Neumann entropy, and per-qubit Bloch vectors.
        </p>
      </div>
      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "1.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Configuration</h3>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 10 }}>
              QASM Circuit
              <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={9}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box", resize: "vertical" }} />
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 10 }}>
              Qubits to reconstruct: <span style={{ color: "#8b5cf6", fontWeight: 700 }}>{nQubits}</span>
              <input type="range" min={1} max={6} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#8b5cf6" }} />
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 10 }}>
              Shots per basis: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{shots}</span>
              <input type="range" min={64} max={8192} step={64} value={shots} onChange={e => setShots(Number(e.target.value))}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#3b82f6" }} />
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 12 }}>
              Compare to target:
              <select value={target} onChange={e => setTarget(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem" }}>
                {TARGET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <button onClick={run} disabled={loading}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
              <Atom size={15} /> {loading ? "Reconstructing…" : "Run Tomography"}
            </button>
          </div>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Purity", value: result.purity.toFixed(4), color: result.is_pure ? "#10b981" : result.is_mixed ? "#ef4444" : "#f59e0b" },
                  { label: "Von Neumann S", value: result.von_neumann_entropy.toFixed(4), color: "#3b82f6" },
                  { label: "Total Shots", value: result.total_shots.toLocaleString(), color: "#64748b" },
                  { label: "Fidelity", value: result.fidelity_to_target !== null ? result.fidelity_to_target.toFixed(4) : "N/A", color: "#f59e0b" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.25rem", fontWeight: 700, marginTop: 4 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem" }}>
                {result.is_pure
                  ? <><Zap size={16} color="#10b981" /><span style={{ color: "#10b981", fontWeight: 600 }}>Pure state (p ≥ 0.95)</span></>
                  : result.is_mixed
                  ? <><ZapOff size={16} color="#ef4444" /><span style={{ color: "#ef4444", fontWeight: 600 }}>Mixed state (p &lt; 0.70)</span></>
                  : <><Zap size={16} color="#f59e0b" /><span style={{ color: "#f59e0b", fontWeight: 600 }}>Partially mixed</span></>}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(result.n_qubits, 4)}, 1fr)`, gap: "1rem", marginBottom: "1rem" }}>
                {result.bloch_vectors.map(bv => (
                  <div key={bv.qubit} style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <BlochSphere bv={bv} />
                    <div style={{ marginTop: 4, fontSize: "0.72rem", color: "#64748b" }}>
                      x={bv.x.toFixed(3)} y={bv.y.toFixed(3)} z={bv.z.toFixed(3)}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 10, fontSize: "0.9rem" }}>Density Matrix ρ (qubit 0)</h3>
                  <DensityMatrix dm={result.density_matrix} />
                </div>
                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 10, fontSize: "0.9rem" }}>Pauli Expectations</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {Object.entries(result.pauli_expectations).map(([op, val]) => (
                      <div key={op} style={{ background: "#0f172a", borderRadius: 6, padding: "0.4rem 0.6rem", border: "1px solid #334155" }}>
                        <span style={{ color: "#64748b", fontSize: "0.72rem" }}>⟨{op}⟩ </span>
                        <span style={{ color: (val as number) > 0.1 ? "#10b981" : (val as number) < -0.1 ? "#ef4444" : "#64748b", fontWeight: 700, fontFamily: "monospace", fontSize: "0.8rem" }}>
                          {(val as number).toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#475569" }}>
              <Atom size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Run tomography to reconstruct ρ, purity, and Bloch vectors from Pauli measurements.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
