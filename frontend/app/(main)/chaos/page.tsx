"use client";
import { useEffect, useState } from "react";
import { FaultResult, FaultSweepPoint, injectFaults, faultSweep, listFaultResults } from "../../../lib/api";
import { AlertOctagon, ShieldCheck, Play, TrendingUp } from "lucide-react";

const PRESET_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[1],q[2];
measure q -> c;`;

const FAULT_TYPES = [
  { id: "bit_flip", label: "Bit Flip", desc: "Random X gate injection", icon: "⚡" },
  { id: "phase_flip", label: "Phase Flip", desc: "Random Z gate injection", icon: "🌀" },
  { id: "depolarizing", label: "Depolarizing", desc: "Random X/Y/Z injection", icon: "☢️" },
  { id: "amplitude_damping", label: "Amplitude Damping", desc: "Qubit energy loss (reset)", icon: "📉" },
];

const GRADE_COLOR: Record<string, string> = {
  A: "#10b981", B: "#3b82f6", C: "#f59e0b", D: "#f97316", F: "#ef4444",
};

function SweepChart({ sweep }: { sweep: FaultSweepPoint[] }) {
  if (!sweep.length) return null;
  const W = 480; const H = 130; const PAD = 30;
  const px = (i: number) => PAD + (i / Math.max(sweep.length - 1, 1)) * (W - PAD * 2);
  const py = (v: number) => H - PAD - v * (H - PAD * 2);
  const resPts = sweep.map((s, i) => `${px(i)},${py(s.resilience_score)}`).join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block", width: "100%" }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" strokeWidth={1} />
      <line x1={PAD} y1={py(0.5)} x2={W - PAD} y2={py(0.5)} stroke="#f97316" strokeWidth={1} strokeDasharray="4 2" />
      <text x={W - PAD + 2} y={py(0.5) + 4} fill="#f97316" fontSize={9}>0.5</text>
      <polyline points={resPts} fill="none" stroke="#3b82f6" strokeWidth={2} />
      {sweep.map((s, i) => (
        <circle key={i} cx={px(i)} cy={py(s.resilience_score)} r={4}
          fill={s.resilience_score >= 0.8 ? "#10b981" : s.resilience_score >= 0.5 ? "#f59e0b" : "#ef4444"} />
      ))}
      {sweep.map((s, i) => (
        <text key={i} x={px(i)} y={H - PAD + 12} textAnchor="middle" fill="#475569" fontSize={9}>
          {(s.fault_rate * 100).toFixed(0)}%
        </text>
      ))}
      <text x={PAD} y={PAD - 6} fill="#3b82f6" fontSize={10}>Resilience Score vs Fault Rate</text>
    </svg>
  );
}

export default function ChaosPage() {
  const [qasm, setQasm] = useState(PRESET_QASM);
  const [faultType, setFaultType] = useState("depolarizing");
  const [faultRate, setFaultRate] = useState(0.05);
  const [nTrials, setNTrials] = useState(20);
  const [result, setResult] = useState<FaultResult | null>(null);
  const [sweep, setSweep] = useState<FaultSweepPoint[]>([]);
  const [history, setHistory] = useState<FaultResult[]>([]);
  const [running, setRunning] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listFaultResults().then(setHistory).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleInject = async () => {
    setRunning(true); setError(null);
    try {
      const r = await injectFaults({ qasm, fault_type: faultType, fault_rate: faultRate, n_trials: nTrials });
      setResult(r); setHistory(prev => [r, ...prev]);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  };

  const handleSweep = async () => {
    setSweeping(true); setError(null);
    try {
      const r = await faultSweep(qasm, faultType);
      setSweep(r.curve);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSweeping(false); }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <AlertOctagon size={28} color="#f97316" /> Quantum Chaos Engineering
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Fault injection stress-tests circuits under simulated hardware noise. Identify resilience thresholds before running on real QPUs.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "1.5rem" }}>
        <div>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>Fault Configuration</h3>

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 10 }}>
              QASM
              <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={7}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box", resize: "vertical" }} />
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {FAULT_TYPES.map(f => (
                <button key={f.id} onClick={() => setFaultType(f.id)}
                  style={{ textAlign: "left", background: faultType === f.id ? "#1d3a6b" : "#0f172a", border: `1px solid ${faultType === f.id ? "#3b82f6" : "#334155"}`, borderRadius: 8, padding: "0.5rem 0.75rem", cursor: "pointer" }}>
                  <span style={{ color: "#e2e8f0", fontSize: "0.85rem" }}>{f.icon} {f.label}</span>
                  <span style={{ color: "#475569", fontSize: "0.72rem", display: "block" }}>{f.desc}</span>
                </button>
              ))}
            </div>

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 8 }}>
              Fault Rate: <span style={{ color: "#f97316", fontWeight: 700 }}>{(faultRate * 100).toFixed(0)}%</span>
              <input type="range" min={1} max={50} step={1} value={faultRate * 100} onChange={e => setFaultRate(Number(e.target.value) / 100)}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#f97316" }} />
            </label>

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 12 }}>
              Trials: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{nTrials}</span>
              <input type="range" min={5} max={100} step={5} value={nTrials} onChange={e => setNTrials(Number(e.target.value))}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#3b82f6" }} />
            </label>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleInject} disabled={running}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#f97316", color: "#fff", border: "none", borderRadius: 8, padding: "0.6rem", cursor: "pointer", fontWeight: 600, opacity: running ? 0.6 : 1, fontSize: "0.85rem" }}>
                <Play size={14} /> {running ? "Injecting…" : "Inject Faults"}
              </button>
              <button onClick={handleSweep} disabled={sweeping}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem", cursor: "pointer", fontSize: "0.85rem", opacity: sweeping ? 0.6 : 1 }}>
                <TrendingUp size={14} /> {sweeping ? "Sweeping…" : "Rate Sweep"}
              </button>
            </div>
          </div>

          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
            <h3 style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>History</h3>
            {loading ? <div style={{ color: "#475569", fontSize: "0.8rem" }}>Loading…</div> :
              history.slice(0, 6).map(r => (
                <div key={r.result_id} onClick={() => setResult(r)} style={{ padding: "0.5rem", borderRadius: 6, marginBottom: 4, cursor: "pointer", background: result?.result_id === r.result_id ? "#0f172a" : "transparent" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#e2e8f0", fontSize: "0.82rem" }}>{r.fault_type} {(r.fault_rate * 100).toFixed(0)}%</span>
                    <span style={{ color: GRADE_COLOR[r.grade] ?? "#64748b", fontWeight: 700, fontSize: "0.82rem" }}>Grade {r.grade}</span>
                  </div>
                  <div style={{ color: "#475569", fontSize: "0.7rem" }}>{r.circuit_name} · {new Date(r.created_at).toLocaleString()}</div>
                </div>
              ))
            }
          </div>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Resilience Score", value: `${(result.resilience_score * 100).toFixed(1)}%`, color: result.resilience_score > 0.7 ? "#10b981" : "#ef4444" },
                  { label: "Grade", value: result.grade, color: GRADE_COLOR[result.grade] ?? "#64748b" },
                  { label: "Mean Fidelity", value: `${(result.mean_fidelity * 100).toFixed(1)}%`, color: "#3b82f6" },
                  { label: "Min Fidelity", value: `${(result.min_fidelity * 100).toFixed(1)}%`, color: result.min_fidelity < 0.5 ? "#ef4444" : "#f59e0b" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.4rem", fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1rem" }}>
                <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <ShieldCheck size={16} color="#10b981" /> Resilience Assessment
                </h3>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ flex: 1, height: 20, background: "#0f172a", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${result.resilience_score * 100}%`, height: "100%", background: result.resilience_score > 0.7 ? "#10b981" : result.resilience_score > 0.5 ? "#f59e0b" : "#ef4444", borderRadius: 99 }} />
                  </div>
                  <span style={{ color: GRADE_COLOR[result.grade], fontWeight: 800, fontSize: "1.2rem", width: 60 }}>Grade {result.grade}</span>
                </div>
                <div style={{ marginTop: 10, color: "#64748b", fontSize: "0.82rem" }}>
                  {result.n_trials} trials · {result.fault_type} at {(result.fault_rate * 100).toFixed(0)}% rate · {result.interpretation}
                </div>
              </div>

              <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 8, fontSize: "0.9rem" }}>Trial Fidelity Distribution</h3>
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 80 }}>
                  {result.trial_fidelities.slice(0, 40).map((fidelity, i) => {
                    const h = Math.max(4, fidelity * 76);
                    const color = fidelity >= 0.8 ? "#10b981" : fidelity >= 0.5 ? "#f59e0b" : "#ef4444";
                    return <div key={i} style={{ flex: 1, height: h, background: color, borderRadius: "2px 2px 0 0", minWidth: 4 }} title={`Trial ${i + 1}: ${(fidelity * 100).toFixed(1)}%`} />;
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, color: "#475569", fontSize: "0.72rem" }}>
                  <span>Trial 1</span>
                  <span style={{ color: "#10b981" }}>■ ≥80%</span>
                  <span style={{ color: "#f59e0b" }}>■ 50-80%</span>
                  <span style={{ color: "#ef4444" }}>■ &lt;50%</span>
                  <span>Trial {result.trial_fidelities.length}</span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, color: "#475569" }}>
              <AlertOctagon size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Select a fault model and inject to see circuit resilience.</p>
            </div>
          )}

          {sweep.length > 0 && (
            <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginTop: "1rem" }}>
              <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 8 }}>{faultType} — Fault Rate Sweep</h3>
              <SweepChart sweep={sweep} />
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: "0.75rem" }}>
                <span style={{ color: "#10b981" }}>● ≥80% resilient</span>
                <span style={{ color: "#f59e0b" }}>● 50-80%</span>
                <span style={{ color: "#ef4444" }}>● &lt;50% fragile</span>
                <span style={{ color: "#f97316", marginLeft: "auto" }}>--- 50% threshold</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
