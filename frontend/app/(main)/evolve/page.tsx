"use client";
import { useEffect, useState } from "react";
import { EvolutionRun, FitnessPoint, evolveCircuit, listEvolutions, getEvolution } from "../../../lib/api";
import { Dna, Play, TrendingUp, ChevronRight, Copy, Check } from "lucide-react";

const PRESET_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

function FitnessChart({ history }: { history: FitnessPoint[] }) {
  if (!history.length) return null;
  const W = 500; const H = 120; const PAD = 30;
  const maxGen = history.length - 1;
  const maxFit = Math.max(...history.map(h => h.best), 0.01);
  const px = (i: number) => PAD + (i / Math.max(maxGen, 1)) * (W - PAD * 2);
  const py = (v: number) => H - PAD - (v / maxFit) * (H - PAD * 2);
  const bestPts = history.map((h, i) => `${px(i)},${py(h.best)}`).join(" ");
  const avgPts = history.map((h, i) => `${px(i)},${py(h.avg)}`).join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block", width: "100%" }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" strokeWidth={1} />
      <polyline points={avgPts} fill="none" stroke="#334155" strokeWidth={1.5} strokeDasharray="4 2" />
      <polyline points={bestPts} fill="none" stroke="#3b82f6" strokeWidth={2} />
      <text x={PAD + 4} y={PAD + 12} fill="#3b82f6" fontSize={10}>— Best</text>
      <text x={PAD + 50} y={PAD + 12} fill="#475569" fontSize={10}>- - Avg</text>
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      style={{ background: "#0f172a", border: "1px solid #334155", color: copied ? "#10b981" : "#3b82f6", borderRadius: 6, padding: "0.35rem 0.7rem", cursor: "pointer", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: 4 }}>
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy QASM"}
    </button>
  );
}

export default function EvolvePage() {
  const [runs, setRuns] = useState<EvolutionRun[]>([]);
  const [selected, setSelected] = useState<EvolutionRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qasm, setQasm] = useState(PRESET_QASM);
  const [circuitName, setCircuitName] = useState("Bell State");
  const [popSize, setPopSize] = useState(20);
  const [nGen, setNGen] = useState(30);
  const [mutRate, setMutRate] = useState(0.2);
  const [shots, setShots] = useState(256);
  const [seed, setSeed] = useState(42);

  useEffect(() => {
    listEvolutions().then(setRuns).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleEvolve = async () => {
    setRunning(true); setError(null);
    try {
      const r = await evolveCircuit({ qasm, circuit_name: circuitName, population_size: popSize, n_generations: nGen, mutation_rate: mutRate, shots, seed });
      setRuns(prev => [r, ...prev]);
      setSelected(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  };

  const improvement = selected ? (selected.improvement >= 0 ? "+" : "") + (selected.improvement * 100).toFixed(1) + "%" : null;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Dna size={28} color="#3b82f6" /> Genetic Circuit Evolution
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Evolutionary algorithm mutates your circuit across generations to maximize fidelity. First-of-its-kind in quantum computing.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.5rem" }}>
        <div>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>Evolution Parameters</h3>

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 8 }}>
              Circuit Name
              <input value={circuitName} onChange={e => setCircuitName(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
            </label>

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 8 }}>
              Seed QASM
              <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={6}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.78rem", boxSizing: "border-box", resize: "vertical" }} />
            </label>

            {[
              { label: "Population Size", key: "popSize", value: popSize, set: setPopSize, min: 4, max: 100, step: 4 },
              { label: "Generations", key: "nGen", value: nGen, set: setNGen, min: 5, max: 200, step: 5 },
              { label: "Shots per Eval", key: "shots", value: shots, set: setShots, min: 64, max: 2048, step: 64 },
            ].map(({ label, key, value, set, min, max, step }) => (
              <label key={key} style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 8 }}>
                {label}: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{value}</span>
                <input type="range" min={min} max={max} step={step} value={value} onChange={e => set(Number(e.target.value))}
                  style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#3b82f6" }} />
              </label>
            ))}

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 8 }}>
              Mutation Rate: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{(mutRate * 100).toFixed(0)}%</span>
              <input type="range" min={5} max={80} step={5} value={mutRate * 100} onChange={e => setMutRate(Number(e.target.value) / 100)}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#3b82f6" }} />
            </label>

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 12 }}>
              Seed
              <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
            </label>

            <button onClick={handleEvolve} disabled={running}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 600, opacity: running ? 0.6 : 1 }}>
              <Play size={16} /> {running ? `Evolving (${nGen} gen)…` : "Evolve Circuit"}
            </button>
          </div>

          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 8, fontSize: "0.95rem" }}>Past Evolutions</h3>
            {loading ? <div style={{ color: "#64748b", fontSize: "0.85rem" }}>Loading…</div> :
              runs.length === 0 ? <div style={{ color: "#64748b", fontSize: "0.85rem" }}>No runs yet.</div> :
              runs.slice(0, 8).map(r => (
                <button key={r.run_id} onClick={() => setSelected(r)}
                  style={{ width: "100%", textAlign: "left", background: selected?.run_id === r.run_id ? "#1d3a6b" : "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 0.75rem", marginBottom: 6, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 600 }}>{r.circuit_name}</span>
                    <span style={{ color: "#10b981", fontSize: "0.78rem", fontWeight: 700 }}>{(r.best_fitness * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ color: "#475569", fontSize: "0.72rem" }}>{r.n_generations}gen · {new Date(r.created_at).toLocaleString()}</div>
                </button>
              ))
            }
          </div>
        </div>

        <div>
          {selected ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Best Fitness", value: `${(selected.best_fitness * 100).toFixed(2)}%`, color: "#3b82f6" },
                  { label: "Improvement", value: improvement, color: selected.improvement >= 0 ? "#10b981" : "#ef4444" },
                  { label: "Gates Original", value: selected.n_gates_original, color: "#f59e0b" },
                  { label: "Gates Evolved", value: selected.n_gates_evolved, color: "#8b5cf6" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.3rem", fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1rem" }}>
                <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <TrendingUp size={16} color="#3b82f6" /> Fitness Curve — {selected.n_generations} generations
                </h3>
                <FitnessChart history={selected.fitness_history} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                {[
                  { label: "Original Circuit", qasm: selected.original_qasm, color: "#334155" },
                  { label: "Evolved Circuit", qasm: selected.evolved_qasm, color: "#1d4ed8" },
                ].map(p => (
                  <div key={p.label} style={{ background: "#1e293b", borderRadius: 12, border: `1px solid ${p.color}`, padding: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.9rem" }}>{p.label}</span>
                      <CopyButton text={p.qasm} />
                    </div>
                    <pre style={{ background: "#0f172a", borderRadius: 6, padding: "0.75rem", color: "#94a3b8", fontSize: "0.75rem", overflowX: "auto", maxHeight: 200, margin: 0 }}>
                      {p.qasm}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, color: "#475569" }}>
              <Dna size={60} style={{ opacity: 0.15, marginBottom: 16 }} />
              <p style={{ fontSize: "1rem" }}>Configure parameters and evolve a circuit.</p>
              <p style={{ fontSize: "0.85rem" }}>The EA will mutate gates across generations to maximize fidelity.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
