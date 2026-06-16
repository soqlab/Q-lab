"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  schedulePulse,
  listPulseSchedules,
  simulatePulse,
  getBackendNativeGates,
  PulseSchedule,
  PulseSimResult,
} from "@/lib/api";

const BACKENDS = ["ibm_brisbane", "ibm_kyoto", "ibm_sherbrooke"] as const;
type Backend = (typeof BACKENDS)[number];

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

function Chip({ label, color = "var(--panel-2)" }: { label: string; color?: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12,
      background: color, border: "1px solid var(--line)", fontFamily: "monospace",
    }}>
      {label}
    </span>
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

export default function PulseControlPage() {
  // Form state
  const [formName, setFormName] = useState("");
  const [formBackend, setFormBackend] = useState<Backend>("ibm_brisbane");
  const [formQubits, setFormQubits] = useState(1);
  const [formGates, setFormGates] = useState("");
  const [formOptimizeDrag, setFormOptimizeDrag] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [schedule, setSchedule] = useState<PulseSchedule | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  // Simulation state
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<PulseSimResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  // Native gates panel
  const [ngBackend, setNgBackend] = useState<Backend>("ibm_brisbane");
  const [loadingNg, setLoadingNg] = useState(false);
  const [nativeGates, setNativeGates] = useState<{ backend: string; native_gates: string[]; basis_gates: string[]; qubit_count: number } | null>(null);
  const [ngError, setNgError] = useState<string | null>(null);

  // Past schedules
  const [pastSchedules, setPastSchedules] = useState<PulseSchedule[]>([]);
  const [loadingPast, setLoadingPast] = useState(true);
  const [pastError, setPastError] = useState<string | null>(null);

  const loadPastSchedules = useCallback(async () => {
    setLoadingPast(true);
    setPastError(null);
    try {
      const data = await listPulseSchedules();
      setPastSchedules(data);
    } catch (e) {
      setPastError(e instanceof Error ? e.message : "Failed to load schedules");
    } finally {
      setLoadingPast(false);
    }
  }, []);

  useEffect(() => { void loadPastSchedules(); }, [loadPastSchedules]);

  async function handleCompile(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;
    setCompiling(true);
    setCompileError(null);
    setSchedule(null);
    setSimResult(null);
    try {
      const gates = formGates.split(",").map(g => g.trim()).filter(Boolean);
      const result = await schedulePulse({
        name: formName.trim(),
        backend: formBackend,
        n_qubits: formQubits,
        gates,
        optimize_drag: formOptimizeDrag,
      });
      setSchedule(result);
      void loadPastSchedules();
    } catch (e) {
      setCompileError(e instanceof Error ? e.message : "Compilation failed");
    } finally {
      setCompiling(false);
    }
  }

  async function handleSimulate() {
    if (!schedule) return;
    setSimulating(true);
    setSimError(null);
    try {
      const result = await simulatePulse({ schedule_id: schedule.schedule_id, n_shots: 1024 });
      setSimResult(result);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setSimulating(false);
    }
  }

  async function handleLoadNativeGates() {
    setLoadingNg(true);
    setNgError(null);
    try {
      const data = await getBackendNativeGates(ngBackend);
      setNativeGates(data);
    } catch (e) {
      setNgError(e instanceof Error ? e.message : "Failed to load native gates");
    } finally {
      setLoadingNg(false);
    }
  }

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Pulse-Level Control</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 0" }}>
            Compile, inspect, and simulate native pulse schedules for IBM Quantum backends
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>
        {/* LEFT: Compiler + schedule display */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Compiler form */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Compile Pulse Schedule</div>
            <form onSubmit={(e) => void handleCompile(e)}>
              {compileError && <ErrorBanner msg={compileError} onDismiss={() => setCompileError(null)} />}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <FormField label="Schedule Name">
                  <input
                    className="input"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g. DRAG-optimised RZ"
                    required
                    style={{ height: 34 }}
                  />
                </FormField>
                <FormField label="Backend">
                  <select
                    className="input"
                    value={formBackend}
                    onChange={e => setFormBackend(e.target.value as Backend)}
                    style={{ height: 34 }}
                  >
                    {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </FormField>
                <FormField label="Qubits (1–5)">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={5}
                    value={formQubits}
                    onChange={e => setFormQubits(parseInt(e.target.value, 10))}
                    style={{ height: 34 }}
                  />
                </FormField>
                <FormField label="Gates (comma-separated)">
                  <input
                    className="input"
                    value={formGates}
                    onChange={e => setFormGates(e.target.value)}
                    placeholder="rx, ry, cx, rz"
                    style={{ height: 34 }}
                  />
                </FormField>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={formOptimizeDrag}
                    onChange={e => setFormOptimizeDrag(e.target.checked)}
                  />
                  Optimize DRAG parameters
                </label>
              </div>
              <button className="button" type="submit" disabled={compiling} style={{ height: 34 }}>
                {compiling ? "Compiling…" : "Compile Schedule"}
              </button>
            </form>
          </div>

          {/* Schedule result */}
          {schedule && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{schedule.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {schedule.backend} · {new Date(schedule.created_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 20 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>DURATION</div>
                    <div style={{ fontWeight: 800, fontSize: 18, color: "var(--strong)" }}>{schedule.total_duration_ns} ns</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>GATE FIDELITY</div>
                    <div style={{ fontWeight: 800, fontSize: 18, color: "#22c55e" }}>
                      {(schedule.gate_fidelity_estimate * 100).toFixed(2)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Waveforms */}
              {schedule.waveforms.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    Waveforms ({schedule.waveforms.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {schedule.waveforms.map(w => (
                      <div key={w.waveform_id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "8px 12px", background: "var(--panel-2)", borderRadius: 6, fontSize: 12,
                        border: "1px solid var(--line)",
                      }}>
                        <span style={{ fontWeight: 600 }}>{w.name}</span>
                        <span style={{ color: "var(--muted)" }}>{w.type}</span>
                        <span>{w.duration_ns} ns</span>
                        <span style={{ color: "#818cf8" }}>amp: {w.amplitude.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Channels */}
              {schedule.channels.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    Channels ({schedule.channels.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {schedule.channels.map(ch => (
                      <div key={ch.channel_id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "8px 12px", background: "var(--panel-2)", borderRadius: 6, fontSize: 12,
                        border: "1px solid var(--line)",
                      }}>
                        <span style={{ fontWeight: 600 }}>{ch.name}</span>
                        <span style={{ color: "var(--muted)" }}>{ch.type}</span>
                        <span>Q{ch.qubit}</span>
                        <span style={{ color: "#818cf8" }}>{ch.frequency_ghz.toFixed(4)} GHz</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Simulate button */}
              {simError && <ErrorBanner msg={simError} onDismiss={() => setSimError(null)} />}
              <button
                className="button"
                type="button"
                onClick={() => void handleSimulate()}
                disabled={simulating}
                style={{ height: 34 }}
              >
                {simulating ? "Simulating…" : "Simulate (1024 shots)"}
              </button>
            </div>
          )}

          {/* Simulation result */}
          {simResult && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Simulation Result</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                {[
                  { label: "State Fidelity", value: `${(simResult.state_fidelity * 100).toFixed(2)}%`, color: "#22c55e" },
                  { label: "Leakage", value: `${(simResult.leakage * 100).toFixed(3)}%`, color: "#f59e0b" },
                  { label: "Control Error", value: `${(simResult.control_error * 100).toFixed(3)}%`, color: "#ef4444" },
                  { label: "Duration", value: `${simResult.duration_ns} ns`, color: "var(--text)" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "var(--panel-2)", borderRadius: 8, border: "1px solid var(--line)", padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontWeight: 800, fontSize: 18, color }}>{value}</div>
                  </div>
                ))}
              </div>

              {simResult.bloch_trajectory.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    Bloch Trajectory (first 5 points)
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--line)" }}>
                        {["#", "X", "Y", "Z"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {simResult.bloch_trajectory.slice(0, 5).map((pt, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                          <td style={{ padding: "6px 10px", color: "var(--muted)" }}>{i + 1}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "monospace" }}>{(pt.x ?? 0).toFixed(4)}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "monospace" }}>{(pt.y ?? 0).toFixed(4)}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "monospace" }}>{(pt.z ?? 0).toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Past schedules table */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Past Schedules</div>
            {pastError && <ErrorBanner msg={pastError} onDismiss={() => setPastError(null)} />}
            {loadingPast ? (
              <div className="empty" style={{ padding: "20px 0" }}>Loading schedules…</div>
            ) : pastSchedules.length === 0 ? (
              <div className="empty" style={{ padding: "20px 0" }}>No schedules compiled yet.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    {["Name", "Backend", "Duration (ns)", "Fidelity"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pastSchedules.map(s => (
                    <tr key={s.schedule_id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{s.name}</td>
                      <td style={{ padding: "8px 10px", color: "var(--muted)", fontFamily: "monospace", fontSize: 12 }}>{s.backend}</td>
                      <td style={{ padding: "8px 10px" }}>{s.total_duration_ns}</td>
                      <td style={{ padding: "8px 10px", color: "#22c55e", fontWeight: 700 }}>
                        {(s.gate_fidelity_estimate * 100).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT: Native gates lookup */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Native Gates Lookup</div>
            {ngError && <ErrorBanner msg={ngError} onDismiss={() => setNgError(null)} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <FormField label="Backend">
                <select
                  className="input"
                  value={ngBackend}
                  onChange={e => setNgBackend(e.target.value as Backend)}
                  style={{ height: 34 }}
                >
                  {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </FormField>
              <button
                className="button"
                type="button"
                onClick={() => void handleLoadNativeGates()}
                disabled={loadingNg}
                style={{ height: 34 }}
              >
                {loadingNg ? "Loading…" : "Load Gates"}
              </button>
            </div>

            {nativeGates && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                  {nativeGates.backend} · {nativeGates.qubit_count} qubits
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    Native Gates
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {nativeGates.native_gates.map(g => (
                      <Chip key={g} label={g} color="#1e1b4b" />
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    Basis Gates
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {nativeGates.basis_gates.map(g => (
                      <Chip key={g} label={g} color="#0c1a2e" />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
