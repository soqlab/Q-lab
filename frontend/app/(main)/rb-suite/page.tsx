"use client";

import { useState, useEffect } from "react";
import { RBSuiteResult, runRBSuite } from "../../../lib/api";
import { BarChart3, Play, Award, Zap } from "lucide-react";

type RBType = "standard" | "interleaved" | "simultaneous";

function gradeColor(grade: string): string {
  if (grade === "A") return "#10b981";
  if (grade === "B") return "#10b981";
  if (grade === "C") return "#f59e0b";
  if (grade === "D") return "#f97316";
  return "#ef4444";
}

export default function RBSuitePage() {
  const [rbType, setRBType] = useState<RBType>("standard");
  const [backend, setBackend] = useState<string>("ibm_nairobi");
  const [qubit, setQubit] = useState<number>(0);
  const [nSeeds, setNSeeds] = useState<number>(30);
  const [interleavedGate, setInterleavedGate] = useState<string>("cx");
  const [result, setResult] = useState<RBSuiteResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const req: Parameters<typeof runRBSuite>[0] = {
        rb_type: rbType,
        backend,
        qubit,
        n_seeds: nSeeds,
      };
      if (rbType === "interleaved") req.interleaved_gate = interleavedGate;
      const res = await runRBSuite(req);
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void handleRun(); }, []);

  function buildSVG(r: RBSuiteResult): React.ReactNode {
    const W = 560;
    const H = 200;
    const padL = 48;
    const padR = 16;
    const padT = 16;
    const padB = 36;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const lengths = r.sequence_lengths;
    const survivals = r.survival_probabilities;
    const fits = r.decay_curve.map((d) => d.fit);

    const minX = Math.min(...lengths);
    const maxX = Math.max(...lengths);
    const xRange = maxX - minX || 1;

    const toX = (m: number) => padL + ((m - minX) / xRange) * innerW;
    const toY = (v: number) => padT + (1 - v) * innerH;

    const survivalPoints = lengths.map((m, i) => `${toX(m)},${toY(survivals[i])}`).join(" ");
    const fitPoints = lengths.map((m, i) => `${toX(m)},${toY(fits[i] ?? 0)}`).join(" ");

    const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
    const xTicks = lengths.filter((_, i) => i % Math.ceil(lengths.length / 5) === 0);

    return (
      <svg width={W} height={H} style={{ display: "block" }}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={toY(v)} y2={toY(v)} stroke="#334155" strokeWidth={0.5} />
            <text x={padL - 4} y={toY(v) + 4} fill="#64748b" fontSize={10} textAnchor="end">{v.toFixed(2)}</text>
          </g>
        ))}
        {xTicks.map((m) => (
          <text key={m} x={toX(m)} y={H - 6} fill="#64748b" fontSize={10} textAnchor="middle">{m}</text>
        ))}
        <line x1={padL} x2={W - padR} y1={toY(0.5)} y2={toY(0.5)} stroke="#475569" strokeWidth={1} strokeDasharray="4,3" />
        <polyline points={fitPoints} fill="none" stroke="#f59e0b" strokeWidth={2} />
        {lengths.map((m, i) => (
          <circle key={i} cx={toX(m)} cy={toY(survivals[i])} r={4} fill="#3b82f6" />
        ))}
        <text x={padL} y={padT - 4} fill="#64748b" fontSize={9}>Survival Probability</text>
        <text x={W / 2} y={H - 1} fill="#64748b" fontSize={9} textAnchor="middle">Sequence Length (Cliffords)</text>
      </svg>
    );
  }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <BarChart3 size={28} color="#3b82f6" />
          <div>
            <h1 style={{ color: "#e2e8f0", fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Randomized Benchmarking Suite</h1>
            <p style={{ color: "#94a3b8", fontSize: "0.875rem", margin: 0 }}>Characterize gate fidelity and error rates via RB experiments</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.5rem" }}>RB Type</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {(["standard", "interleaved", "simultaneous"] as RBType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setRBType(t)}
                    style={{ border: "none", borderRadius: 8, padding: "0.6rem", cursor: "pointer", fontWeight: 700, fontSize: "0.8rem", background: rbType === t ? "#3b82f6" : "#334155", color: rbType === t ? "#fff" : "#94a3b8", textTransform: "capitalize" }}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.5rem" }}>Backend</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {["ibm_nairobi", "ibm_oslo", "ionq_aria"].map((b) => (
                  <button
                    key={b}
                    onClick={() => setBackend(b)}
                    style={{ border: "none", borderRadius: 8, padding: "0.6rem", cursor: "pointer", fontWeight: 700, fontSize: "0.78rem", background: backend === b ? "#0f172a" : "#334155", color: backend === b ? "#3b82f6" : "#94a3b8", textAlign: "left", borderLeft: backend === b ? "3px solid #3b82f6" : "3px solid transparent" }}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.5rem" }}>Qubit (0–6)</label>
              <input
                type="number"
                min={0}
                max={6}
                value={qubit}
                onChange={(e) => setQubit(Math.max(0, Math.min(6, parseInt(e.target.value) || 0)))}
                style={{ width: "100%", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "0.5rem", fontSize: "0.9rem", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Seeds</label>
                <span style={{ color: "#3b82f6", fontWeight: 700, fontSize: "0.875rem" }}>{nSeeds}</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                step={10}
                value={nSeeds}
                onChange={(e) => setNSeeds(parseInt(e.target.value))}
                style={{ width: "100%", accentColor: "#3b82f6" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>
                <span>10</span><span>100</span>
              </div>
            </div>

            {rbType === "interleaved" && (
              <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.5rem" }}>Interleaved Gate</label>
                <select
                  value={interleavedGate}
                  onChange={(e) => setInterleavedGate(e.target.value)}
                  style={{ width: "100%", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "0.5rem", fontSize: "0.9rem" }}
                >
                  {["h", "cx", "s", "t", "x"].map((g) => (
                    <option key={g} value={g}>{g.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={handleRun}
              disabled={loading}
              style={{ border: "none", borderRadius: 8, padding: "0.7rem", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, background: loading ? "#64748b" : "#3b82f6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", fontSize: "0.9rem" }}
            >
              <Play size={16} />
              {loading ? "Benchmarking..." : "Run RB Suite"}
            </button>

            {error && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem", fontSize: "0.8rem" }}>
                {error}
              </div>
            )}
          </div>

          <div>
            {!result ? (
              <div style={{ height: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", background: "#1e293b", borderRadius: 10, border: "1px solid #334155" }}>
                <BarChart3 size={48} color="#334155" />
                <p style={{ color: "#64748b", fontSize: "0.9rem", textAlign: "center" }}>Configure your benchmarking parameters and run the RB suite</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
                    <Award size={24} color={gradeColor(result.quality_grade)} />
                    <div>
                      <div style={{ color: gradeColor(result.quality_grade), fontSize: "2rem", fontWeight: 900, lineHeight: 1 }}>{result.quality_grade}</div>
                      <div style={{ color: "#64748b", fontSize: "0.75rem" }}>Quality Grade — {result.backend}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.75rem" }}>
                    <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center", border: "1px solid #334155" }}>
                      <div style={{ color: "#ef4444", fontSize: "0.95rem", fontWeight: 700 }}>{result.error_per_clifford.toExponential(2)}</div>
                      <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>Error per Clifford</div>
                    </div>
                    <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center", border: "1px solid #334155" }}>
                      <div style={{ color: "#10b981", fontSize: "0.95rem", fontWeight: 700 }}>{(result.average_gate_fidelity * 100).toFixed(4)}%</div>
                      <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>Avg Gate Fidelity</div>
                    </div>
                    <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center", border: "1px solid #334155" }}>
                      <div style={{ color: "#3b82f6", fontSize: "0.95rem", fontWeight: 700 }}>{result.fit_p.toFixed(6)}</div>
                      <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>Fit p-value</div>
                    </div>
                  </div>

                  {result.interleaved_epc !== null && result.gate_specific_fidelity !== null && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
                      <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center", border: "1px solid #334155" }}>
                        <div style={{ color: "#8b5cf6", fontSize: "0.95rem", fontWeight: 700 }}>{result.gate_specific_fidelity.toFixed(5)}</div>
                        <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>Gate-Specific Fidelity ({result.interleaved_gate})</div>
                      </div>
                      <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center", border: "1px solid #334155" }}>
                        <div style={{ color: "#f59e0b", fontSize: "0.95rem", fontWeight: 700 }}>{result.interleaved_epc.toExponential(2)}</div>
                        <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.25rem" }}>Interleaved EPC</div>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <Zap size={16} color="#f59e0b" />
                    <span style={{ color: "#e2e8f0", fontWeight: 700 }}>Decay Curve</span>
                    <span style={{ color: "#64748b", fontSize: "0.75rem" }}>
                      — <span style={{ color: "#3b82f6" }}>● data</span>
                      <span style={{ color: "#f59e0b" }}> — fit</span>
                    </span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    {buildSVG(result)}
                  </div>
                </div>

                {result.recommendations.length > 0 && (
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1.25rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.75rem" }}>Recommendations</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      {result.recommendations.map((rec, i) => (
                        <li key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                          <span style={{ color: "#3b82f6", marginTop: 2 }}>›</span>
                          <span style={{ color: "#e2e8f0", fontSize: "0.85rem" }}>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
