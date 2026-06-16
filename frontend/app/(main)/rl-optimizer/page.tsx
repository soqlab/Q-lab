"use client";

import { useState, useEffect, useCallback } from "react";
import {
  trainRLOptimizer,
  listRLSessions,
  applyRLOptimizer,
  RLSession,
  RLOptimizedCircuit,
} from "../../../lib/api";

const BACKENDS = ["ibm_brisbane", "ibm_kyoto", "ionq_aria_1", "rigetti_ankaa_2"];
const ALGORITHMS = ["ppo", "dqn", "sac"];
const OBJECTIVES = ["depth", "fidelity", "cnot_count"];

function TrainingCurve({ curve }: { curve: number[] }) {
  if (!curve || curve.length === 0)
    return <div style={{ color: "var(--muted)", fontSize: 13 }}>No training data yet.</div>;

  const W = 480, H = 140, padL = 44, padR = 12, padT = 12, padB = 28;
  const minR = Math.min(...curve);
  const maxR = Math.max(...curve);
  const range = maxR - minR || 1;
  const n = curve.length;

  const px = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const py = (r: number) => padT + (1 - (r - minR) / range) * (H - padT - padB);

  const points = curve.map((r, i) => `${px(i)},${py(r)}`).join(" ");
  const area = `M${px(0)},${py(curve[0])} ` + curve.map((r, i) => `L${px(i)},${py(r)}`).join(" ") + ` L${px(n - 1)},${H - padB} L${px(0)},${H - padB} Z`;

  const yTicks = [minR, minR + range / 2, maxR];
  const xStep = Math.ceil(n / 5);

  return (
    <svg width={W} height={H} style={{ overflow: "visible", display: "block" }}>
      <defs>
        <linearGradient id="rlgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={py(v)} x2={W - padR} y2={py(v)} stroke="#1f2937" strokeDasharray="3,3" />
          <text x={padL - 4} y={py(v) + 4} fontSize={9} fill="#6b7280" textAnchor="end">{v.toFixed(2)}</text>
        </g>
      ))}
      {curve.filter((_, i) => i % xStep === 0 || i === n - 1).map((_, idx) => {
        const i = Math.min(idx * xStep, n - 1);
        return (
          <text key={i} x={px(i)} y={H - padB + 14} fontSize={9} fill="#6b7280" textAnchor="middle">{i}</text>
        );
      })}
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#374151" />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#374151" />
      <path d={area} fill="url(#rlgrad)" />
      <polyline points={points} fill="none" stroke="#6366f1" strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={px(n - 1)} cy={py(curve[n - 1])} r={3} fill="#10b981" />
      <text x={padL - 2} y={padT - 3} fontSize={9} fill="#6b7280">reward</text>
      <text x={W / 2} y={H - 2} fontSize={9} fill="#6b7280" textAnchor="middle">episode</text>
    </svg>
  );
}

export default function RLOptimizerPage() {
  const [sessions, setSessions] = useState<RLSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState("");

  const [form, setForm] = useState({
    name: "",
    backend: "ibm_brisbane",
    n_qubits: 2,
    algorithm: "ppo",
    objective: "depth",
    episodes: 500,
  });
  const [training, setTraining] = useState(false);
  const [trainError, setTrainError] = useState("");
  const [latestSession, setLatestSession] = useState<RLSession | null>(null);

  const [applyQasm, setApplyQasm] = useState("");
  const [applySessionId, setApplySessionId] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [applyResult, setApplyResult] = useState<RLOptimizedCircuit | null>(null);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const s = await listRLSessions();
      setSessions(s);
      setSessionsError("");
      if (s.length > 0 && !applySessionId) setApplySessionId(s[0].session_id);
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setLoadingSessions(false);
    }
  }, [applySessionId]);

  useEffect(() => { void loadSessions(); }, []);

  const handleTrain = async () => {
    if (!form.name.trim()) { setTrainError("Name is required"); return; }
    setTraining(true);
    setTrainError("");
    try {
      const sess = await trainRLOptimizer({
        name: form.name.trim(),
        backend: form.backend,
        n_qubits: form.n_qubits,
        algorithm: form.algorithm,
        objective: form.objective,
        episodes: form.episodes,
      });
      setLatestSession(sess);
      setSessions(prev => [sess, ...prev]);
      setApplySessionId(sess.session_id);
    } catch (e) {
      setTrainError(e instanceof Error ? e.message : "Training failed");
    } finally {
      setTraining(false);
    }
  };

  const handleApply = async () => {
    if (!applyQasm.trim()) { setApplyError("Paste a QASM circuit"); return; }
    if (!applySessionId) { setApplyError("Select a session"); return; }
    setApplying(true);
    setApplyError("");
    try {
      const res = await applyRLOptimizer({ session_id: applySessionId, circuit_qasm: applyQasm });
      setApplyResult(res);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const displaySession = latestSession ?? (sessions.length > 0 ? sessions[0] : null);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>RL Circuit Optimizer</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Reinforcement learning agents compress quantum circuits by minimizing gate depth, CNOT count, or maximising fidelity.
        </p>
      </div>

      {/* Training form */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h2>Train Agent</h2></div>
        <div style={{ padding: 16 }}>
          {trainError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fee2e2", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
              {trainError}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Session Name</span>
              <input
                className="input"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. VQE depth opt"
                style={{ height: 34 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Backend</span>
              <select className="input" value={form.backend} onChange={e => setForm(f => ({ ...f, backend: e.target.value }))} style={{ height: 34 }}>
                {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Qubits (1–6)</span>
              <input
                className="input"
                type="number"
                min={1}
                max={6}
                value={form.n_qubits}
                onChange={e => setForm(f => ({ ...f, n_qubits: Number(e.target.value) }))}
                style={{ height: 34 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Algorithm</span>
              <select className="input" value={form.algorithm} onChange={e => setForm(f => ({ ...f, algorithm: e.target.value }))} style={{ height: 34 }}>
                {ALGORITHMS.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Objective</span>
              <select className="input" value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} style={{ height: 34 }}>
                {OBJECTIVES.map(o => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
              </select>
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
              Episodes: <strong style={{ color: "var(--text)" }}>{form.episodes}</strong>
            </span>
            <input
              type="range"
              min={100}
              max={2000}
              step={100}
              value={form.episodes}
              onChange={e => setForm(f => ({ ...f, episodes: Number(e.target.value) }))}
              style={{ accentColor: "#6366f1" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)" }}>
              <span>100</span><span>2000</span>
            </div>
          </label>
          <button className="button" onClick={() => void handleTrain()} disabled={training} style={{ height: 36 }}>
            {training ? "Training…" : "Train"}
          </button>
        </div>
      </div>

      {/* Stats card */}
      {displaySession && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <h2>Session — {displaySession.name}</h2>
            <span style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 4,
              background: displaySession.status === "completed" ? "#dcfce7" : "#fef3c7",
              color: displaySession.status === "completed" ? "#15803d" : "#92400e",
              fontWeight: 600,
            }}>{displaySession.status}</span>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginBottom: 20 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 36, fontWeight: 800, color: "#10b981" }}>
                  {displaySession.depth_reduction_pct.toFixed(1)}%
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Depth Reduction</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 36, fontWeight: 800, color: "#6366f1" }}>
                  +{(displaySession.gate_fidelity_improvement * 100).toFixed(2)}%
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Fidelity Improvement</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Circuit Depth</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                  <span style={{ color: "#ef4444", fontWeight: 700 }}>{displaySession.initial_circuit_depth}</span>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>→</span>
                  <span style={{ color: "#10b981", fontWeight: 700 }}>{displaySession.optimized_circuit_depth}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Algorithm</div>
                <div style={{ fontWeight: 700 }}>{displaySession.algorithm.toUpperCase()}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Episodes</div>
                <div style={{ fontWeight: 700 }}>{displaySession.episodes}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Best Reward</div>
                <div style={{ fontWeight: 700 }}>{displaySession.best_reward.toFixed(4)}</div>
              </div>
            </div>

            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Training Curve</div>
            <div style={{ overflowX: "auto" }}>
              <TrainingCurve curve={displaySession.training_curve} />
            </div>
          </div>
        </div>
      )}

      {/* Apply panel */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h2>Apply Policy to Circuit</h2></div>
        <div style={{ padding: 16 }}>
          {applyError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fee2e2", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
              {applyError}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, marginBottom: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Session</span>
              <select
                className="input"
                value={applySessionId}
                onChange={e => setApplySessionId(e.target.value)}
                style={{ height: 34 }}
              >
                {sessions.map(s => (
                  <option key={s.session_id} value={s.session_id}>{s.name} ({s.algorithm.toUpperCase()})</option>
                ))}
              </select>
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Circuit QASM</span>
            <textarea
              className="input"
              rows={5}
              value={applyQasm}
              onChange={e => setApplyQasm(e.target.value)}
              placeholder={"OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[2];\n..."}
              style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
            />
          </label>
          <button className="button" onClick={() => void handleApply()} disabled={applying} style={{ height: 36 }}>
            {applying ? "Applying…" : "Apply Policy"}
          </button>

          {applyResult && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Original Depth</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#ef4444" }}>{applyResult.original_depth}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Optimized Depth</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#10b981" }}>{applyResult.optimized_depth}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Gate Count</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    <span style={{ color: "#ef4444" }}>{applyResult.original_gate_count}</span>
                    {" → "}
                    <span style={{ color: "#10b981" }}>{applyResult.optimized_gate_count}</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Est. Fidelity Gain</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#6366f1" }}>
                    +{(applyResult.estimated_fidelity_gain * 100).toFixed(2)}%
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>Original QASM</div>
                  <pre style={{
                    background: "var(--panel-2)", borderRadius: 6, padding: 12,
                    fontSize: 11, fontFamily: "monospace", overflow: "auto", maxHeight: 200, margin: 0,
                    border: "1px solid var(--line)",
                  }}>{applyResult.original_qasm}</pre>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#10b981", marginBottom: 4, fontWeight: 600 }}>Optimized QASM</div>
                  <pre style={{
                    background: "var(--panel-2)", borderRadius: 6, padding: 12,
                    fontSize: 11, fontFamily: "monospace", overflow: "auto", maxHeight: 200, margin: 0,
                    border: "1px solid #10b98144",
                  }}>{applyResult.optimized_qasm}</pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sessions table */}
      <div className="panel">
        <div className="panel-header">
          <h2>All Sessions</h2>
          <button className="button secondary" onClick={() => void loadSessions()} style={{ height: 28, fontSize: 12 }}>
            Refresh
          </button>
        </div>
        {loadingSessions ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading sessions…</div>
        ) : sessionsError ? (
          <div style={{ padding: 16, color: "#b91c1c", fontSize: 13 }}>{sessionsError}</div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No sessions yet. Train your first agent above.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["Name", "Algorithm", "Objective", "Depth Reduction", "Status", "Created"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr
                    key={s.session_id}
                    style={{ borderBottom: "1px solid var(--line)", cursor: "pointer" }}
                    onClick={() => { setLatestSession(s); setApplySessionId(s.session_id); }}
                  >
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>{s.name}</td>
                    <td style={{ padding: "8px 12px" }}>{s.algorithm.toUpperCase()}</td>
                    <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{s.objective}</td>
                    <td style={{ padding: "8px 12px", color: "#10b981", fontWeight: 700 }}>{s.depth_reduction_pct.toFixed(1)}%</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{
                        fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600,
                        background: s.status === "completed" ? "#dcfce7" : "#fef3c7",
                        color: s.status === "completed" ? "#15803d" : "#92400e",
                      }}>{s.status}</span>
                    </td>
                    <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{new Date(s.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
