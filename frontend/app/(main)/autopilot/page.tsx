"use client";
import { useState, useEffect } from "react";
import { startAutopilot, stepAutopilot, listAutopilotMissions, AutopilotMission } from "@/lib/api";

export default function AutopilotPage() {
  const [missions, setMissions] = useState<{ mission_id: string; name: string; status: string; current_iteration: number; best_value: number | null; estimated_completion_pct: number }[]>([]);
  const [active, setActive] = useState<AutopilotMission | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showStart, setShowStart] = useState(false);
  const [missionName, setMissionName] = useState("VQE Ground State Search");
  const [goal, setGoal] = useState("minimize_energy");
  const [backend, setBackend] = useState("ibm_brisbane");
  const [maxIter, setMaxIter] = useState(30);
  const [targetValue, setTargetValue] = useState(-1.857);
  const [stepValue, setStepValue] = useState("");

  useEffect(() => { loadMissions(); }, []);

  async function loadMissions() {
    try {
      const r = await listAutopilotMissions();
      setMissions(r.missions as typeof missions);
    } catch { /* ignore */ }
  }

  async function start() {
    setLoading(true); setError("");
    try {
      const m = await startAutopilot({ name: missionName, goal, backend, termination: { target_value: targetValue, max_iterations: maxIter, metric: "value", tolerance: 0.001, max_cost_usd: 100, confidence_required: 0.95 } });
      setActive(m);
      setShowStart(false);
      loadMissions();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function step() {
    if (!active || !stepValue) return;
    setLoading(true);
    try {
      const nextParams = { ...active.best_params };
      const m = await stepAutopilot({ mission_id: active.mission_id, value: Number(stepValue), params: nextParams, run_id: `manual_${Date.now()}` });
      setActive(m);
      setStepValue("");
      loadMissions();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const statusColor: Record<string, string> = { running: "var(--info-text)", converged: "var(--ok)", stopped: "var(--muted)", max_iter: "#f59e0b" };

  return (
    <div style={{ padding:24, maxWidth:1100, margin:"0 auto", display:"flex", flexDirection:"column", gap:24 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <h1 style={{ fontSize:24, fontWeight:700 }}>Experiment Autopilot</h1>
        <button onClick={() => setShowStart(!showStart)} className="button">
          + Launch Mission
        </button>
      </div>
      <p style={{ color:"var(--muted)" }}>Set a target (e.g. "find ground state energy to 1 mHa") and Q-Lab iterates circuits, adjusts parameters, picks backends, and stops when converged.</p>

      {error && <div style={{ color:"var(--danger)", background:"rgba(239,68,68,0.1)", borderRadius:6, padding:12 }}>{error}</div>}

      {showStart && (
        <div style={{ background:"var(--surface)", borderRadius:8, padding:20, display:"flex", flexDirection:"column", gap:16 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            <div>
              <label style={{ fontSize:13, color:"var(--muted)" }}>Mission Name</label>
              <input value={missionName} onChange={e => setMissionName(e.target.value)}
                className="input" style={{ width:"100%", marginTop:4 }} />
            </div>
            <div>
              <label style={{ fontSize:13, color:"var(--muted)" }}>Goal</label>
              <select value={goal} onChange={e => setGoal(e.target.value)}
                className="input" style={{ width:"100%", marginTop:4 }}>
                {["minimize_energy", "maximize_fidelity", "maximize_approximation_ratio", "minimize_error"].map(g => (
                  <option key={g} value={g}>{g.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize:13, color:"var(--muted)" }}>Backend</label>
              <select value={backend} onChange={e => setBackend(e.target.value)}
                className="input" style={{ width:"100%", marginTop:4 }}>
                {["ibm_brisbane", "ionq_aria_1", "rigetti_ankaa_2"].map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:13, color:"var(--muted)" }}>Target Value</label>
              <input type="number" step="any" value={targetValue} onChange={e => setTargetValue(Number(e.target.value))}
                className="input" style={{ width:"100%", marginTop:4, fontFamily:"ui-monospace,monospace" }} />
            </div>
            <div>
              <label style={{ fontSize:13, color:"var(--muted)" }}>Max Iterations</label>
              <input type="number" value={maxIter} onChange={e => setMaxIter(Number(e.target.value))}
                className="input" style={{ width:"100%", marginTop:4 }} />
            </div>
          </div>
          <div style={{ display:"flex", gap:12 }}>
            <button onClick={start} disabled={loading}
              style={{ padding:"8px 16px", background:"rgba(16,185,129,0.1)", border:"1px solid var(--ok)", color:"var(--ok)", borderRadius:6, fontSize:13, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
              Launch
            </button>
            <button onClick={() => setShowStart(false)} className="button secondary">Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:24 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <h2 style={{ fontSize:13, fontWeight:500, color:"var(--muted)", textTransform:"uppercase" }}>Missions</h2>
          {(missions ?? []).map(m => (
            <div key={m.mission_id} onClick={() => setActive(m as unknown as AutopilotMission)}
              style={{ background:"var(--surface)", borderRadius:8, padding:12, cursor:"pointer", border: active?.mission_id === m.mission_id ? "1px solid var(--strong)" : "1px solid transparent" }}>
              <div style={{ fontWeight:500, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.name}</div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginTop:4 }}>
                <span style={{ color: statusColor[m.status] ?? "var(--muted)" }}>{m.status}</span>
                <span style={{ color:"var(--muted)" }}>iter {m.current_iteration}</span>
              </div>
              <div style={{ marginTop:6, width:"100%", background:"var(--line)", borderRadius:999, height:6 }}>
                <div style={{ background:"var(--strong)", height:6, borderRadius:999, width:`${m.estimated_completion_pct}%` }} />
              </div>
              {m.best_value !== null && <div style={{ fontSize:12, fontFamily:"ui-monospace,monospace", color:"var(--strong)", marginTop:4 }}>best: {m.best_value.toFixed(6)}</div>}
            </div>
          ))}
        </div>

        {active && (
          <div style={{ gridColumn:"span 2", display:"flex", flexDirection:"column", gap:16 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
              {([
                ["Status", active.status, statusColor[active.status] ?? "var(--muted)"],
                ["Iteration", String(active.current_iteration), "var(--text)"],
                ["Best Value", active.best_value !== null ? active.best_value.toFixed(6) : "—", "var(--strong)"],
              ] as [string, string, string][]).map(([l, v, c]) => (
                <div key={l} style={{ background:"var(--surface)", borderRadius:8, padding:12, textAlign:"center" }}>
                  <div style={{ fontSize:12, color:"var(--muted)" }}>{l}</div>
                  <div style={{ fontFamily:"ui-monospace,monospace", fontWeight:600, marginTop:4, color:c }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ width:"100%", background:"var(--line)", borderRadius:999, height:12 }}>
              <div style={{ background:"var(--strong)", height:12, borderRadius:999, width:`${active.estimated_completion_pct}%` }} />
            </div>
            <div style={{ fontSize:12, color:"var(--muted)", textAlign:"center" }}>{active.estimated_completion_pct.toFixed(1)}% complete · ${active.total_cost_usd.toFixed(4)} spent</div>

            {active.converged && (
              <div style={{ background:"rgba(16,185,129,0.1)", border:"1px solid var(--ok)", borderRadius:6, padding:12, color:"var(--ok)", fontSize:13 }}>
                {active.convergence_reason}
              </div>
            )}

            {!active.converged && active.next_action && (
              <div style={{ background:"var(--surface)", borderRadius:8, padding:16, display:"flex", flexDirection:"column", gap:12 }}>
                <h3 style={{ fontWeight:500, fontSize:13 }}>Next Suggested Point</h3>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  {Object.entries(active.next_action.params as Record<string, unknown> || {}).map(([k, v]) => (
                    <div key={k} style={{ display:"flex", alignItems:"center", gap:8, fontSize:13 }}>
                      <span style={{ color:"var(--muted)", fontFamily:"ui-monospace,monospace" }}>{k}:</span>
                      <span style={{ fontFamily:"ui-monospace,monospace", color:"var(--strong)" }}>{typeof v === "number" ? v.toFixed(4) : String(v)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:12 }}>
                  <input type="number" step="any" placeholder="Your objective value" value={stepValue}
                    onChange={e => setStepValue(e.target.value)}
                    style={{ flex:1, background:"var(--surface)", color:"var(--text)", fontFamily:"ui-monospace,monospace", padding:"8px 12px", borderRadius:6, border:"1px solid var(--strong)", fontSize:13 }} />
                  <button onClick={step} disabled={loading || !stepValue} className="button"
                    style={{ opacity: (loading || !stepValue) ? 0.5 : 1, cursor: (loading || !stepValue) ? "not-allowed" : "pointer" }}>
                    Submit &amp; Iterate
                  </button>
                </div>
              </div>
            )}

            {(active.iterations ?? []).length > 0 && (
              <div style={{ background:"var(--surface)", borderRadius:8, padding:16 }}>
                <h3 style={{ fontWeight:500, fontSize:13, marginBottom:12 }}>Iteration History</h3>
                <div style={{ display:"flex", alignItems:"flex-end", gap:4, height:80 }}>
                  {(active.iterations as { value: number }[]).map((it, i) => {
                    const vals = (active.iterations as { value: number }[]).map(x => x.value);
                    const mn = Math.min(...vals); const mx = Math.max(...vals);
                    const pct = mx === mn ? 50 : ((it.value - mn) / (mx - mn)) * 100;
                    return <div key={i} style={{ flex:1, background:"var(--strong)", borderRadius:"4px 4px 0 0", height:`${Math.max(4, pct)}%` }} title={`iter ${i + 1}: ${it.value.toFixed(4)}`} />;
                  })}
                </div>
              </div>
            )}

            {(active.decision_log ?? []).length > 0 && (
              <div style={{ background:"var(--surface)", borderRadius:8, padding:16, display:"flex", flexDirection:"column", gap:8, maxHeight:192, overflowY:"auto" }}>
                <h3 style={{ fontWeight:500, fontSize:13 }}>Decision Log</h3>
                {(active.decision_log as { iteration: number; decision: string }[]).slice(-5).map((d, i) => (
                  <div key={i} style={{ fontSize:12, color:"var(--muted)" }}>
                    <span style={{ color:"var(--strong)", fontFamily:"ui-monospace,monospace" }}>iter {d.iteration}:</span> {d.decision}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
