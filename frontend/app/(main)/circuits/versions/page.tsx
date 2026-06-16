"use client";

import { useEffect, useState } from "react";
import {
  listCircuitFamilies, listCircuitVersions, createCircuitVersion, diffCircuitVersions, getCircuitVersionHistory,
  CircuitFamily, CircuitVersion, CircuitDiff,
} from "../../../../lib/api";

const SAMPLE_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

export default function CircuitVersionsPage() {
  const [families, setFamilies] = useState<CircuitFamily[]>([]);
  const [versions, setVersions] = useState<CircuitVersion[]>([]);
  const [selectedFamily, setSelectedFamily] = useState<string>("");
  const [selectedVersion, setSelectedVersion] = useState<CircuitVersion | null>(null);
  const [compareVersion, setCompareVersion] = useState<CircuitVersion | null>(null);
  const [diff, setDiff] = useState<CircuitDiff | null>(null);
  const [history, setHistory] = useState<CircuitVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"versions" | "diff" | "history">("versions");

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ circuit_family: "", qasm: SAMPLE_QASM, commit_message: "", tags: "" });
  const [creating, setCreating] = useState(false);

  const loadFamilies = () => {
    setLoading(true);
    listCircuitFamilies()
      .then(f => { setFamilies(f); setErr(""); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadFamilies(); }, []);

  useEffect(() => {
    if (!selectedFamily) { setVersions([]); return; }
    listCircuitVersions({ family: selectedFamily, limit: 50 })
      .then(setVersions)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [selectedFamily]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const tags = createForm.tags ? createForm.tags.split(",").map(t => t.trim()) : [];
      await createCircuitVersion({ ...createForm, tags });
      loadFamilies();
      if (createForm.circuit_family === selectedFamily) {
        listCircuitVersions({ family: selectedFamily, limit: 50 }).then(setVersions);
      }
      setShowCreate(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDiff = async () => {
    if (!selectedVersion || !compareVersion) return;
    try {
      const d = await diffCircuitVersions(selectedVersion.version_id, compareVersion.version_id);
      setDiff(d);
      setTab("diff");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleHistory = async (v: CircuitVersion) => {
    try {
      const h = await getCircuitVersionHistory(v.version_id);
      setHistory(h.history);
      setTab("history");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const renderDeltaBadge = (delta: number, label: string) => {
    const color = delta === 0 ? "#6b7280" : delta > 0 ? "#ef4444" : "#10b981";
    const sign = delta > 0 ? "+" : "";
    return (
      <span key={label} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, background: `${color}22`, color, marginRight: 4 }}>
        {label}: {sign}{delta}
      </span>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Circuit Version Control</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={loadFamilies}>Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? "Cancel" : "+ Commit Version"}
          </button>
        </div>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>}

      {/* Create form */}
      {showCreate && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header"><h2>Commit Circuit Version</h2></div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 160 }}>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>Circuit Family</span>
                <input className="input" value={createForm.circuit_family} onChange={e => setCreateForm(f => ({ ...f, circuit_family: e.target.value }))} placeholder="bell-state" />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 2, minWidth: 200 }}>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>Commit Message</span>
                <input className="input" value={createForm.commit_message} onChange={e => setCreateForm(f => ({ ...f, commit_message: e.target.value }))} placeholder="Add Hadamard + CNOT" />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>Tags (comma-separated)</span>
                <input className="input" value={createForm.tags} onChange={e => setCreateForm(f => ({ ...f, tags: e.target.value }))} placeholder="v1, stable" />
              </label>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>QASM</span>
              <textarea
                className="input"
                value={createForm.qasm}
                onChange={e => setCreateForm(f => ({ ...f, qasm: e.target.value }))}
                rows={8}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </label>
            <div>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !createForm.circuit_family || !createForm.qasm}>
                {creating ? "Committing..." : "Commit"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 16 }}>
        {/* Family list */}
        <div style={{ flex: "0 0 220px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            Circuit Families
          </div>
          {loading ? (
            <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading...</div>
          ) : families.length === 0 ? (
            <div className="panel" style={{ padding: 16, color: "#6b7280", fontSize: 13 }}>No circuits yet.</div>
          ) : (
            families.map(f => (
              <div
                key={f.circuit_family}
                className="panel"
                onClick={() => setSelectedFamily(f.circuit_family)}
                style={{
                  padding: "9px 12px", cursor: "pointer",
                  borderLeft: selectedFamily === f.circuit_family ? "3px solid #3b82f6" : "3px solid transparent",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{f.circuit_family}</div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{f.version_count} version{f.version_count !== 1 ? "s" : ""}</div>
              </div>
            ))
          )}
        </div>

        {/* Version detail */}
        <div style={{ flex: 1 }}>
          {selectedFamily ? (
            <>
              {/* Tabs */}
              <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
                {(["versions", "diff", "history"] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{
                    padding: "5px 14px", borderRadius: 4, fontSize: 13, cursor: "pointer", border: "1px solid",
                    borderColor: tab === t ? "#3b82f6" : "#374151",
                    background: tab === t ? "#1d4ed822" : "transparent",
                    color: tab === t ? "#3b82f6" : "#9ca3af",
                  }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                ))}
              </div>

              {tab === "versions" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {versions.length === 0 ? (
                    <div className="panel" style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>No versions in this family.</div>
                  ) : versions.map(v => {
                    const ds = v.diff_stats as { delta_gates?: number; delta_depth?: number; delta_qubits?: number; new_stats?: { num_qubits?: number; gate_count?: number; depth?: number } };
                    const ns = ds.new_stats ?? {};
                    return (
                      <div key={v.version_id} className="panel" style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>v{v.version_num}</span>
                            {v.semantic_version && (
                              <span style={{ fontSize: 11, fontFamily: "monospace", color: "#9ca3af" }}>{v.semantic_version}</span>
                            )}
                            <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace" }}>{v.version_id.slice(0, 12)}…</span>
                            {v.commit_message && <span style={{ fontSize: 13 }}>{v.commit_message}</span>}
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }}
                              onClick={() => { setSelectedVersion(v); setCompareVersion(null); setDiff(null); }}>
                              Select A
                            </button>
                            {selectedVersion && selectedVersion.version_id !== v.version_id && (
                              <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }}
                                onClick={() => { setCompareVersion(v); }}>
                                Compare B
                              </button>
                            )}
                            <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }}
                              onClick={() => handleHistory(v)}>
                              History
                            </button>
                          </div>
                        </div>
                        <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          {v.version_num > 1 && ds.delta_gates != null && renderDeltaBadge(ds.delta_gates, "Δgates")}
                          {v.version_num > 1 && ds.delta_depth != null && renderDeltaBadge(ds.delta_depth, "Δdepth")}
                          {v.version_num > 1 && ds.delta_qubits != null && renderDeltaBadge(ds.delta_qubits, "Δqubits")}
                          {ns.num_qubits != null && <span style={{ fontSize: 11, color: "#6b7280" }}>{ns.num_qubits}q</span>}
                          {ns.gate_count != null && <span style={{ fontSize: 11, color: "#6b7280" }}>{ns.gate_count} gates</span>}
                          {v.tags?.length > 0 && v.tags.map(tag => (
                            <span key={tag} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, background: "#1d4ed822", color: "#3b82f6" }}>{tag}</span>
                          ))}
                          <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto" }}>{new Date(v.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })}
                  {selectedVersion && compareVersion && (
                    <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={handleDiff}>
                      Diff v{selectedVersion.version_num} ↔ v{compareVersion.version_num}
                    </button>
                  )}
                </div>
              )}

              {tab === "diff" && diff && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="panel" style={{ padding: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 10 }}>
                      {diff.v1.circuit_family} v{diff.v1.version_num} → v{diff.v2.version_num}
                      {diff.is_identical && <span style={{ color: "#f59e0b", marginLeft: 10 }}>(identical)</span>}
                    </div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      {[
                        { label: "Δ Depth", v: diff.diff_stats.delta_depth },
                        { label: "Δ Gates", v: diff.diff_stats.delta_gates },
                        { label: "Δ CX", v: diff.diff_stats.delta_cx },
                        { label: "Δ Qubits", v: diff.diff_stats.delta_qubits },
                      ].map(({ label, v }) => (
                        <div key={label}>
                          <div style={{ fontSize: 11, color: "#9ca3af" }}>{label}</div>
                          <div style={{ fontWeight: 700, color: v === 0 ? "#6b7280" : v > 0 ? "#ef4444" : "#10b981" }}>
                            {v > 0 ? "+" : ""}{v}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="panel">
                    <div className="panel-header"><h2>Unified Diff</h2></div>
                    <div style={{ padding: 16 }}>
                      <pre style={{ fontFamily: "monospace", fontSize: 11, overflow: "auto", maxHeight: 400, margin: 0, whiteSpace: "pre-wrap" }}>
                        {diff.text_diff || "(no textual diff)"}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {tab === "history" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {history.length === 0 ? (
                    <div className="panel" style={{ padding: 24, color: "#6b7280" }}>Select a version and click History.</div>
                  ) : history.map((v, i) => (
                    <div key={v.version_id} className="panel" style={{ padding: "10px 14px", display: "flex", gap: 12, alignItems: "center" }}>
                      <div style={{ width: 24, height: 24, borderRadius: "50%", background: i === 0 ? "#10b981" : "#374151", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                        {v.version_num}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{v.commit_message || "(no message)"}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>{v.version_id}</div>
                      </div>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>{new Date(v.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="panel" style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>
              Select a circuit family to browse versions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
