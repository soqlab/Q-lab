"use client";

import { useState } from "react";
import { QuantumNetworkResult, NetworkNode, NetworkLink, simulateQuantumNetwork } from "../../../lib/api";
import { Network, Play, Wifi, AlertTriangle } from "lucide-react";

const TOPOLOGIES = [
  { id: "linear", label: "Linear Chain", color: "#3b82f6" },
  { id: "star", label: "Star", color: "#8b5cf6" },
  { id: "mesh", label: "Mesh", color: "#10b981" },
  { id: "ring", label: "Ring", color: "#f59e0b" },
];

function fidelityColor(f: number): string {
  if (f > 0.9) return "#10b981";
  if (f > 0.7) return "#f59e0b";
  return "#ef4444";
}

export default function QuantumNetworkPage() {
  const [topology, setTopology] = useState("linear");
  const [nNodes, setNNodes] = useState(5);
  const [distanceKm, setDistanceKm] = useState(50);
  const [linkFidelity, setLinkFidelity] = useState(0.95);
  const [memoryCoherenceMs, setMemoryCoherenceMs] = useState(100);
  const [gateFidelity, setGateFidelity] = useState(0.99);
  const [entanglementRateHz, setEntanglementRateHz] = useState(1000);
  const [result, setResult] = useState<QuantumNetworkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTopology = TOPOLOGIES.find((t) => t.id === topology) ?? TOPOLOGIES[0];

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await simulateQuantumNetwork({
        topology,
        n_nodes: nNodes,
        distance_km: distanceKm,
        link_fidelity: linkFidelity,
        memory_coherence_time_ms: memoryCoherenceMs,
        gate_fidelity: gateFidelity,
        entanglement_rate_hz: entanglementRateHz,
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const _unused_node: NetworkNode | null = null;
  const _unused_link: NetworkLink | null = null;
  void _unused_node;
  void _unused_link;

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <Network size={28} color="#3b82f6" />
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
              Quantum Network Simulator
            </h1>
            <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.9rem" }}>
              Simulate entanglement distribution across quantum network topologies
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div
            style={{
              background: "#1e293b",
              borderRadius: 12,
              border: "1px solid #334155",
              padding: "1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <div>
              <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
                Topology
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                {TOPOLOGIES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTopology(t.id)}
                    style={{
                      border: `1px solid ${topology === t.id ? t.color : "transparent"}`,
                      borderRadius: 8,
                      padding: "0.5rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      background: topology === t.id ? `${t.color}22` : "#0f172a",
                      color: topology === t.id ? t.color : "#94a3b8",
                      transition: "all 0.15s",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Nodes: {nNodes}
              </label>
              <input
                type="range"
                min={2}
                max={10}
                step={1}
                value={nNodes}
                onChange={(e) => setNNodes(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: activeTopology.color }}
              />
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Distance: {distanceKm} km
              </label>
              <input
                type="range"
                min={10}
                max={500}
                step={10}
                value={distanceKm}
                onChange={(e) => setDistanceKm(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: activeTopology.color }}
              />
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Link fidelity: {linkFidelity.toFixed(2)}
              </label>
              <input
                type="range"
                min={0.5}
                max={1.0}
                step={0.01}
                value={linkFidelity}
                onChange={(e) => setLinkFidelity(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: "#10b981" }}
              />
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Memory coherence: {memoryCoherenceMs} ms
              </label>
              <input
                type="range"
                min={10}
                max={1000}
                step={10}
                value={memoryCoherenceMs}
                onChange={(e) => setMemoryCoherenceMs(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: "#8b5cf6" }}
              />
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Gate fidelity: {gateFidelity.toFixed(3)}
              </label>
              <input
                type="range"
                min={0.8}
                max={1.0}
                step={0.005}
                value={gateFidelity}
                onChange={(e) => setGateFidelity(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: "#f59e0b" }}
              />
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Entanglement rate: {entanglementRateHz.toLocaleString()} Hz
              </label>
              <input
                type="range"
                min={100}
                max={10000}
                step={100}
                value={entanglementRateHz}
                onChange={(e) => setEntanglementRateHz(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: "#3b82f6" }}
              />
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{
                width: "100%",
                border: "none",
                borderRadius: 8,
                padding: "0.7rem",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
                background: loading ? "#1e293b" : activeTopology.color,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                fontSize: "0.9rem",
                opacity: loading ? 0.6 : 1,
              }}
            >
              <Play size={16} />
              {loading ? "Simulating..." : "Run Simulation"}
            </button>

            {error && (
              <div
                style={{
                  background: "#7f1d1d22",
                  border: "1px solid #ef4444",
                  color: "#f87171",
                  borderRadius: 8,
                  padding: "0.75rem",
                  fontSize: "0.85rem",
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {!result ? (
              <div
                style={{
                  background: "#1e293b",
                  borderRadius: 12,
                  border: "1px solid #334155",
                  height: 420,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                  gap: "0.75rem",
                }}
              >
                <Network size={48} color="#334155" />
                <p style={{ margin: 0, fontSize: "0.95rem" }}>Configure network parameters and click Run Simulation</p>
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div
                    style={{
                      background: result.end_to_end_fidelity > 2 / 3 ? "#052e1633" : "#7f1d1d33",
                      border: `1px solid ${result.end_to_end_fidelity > 2 / 3 ? "#10b981" : "#ef4444"}`,
                      borderRadius: 12,
                      padding: "1.25rem",
                    }}
                  >
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginBottom: "0.3rem" }}>End-to-End Fidelity</div>
                    <div style={{ fontSize: "2.5rem", fontWeight: 700, color: result.end_to_end_fidelity > 2 / 3 ? "#10b981" : "#ef4444" }}>
                      {result.end_to_end_fidelity.toFixed(4)}
                    </div>
                    <div
                      style={{
                        marginTop: "0.5rem",
                        display: "inline-block",
                        background: result.end_to_end_fidelity_above_threshold ? "#10b98122" : "#ef444422",
                        border: `1px solid ${result.end_to_end_fidelity_above_threshold ? "#10b981" : "#ef4444"}`,
                        borderRadius: 4,
                        padding: "0.2rem 0.6rem",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: result.end_to_end_fidelity_above_threshold ? "#10b981" : "#ef4444",
                      }}
                    >
                      {result.end_to_end_fidelity_above_threshold ? "Above Threshold" : "Below Threshold"}
                    </div>
                  </div>

                  <div
                    style={{
                      background: result.secret_key_rate_bits_per_sec > 0 ? "#052e1633" : "#7f1d1d33",
                      border: `1px solid ${result.secret_key_rate_bits_per_sec > 0 ? "#10b981" : "#ef4444"}`,
                      borderRadius: 12,
                      padding: "1.25rem",
                    }}
                  >
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginBottom: "0.3rem" }}>Secret Key Rate</div>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700, color: result.secret_key_rate_bits_per_sec > 0 ? "#10b981" : "#ef4444" }}>
                      {result.secret_key_rate_bits_per_sec > 0
                        ? `${result.secret_key_rate_bits_per_sec.toFixed(2)} bits/s`
                        : "0 bits/s (QKD impossible)"}
                    </div>
                    <div style={{ color: "#64748b", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                      <Wifi size={12} style={{ display: "inline", marginRight: 4 }} />
                      {result.topology} topology
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
                  {[
                    { label: "Nodes", value: String(result.n_nodes), color: "#3b82f6" },
                    { label: "Links", value: String(result.n_links), color: "#8b5cf6" },
                    { label: "Total Distance", value: `${result.total_distance_km} km`, color: "#f59e0b" },
                  ].map((c) => (
                    <div key={c.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                      <div style={{ fontSize: "1.2rem", fontWeight: 700, color: c.color }}>{c.value}</div>
                      <div style={{ color: "#94a3b8", fontSize: "0.72rem", marginTop: "0.2rem" }}>{c.label}</div>
                    </div>
                  ))}
                  {[
                    { label: "Repeater Overhead", value: `${result.repeater_overhead_factor.toFixed(2)}×`, color: "#ef4444" },
                    { label: "Entanglement Time", value: `${result.entanglement_generation_time_ms} ms`, color: "#10b981" },
                    { label: "Classical Comm.", value: `${result.classical_communication_time_ms} ms`, color: "#94a3b8" },
                  ].map((c) => (
                    <div key={c.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                      <div style={{ fontSize: "1.2rem", fontWeight: 700, color: c.color }}>{c.value}</div>
                      <div style={{ color: "#94a3b8", fontSize: "0.72rem", marginTop: "0.2rem" }}>{c.label}</div>
                    </div>
                  ))}
                </div>

                {result.fidelity_per_hop && result.fidelity_per_hop.length > 0 && (
                  <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
                      Fidelity Per Hop
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      {result.fidelity_per_hop.map((f, idx) => (
                        <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
                          <svg width={36} height={36} viewBox="0 0 36 36">
                            <circle cx={18} cy={18} r={16} fill={fidelityColor(f)} opacity={0.15} />
                            <circle cx={18} cy={18} r={14} fill="none" stroke={fidelityColor(f)} strokeWidth={2} />
                            <text x={18} y={22} textAnchor="middle" fontSize={10} fill={fidelityColor(f)} fontWeight="bold">
                              {f.toFixed(2)}
                            </text>
                          </svg>
                          <span style={{ fontSize: "0.68rem", color: "#64748b" }}>Hop {idx + 1}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "1rem", marginTop: "0.75rem", fontSize: "0.72rem", color: "#64748b" }}>
                      <span>
                        <span style={{ color: "#10b981" }}>●</span> &gt; 0.9
                      </span>
                      <span>
                        <span style={{ color: "#f59e0b" }}>●</span> 0.7 – 0.9
                      </span>
                      <span>
                        <span style={{ color: "#ef4444" }}>●</span> &lt; 0.7
                      </span>
                    </div>
                  </div>
                )}

                {result.bottleneck_link && (
                  <div
                    style={{
                      background: "#f59e0b11",
                      border: "1px solid #f59e0b",
                      borderRadius: 10,
                      padding: "0.75rem 1rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                    }}
                  >
                    <AlertTriangle size={16} color="#f59e0b" />
                    <span style={{ color: "#fbbf24", fontSize: "0.85rem" }}>
                      <strong>Bottleneck:</strong> {result.bottleneck_link}
                    </span>
                  </div>
                )}

                {result.improvement_suggestions && result.improvement_suggestions.length > 0 && (
                  <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
                      Improvement Suggestions
                    </div>
                    <ul style={{ margin: 0, padding: "0 0 0 1.25rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      {result.improvement_suggestions.map((s, i) => (
                        <li key={i} style={{ color: "#94a3b8", fontSize: "0.85rem", lineHeight: 1.5 }}>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
