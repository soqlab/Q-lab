"use client";
import { useState } from "react";
import { EntanglementMapResult, EntanglementLayer, mapEntanglement } from "../../../lib/api";
import { GitBranch, Play } from "lucide-react";

const PRESET = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[4];
creg c[4];
h q[0];
cx q[0],q[1];
cx q[1],q[2];
cx q[2],q[3];
h q[1];
cx q[0],q[2];
measure q -> c;`;

function LayerCard({ layer, nQubits, maxEntropy }: { layer: EntanglementLayer; nQubits: number; maxEntropy: number }) {
  return (
    <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", minWidth: 140, border: "1px solid #1e293b" }}>
      <div style={{ color: "#64748b", fontSize: "0.68rem", marginBottom: 6 }}>Depth {layer.depth}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 }}>
        {layer.qubit_entanglement.map(q => {
          const frac = maxEntropy > 0 ? q.entropy / maxEntropy : 0;
          const color = frac > 0.6 ? "#10b981" : frac > 0.2 ? "#f59e0b" : "#334155";
          return (
            <div key={q.qubit} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: "#64748b", fontSize: "0.68rem", width: 16 }}>q{q.qubit}</span>
              <div style={{ flex: 1, height: 8, background: "#1e293b", borderRadius: 99 }}>
                <div style={{ width: `${frac * 100}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.3s" }} />
              </div>
              <span style={{ color, fontSize: "0.65rem", width: 28, textAlign: "right" }}>{q.entropy.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
      {layer.entangled_pairs.length > 0 && (
        <div style={{ fontSize: "0.65rem", color: "#475569" }}>
          {layer.entangled_pairs.map(p => `q${p.q1}-q${p.q2}`).join(", ")}
        </div>
      )}
      <div style={{ fontSize: "0.68rem", color: "#64748b", marginTop: 4 }}>
        S_total={layer.total_entropy.toFixed(2)}
      </div>
    </div>
  );
}

function EntanglementGraph({ result }: { result: EntanglementMapResult }) {
  const W = 300; const n = result.n_qubits;
  const positions = Array.from({ length: n }, (_, i) => ({
    x: 40 + (i % 2) * 220,
    y: 30 + Math.floor(i / 2) * 60,
  }));
  const maxPairs = result.n_entangled_pairs;
  return (
    <svg width={W} height={Math.max(120, Math.ceil(n / 2) * 70 + 20)} style={{ display: "block" }}>
      {result.final_entangled_pairs.map(({ q1, q2 }, i) => {
        const p1 = positions[q1]; const p2 = positions[q2];
        if (!p1 || !p2) return null;
        return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#10b981" strokeWidth={2.5} strokeOpacity={0.7} />;
      })}
      {positions.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={18} fill="#1e293b" stroke="#334155" strokeWidth={1.5} />
          <text x={p.x} y={p.y + 4} fill="#e2e8f0" fontSize={11} textAnchor="middle" fontWeight="bold">q{i}</text>
        </g>
      ))}
    </svg>
  );
}

export default function EntanglementPage() {
  const [qasm, setQasm] = useState(PRESET);
  const [nQubits, setNQubits] = useState(4);
  const [result, setResult] = useState<EntanglementMapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    try { setResult(await mapEntanglement({ qasm, n_qubits: nQubits })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <GitBranch size={28} color="#10b981" /> Entanglement Topology Animator
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Maps bipartite entanglement entropy per qubit at each circuit depth layer. Watch entanglement
          propagate through CX gates in real-time. Computes von Neumann entropy and final topology graph.
        </p>
      </div>
      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Circuit Input</h3>
            <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={10}
              style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box", resize: "vertical", marginBottom: 12 }} />
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 14 }}>
              Qubits to analyze: <span style={{ color: "#10b981", fontWeight: 700 }}>{nQubits}</span>
              <input type="range" min={2} max={8} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#10b981" }} />
            </label>
            <button onClick={run} disabled={loading}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#10b981", color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
              <Play size={15} /> {loading ? "Mapping…" : "Animate Entanglement"}
            </button>
          </div>

          {result && (
            <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
              <h3 style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.88rem", marginBottom: 10 }}>Final Topology</h3>
              <EntanglementGraph result={result} />
              <div style={{ marginTop: 8, fontSize: "0.78rem", color: "#64748b" }}>
                {result.n_entangled_pairs} entangled pair{result.n_entangled_pairs !== 1 ? "s" : ""}
              </div>
              <div style={{ marginTop: 6, fontSize: "0.78rem" }}>
                <span style={{ color: result.is_fully_entangled ? "#10b981" : "#f59e0b" }}>
                  {result.is_fully_entangled ? "✓ Fully entangled" : "◆ Partially entangled"}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: "0.78rem", color: "#64748b" }}>
                Max entropy: {result.max_entropy_observed.toFixed(3)} / {result.max_possible_entropy.toFixed(3)}
              </div>
              <div style={{ marginTop: 4, height: 6, background: "#0f172a", borderRadius: 99 }}>
                <div style={{ width: `${result.entanglement_fraction * 100}%`, height: "100%", background: "#10b981", borderRadius: 99 }} />
              </div>
            </div>
          )}
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Layers", value: result.n_layers, color: "#64748b" },
                  { label: "Entangled Pairs", value: result.n_entangled_pairs, color: "#10b981" },
                  { label: "Entanglement Fraction", value: `${(result.entanglement_fraction * 100).toFixed(1)}%`, color: "#f59e0b" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.3rem", fontWeight: 700, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem", marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: "0.75rem" }}>
                  <span style={{ color: "#10b981" }}>■ High entropy</span>
                  <span style={{ color: "#f59e0b" }}>■ Partial</span>
                  <span style={{ color: "#334155" }}>■ None</span>
                </div>
                <div style={{ overflowX: "auto", display: "flex", gap: 8, paddingBottom: 8 }}>
                  {result.layers.map(layer => (
                    <LayerCard key={layer.depth} layer={layer} nQubits={result.n_qubits} maxEntropy={result.max_entropy_observed} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#475569" }}>
              <GitBranch size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Animate to see entanglement entropy propagate through each circuit depth layer.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
