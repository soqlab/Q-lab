"use client";

import { useState } from "react";
import { QuantumChemResult, BondCurvePoint, runQuantumChem } from "../../../lib/api";
import { Atom, Play, CheckCircle, Zap } from "lucide-react";

const MOLECULES = [
  { id: "h2", label: "H₂", formula: "H₂", color: "#3b82f6" },
  { id: "lih", label: "LiH", formula: "LiH", color: "#8b5cf6" },
  { id: "h2o", label: "H₂O", formula: "H₂O", color: "#10b981" },
  { id: "beh2", label: "BeH₂", formula: "BeH₂", color: "#f59e0b" },
  { id: "n2", label: "N₂", formula: "N₂", color: "#ef4444" },
];

export default function QuantumChemPage() {
  const [molecule, setMolecule] = useState("h2");
  const [bondLength, setBondLength] = useState(0.74);
  const [basis, setBasis] = useState("sto-3g");
  const [result, setResult] = useState<QuantumChemResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRun = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await runQuantumChem({ molecule, bond_length: bondLength, basis });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const renderBondCurve = (curve: BondCurvePoint[], equil: number) => {
    if (!curve || curve.length === 0) return null;
    const W = 500, H = 200, PAD = 40;
    const xs = curve.map(p => p.bond_length);
    const ys = curve.map(p => p.energy);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const toSvgX = (v: number) => PAD + ((v - minX) / rangeX) * (W - 2 * PAD);
    const toSvgY = (v: number) => PAD + (1 - (v - minY) / rangeY) * (H - 2 * PAD);

    const polyline = curve.map(p => `${toSvgX(p.bond_length)},${toSvgY(p.energy)}`).join(" ");
    const eqX = toSvgX(equil);

    return (
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" />
        <text x={PAD - 4} y={PAD + 4} fontSize={9} fill="#64748b" textAnchor="end">{maxY.toFixed(2)}</text>
        <text x={PAD - 4} y={H - PAD + 4} fontSize={9} fill="#64748b" textAnchor="end">{minY.toFixed(2)}</text>
        <text x={PAD} y={H - PAD + 18} fontSize={9} fill="#64748b" textAnchor="middle">{minX.toFixed(1)}</text>
        <text x={W - PAD} y={H - PAD + 18} fontSize={9} fill="#64748b" textAnchor="middle">{maxX.toFixed(1)}</text>
        <text x={W / 2} y={H - 4} fontSize={10} fill="#94a3b8" textAnchor="middle">Bond Length (Å)</text>
        <text x={14} y={H / 2} fontSize={10} fill="#94a3b8" textAnchor="middle" transform={`rotate(-90, 14, ${H / 2})`}>Energy (Ha)</text>
        <polyline points={polyline} fill="none" stroke="#3b82f6" strokeWidth={2} />
        <line x1={eqX} y1={PAD} x2={eqX} y2={H - PAD} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5,3" />
        <text x={eqX + 4} y={PAD + 12} fontSize={9} fill="#f59e0b">{equil.toFixed(2)} Å</text>
      </svg>
    );
  };

  const activeMol = MOLECULES.find(m => m.id === molecule);

  return (
    <div style={{ padding: 24, background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <Atom size={22} color="#3b82f6" />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Quantum Chemistry Module</h1>
        </div>

        {error && (
          <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Molecule</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {MOLECULES.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setMolecule(m.id)}
                    style={{
                      border: molecule === m.id ? `1.5px solid ${m.color}` : "1.5px solid #334155",
                      borderRadius: 8,
                      padding: "0.55rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      background: molecule === m.id ? `${m.color}18` : "#0f172a",
                      color: molecule === m.id ? m.color : "#94a3b8",
                      fontSize: 14,
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                Bond Length: <span style={{ color: "#e2e8f0" }}>{bondLength.toFixed(2)} Å</span>
              </div>
              <input
                type="range"
                min={0.3}
                max={3.0}
                step={0.05}
                value={bondLength}
                onChange={e => setBondLength(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#3b82f6" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginTop: 2 }}>
                <span>0.3 Å</span>
                <span>3.0 Å</span>
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Basis Set</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[{ id: "sto-3g", label: "STO-3G" }, { id: "cc-pvdz", label: "cc-pVDZ" }].map(b => (
                  <button
                    key={b.id}
                    onClick={() => setBasis(b.id)}
                    style={{
                      border: basis === b.id ? "1.5px solid #3b82f6" : "1.5px solid #334155",
                      borderRadius: 8,
                      padding: "0.55rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      background: basis === b.id ? "#3b82f618" : "#0f172a",
                      color: basis === b.id ? "#3b82f6" : "#94a3b8",
                      fontSize: 14,
                      width: "100%",
                    }}
                  >
                    {b.label}
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
                background: loading ? "#1e3a5f" : "#3b82f6",
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
              {loading ? "Running..." : "Run VQE"}
            </button>
          </div>

          <div>
            {result ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CheckCircle size={18} color={result.chemical_accuracy_achieved ? "#10b981" : "#ef4444"} />
                    <span style={{
                      fontWeight: 700,
                      fontSize: 15,
                      color: result.chemical_accuracy_achieved ? "#10b981" : "#ef4444",
                    }}>
                      {result.chemical_accuracy_achieved ? "Chemical Accuracy ✓" : "Above Chemical Accuracy"}
                    </span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  {[
                    { label: "FCI Energy", value: `${result.fci_energy_hartree.toFixed(4)} Ha`, color: "#3b82f6" },
                    { label: "VQE Energy", value: `${result.vqe_energy_hartree.toFixed(4)} Ha`, color: "#10b981" },
                    { label: "Energy Error", value: result.energy_error_hartree.toFixed(6), color: "#f59e0b" },
                    { label: "Correlation %", value: `${result.correlation_energy_pct.toFixed(2)}%`, color: "#8b5cf6" },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Molecule Info</div>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    {[
                      { label: "Molecule", value: result.molecule },
                      { label: "Formula", value: result.formula },
                      { label: "Electrons", value: result.n_electrons },
                      { label: "Qubits", value: result.n_qubits },
                      { label: "Point Group", value: result.point_group },
                      { label: "HOMO-LUMO Gap", value: `${result.homo_lumo_gap.toFixed(3)} eV` },
                    ].map(i => (
                      <div key={i.label}>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{i.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{i.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
                    Bond Dissociation Curve
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    {renderBondCurve(result.bond_curve, result.equilibrium_bond_length)}
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                    <Zap size={13} style={{ display: "inline", marginRight: 4 }} />
                    Circuit Stats
                  </div>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    {[
                      { label: "Pauli Terms", value: result.n_pauli_terms },
                      { label: "CNOT Gates", value: result.n_cnot_gates },
                      { label: "Circuit Depth", value: result.circuit_depth },
                    ].map(s => (
                      <div key={s.label}>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{s.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
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
                <Atom size={48} color="#334155" />
                <div style={{ color: "#64748b", fontSize: 15 }}>
                  Select a molecule and run VQE to see results
                </div>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  {activeMol ? `${activeMol.formula} at ${bondLength.toFixed(2)} Å with ${basis}` : ""}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
