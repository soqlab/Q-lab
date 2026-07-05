"use client";
import { useState, useEffect } from "react";
import { listNoiseModels, getNoiseModel, applyNoiseModel, NoiseMarketplaceModel } from "@/lib/api";

export default function NoiseMarketplacePage() {
  const [models, setModels] = useState<NoiseMarketplaceModel[]>([]);
  const [selected, setSelected] = useState<NoiseMarketplaceModel | null>(null);
  const [applyResult, setApplyResult] = useState<{ fidelity_degradation: number; ideal_counts: Record<string, number>; noisy_counts: Record<string, number>; noise_method: string } | null>(null);
  const [qasm, setQasm] = useState('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [snippetTab, setSnippetTab] = useState<"qiskit" | "pennylane" | "qasm">("qiskit");
  const [sortBy, setSortBy] = useState("downloads");

  useEffect(() => { load(); }, [sortBy]);

  async function load() {
    setLoading(true);
    try {
      const r = await listNoiseModels({ sort_by: sortBy });
      setModels(r.models);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function selectModel(id: string) {
    try {
      const m = await getNoiseModel(id);
      setSelected(m); setApplyResult(null);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function apply() {
    if (!selected) return;
    setLoading(true); setError("");
    try {
      const r = await applyNoiseModel({ model_id: selected.model_id, circuit_qasm: qasm });
      setApplyResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1152, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Noise Model Marketplace</h1>
      <p style={{ color: "var(--muted)" }}>Browse, download, and apply community-contributed noise models for realistic quantum simulation.</p>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Sort:</span>
        {(["downloads", "stars"] as const).map(s => (
          <button key={s} onClick={() => setSortBy(s)}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              fontSize: 13,
              border: "none",
              cursor: "pointer",
              background: sortBy === s ? "var(--strong)" : "var(--surface)",
              color: sortBy === s ? "var(--text)" : "var(--muted)",
            }}>
            {s}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(models ?? []).map(m => (
            <div key={m.model_id}
              onClick={() => selectModel(m.model_id)}
              style={{
                background: "var(--surface)",
                borderRadius: 8,
                padding: 16,
                cursor: "pointer",
                border: selected?.model_id === m.model_id ? "1px solid var(--strong)" : "1px solid transparent",
              }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{m.backend} · {m.n_qubits}q · {m.model_type}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
                  <div>{m.downloads.toLocaleString()} ↓</div>
                  <div>★ {m.stars}</div>
                </div>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, WebkitLineClamp: 2, display: "-webkit-box", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{m.description}</p>
              <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                {(m.tags ?? []).map(t => (
                  <span key={t} style={{ fontSize: 12, background: "var(--line)", color: "var(--muted)", padding: "2px 6px", borderRadius: 6 }}>{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 24 }}>
            <h2 style={{ fontWeight: 600 }}>{selected.name}</h2>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>{selected.description}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
              <div><span style={{ color: "var(--muted)" }}>Author:</span> {selected.author}</div>
              <div><span style={{ color: "var(--muted)" }}>Fidelity Err:</span> {selected.fidelity_error}</div>
              <div><span style={{ color: "var(--muted)" }}>Institution:</span> {selected.institution}</div>
              <div><span style={{ color: "var(--muted)" }}>Captured:</span> {selected.date_captured}</div>
            </div>

            <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
              {(["qiskit", "pennylane", "qasm"] as const).map(t => (
                <button key={t} onClick={() => setSnippetTab(t)}
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    borderBottom: snippetTab === t ? "2px solid var(--strong)" : "2px solid transparent",
                    color: snippetTab === t ? "var(--strong)" : "var(--muted)",
                  }}>
                  {t}
                </button>
              ))}
            </div>
            <pre style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: "var(--ok)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", overflowX: "auto", whiteSpace: "pre-wrap", maxHeight: 160 }}>
              {snippetTab === "qiskit" ? selected.qiskit_snippet : snippetTab === "pennylane" ? selected.pennylane_snippet : selected.qasm_snippet}
            </pre>

            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>Test Circuit (QASM)</label>
              <textarea value={qasm} onChange={e => setQasm(e.target.value)}
                style={{ width: "100%", height: 96, marginTop: 4, background: "var(--surface)", color: "var(--ok)", fontFamily: "ui-monospace,monospace", fontSize: 12, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }} />
            </div>
            <button onClick={apply} disabled={loading}
              style={{ width: "100%", padding: "8px 0", background: "#7c3aed", borderRadius: 6, fontWeight: 500, fontSize: 13, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1, color: "var(--text)" }}>
              {loading ? "Applying..." : "Apply Noise Model"}
            </button>

            {applyResult && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                  <div><span style={{ color: "var(--muted)" }}>Fidelity loss:</span> <span style={{ color: "var(--danger)", fontFamily: "ui-monospace,monospace" }}>{(applyResult.fidelity_degradation * 100).toFixed(2)}%</span></div>
                  <div><span style={{ color: "var(--muted)" }}>Method:</span> {applyResult.noise_method}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {(["ideal_counts", "noisy_counts"] as const).map(k => (
                    <div key={k} style={{ background: "var(--line)", borderRadius: 6, padding: 12 }}>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{k === "ideal_counts" ? "Ideal" : "Noisy"}</div>
                      {Object.entries(applyResult[k]).slice(0, 4).map(([state, count]) => (
                        <div key={state} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "ui-monospace,monospace" }}>
                          <span>{state}</span><span>{count}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
