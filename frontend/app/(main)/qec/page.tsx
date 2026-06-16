"use client";
import { useState } from "react";
import { QECResult, QECCode, synthesizeQEC, listQECCodes } from "../../../lib/api";
import { Shield, Copy, Check, Layers } from "lucide-react";
import { useEffect } from "react";

const PRESET = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
t q[0];
measure q -> c;`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background: "#0f172a", border: "1px solid #334155", color: copied ? "#10b981" : "#94a3b8", borderRadius: 6, padding: "0.25rem 0.6rem", cursor: "pointer", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 4 }}>
      {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

const CODE_COLORS: Record<string, string> = {
  steane: "#3b82f6", shor: "#8b5cf6", surface_d3: "#10b981", surface_d5: "#f59e0b", repetition: "#f97316",
};

export default function QECPage() {
  const [qasm, setQasm] = useState(PRESET);
  const [codeId, setCodeId] = useState("steane");
  const [errorRate, setErrorRate] = useState(0.001);
  const [result, setResult] = useState<QECResult | null>(null);
  const [codes, setCodes] = useState<QECCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listQECCodes().then(setCodes).catch(() => {}); }, []);

  const run = async () => {
    setLoading(true); setError(null);
    try { setResult(await synthesizeQEC({ logical_qasm: qasm, code: codeId, physical_error_rate: errorRate })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const color = CODE_COLORS[codeId] ?? "#3b82f6";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Shield size={28} color="#10b981" /> QEC Auto-Synthesizer
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Automatically wraps logical circuits in quantum error correction codes — Steane, Shor, Surface Code d=3/5, Repetition.
          Estimates physical qubit overhead, logical error rate, and fault-tolerant gate cost.
        </p>
      </div>
      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "1.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Logical Circuit</h3>
            <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={8}
              style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box", resize: "vertical", marginBottom: 12 }} />

            <h4 style={{ color: "#94a3b8", fontSize: "0.82rem", marginBottom: 8 }}>QEC Code</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {codes.map(c => (
                <button key={c.id} onClick={() => setCodeId(c.id)}
                  style={{ textAlign: "left", background: codeId === c.id ? CODE_COLORS[c.id] + "18" : "#0f172a", border: `1px solid ${codeId === c.id ? CODE_COLORS[c.id] : "#334155"}`, borderRadius: 8, padding: "0.5rem 0.75rem", cursor: "pointer" }}>
                  <div style={{ color: codeId === c.id ? CODE_COLORS[c.id] : "#e2e8f0", fontWeight: 600, fontSize: "0.85rem" }}>{c.name}</div>
                  <div style={{ color: "#475569", fontSize: "0.7rem" }}>{c.description} · d={c.distance} · {c.physical_per_logical}× overhead</div>
                </button>
              ))}
            </div>

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 12 }}>
              Physical error rate: <span style={{ color: "#f97316", fontWeight: 700 }}>{(errorRate * 100).toFixed(2)}%</span>
              <input type="range" min={0.01} max={5} step={0.01} value={errorRate * 100}
                onChange={e => setErrorRate(Number(e.target.value) / 100)}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#f97316" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#475569", marginTop: 2 }}>
                <span>0.01%</span><span>5%</span>
              </div>
            </label>

            <button onClick={run} disabled={loading}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#10b981", color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
              <Shield size={15} /> {loading ? "Synthesizing…" : "Synthesize QEC Circuit"}
            </button>
          </div>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Physical Qubits", value: result.n_total_qubits, color },
                  { label: "Overhead Factor", value: `${result.overhead_factor}×`, color: result.overhead_factor > 10 ? "#ef4444" : "#f59e0b" },
                  { label: "Code Distance", value: result.code_distance, color: "#3b82f6" },
                  { label: "Logical Error Rate", value: result.estimated_logical_error_rate.toExponential(2), color: "#10b981" },
                  { label: "Error Suppression", value: `${result.error_suppression_factor.toFixed(0)}×`, color: "#8b5cf6" },
                  { label: "Syndrome Rounds/Gate", value: result.syndrome_rounds_per_gate, color: "#64748b" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.2rem", fontWeight: 700, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem", marginBottom: "1rem" }}>
                <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 8, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 6 }}>
                  <Layers size={14} color={color} /> {result.code_name}
                </h3>
                <p style={{ color: "#64748b", fontSize: "0.82rem", margin: "0 0 8px" }}>{result.description}</p>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "0.8rem", color: "#94a3b8" }}>
                  <span>{result.n_logical_qubits} logical → {result.n_physical_qubits} data + {result.n_syndrome_qubits} syndrome qubits</span>
                  <span>Corrects {result.corrects_n_errors} error{result.corrects_n_errors > 1 ? "s" : ""}</span>
                  <span>~{result.estimated_physical_gates.toLocaleString()} physical gates</span>
                </div>
              </div>

              <div style={{ background: "#1e293b", borderRadius: 12, border: `1px solid ${color}30`, padding: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.9rem" }}>Encoded QASM</h3>
                  <CopyButton text={result.encoded_qasm} />
                </div>
                <pre style={{ background: "#0f172a", borderRadius: 6, padding: "0.75rem", color: "#94a3b8", fontSize: "0.72rem", overflowX: "auto", maxHeight: 280, margin: 0 }}>
                  {result.encoded_qasm}
                </pre>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#475569" }}>
              <Shield size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Select a QEC code and synthesize to see physical qubit overhead and encoded circuit.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
