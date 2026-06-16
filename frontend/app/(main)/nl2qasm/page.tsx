"use client";
import { useEffect, useState } from "react";
import { NL2QASMResult, NL2QASMSuggestion, compileNL, listNL2QASMExamples } from "../../../lib/api";
type NL2QASMExample = { name: string; pattern_hint: string; n_qubits: number };
import { Terminal, Zap, Copy, Check } from "lucide-react";

function ConfidenceBadge({ conf }: { conf: number }) {
  const color = conf > 0.8 ? "#10b981" : conf > 0.5 ? "#f59e0b" : "#ef4444";
  const label = conf > 0.8 ? "High" : conf > 0.5 ? "Medium" : "Low";
  return (
    <span style={{ background: color + "22", color, fontSize: "0.75rem", fontWeight: 700, padding: "2px 8px", borderRadius: 99, border: `1px solid ${color}40` }}>
      {label} ({(conf * 100).toFixed(0)}%)
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button onClick={copy} style={{ background: "none", border: "none", cursor: "pointer", color: copied ? "#10b981" : "#64748b", display: "flex", alignItems: "center", gap: 4, fontSize: "0.78rem" }}>
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function NL2QASMPage() {
  const [prompt, setPrompt] = useState("Create a Bell state between two qubits");
  const [nQubits, setNQubits] = useState(0);
  const [examples, setExamples] = useState<NL2QASMExample[]>([]);
  const [result, setResult] = useState<NL2QASMResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listNL2QASMExamples().then(e => setExamples(e)).catch(() => {});
  }, []);

  const compile = async () => {
    setLoading(true); setError(null);
    try {
      setResult(await compileNL({ description: prompt, n_qubits_hint: nQubits > 0 ? nQubits : undefined }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Terminal size={28} color="#8b5cf6" /> Natural Language → QASM Compiler
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Describe a quantum circuit in plain English. Pattern-matched against Bell states, GHZ, QFT, Grover,
          teleportation, SWAP test, VQE ansatz, and more — compiled to valid OpenQASM 2.0.
        </p>
      </div>
      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Describe Your Circuit</h3>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
              placeholder="e.g. 'Create a 3-qubit GHZ state' or 'Build a quantum teleportation circuit'"
              style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontSize: "0.85rem", boxSizing: "border-box", resize: "vertical", marginBottom: 12 }} />
            <label style={{ color: "#94a3b8", fontSize: "0.82rem", display: "block", marginBottom: 14 }}>
              Override qubit count: <span style={{ color: "#8b5cf6", fontWeight: 700 }}>{nQubits === 0 ? "auto" : nQubits}</span>
              <input type="range" min={0} max={10} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#8b5cf6" }} />
            </label>
            <button onClick={compile} disabled={loading || !prompt.trim()}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 700, opacity: loading || !prompt.trim() ? 0.6 : 1 }}>
              <Zap size={15} /> {loading ? "Compiling…" : "Compile to QASM"}
            </button>
          </div>

          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
            <h3 style={{ color: "#94a3b8", fontSize: "0.8rem", fontWeight: 600, marginBottom: 8 }}>Example Prompts</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {examples.slice(0, 11).map(ex => (
                <button key={ex.name} onClick={() => setPrompt(ex.pattern_hint)}
                  style={{ textAlign: "left", background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "0.75rem", padding: "0.2rem 0", textDecoration: "underline dotted" }}>
                  → {ex.pattern_hint}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "1.05rem" }}>{result.circuit_name}</h2>
                  <ConfidenceBadge conf={result.confidence} />
                  {result.is_exact_match && (
                    <span style={{ background: "#10b98122", color: "#10b981", fontSize: "0.72rem", padding: "2px 6px", borderRadius: 4 }}>Exact match</span>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Qubits", value: result.n_qubits, color: "#8b5cf6" },
                  { label: "Gates", value: result.n_gates, color: "#3b82f6" },
                  { label: "Confidence", value: `${(result.confidence * 100).toFixed(0)}%`, color: result.confidence > 0.8 ? "#10b981" : "#f59e0b" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.3rem", fontWeight: 700, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
                <p style={{ color: "#94a3b8", fontSize: "0.82rem", margin: 0 }}>{result.explanation}</p>
              </div>

              <div style={{ background: "#0f172a", borderRadius: 10, border: "1px solid #334155", padding: "1rem", marginBottom: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.85rem" }}>Generated QASM</h3>
                  <CopyButton text={result.qasm} />
                </div>
                <pre style={{ color: "#a5f3fc", fontSize: "0.78rem", margin: 0, overflowX: "auto", whiteSpace: "pre-wrap" }}>
                  {result.qasm}
                </pre>
              </div>

              {result.suggestions.length > 0 && (
                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem 1rem" }}>
                  <h3 style={{ color: "#94a3b8", fontSize: "0.8rem", fontWeight: 600, marginBottom: 8 }}>Similar circuits you might want</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {result.suggestions.map((s: NL2QASMSuggestion) => (
                      <button key={s.name} onClick={() => setPrompt(s.try_saying)}
                        style={{ background: "#334155", border: "none", borderRadius: 6, padding: "0.3rem 0.65rem", color: "#e2e8f0", fontSize: "0.75rem", cursor: "pointer" }}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#475569" }}>
              <Terminal size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Describe a quantum circuit in natural language to generate OpenQASM 2.0 code.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
