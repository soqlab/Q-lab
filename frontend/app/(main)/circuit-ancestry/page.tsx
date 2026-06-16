"use client";
import { useState, useEffect } from "react";
import { listCircuits, createCircuit, getCircuitTree, forkCircuit, AncestryCircuitTree } from "@/lib/api";

export default function CircuitAncestryPage() {
  const [circuits, setCircuits] = useState<{ circuit_id: string; name: string; total_versions: number; total_forks: number }[]>([]);
  const [tree, setTree] = useState<AncestryCircuitTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [qasm, setQasm] = useState('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];');
  const [msg, setMsg] = useState("Initial version");

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await listCircuits() as { circuits: { circuit_id: string; name: string; total_versions: number; total_forks: number }[] };
      setCircuits(r.circuits);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function create() {
    if (!name || !qasm) return;
    setLoading(true); setError("");
    try {
      await createCircuit({ name, qasm, commit_message: msg });
      setShowCreate(false); setName(""); setMsg("Initial version");
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function loadTree(circuitId: string) {
    setLoading(true);
    try {
      const t = await getCircuitTree(circuitId);
      setTree(t);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function fork(circuitId: string) {
    setLoading(true);
    try {
      await forkCircuit({ circuit_id: circuitId });
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Circuit Ancestry</h1>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium">
          + New Circuit
        </button>
      </div>
      <p className="text-gray-400">Git-style versioning for quantum circuits — commit, fork, and diff across circuit lineages.</p>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {showCreate && (
        <div className="bg-gray-900 rounded-lg p-5 space-y-3">
          <input placeholder="Circuit name" value={name} onChange={e => setName(e.target.value)}
            className="w-full bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          <textarea value={qasm} onChange={e => setQasm(e.target.value)}
            className="w-full h-36 bg-gray-800 text-green-400 font-mono text-sm px-3 py-2 rounded border border-gray-700" />
          <input placeholder="Commit message" value={msg} onChange={e => setMsg(e.target.value)}
            className="w-full bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          <div className="flex gap-3">
            <button onClick={create} disabled={loading} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50">Commit</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-700 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {circuits.map((c) => (
          <div key={c.circuit_id} className="bg-gray-900 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{c.name}</span>
              <span className="font-mono text-xs text-gray-500">{c.circuit_id.slice(0, 8)}</span>
            </div>
            <div className="flex gap-4 text-sm text-gray-400">
              <span>{c.total_versions} version{c.total_versions !== 1 ? "s" : ""}</span>
              <span>{c.total_forks} fork{c.total_forks !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => loadTree(c.circuit_id)}
                className="px-3 py-1 bg-indigo-700 hover:bg-indigo-600 rounded text-xs">View Tree</button>
              <button onClick={() => fork(c.circuit_id)}
                className="px-3 py-1 bg-purple-700 hover:bg-purple-600 rounded text-xs">Fork</button>
            </div>
          </div>
        ))}
      </div>

      {tree && (
        <div className="bg-gray-900 rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">Version History: {tree.circuit_id.slice(0, 8)}</h2>
          <div className="space-y-2">
            {tree.versions.map(v => (
              <div key={v.version_id} className={`flex items-center gap-4 p-3 rounded border ${v.is_head ? "border-indigo-500 bg-indigo-900/20" : "border-gray-700"}`}>
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-mono">
                  v{v.version_number}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{v.commit_message}</div>
                  <div className="text-xs text-gray-500">{v.n_qubits}q · depth {v.depth} · {v.gate_count} gates</div>
                </div>
                {v.is_head && <span className="text-xs bg-indigo-600 px-2 py-0.5 rounded">HEAD</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
