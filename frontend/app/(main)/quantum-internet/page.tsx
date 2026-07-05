"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createQuantumNetwork,
  listQuantumNetworks,
  getQuantumNetwork,
  simulateEntanglement,
  optimizeRepeaters,
  QNetwork,
  EntanglementSimResult,
  RepeaterPlacement,
} from "@/lib/api";

const TOPOLOGIES = ["star", "chain", "mesh", "ring"];
const NODE_TYPES = ["end_node", "repeater", "switch"];

type NodeDraft = {
  name: string;
  type: string;
  location: string;
  qubit_count: number;
  coherence_time_us: number;
  gate_fidelity: number;
};

type LinkDraft = {
  node_a: string;
  node_b: string;
  distance_km: number;
  loss_db_per_km: number;
  entanglement_rate_hz: number;
  fidelity: number;
};

type BadgeStyle = { background: string; color: string; border: string };

const topologyBadgeStyle: Record<string, BadgeStyle> = {
  star: { background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.4)" },
  chain: { background: "rgba(59,130,246,0.15)", color: "var(--info-text)", border: "1px solid rgba(59,130,246,0.4)" },
  mesh: { background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.4)" },
  ring: { background: "rgba(20,184,166,0.15)", color: "#2dd4bf", border: "1px solid rgba(20,184,166,0.4)" },
};

const defaultBadgeStyle: BadgeStyle = { background: "var(--line)", color: "var(--muted)", border: "1px solid var(--line)" };

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 };
const errorBoxStyle: React.CSSProperties = { color: "var(--danger)", fontSize: 13, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" };

export default function QuantumInternetPage() {
  const [networks, setNetworks] = useState<QNetwork[]>([]);
  const [loadingNetworks, setLoadingNetworks] = useState(true);
  const [networksError, setNetworksError] = useState<string | null>(null);

  const [selectedNetwork, setSelectedNetwork] = useState<QNetwork | null>(null);
  const [loadingNetwork, setLoadingNetwork] = useState(false);

  // Create network form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createTopology, setCreateTopology] = useState("mesh");
  const [nodeDrafts, setNodeDrafts] = useState<NodeDraft[]>([
    { name: "", type: "end_node", location: "", qubit_count: 4, coherence_time_us: 100, gate_fidelity: 0.99 },
  ]);
  const [linkDrafts, setLinkDrafts] = useState<LinkDraft[]>([
    { node_a: "", node_b: "", distance_km: 10, loss_db_per_km: 0.2, entanglement_rate_hz: 1000, fidelity: 0.95 },
  ]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Simulation
  const [simSource, setSimSource] = useState("");
  const [simDest, setSimDest] = useState("");
  const [simNRuns, setSimNRuns] = useState(1000);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<EntanglementSimResult | null>(null);

  // Repeater optimization
  const [optNRepeaters, setOptNRepeaters] = useState(3);
  const [optBudget, setOptBudget] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [optResult, setOptResult] = useState<RepeaterPlacement | null>(null);

  const loadNetworks = useCallback(async () => {
    setLoadingNetworks(true);
    setNetworksError(null);
    try {
      const data = await listQuantumNetworks();
      setNetworks(data);
    } catch {
      setNetworksError("Failed to load networks.");
    } finally {
      setLoadingNetworks(false);
    }
  }, []);

  useEffect(() => {
    loadNetworks();
  }, [loadNetworks]);

  const handleSelectNetwork = async (id: string) => {
    setLoadingNetwork(true);
    setSimResult(null);
    setOptResult(null);
    setSimError(null);
    setOptError(null);
    try {
      const net = await getQuantumNetwork(id);
      setSelectedNetwork(net);
      if (net.nodes.length >= 2) {
        setSimSource(net.nodes[0].name);
        setSimDest(net.nodes[net.nodes.length - 1].name);
      }
    } catch {
      setSelectedNetwork(null);
    } finally {
      setLoadingNetwork(false);
    }
  };

  const addNodeDraft = () =>
    setNodeDrafts((d) => [...d, { name: "", type: "end_node", location: "", qubit_count: 4, coherence_time_us: 100, gate_fidelity: 0.99 }]);

  const removeNodeDraft = (i: number) => setNodeDrafts((d) => d.filter((_, idx) => idx !== i));

  const updateNodeDraft = (i: number, key: keyof NodeDraft, value: string | number) =>
    setNodeDrafts((d) => d.map((n, idx) => (idx === i ? { ...n, [key]: value } : n)));

  const addLinkDraft = () =>
    setLinkDrafts((d) => [...d, { node_a: "", node_b: "", distance_km: 10, loss_db_per_km: 0.2, entanglement_rate_hz: 1000, fidelity: 0.95 }]);

  const removeLinkDraft = (i: number) => setLinkDrafts((d) => d.filter((_, idx) => idx !== i));

  const updateLinkDraft = (i: number, key: keyof LinkDraft, value: string | number) =>
    setLinkDrafts((d) => d.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));

  const handleCreateNetwork = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await createQuantumNetwork({
        name: createName,
        topology: createTopology,
        nodes: nodeDrafts,
        links: linkDrafts,
      });
      setShowCreate(false);
      setCreateName("");
      setNodeDrafts([{ name: "", type: "end_node", location: "", qubit_count: 4, coherence_time_us: 100, gate_fidelity: 0.99 }]);
      setLinkDrafts([{ node_a: "", node_b: "", distance_km: 10, loss_db_per_km: 0.2, entanglement_rate_hz: 1000, fidelity: 0.95 }]);
      loadNetworks();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Failed to create network.");
    } finally {
      setCreating(false);
    }
  };

  const handleSimulate = async () => {
    if (!selectedNetwork) return;
    setSimulating(true);
    setSimError(null);
    setSimResult(null);
    try {
      const result = await simulateEntanglement({
        network_id: selectedNetwork.network_id,
        source_node: simSource,
        dest_node: simDest,
        n_runs: simNRuns,
      });
      setSimResult(result);
    } catch (e: unknown) {
      setSimError(e instanceof Error ? e.message : "Simulation failed.");
    } finally {
      setSimulating(false);
    }
  };

  const handleOptimize = async () => {
    if (!selectedNetwork) return;
    setOptimizing(true);
    setOptError(null);
    setOptResult(null);
    try {
      const result = await optimizeRepeaters({
        network_id: selectedNetwork.network_id,
        n_repeaters: optNRepeaters,
        budget_usd: optBudget ? Number(optBudget) : undefined,
      });
      setOptResult(result);
    } catch (e: unknown) {
      setOptError(e instanceof Error ? e.message : "Optimization failed.");
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>Quantum Internet Simulator</h1>
          <p style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>Multi-node entanglement distribution and network topology modeling</p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="button"
        >
          {showCreate ? "Cancel" : "Create Network"}
        </button>
      </div>

      {/* Create Network Form */}
      {showCreate && (
        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--strong)" }}>New Quantum Network</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Network Name</label>
              <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={labelStyle}>Topology</label>
              <select value={createTopology} onChange={(e) => setCreateTopology(e.target.value)} className="input" style={{ width: "100%" }}>
                {TOPOLOGIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Nodes Builder */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>Nodes</p>
              <button onClick={addNodeDraft} style={{ fontSize: 12, color: "var(--strong)", background: "none", border: "none", cursor: "pointer" }}>+ Add Node</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {nodeDrafts.map((node, i) => (
                <div key={i} style={{ background: "var(--surface)", borderRadius: 8, padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8, alignItems: "flex-end" }}>
                  <div>
                    <label style={labelStyle}>Name</label>
                    <input type="text" value={node.name} onChange={(e) => updateNodeDraft(i, "name", e.target.value)} className="input" style={{ width: "100%", fontSize: 12 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select value={node.type} onChange={(e) => updateNodeDraft(i, "type", e.target.value)} className="input" style={{ width: "100%", fontSize: 12 }}>
                      {NODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Location</label>
                    <input type="text" value={node.location} onChange={(e) => updateNodeDraft(i, "location", e.target.value)} className="input" style={{ width: "100%", fontSize: 12 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Qubits</label>
                    <input type="number" min={1} value={node.qubit_count} onChange={(e) => updateNodeDraft(i, "qubit_count", Number(e.target.value))} className="input" style={{ width: "100%", fontSize: 12 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Coh. (µs)</label>
                    <input type="number" min={1} value={node.coherence_time_us} onChange={(e) => updateNodeDraft(i, "coherence_time_us", Number(e.target.value))} className="input" style={{ width: "100%", fontSize: 12 }} />
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Fidelity</label>
                      <input type="number" min={0} max={1} step={0.001} value={node.gate_fidelity} onChange={(e) => updateNodeDraft(i, "gate_fidelity", Number(e.target.value))} className="input" style={{ width: "100%", fontSize: 12 }} />
                    </div>
                    <button onClick={() => removeNodeDraft(i)} style={{ fontSize: 12, color: "var(--danger)", background: "none", border: "none", cursor: "pointer", paddingBottom: 4, paddingLeft: 4, paddingRight: 4 }}>x</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Links Builder */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>Links</p>
              <button onClick={addLinkDraft} style={{ fontSize: 12, color: "var(--strong)", background: "none", border: "none", cursor: "pointer" }}>+ Add Link</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {linkDrafts.map((link, i) => (
                <div key={i} style={{ background: "var(--surface)", borderRadius: 8, padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8, alignItems: "flex-end" }}>
                  <div>
                    <label style={labelStyle}>Node A</label>
                    <input type="text" value={link.node_a} onChange={(e) => updateLinkDraft(i, "node_a", e.target.value)} className="input" style={{ width: "100%", fontSize: 12 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Node B</label>
                    <input type="text" value={link.node_b} onChange={(e) => updateLinkDraft(i, "node_b", e.target.value)} className="input" style={{ width: "100%", fontSize: 12 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Distance (km)</label>
                    <input type="number" min={0} value={link.distance_km} onChange={(e) => updateLinkDraft(i, "distance_km", Number(e.target.value))} className="input" style={{ width: "100%", fontSize: 12 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Loss (dB/km)</label>
                    <input type="number" min={0} step={0.01} value={link.loss_db_per_km} onChange={(e) => updateLinkDraft(i, "loss_db_per_km", Number(e.target.value))} className="input" style={{ width: "100%", fontSize: 12 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Ent. Rate (Hz)</label>
                    <input type="number" min={0} value={link.entanglement_rate_hz} onChange={(e) => updateLinkDraft(i, "entanglement_rate_hz", Number(e.target.value))} className="input" style={{ width: "100%", fontSize: 12 }} />
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Fidelity</label>
                      <input type="number" min={0} max={1} step={0.001} value={link.fidelity} onChange={(e) => updateLinkDraft(i, "fidelity", Number(e.target.value))} className="input" style={{ width: "100%", fontSize: 12 }} />
                    </div>
                    <button onClick={() => removeLinkDraft(i)} style={{ fontSize: 12, color: "var(--danger)", background: "none", border: "none", cursor: "pointer", paddingBottom: 4, paddingLeft: 4, paddingRight: 4 }}>x</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {createError && <div style={errorBoxStyle}>{createError}</div>}
          <button onClick={handleCreateNetwork} disabled={creating || !createName} className="button" style={{ opacity: creating || !createName ? 0.5 : 1, cursor: creating || !createName ? "not-allowed" : "pointer" }}>
            {creating ? "Creating…" : "Create Network"}
          </button>
        </div>
      )}

      {/* Networks List */}
      {loadingNetworks ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading networks…</div>
      ) : networksError ? (
        <div style={errorBoxStyle}>{networksError}</div>
      ) : networks.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>No networks found.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
          {(networks ?? []).map((net) => (
            <div
              key={net.network_id}
              onClick={() => handleSelectNetwork(net.network_id)}
              className="panel"
              style={{
                padding: 16,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                border: selectedNetwork?.network_id === net.network_id ? "1px solid var(--strong)" : "1px solid var(--line)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <p style={{ fontWeight: 600, fontSize: 13 }}>{net.name}</p>
                <span style={{ fontSize: 12, padding: "2px 6px", borderRadius: 999, ...(topologyBadgeStyle[net.topology] ?? defaultBadgeStyle) }}>{net.topology}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 16 }}>
                <span>{(net.nodes ?? []).length} nodes</span>
                <span>{(net.links ?? []).length} links</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(net.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* Selected Network Detail */}
      {loadingNetwork ? (
        <div className="panel" style={{ padding: 24, fontSize: 13, color: "var(--muted)" }}>Loading network details…</div>
      ) : selectedNetwork && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 24 }}>
          {/* Topology Summary */}
          <div className="panel" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--strong)" }}>Network: {selectedNetwork.name}</h2>

            <div>
              <p style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginBottom: 8 }}>Nodes</p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ paddingBottom: 6, fontWeight: 500, color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>Name</th>
                      <th style={{ paddingBottom: 6, fontWeight: 500, color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>Type</th>
                      <th style={{ paddingBottom: 6, fontWeight: 500, color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>Location</th>
                      <th style={{ paddingBottom: 6, fontWeight: 500, color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>Qubits</th>
                      <th style={{ paddingBottom: 6, fontWeight: 500, color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>Fidelity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedNetwork.nodes ?? []).map((n) => (
                      <tr key={n.node_id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "6px 12px 6px 0", fontWeight: 500 }}>{n.name}</td>
                        <td style={{ padding: "6px 12px 6px 0" }}>{n.type}</td>
                        <td style={{ padding: "6px 12px 6px 0" }}>{n.location}</td>
                        <td style={{ padding: "6px 12px 6px 0" }}>{n.qubit_count}</td>
                        <td style={{ padding: "6px 0" }}>{(n.gate_fidelity * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginBottom: 8 }}>Links</p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ paddingBottom: 6, fontWeight: 500, color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>A</th>
                      <th style={{ paddingBottom: 6, fontWeight: 500, color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>B</th>
                      <th style={{ paddingBottom: 6, fontWeight: 500, color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>Dist (km)</th>
                      <th style={{ paddingBottom: 6, fontWeight: 500, color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>Rate (Hz)</th>
                      <th style={{ paddingBottom: 6, fontWeight: 500, color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>Fidelity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedNetwork.links ?? []).map((l) => (
                      <tr key={l.link_id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "6px 12px 6px 0" }}>{l.node_a}</td>
                        <td style={{ padding: "6px 12px 6px 0" }}>{l.node_b}</td>
                        <td style={{ padding: "6px 12px 6px 0" }}>{l.distance_km}</td>
                        <td style={{ padding: "6px 12px 6px 0" }}>{l.entanglement_rate_hz}</td>
                        <td style={{ padding: "6px 0" }}>{(l.fidelity * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Simulation + Optimization */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Simulation Panel */}
            <div className="panel" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--strong)" }}>Entanglement Simulation</h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Source Node</label>
                  <select value={simSource} onChange={(e) => setSimSource(e.target.value)} className="input" style={{ width: "100%" }}>
                    {(selectedNetwork.nodes ?? []).map((n) => <option key={n.node_id} value={n.name}>{n.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Destination Node</label>
                  <select value={simDest} onChange={(e) => setSimDest(e.target.value)} className="input" style={{ width: "100%" }}>
                    {(selectedNetwork.nodes ?? []).map((n) => <option key={n.node_id} value={n.name}>{n.name}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={labelStyle}>Runs: {simNRuns.toLocaleString()}</label>
                  <input type="range" min={100} max={10000} step={100} value={simNRuns} onChange={(e) => setSimNRuns(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--strong)" }} />
                </div>
              </div>

              <button onClick={handleSimulate} disabled={simulating || !simSource || !simDest} className="button" style={{ width: "100%", opacity: simulating || !simSource || !simDest ? 0.5 : 1, cursor: simulating || !simSource || !simDest ? "not-allowed" : "pointer" }}>
                {simulating ? "Simulating…" : "Simulate"}
              </button>

              {simError && <div style={errorBoxStyle}>{simError}</div>}

              {simResult && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
                  {/* Path */}
                  <div>
                    <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Path ({simResult.n_hops} hop{simResult.n_hops !== 1 ? "s" : ""})</p>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, fontSize: 13 }}>
                      {(simResult.path ?? []).map((node, i) => (
                        <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 500 }}>{node}</span>
                          {i < simResult.path.length - 1 && <span style={{ color: "var(--muted)", fontSize: 12 }}>→</span>}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { label: "End-to-End Fidelity", value: `${(simResult.end_to_end_fidelity * 100).toFixed(2)}%`, green: true },
                      { label: "Entanglement Rate", value: `${simResult.entanglement_rate_hz.toFixed(1)} Hz`, green: false },
                      { label: "Success Probability", value: `${(simResult.success_probability * 100).toFixed(2)}%`, green: true },
                      { label: "Latency", value: `${simResult.latency_ms.toFixed(2)} ms`, green: false },
                    ].map(({ label, value, green }) => (
                      <div key={label} style={{ background: "var(--surface)", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
                        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>{label}</p>
                        <p style={{ fontSize: 13, fontWeight: 600, color: green ? "var(--ok)" : "var(--strong)" }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {simResult.bottleneck_link && (
                    <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" }}>
                      <p style={{ fontSize: 12, color: "var(--danger)" }}>Bottleneck Link: <span style={{ fontWeight: 500, color: "var(--danger)" }}>{simResult.bottleneck_link}</span></p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Repeater Optimizer */}
            <div className="panel" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--strong)" }}>Repeater Optimizer</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Repeaters: {optNRepeaters}</label>
                  <input type="range" min={1} max={10} value={optNRepeaters} onChange={(e) => setOptNRepeaters(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--strong)" }} />
                </div>
                <div>
                  <label style={labelStyle}>Budget (USD, optional)</label>
                  <input type="number" min={0} value={optBudget} onChange={(e) => setOptBudget(e.target.value)} placeholder="No limit" className="input" style={{ width: "100%" }} />
                </div>
              </div>
              <button onClick={handleOptimize} disabled={optimizing} className="button" style={{ width: "100%", opacity: optimizing ? 0.5 : 1, cursor: optimizing ? "not-allowed" : "pointer" }}>
                {optimizing ? "Optimizing…" : "Optimize Repeaters"}
              </button>
              {optError && <div style={errorBoxStyle}>{optError}</div>}
              {optResult && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ background: "var(--surface)", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
                      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>Fidelity</p>
                      <p style={{ fontSize: 13, fontWeight: 600 }}>
                        <span style={{ color: "var(--muted)" }}>{(optResult.fidelity_before * 100).toFixed(2)}%</span>
                        <span style={{ color: "var(--muted)", margin: "0 4px" }}>→</span>
                        <span style={{ color: "var(--ok)" }}>{(optResult.fidelity_after * 100).toFixed(2)}%</span>
                      </p>
                    </div>
                    <div style={{ background: "var(--surface)", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
                      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>Rate (Hz)</p>
                      <p style={{ fontSize: 13, fontWeight: 600 }}>
                        <span style={{ color: "var(--muted)" }}>{optResult.rate_before.toFixed(1)}</span>
                        <span style={{ color: "var(--muted)", margin: "0 4px" }}>→</span>
                        <span style={{ color: "var(--ok)" }}>{optResult.rate_after.toFixed(1)}</span>
                      </p>
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Placements</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {(optResult.placements ?? []).map((p, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface)", borderRadius: 8, padding: "6px 12px", fontSize: 12 }}>
                          <span style={{ color: "var(--text)" }}>{p.position}</span>
                          <span style={{ color: "var(--ok)", fontWeight: 500 }}>+{(p.improvement * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
