"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  designExperiment,
  listExperimentDesigns,
  simulateOED,
  ExperimentDesign,
  OEDSimulatedOutcome,
} from "@/lib/api";

const EXPERIMENT_TYPES = ["tomography", "characterization", "vqe", "rb"] as const;
type ExperimentType = (typeof EXPERIMENT_TYPES)[number];

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div style={{
      padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5",
      borderRadius: 8, fontSize: 13, color: "#b91c1c", marginBottom: 12, display: "flex", justifyContent: "space-between",
    }}>
      <span>{msg}</span>
      <button onClick={onDismiss} type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 700 }}>×</button>
    </div>
  );
}

function StatBlock({ label, value, color = "var(--text)" }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ background: "var(--panel-2)", borderRadius: 8, border: "1px solid var(--line)", padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 18, color }}>{value}</div>
    </div>
  );
}

export default function OEDPage() {
  // Design form
  const [name, setName] = useState("");
  const [expType, setExpType] = useState<ExperimentType>("tomography");
  const [nQubits, setNQubits] = useState(2);
  const [targetPrecision, setTargetPrecision] = useState(0.01);
  const [budgetShots, setBudgetShots] = useState(8192);
  const [designing, setDesigning] = useState(false);
  const [design, setDesign] = useState<ExperimentDesign | null>(null);
  const [designError, setDesignError] = useState<string | null>(null);

  // Simulation
  const [noiseLevel, setNoiseLevel] = useState(0.01);
  const [simulating, setSimulating] = useState(false);
  const [simOutcome, setSimOutcome] = useState<OEDSimulatedOutcome | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  // Past designs
  const [pastDesigns, setPastDesigns] = useState<ExperimentDesign[]>([]);
  const [loadingPast, setLoadingPast] = useState(true);
  const [pastError, setPastError] = useState<string | null>(null);

  const loadPastDesigns = useCallback(async () => {
    setLoadingPast(true);
    setPastError(null);
    try {
      const data = await listExperimentDesigns();
      setPastDesigns(data);
    } catch (e) {
      setPastError(e instanceof Error ? e.message : "Failed to load designs");
    } finally {
      setLoadingPast(false);
    }
  }, []);

  useEffect(() => { void loadPastDesigns(); }, [loadPastDesigns]);

  async function handleDesign(e: React.FormEvent) {
    e.preventDefault();
    setDesigning(true);
    setDesignError(null);
    setDesign(null);
    setSimOutcome(null);
    try {
      const result = await designExperiment({
        name: name.trim(),
        experiment_type: expType,
        n_qubits: nQubits,
        target_precision: targetPrecision,
        budget_shots: budgetShots,
      });
      setDesign(result);
      void loadPastDesigns();
    } catch (e) {
      setDesignError(e instanceof Error ? e.message : "Design failed");
    } finally {
      setDesigning(false);
    }
  }

  async function handleSimulate() {
    if (!design) return;
    setSimulating(true);
    setSimError(null);
    try {
      const result = await simulateOED({ design_id: design.design_id, noise_level: noiseLevel });
      setSimOutcome(result);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setSimulating(false);
    }
  }

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Optimal Experiment Design</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 0" }}>
            Maximize Fisher information and minimize Cramér–Rao bound for quantum experiments
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Design form */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Compute Optimal Design</div>
          {designError && <ErrorBanner msg={designError} onDismiss={() => setDesignError(null)} />}
          <form onSubmit={(e) => void handleDesign(e)}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 16 }}>
              <FormField label="Design Name">
                <input className="input" value={name} onChange={e => setName(e.target.value)}
                  required placeholder="e.g. QST Fisher scan" style={{ height: 34 }} />
              </FormField>
              <FormField label="Experiment Type">
                <select className="input" value={expType} onChange={e => setExpType(e.target.value as ExperimentType)}
                  style={{ height: 34 }}>
                  {EXPERIMENT_TYPES.map(t => (
                    <option key={t} value={t}>{t.toUpperCase()}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Qubits (1–10)">
                <input className="input" type="number" min={1} max={10} value={nQubits}
                  onChange={e => setNQubits(parseInt(e.target.value, 10))} style={{ height: 34 }} />
              </FormField>
              <FormField label={`Target Precision: ${targetPrecision.toFixed(3)}`}>
                <input type="range" min={0.001} max={0.1} step={0.001} value={targetPrecision}
                  onChange={e => setTargetPrecision(parseFloat(e.target.value))}
                  style={{ marginTop: 6 }} />
              </FormField>
              <FormField label="Budget Shots">
                <input className="input" type="number" min={100} step={100} value={budgetShots}
                  onChange={e => setBudgetShots(parseInt(e.target.value, 10))} style={{ height: 34 }} />
              </FormField>
            </div>
            <button className="button" type="submit" disabled={designing} style={{ height: 36 }}>
              {designing ? "Computing…" : "Compute Optimal Design"}
            </button>
          </form>
        </div>

        {/* Design result */}
        {design && (
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{design.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {design.experiment_type.toUpperCase()} · {design.n_qubits} qubits · {new Date(design.created_at).toLocaleString()}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
              <StatBlock label="Optimal Shots" value={design.optimal_shots.toLocaleString()} color="var(--strong)" />
              <StatBlock label="Fisher Information" value={design.fisher_information.toFixed(4)} color="#818cf8" />
              <StatBlock label="Cramér–Rao Bound" value={design.cramer_rao_bound.toFixed(6)} color="#f59e0b" />
              <StatBlock label="Est. Runtime" value={`${design.estimated_runtime_min.toFixed(1)} min`} color="var(--text)" />
            </div>

            {design.recommended_circuits.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                  Recommended Circuits ({design.recommended_circuits.length})
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {design.recommended_circuits.map((c, i) => (
                    <span key={i} style={{
                      padding: "3px 10px", borderRadius: 6, fontSize: 12, background: "var(--panel-2)",
                      border: "1px solid var(--line)", fontFamily: "monospace",
                    }}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Simulate execution */}
            {simError && <ErrorBanner msg={simError} onDismiss={() => setSimError(null)} />}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Simulate Execution</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ minWidth: 100, fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
                    Noise level: {noiseLevel.toFixed(3)}
                  </span>
                  <input type="range" min={0} max={0.1} step={0.001} value={noiseLevel}
                    onChange={e => setNoiseLevel(parseFloat(e.target.value))} style={{ width: 160 }} />
                </label>
                <button className="button" type="button" onClick={() => void handleSimulate()}
                  disabled={simulating} style={{ height: 34 }}>
                  {simulating ? "Simulating…" : "Simulate Execution"}
                </button>
              </div>

              {simOutcome && (
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  <StatBlock
                    label="Achieved Precision"
                    value={simOutcome.achieved_precision.toFixed(5)}
                    color={simOutcome.achieved_precision <= design.target_precision ? "#22c55e" : "#ef4444"}
                  />
                  <StatBlock label="Achieved Fidelity" value={`${(simOutcome.achieved_fidelity * 100).toFixed(2)}%`} color="#22c55e" />
                  <StatBlock label="Shots Used" value={simOutcome.total_shots_used.toLocaleString()} />
                  <div style={{ background: "var(--panel-2)", borderRadius: 8, border: "1px solid var(--line)", padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>Converged</div>
                    <span style={{
                      display: "inline-block", padding: "3px 12px", borderRadius: 999, fontSize: 13, fontWeight: 700,
                      background: simOutcome.converged ? "#dcfce7" : "#fee2e2",
                      color: simOutcome.converged ? "#15803d" : "#b91c1c",
                      alignSelf: "flex-start",
                    }}>
                      {simOutcome.converged ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Past designs table */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>All Designs</div>
          {pastError && <ErrorBanner msg={pastError} onDismiss={() => setPastError(null)} />}
          {loadingPast ? (
            <div className="empty" style={{ padding: "20px 0" }}>Loading designs…</div>
          ) : pastDesigns.length === 0 ? (
            <div className="empty" style={{ padding: "20px 0" }}>No experiment designs yet.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    {["Name", "Type", "Qubits", "Optimal Shots", "Fisher Info", "Runtime (min)"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pastDesigns.map(d => (
                    <tr key={d.design_id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{d.name}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                          background: "var(--panel-2)", border: "1px solid var(--line)",
                        }}>
                          {d.experiment_type.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{d.n_qubits}</td>
                      <td style={{ padding: "8px 10px", color: "var(--strong)", fontWeight: 700 }}>{d.optimal_shots.toLocaleString()}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{d.fisher_information.toFixed(4)}</td>
                      <td style={{ padding: "8px 10px" }}>{d.estimated_runtime_min.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
