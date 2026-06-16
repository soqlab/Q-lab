"use client";
import { useState } from "react";
import { TranspileProviderResult, transpileCircuit } from "../../../lib/api";
import { ArrowRightLeft, Copy, Check, Zap } from "lucide-react";

const PRESET_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
t q[0];
s q[1];
cx q[0],q[1];
measure q -> c;`;

const PROVIDERS = [
  { id: "ibm", label: "IBM Quantum", color: "#3b82f6", icon: "🔷" },
  { id: "ionq", label: "IonQ", color: "#8b5cf6", icon: "⚛️" },
  { id: "braket", label: "AWS Braket", color: "#f59e0b", icon: "🔶" },
  { id: "rigetti", label: "Rigetti", color: "#10b981", icon: "🟢" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background: "#0f172a", border: "1px solid #334155", color: copied ? "#10b981" : "#94a3b8", borderRadius: 6, padding: "0.25rem 0.6rem", cursor: "pointer", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 4 }}>
      {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function TranspilePage() {
  const [qasm, setQasm] = useState(PRESET_QASM);
  const [results, setResults] = useState<Record<string, TranspileProviderResult>>({});
  const [activeTab, setActiveTab] = useState("ibm");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTranspile = async () => {
    setLoading(true); setError(null);
    try {
      const r = await transpileCircuit({ qasm, providers: PROVIDERS.map(p => p.id) });
      setResults(r.results);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const provider = PROVIDERS.find(p => p.id === activeTab)!;
  const activeResult = results[activeTab];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <ArrowRightLeft size={28} color="#3b82f6" /> Cross-Provider Circuit Transpiler
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Translates any QASM circuit into native gate sets of IBM, IonQ, AWS Braket, and Rigetti simultaneously. Compare overhead ratios across all providers.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.5rem" }}>
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
          <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Input Circuit</h3>
          <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={14}
            style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.6rem", fontFamily: "monospace", fontSize: "0.78rem", boxSizing: "border-box", resize: "vertical", marginBottom: 12 }} />
          <button onClick={handleTranspile} disabled={loading}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.65rem", cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
            <Zap size={15} /> {loading ? "Transpiling all providers…" : "Transpile All Providers"}
          </button>

          {Object.keys(results).length > 0 && (
            <div style={{ marginTop: "1.25rem" }}>
              <h4 style={{ color: "#94a3b8", fontSize: "0.82rem", marginBottom: 8 }}>Overhead Comparison</h4>
              {PROVIDERS.map(p => {
                const r = results[p.id];
                if (!r) return null;
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ color: "#64748b", fontSize: "0.78rem", width: 60 }}>{p.label.split(" ")[0]}</span>
                    <div style={{ flex: 1, height: 8, background: "#0f172a", borderRadius: 99 }}>
                      <div style={{ width: `${Math.min(r.overhead_ratio * 50, 100)}%`, height: "100%", background: p.color, borderRadius: 99 }} />
                    </div>
                    <span style={{ color: p.color, fontWeight: 700, fontSize: "0.78rem", width: 36 }}>{r.overhead_ratio.toFixed(2)}×</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: "1rem" }}>
            {PROVIDERS.map(p => (
              <button key={p.id} onClick={() => setActiveTab(p.id)}
                style={{ flex: 1, padding: "0.5rem 0.4rem", borderRadius: 8, border: `2px solid ${activeTab === p.id ? p.color : "#334155"}`, background: activeTab === p.id ? p.color + "22" : "#1e293b", cursor: "pointer", textAlign: "center" }}>
                <div style={{ fontSize: "1.1rem" }}>{p.icon}</div>
                <div style={{ color: activeTab === p.id ? p.color : "#94a3b8", fontSize: "0.72rem", fontWeight: 600, marginTop: 2 }}>{p.label}</div>
                {results[p.id] && <div style={{ color: "#475569", fontSize: "0.65rem" }}>{results[p.id].overhead_ratio.toFixed(2)}× overhead</div>}
              </button>
            ))}
          </div>

          {activeResult ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Original Gates", value: activeResult.original_gate_count, color: "#64748b" },
                  { label: "Transpiled Gates", value: activeResult.transpiled_gate_count, color: provider.color },
                  { label: "Overhead Ratio", value: `${activeResult.overhead_ratio.toFixed(2)}×`, color: activeResult.overhead_ratio > 2 ? "#ef4444" : "#10b981" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.4rem", fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>Native Gate Set</h3>
                  <div style={{ fontSize: "0.8rem", color: "#94a3b8", fontFamily: "monospace" }}>{activeResult.native_gate_set}</div>
                  <div style={{ marginTop: 8, color: "#64748b", fontSize: "0.75rem" }}>{activeResult.n_qubits} qubits</div>
                </div>
                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>Provider Info</h3>
                  <div style={{ color: provider.color, fontSize: "0.85rem", fontWeight: 700, marginBottom: 6 }}>{provider.icon} {provider.label}</div>
                  <div style={{ color: "#10b981", fontSize: "0.82rem" }}>✓ Decomposition complete</div>
                  <div style={{ color: "#64748b", fontSize: "0.75rem", marginTop: 4 }}>
                    {activeResult.transpiled_gate_count - activeResult.original_gate_count > 0
                      ? `+${activeResult.transpiled_gate_count - activeResult.original_gate_count} gates from decomposition`
                      : "No gate overhead"}
                  </div>
                </div>
              </div>

              <div style={{ background: "#1e293b", borderRadius: 12, border: `1px solid ${provider.color}30`, padding: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.9rem" }}>{provider.icon} {provider.label} Native QASM</h3>
                  <CopyButton text={activeResult.transpiled_qasm} />
                </div>
                <pre style={{ background: "#0f172a", borderRadius: 6, padding: "0.75rem", color: "#94a3b8", fontSize: "0.75rem", overflowX: "auto", maxHeight: 260, margin: 0 }}>
                  {activeResult.transpiled_qasm}
                </pre>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, color: "#475569" }}>
              <ArrowRightLeft size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Paste a circuit and click "Transpile All Providers" to see decompositions for all quantum hardware vendors.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
