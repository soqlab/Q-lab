"use client";
import { useState } from "react";
import { CliffordTResult, analyzeCliffordT } from "../../../lib/api";
import { Layers, Zap, AlertTriangle, CheckCircle } from "lucide-react";

const PRESET = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
t q[0];
cx q[0],q[1];
t q[1];
h q[1];
tdg q[0];
cx q[0],q[2];
rz(1.5708) q[2];
t q[2];
measure q -> c;`;

const TYPE_COLORS: Record<string, string> = {
  "T": "#ef4444",
  "Clifford-1Q": "#3b82f6",
  "Clifford-2Q": "#8b5cf6",
  "Non-Clifford": "#f97316",
  "Unknown": "#64748b",
};

function GateTypeDonut({ counts }: { counts: { T_gates: number; Clifford_1Q: number; Clifford_2Q: number; Non_Clifford: number } }) {
  const entries = [
    { label: "T gates", value: counts.T_gates, color: "#ef4444" },
    { label: "Clifford 1Q", value: counts.Clifford_1Q, color: "#3b82f6" },
    { label: "Clifford 2Q", value: counts.Clifford_2Q, color: "#8b5cf6" },
    { label: "Non-Clifford", value: counts.Non_Clifford, color: "#f97316" },
  ].filter(e => e.value > 0);
  const total = entries.reduce((s, e) => s + e.value, 0) || 1;
  let angle = 0;
  const R = 50; const CX = 70; const CY = 70;
  const slices = entries.map(e => {
    const start = angle;
    angle += (e.value / total) * 2 * Math.PI;
    return { ...e, start, end: angle };
  });
  function arc(a: number): [number, number] {
    return [CX + R * Math.cos(a - Math.PI / 2), CY + R * Math.sin(a - Math.PI / 2)];
  }
  return (
    <svg width={200} height={150}>
      {slices.map((s, i) => {
        const [x1, y1] = arc(s.start); const [x2, y2] = arc(s.end);
        const large = s.end - s.start > Math.PI ? 1 : 0;
        return <path key={i} d={`M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`} fill={s.color} opacity={0.85} />;
      })}
      <circle cx={CX} cy={CY} r={26} fill="#0f172a" />
      <text x={CX} y={CY + 5} fill="#e2e8f0" fontSize={11} textAnchor="middle" fontWeight="bold">{total}</text>
      <text x={CX} y={CY - 8} fill="#64748b" fontSize={8} textAnchor="middle">gates</text>
      {slices.map((s, i) => {
        const mid = (s.start + s.end) / 2;
        const lx = CX + (R + 14) * Math.cos(mid - Math.PI / 2);
        const ly = CY + (R + 14) * Math.sin(mid - Math.PI / 2);
        return <text key={i} x={lx} y={ly} fill={s.color} fontSize={8} textAnchor="middle">{s.value}</text>;
      })}
    </svg>
  );
}

export default function CliffordTPage() {
  const [qasm, setQasm] = useState(PRESET);
  const [result, setResult] = useState<CliffordTResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    try { setResult(await analyzeCliffordT({ qasm })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Layers size={28} color="#ef4444" /> Clifford + T Resource Counter
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Decomposes circuits into the Clifford+T universal gate set. Counts T-gates (magic state cost),
          estimates fault-tolerant overhead, and recommends code distance for FTQC implementation.
        </p>
      </div>
      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1.5rem" }}>
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
          <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Circuit</h3>
          <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={14}
            style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box", resize: "vertical", marginBottom: 12 }} />
          <button onClick={run} disabled={loading}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
            <Layers size={15} /> {loading ? "Analyzing…" : "Analyze Clifford+T"}
          </button>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "T-Count", value: result.t_count, color: "#ef4444" },
                  { label: "T-Gate Ratio", value: `${(result.t_gate_ratio * 100).toFixed(1)}%`, color: result.t_gate_ratio > 0.3 ? "#ef4444" : "#f59e0b" },
                  { label: "Total Gates", value: result.total_gates, color: "#64748b" },
                  { label: "Magic States", value: result.estimated_magic_states, color: "#8b5cf6" },
                  { label: "FTQC Gates", value: result.total_physical_gates_ftqc.toLocaleString(), color: "#3b82f6" },
                  { label: "Code Distance", value: `d=${result.recommended_code_distance}`, color: "#10b981" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.25rem", fontWeight: 700, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {result.is_clifford_only && (
                <div style={{ background: "#10b98122", border: "1px solid #10b981", borderRadius: 8, padding: "0.75rem 1rem", color: "#10b981", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={16} /> <strong>Clifford-only circuit</strong> — efficiently simulable classically via Gottesman-Knill theorem. No T-gate overhead.
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.88rem", marginBottom: 8 }}>Gate Distribution</h3>
                  <GateTypeDonut counts={result.gate_type_counts} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {Object.entries({ "T gates": result.gate_type_counts.T_gates, "Clifford 1Q": result.gate_type_counts.Clifford_1Q, "Clifford 2Q": result.gate_type_counts.Clifford_2Q, "Non-Clifford": result.gate_type_counts.Non_Clifford }).map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
                        <span style={{ color: "#64748b" }}>{k}</span>
                        <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {result.recommendations.length > 0 && (
                    <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem 1rem" }}>
                      <h3 style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                        <Zap size={14} color="#f59e0b" /> Optimization Recommendations
                      </h3>
                      {result.recommendations.map((r, i) => (
                        <div key={i} style={{ color: "#94a3b8", fontSize: "0.82rem", padding: "0.3rem 0", borderBottom: i < result.recommendations.length - 1 ? "1px solid #1e293b" : "none" }}>
                          → {r}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem 1rem" }}>
                    <h3 style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>Gate Breakdown (first 30)</h3>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {result.gate_breakdown.slice(0, 30).map((g, i) => (
                        <span key={i} style={{ background: TYPE_COLORS[g.type] + "22", color: TYPE_COLORS[g.type], fontSize: "0.68rem", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace" }}>
                          {g.gate}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#475569" }}>
              <Layers size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Analyze a circuit to count T-gates, Clifford gates, and estimate fault-tolerant overhead.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
