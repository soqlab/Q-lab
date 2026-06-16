"use client";

import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import { fetchCircuitTopology, CircuitTopologyResult } from "../../../../lib/api";

export default function CircuitTopologyPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<CircuitTopologyResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCircuitTopology(runId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const isApprox = data.source === "fingerprint_chain_approximation";

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Share2 size={16} aria-hidden="true" />
          Circuit Topology
        </h2>
        {isApprox && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
            approximated from fingerprint
          </span>
        )}
      </div>

      <div style={{ padding: "12px 18px" }}>
        {/* Betti numbers */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
          <BettiBox n={0} value={data.betti_0} label="Connected components" />
          <BettiBox n={1} value={data.betti_1} label="Independent cycles" />
          <Stat label="Topological complexity" value={String(data.topological_complexity)} />
          <Stat label="Connectivity entropy" value={data.connectivity_entropy.toFixed(3)} />
          {data.most_connected_qubit != null && (
            <Stat label="Hub qubit" value={`Q${data.most_connected_qubit}`} accent="#7c3aed" />
          )}
        </div>

        {/* Interaction graph visualization */}
        {data.interaction_graph.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>
              Qubit interaction graph
            </div>
            <InteractionGraph graph={data.interaction_graph} nQubits={data.n_qubits} />
          </div>
        )}

        {/* Persistence diagram */}
        {data.persistence_diagram.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
              0-dim persistence diagram
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {data.persistence_diagram.map((pt, i) => (
                <div key={i} style={{
                  background: "var(--panel-2)", borderRadius: 6, padding: "4px 8px",
                  fontSize: 11, color: "var(--muted)",
                }}>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>
                    life={pt.lifetime.toFixed(1)}
                  </span>
                  {" "}[{pt.birth.toFixed(0)}→{pt.death.toFixed(0)}]
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function BettiBox({ n, value, label }: { n: number; value: number; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>
        β<sub>{n}</sub> — {label}
      </span>
      <span style={{ fontSize: 28, fontWeight: 800, color: value > 0 ? "var(--text)" : "var(--muted)" }}>
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</span>
    </div>
  );
}

type InteractionGraphProps = {
  graph: { q1: number; q2: number; weight: number }[];
  nQubits: number;
};

function InteractionGraph({ graph, nQubits }: InteractionGraphProps) {
  const n = Math.max(nQubits, Math.max(...graph.flatMap(e => [e.q1, e.q2])) + 1, 1);
  const R = 90;
  const CX = 110;
  const CY = 110;
  const r = 14;
  const maxW = Math.max(...graph.map(e => e.weight), 1);

  function pos(i: number) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
  }

  return (
    <svg width={220} height={220} style={{ display: "block" }}>
      {graph.map((e, i) => {
        const a = pos(e.q1);
        const b = pos(e.q2);
        const stroke = `hsl(${Math.round((1 - e.weight / maxW) * 120)},70%,45%)`;
        return (
          <line key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={stroke}
            strokeWidth={1 + (e.weight / maxW) * 3}
            opacity={0.7}
          >
            <title>{`Q${e.q1}–Q${e.q2}: ${e.weight} interactions`}</title>
          </line>
        );
      })}
      {Array.from({ length: n }, (_, i) => {
        const p = pos(i);
        const deg = graph.reduce((s, e) => s + (e.q1 === i || e.q2 === i ? e.weight : 0), 0);
        const isHub = deg === Math.max(...Array.from({ length: n }, (_, j) =>
          graph.reduce((s, e) => s + (e.q1 === j || e.q2 === j ? e.weight : 0), 0)
        ));
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={r}
              fill={isHub ? "#7c3aed" : "var(--strong)"}
              stroke="var(--panel)" strokeWidth={2}
            />
            <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
              fontSize={9} fontWeight={700} fill="#fff"
              style={{ userSelect: "none", pointerEvents: "none" }}>
              {i}
            </text>
            <title>{`Q${i} — strength: ${deg}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
