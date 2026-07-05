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
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Circuit Ancestry</h1>
        <button onClick={() => setShowCreate(!showCreate)} className="button">
          + New Circuit
        </button>
      </div>
      <p style={{ color: "var(--muted)" }}>Git-style versioning for quantum circuits — commit, fork, and diff across circuit lineages.</p>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {showCreate && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <input placeholder="Circuit name" value={name} onChange={e => setName(e.target.value)}
            className="input" style={{ width: "100%" }} />
          <textarea value={qasm} onChange={e => setQasm(e.target.value)}
            className="input" style={{ width: "100%", height: 144, color: "var(--ok)", fontFamily: "ui-monospace,monospace", fontSize: 13 }} />
          <input placeholder="Commit message" value={msg} onChange={e => setMsg(e.target.value)}
            className="input" style={{ width: "100%" }} />
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={create} disabled={loading}
              style={{ padding: "8px 16px", background: "var(--ok)", borderRadius: 6, fontSize: 13, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer", color: "var(--text)", border: "none" }}>
              Commit
            </button>
            <button onClick={() => setShowCreate(false)} className="button secondary">Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
        {(circuits ?? []).map((c) => (
          <div key={c.circuit_id} style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: "var(--muted)" }}>{c.circuit_id.slice(0, 8)}</span>
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--muted)" }}>
              <span>{c.total_versions} version{c.total_versions !== 1 ? "s" : ""}</span>
              <span>{c.total_forks} fork{c.total_forks !== 1 ? "s" : ""}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => loadTree(c.circuit_id)}
                style={{ padding: "4px 12px", background: "var(--strong)", borderRadius: 6, fontSize: 12, cursor: "pointer", color: "var(--text)", border: "none" }}>
                View Tree
              </button>
              <button onClick={() => fork(c.circuit_id)}
                style={{ padding: "4px 12px", background: "#7c3aed", borderRadius: 6, fontSize: 12, cursor: "pointer", color: "var(--text)", border: "none" }}>
                Fork
              </button>
            </div>
          </div>
        ))}
      </div>

      {tree && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontWeight: 600 }}>Version History: {tree.circuit_id.slice(0, 8)}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(tree.versions ?? []).map(v => (
              <div key={v.version_id} style={{ display: "flex", alignItems: "center", gap: 16, padding: 12, borderRadius: 6, border: v.is_head ? "1px solid var(--strong)" : "1px solid var(--line)", background: v.is_head ? "rgba(99,102,241,0.1)" : "transparent" }}>
                <div style={{ width: 32, height: 32, borderRadius: 999, background: "var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontFamily: "ui-monospace,monospace", flexShrink: 0 }}>
                  v{v.version_number}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v.commit_message}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{v.n_qubits}q · depth {v.depth} · {v.gate_count} gates</div>
                </div>
                {v.is_head && <span style={{ fontSize: 12, background: "var(--strong)", padding: "2px 8px", borderRadius: 6, color: "var(--text)", flexShrink: 0 }}>HEAD</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
