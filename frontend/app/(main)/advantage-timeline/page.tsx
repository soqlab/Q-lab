"use client";

import { useState } from "react";
import { AdvantageTimelineResult, RoadmapEntry, AdvantageScenario, projectAdvantageTimeline } from "../../../lib/api";
import { Clock, Play, Zap, TrendingUp } from "lucide-react";

const ALGORITHMS = [
  { id: "factoring", label: "Shor's Factoring", color: "#3b82f6" },
  { id: "search", label: "Grover Search", color: "#8b5cf6" },
  { id: "simulation", label: "Hamiltonian Simulation", color: "#10b981" },
  { id: "optimization", label: "QAOA Optimization", color: "#f59e0b" },
  { id: "ml", label: "Quantum ML", color: "#ef4444" },
  { id: "chemistry", label: "Quantum Chemistry", color: "#06b6d4" },
  { id: "sampling", label: "Quantum Sampling", color: "#ec4899" },
  { id: "linear_systems", label: "HHL Linear Systems", color: "#84cc16" },
];

function formatNumber(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return n.toLocaleString();
  return String(n);
}

function formatScientific(n: number): string {
  if (n > 1e9 || n < 1e-3) {
    return n.toExponential(2);
  }
  return n.toLocaleString();
}

function RoadmapTimeline({ roadmap, yearOfAdvantage }: { roadmap: RoadmapEntry[]; yearOfAdvantage: number }) {
  const NOW = 2026;
  const allYears = roadmap.map((r) => r.year);
  const minYear = Math.min(NOW, ...allYears);
  const maxYear = Math.max(yearOfAdvantage + 5, ...allYears, 2045);
  const width = 580;
  const height = 120;
  const padLeft = 40;
  const padRight = 40;
  const chartW = width - padLeft - padRight;
  const midY = 60;

  const xPos = (year: number) => padLeft + ((year - minYear) / (maxYear - minYear)) * chartW;

  return (
    <svg width={width} height={height} style={{ display: "block", maxWidth: "100%" }}>
      <line x1={padLeft} y1={midY} x2={width - padRight} y2={midY} stroke="#334155" strokeWidth={2} />
      {roadmap.map((entry) => {
        const x = xPos(entry.year);
        const color = entry.can_run ? "#10b981" : "#475569";
        return (
          <g key={entry.year}>
            <circle cx={x} cy={midY} r={8} fill={color} />
            <text x={x} y={midY - 14} textAnchor="middle" fill={color} fontSize={10}>
              {entry.year}
            </text>
            <text x={x} y={midY + 20} textAnchor="middle" fill="#94a3b8" fontSize={9}>
              {entry.logical_qubits}q
            </text>
          </g>
        );
      })}
      {NOW >= minYear && NOW <= maxYear && (
        <g>
          <line x1={xPos(NOW)} y1={midY - 30} x2={xPos(NOW)} y2={midY + 30} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4,3" />
          <text x={xPos(NOW)} y={midY - 34} textAnchor="middle" fill="#f59e0b" fontSize={9} fontWeight="bold">NOW</text>
        </g>
      )}
      {yearOfAdvantage >= minYear && yearOfAdvantage <= maxYear && (
        <g>
          <line x1={xPos(yearOfAdvantage)} y1={midY - 30} x2={xPos(yearOfAdvantage)} y2={midY + 30} stroke="#10b981" strokeWidth={1.5} strokeDasharray="4,3" />
          <text x={xPos(yearOfAdvantage)} y={midY - 34} textAnchor="middle" fill="#10b981" fontSize={9} fontWeight="bold">Target</text>
        </g>
      )}
      <text x={padLeft} y={height - 4} fill="#64748b" fontSize={9}>{minYear}</text>
      <text x={width - padRight} y={height - 4} textAnchor="end" fill="#64748b" fontSize={9}>{maxYear}</text>
    </svg>
  );
}

export default function AdvantageTimelinePage() {
  const [algorithm, setAlgorithm] = useState("factoring");
  const [problemSize, setProblemSize] = useState(2048);
  const [result, setResult] = useState<AdvantageTimelineResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAlgo = ALGORITHMS.find((a) => a.id === algorithm) ?? ALGORITHMS[0];

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await projectAdvantageTimeline({ algorithm, problem_size: problemSize });
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <TrendingUp size={28} color="#f59e0b" />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800, color: "#e2e8f0" }}>Advantage Timeline Projector</h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem" }}>Project when quantum algorithms will outperform classical counterparts</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.6rem", fontWeight: 600 }}>ALGORITHM</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                {ALGORITHMS.map((algo) => (
                  <button
                    key={algo.id}
                    onClick={() => setAlgorithm(algo.id)}
                    style={{
                      background: algorithm === algo.id ? algo.color + "22" : "transparent",
                      border: `1px solid ${algorithm === algo.id ? algo.color : "#334155"}`,
                      borderRadius: 6,
                      color: algorithm === algo.id ? algo.color : "#94a3b8",
                      cursor: "pointer",
                      padding: "0.35rem 0.6rem",
                      fontSize: "0.75rem",
                      fontWeight: algorithm === algo.id ? 700 : 400,
                    }}
                  >
                    {algo.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.4rem", fontWeight: 600 }}>
                PROBLEM SIZE: {problemSize.toLocaleString()}
              </div>
              <input
                type="range"
                min={10}
                max={10000}
                step={10}
                value={problemSize}
                onChange={(e) => setProblemSize(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                <span>10</span><span>10,000</span>
              </div>
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{
                background: selectedAlgo.color,
                border: "none",
                borderRadius: 8,
                padding: "0.7rem",
                cursor: "pointer",
                fontWeight: 700,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                opacity: loading ? 0.7 : 1,
              }}
            >
              <Play size={16} />
              {loading ? "Projecting..." : "Project Timeline"}
            </button>

            {error && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem" }}>{error}</div>
            )}
          </div>

          <div>
            {result === null ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#64748b" }}>
                <Clock size={56} color="#334155" />
                <p style={{ marginTop: "1rem" }}>Select an algorithm and run to see the timeline projection</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1.25rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.4rem" }}>YEAR OF QUANTUM ADVANTAGE</div>
                  <div style={{ fontSize: "3rem", fontWeight: 800, color: "#f59e0b", lineHeight: 1 }}>{result.most_likely_year}</div>
                  <div style={{ color: "#64748b", fontSize: "0.85rem", marginTop: "0.4rem" }}>
                    (Optimistic: {result.optimistic_year} | Pessimistic: {result.pessimistic_year})
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#3b82f6", fontSize: "1.2rem", fontWeight: 700 }}>{result.qubits_needed_logical.toLocaleString()}</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>Logical Qubits</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#8b5cf6", fontSize: "1.2rem", fontWeight: 700 }}>{formatNumber(result.physical_qubits_needed)}</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>Physical Qubits</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#10b981", fontSize: "1.2rem", fontWeight: 700 }}>{formatScientific(result.t_gates_needed)}</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>T-Gates Needed</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#f59e0b", fontSize: "1.2rem", fontWeight: 700 }}>{formatScientific(result.speedup_at_advantage)}x</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>Speedup</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#ef4444", fontSize: "1.2rem", fontWeight: 700 }}>{formatScientific(result.classical_time_years)} yr</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>Classical Time</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#06b6d4", fontSize: "1.2rem", fontWeight: 700 }}>{formatScientific(result.quantum_time_seconds)}s</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>Quantum Time</div>
                  </div>
                </div>

                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.75rem", fontWeight: 600 }}>SCENARIOS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem" }}>
                    {result.scenarios.map((sc: AdvantageScenario) => {
                      const isLikely = sc.year === result.most_likely_year;
                      return (
                        <div
                          key={sc.name}
                          style={{
                            background: isLikely ? "#1d3a6b" : "#0f172a",
                            border: `1px solid ${isLikely ? "#3b82f6" : "#334155"}`,
                            borderRadius: 8,
                            padding: "0.75rem",
                          }}
                        >
                          <div style={{ color: isLikely ? "#3b82f6" : "#94a3b8", fontWeight: 700, fontSize: "0.85rem" }}>{sc.name}</div>
                          <div style={{ color: "#f59e0b", fontSize: "1.3rem", fontWeight: 800 }}>{sc.year}</div>
                          <div style={{ color: "#64748b", fontSize: "0.75rem", marginTop: "0.25rem" }}>{sc.description}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.75rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <Zap size={14} /> HARDWARE ROADMAP
                  </div>
                  <RoadmapTimeline roadmap={result.hardware_roadmap} yearOfAdvantage={result.year_of_advantage} />
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.75rem" }}>
                    <span style={{ color: "#10b981" }}>● Can run algorithm</span>
                    <span style={{ color: "#475569" }}>● Cannot yet run</span>
                    <span style={{ color: "#f59e0b" }}>--- NOW (2026)</span>
                    <span style={{ color: "#10b981" }}>--- Target year</span>
                  </div>
                </div>

                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.5rem", fontWeight: 600 }}>RECOMMENDATION</div>
                  <p style={{ margin: 0, color: "#e2e8f0", fontSize: "0.9rem", lineHeight: 1.6 }}>{result.recommendation}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
