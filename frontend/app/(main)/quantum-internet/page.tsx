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

const topologyBadge: Record<string, string> = {
  star: "bg-yellow-900/40 text-yellow-400 border border-yellow-800",
  chain: "bg-blue-900/40 text-blue-400 border border-blue-800",
  mesh: "bg-purple-900/40 text-purple-400 border border-purple-800",
  ring: "bg-teal-900/40 text-teal-400 border border-teal-800",
};

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
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Quantum Internet Simulator</h1>
          <p className="text-gray-400 mt-1 text-sm">Multi-node entanglement distribution and network topology modeling</p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        >
          {showCreate ? "Cancel" : "Create Network"}
        </button>
      </div>

      {/* Create Network Form */}
      {showCreate && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
          <h2 className="text-sm font-semibold text-indigo-400">New Quantum Network</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Network Name</label>
              <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Topology</label>
              <select value={createTopology} onChange={(e) => setCreateTopology(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                {TOPOLOGIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Nodes Builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-300">Nodes</p>
              <button onClick={addNodeDraft} className="text-xs text-indigo-400 hover:text-indigo-300">+ Add Node</button>
            </div>
            <div className="space-y-2">
              {nodeDrafts.map((node, i) => (
                <div key={i} className="bg-gray-800 rounded-lg p-3 grid grid-cols-3 md:grid-cols-6 gap-2 items-end">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Name</label>
                    <input type="text" value={node.name} onChange={(e) => updateNodeDraft(i, "name", e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Type</label>
                    <select value={node.type} onChange={(e) => updateNodeDraft(i, "type", e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none">
                      {NODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Location</label>
                    <input type="text" value={node.location} onChange={(e) => updateNodeDraft(i, "location", e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Qubits</label>
                    <input type="number" min={1} value={node.qubit_count} onChange={(e) => updateNodeDraft(i, "qubit_count", Number(e.target.value))} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Coh. (µs)</label>
                    <input type="number" min={1} value={node.coherence_time_us} onChange={(e) => updateNodeDraft(i, "coherence_time_us", Number(e.target.value))} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                  </div>
                  <div className="flex gap-1 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-400 mb-1">Fidelity</label>
                      <input type="number" min={0} max={1} step={0.001} value={node.gate_fidelity} onChange={(e) => updateNodeDraft(i, "gate_fidelity", Number(e.target.value))} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                    </div>
                    <button onClick={() => removeNodeDraft(i)} className="text-xs text-red-400 hover:text-red-300 pb-1 px-1">x</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Links Builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-300">Links</p>
              <button onClick={addLinkDraft} className="text-xs text-indigo-400 hover:text-indigo-300">+ Add Link</button>
            </div>
            <div className="space-y-2">
              {linkDrafts.map((link, i) => (
                <div key={i} className="bg-gray-800 rounded-lg p-3 grid grid-cols-3 md:grid-cols-6 gap-2 items-end">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Node A</label>
                    <input type="text" value={link.node_a} onChange={(e) => updateLinkDraft(i, "node_a", e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Node B</label>
                    <input type="text" value={link.node_b} onChange={(e) => updateLinkDraft(i, "node_b", e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Distance (km)</label>
                    <input type="number" min={0} value={link.distance_km} onChange={(e) => updateLinkDraft(i, "distance_km", Number(e.target.value))} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Loss (dB/km)</label>
                    <input type="number" min={0} step={0.01} value={link.loss_db_per_km} onChange={(e) => updateLinkDraft(i, "loss_db_per_km", Number(e.target.value))} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Ent. Rate (Hz)</label>
                    <input type="number" min={0} value={link.entanglement_rate_hz} onChange={(e) => updateLinkDraft(i, "entanglement_rate_hz", Number(e.target.value))} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                  </div>
                  <div className="flex gap-1 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-400 mb-1">Fidelity</label>
                      <input type="number" min={0} max={1} step={0.001} value={link.fidelity} onChange={(e) => updateLinkDraft(i, "fidelity", Number(e.target.value))} className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none" />
                    </div>
                    <button onClick={() => removeLinkDraft(i)} className="text-xs text-red-400 hover:text-red-300 pb-1 px-1">x</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {createError && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{createError}</div>}
          <button onClick={handleCreateNetwork} disabled={creating || !createName} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-4 py-2 text-sm font-medium transition-colors">
            {creating ? "Creating…" : "Create Network"}
          </button>
        </div>
      )}

      {/* Networks List */}
      {loadingNetworks ? (
        <div className="text-sm text-gray-400 animate-pulse">Loading networks…</div>
      ) : networksError ? (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{networksError}</div>
      ) : networks.length === 0 ? (
        <div className="text-sm text-gray-500">No networks found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {networks.map((net) => (
            <div
              key={net.network_id}
              onClick={() => handleSelectNetwork(net.network_id)}
              className={`bg-gray-900 border rounded-xl p-4 cursor-pointer transition-colors space-y-2 ${selectedNetwork?.network_id === net.network_id ? "border-indigo-600" : "border-gray-800 hover:border-gray-600"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-sm">{net.name}</p>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${topologyBadge[net.topology] ?? "bg-gray-700 text-gray-400"}`}>{net.topology}</span>
              </div>
              <div className="text-xs text-gray-400 flex gap-4">
                <span>{net.nodes.length} nodes</span>
                <span>{net.links.length} links</span>
              </div>
              <p className="text-xs text-gray-500">{new Date(net.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* Selected Network Detail */}
      {loadingNetwork ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-sm text-gray-400 animate-pulse">Loading network details…</div>
      ) : selectedNetwork && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Topology Summary */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="text-base font-semibold text-indigo-400">Network: {selectedNetwork.name}</h2>

            <div>
              <p className="text-xs font-medium text-gray-400 mb-2">Nodes</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-800">
                      <th className="pb-1.5 font-medium">Name</th>
                      <th className="pb-1.5 font-medium">Type</th>
                      <th className="pb-1.5 font-medium">Location</th>
                      <th className="pb-1.5 font-medium">Qubits</th>
                      <th className="pb-1.5 font-medium">Fidelity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedNetwork.nodes.map((n) => (
                      <tr key={n.node_id} className="border-b border-gray-800/50">
                        <td className="py-1.5 pr-3 font-medium">{n.name}</td>
                        <td className="py-1.5 pr-3">{n.type}</td>
                        <td className="py-1.5 pr-3">{n.location}</td>
                        <td className="py-1.5 pr-3">{n.qubit_count}</td>
                        <td className="py-1.5">{(n.gate_fidelity * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-400 mb-2">Links</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-800">
                      <th className="pb-1.5 font-medium">A</th>
                      <th className="pb-1.5 font-medium">B</th>
                      <th className="pb-1.5 font-medium">Dist (km)</th>
                      <th className="pb-1.5 font-medium">Rate (Hz)</th>
                      <th className="pb-1.5 font-medium">Fidelity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedNetwork.links.map((l) => (
                      <tr key={l.link_id} className="border-b border-gray-800/50">
                        <td className="py-1.5 pr-3">{l.node_a}</td>
                        <td className="py-1.5 pr-3">{l.node_b}</td>
                        <td className="py-1.5 pr-3">{l.distance_km}</td>
                        <td className="py-1.5 pr-3">{l.entanglement_rate_hz}</td>
                        <td className="py-1.5">{(l.fidelity * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Simulation + Optimization */}
          <div className="space-y-4">
            {/* Simulation Panel */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <h2 className="text-base font-semibold text-indigo-400">Entanglement Simulation</h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Source Node</label>
                  <select value={simSource} onChange={(e) => setSimSource(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                    {selectedNetwork.nodes.map((n) => <option key={n.node_id} value={n.name}>{n.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Destination Node</label>
                  <select value={simDest} onChange={(e) => setSimDest(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                    {selectedNetwork.nodes.map((n) => <option key={n.node_id} value={n.name}>{n.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Runs: {simNRuns.toLocaleString()}</label>
                  <input type="range" min={100} max={10000} step={100} value={simNRuns} onChange={(e) => setSimNRuns(Number(e.target.value))} className="w-full accent-indigo-500" />
                </div>
              </div>

              <button onClick={handleSimulate} disabled={simulating || !simSource || !simDest} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg py-2 text-sm font-medium transition-colors">
                {simulating ? "Simulating…" : "Simulate"}
              </button>

              {simError && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{simError}</div>}

              {simResult && (
                <div className="space-y-3 pt-1">
                  {/* Path */}
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Path ({simResult.n_hops} hop{simResult.n_hops !== 1 ? "s" : ""})</p>
                    <div className="flex items-center flex-wrap gap-1 text-sm">
                      {simResult.path.map((node, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <span className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs font-medium">{node}</span>
                          {i < simResult.path.length - 1 && <span className="text-gray-500 text-xs">→</span>}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "End-to-End Fidelity", value: `${(simResult.end_to_end_fidelity * 100).toFixed(2)}%`, green: true },
                      { label: "Entanglement Rate", value: `${simResult.entanglement_rate_hz.toFixed(1)} Hz`, green: false },
                      { label: "Success Probability", value: `${(simResult.success_probability * 100).toFixed(2)}%`, green: true },
                      { label: "Latency", value: `${simResult.latency_ms.toFixed(2)} ms`, green: false },
                    ].map(({ label, value, green }) => (
                      <div key={label} className="bg-gray-800 rounded-lg px-3 py-2 text-center">
                        <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                        <p className={`text-sm font-semibold ${green ? "text-green-400" : "text-indigo-300"}`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {simResult.bottleneck_link && (
                    <div className="bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
                      <p className="text-xs text-red-400">Bottleneck Link: <span className="font-medium text-red-300">{simResult.bottleneck_link}</span></p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Repeater Optimizer */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <h2 className="text-base font-semibold text-indigo-400">Repeater Optimizer</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Repeaters: {optNRepeaters}</label>
                  <input type="range" min={1} max={10} value={optNRepeaters} onChange={(e) => setOptNRepeaters(Number(e.target.value))} className="w-full accent-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Budget (USD, optional)</label>
                  <input type="number" min={0} value={optBudget} onChange={(e) => setOptBudget(e.target.value)} placeholder="No limit" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
                </div>
              </div>
              <button onClick={handleOptimize} disabled={optimizing} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg py-2 text-sm font-medium transition-colors">
                {optimizing ? "Optimizing…" : "Optimize Repeaters"}
              </button>
              {optError && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{optError}</div>}
              {optResult && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-gray-800 rounded-lg px-3 py-2 text-center">
                      <p className="text-xs text-gray-400 mb-0.5">Fidelity</p>
                      <p className="text-sm font-semibold">
                        <span className="text-gray-400">{(optResult.fidelity_before * 100).toFixed(2)}%</span>
                        <span className="text-gray-500 mx-1">→</span>
                        <span className="text-green-400">{(optResult.fidelity_after * 100).toFixed(2)}%</span>
                      </p>
                    </div>
                    <div className="bg-gray-800 rounded-lg px-3 py-2 text-center">
                      <p className="text-xs text-gray-400 mb-0.5">Rate (Hz)</p>
                      <p className="text-sm font-semibold">
                        <span className="text-gray-400">{optResult.rate_before.toFixed(1)}</span>
                        <span className="text-gray-500 mx-1">→</span>
                        <span className="text-green-400">{optResult.rate_after.toFixed(1)}</span>
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-2">Placements</p>
                    <div className="space-y-1">
                      {optResult.placements.map((p, i) => (
                        <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-1.5 text-xs">
                          <span className="text-gray-200">{p.position}</span>
                          <span className="text-green-400 font-medium">+{(p.improvement * 100).toFixed(1)}%</span>
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
