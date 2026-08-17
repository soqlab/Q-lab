"use client";
import { useState } from "react";
import { EnsembleResult, runEnsemble } from "../../../lib/api";
import { GitMerge, Play } from "lucide-react";

const PRESET = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[1],q[2];
t q[0];
measure q -> c;`;

const ALL_PROVIDERS = ["ibm_sim", "ionq_sim", "braket_sim", "rigetti_sim", "statevector"];
const PROVIDER_LABELS: Record<string, string> = {
  ibm_sim: "IBM Sim", ionq_sim: "IonQ Sim", braket_sim: "AWS Braket",
  rigetti_sim: "Rigetti Sim", statevector: "Ideal SV",
};

function DistBar({ dist }: { dist: Record<string, number> }) {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = entries[0]?.[1] ?? 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {entries.map(([bs, prob]) => (
        <div key={bs} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#94a3b8", width: 40, textAlign: "right" }}>{bs}</span>
          <div style={{ flex: 1, height: 10, background: "#0f172a", borderRadius: 99 }}>
            <div style={{ width: `${(prob / max) * 100}%`, height: "100%", background: "#3b82f6", borderRadius: 99 }} />
          </div>
          <span style={{ color: "#64748b", fontSize: "0.68rem", width: 36 }}>{(prob * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export default function EnsemblePage() {
  const [qasm, setQasm] = useState(PRESET);
  const [shots, setShots] = useState(1024);
  const [providers, setProviders] = useState<string[]>(ALL_PROVIDERS);
  const [result, setResult] = useState<EnsembleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("consensus");

  const toggleProvider = (p: string) => setProviders(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const run = async () => {
    setLoading(true); setError(null);
    try { setResult(await runEnsemble({ qasm, shots, providers })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const activeResult = result?.individual_results.find(r => r.provider_id === activeTab);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem" }}>
      <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: "1.5rem", display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#e2e8f0", lineHeight: 1.6 }}>
        <span>⚗️</span>
        <span><strong style={{ color: "#f59e0b" }}>Simulated Preview</strong> — All provider backends (IBM, IonQ, Braket, Rigetti) run as local simulators. Real hardware submission is in development.</span>
      </div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <GitMerge size={28} color="#3b82f6" /> Multi-Backend Statistical Ensemble
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Runs the same circuit on multiple simulated providers simultaneously, fuses result distributions
          using fidelity-weighted averaging, and computes cross-provider agreement score.
        </p>
      </div>
      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Configuration</h3>
            <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={8}
              style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box", resize: "vertical", marginBottom: 12 }} />
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 12 }}>
              Shots per provider: <span style={{ color: "#3b82f6", fontWeight: 700 }}>{shots}</span>
              <input type="range" min={64} max={4096} step={64} value={shots} onChange={e => setShots(Number(e.target.value))}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#3b82f6" }} />
            </label>
            <h4 style={{ color: "#94a3b8", fontSize: "0.82rem", marginBottom: 6 }}>Providers</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
              {ALL_PROVIDERS.map(p => (
                <label key={p} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={providers.includes(p)} onChange={() => toggleProvider(p)} style={{ accentColor: "#3b82f6" }} />
                  <span style={{ color: providers.includes(p) ? "#e2e8f0" : "#475569", fontSize: "0.82rem" }}>{PROVIDER_LABELS[p]}</span>
                </label>
              ))}
            </div>
            <button onClick={run} disabled={loading || providers.length === 0}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 600, opacity: loading || providers.length === 0 ? 0.6 : 1 }}>
              <Play size={15} /> {loading ? "Running ensemble…" : "Run Ensemble"}
            </button>
          </div>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Agreement", value: `${(result.agreement_score * 100).toFixed(1)}%`, color: result.agreement_score > 0.8 ? "#10b981" : "#f59e0b" },
                  { label: "Providers", value: result.n_providers, color: "#3b82f6" },
                  { label: "Top Bitstring", value: result.consensus_top_bitstring || "—", color: "#8b5cf6" },
                  { label: "Best Provider", value: result.best_provider_name.split(" ")[0], color: "#10b981" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.15rem", fontWeight: 700, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: "1rem", flexWrap: "wrap" }}>
                <button onClick={() => setActiveTab("consensus")}
                  style={{ padding: "0.45rem 0.85rem", borderRadius: 8, border: `2px solid ${activeTab === "consensus" ? "#3b82f6" : "#334155"}`, background: activeTab === "consensus" ? "#1d3a6b" : "#1e293b", color: activeTab === "consensus" ? "#3b82f6" : "#94a3b8", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>
                  Consensus
                </button>
                {result.individual_results.map(r => (
                  <button key={r.provider_id} onClick={() => setActiveTab(r.provider_id)}
                    style={{ padding: "0.45rem 0.85rem", borderRadius: 8, border: `2px solid ${activeTab === r.provider_id ? r.color : "#334155"}`, background: activeTab === r.provider_id ? r.color + "22" : "#1e293b", color: activeTab === r.provider_id ? r.color : "#94a3b8", cursor: "pointer", fontSize: "0.8rem" }}>
                    {PROVIDER_LABELS[r.provider_id]}
                    <span style={{ marginLeft: 6, fontSize: "0.7rem", opacity: 0.7 }}>{(r.estimated_fidelity * 100).toFixed(0)}%</span>
                  </button>
                ))}
              </div>

              {activeTab === "consensus" ? (
                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #3b82f640", padding: "1.25rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 12, fontSize: "0.9rem" }}>Weighted Consensus Distribution</h3>
                  <DistBar dist={result.consensus_distribution} />
                  <div style={{ marginTop: 12, color: "#64748b", fontSize: "0.78rem" }}>
                    Entropy: {result.consensus_entropy.toFixed(3)} bits · Agreement: {(result.agreement_score * 100).toFixed(1)}%
                  </div>
                </div>
              ) : activeResult ? (
                <div style={{ background: "#1e293b", borderRadius: 12, border: `1px solid ${activeResult.color}40`, padding: "1.25rem" }}>
                  <h3 style={{ color: activeResult.color, fontWeight: 600, marginBottom: 12, fontSize: "0.9rem" }}>{activeResult.provider_name}</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
                    {[
                      { l: "Noise Level", v: `${(activeResult.noise_level * 100).toFixed(1)}%` },
                      { l: "Fidelity", v: `${(activeResult.estimated_fidelity * 100).toFixed(1)}%` },
                      { l: "TVD to Ideal", v: activeResult.tvd_to_ideal.toFixed(4) },
                    ].map(m => (
                      <div key={m.l} style={{ background: "#0f172a", borderRadius: 6, padding: "0.5rem", textAlign: "center" }}>
                        <div style={{ color: "#64748b", fontSize: "0.7rem" }}>{m.l}</div>
                        <div style={{ color: activeResult.color, fontWeight: 700, fontSize: "0.9rem" }}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                  <DistBar dist={activeResult.distribution} />
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#475569" }}>
              <GitMerge size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Run ensemble to fuse results across IBM, IonQ, Braket, Rigetti, and ideal statevector.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
