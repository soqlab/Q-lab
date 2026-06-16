"use client";
import { useState } from "react";
import { exportCode, CodeExportResult } from "@/lib/api";

const DEMO_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];`;

const FRAMEWORKS = ["qiskit", "pennylane", "cirq", "braket"];

export default function CodeExportPage() {
  const [qasm, setQasm] = useState(DEMO_QASM);
  const [framework, setFramework] = useState("qiskit");
  const [nShots, setNShots] = useState(1024);
  const [viz, setViz] = useState(true);
  const [result, setResult] = useState<CodeExportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await exportCode({ qasm, framework, n_shots: nShots, include_visualization: viz })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  function copy() {
    if (result?.code) { navigator.clipboard.writeText(result.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  }

  const fwColor: Record<string, string> = { qiskit: "#6366f1", pennylane: "#f59e0b", cirq: "#34d399", braket: "#38bdf8" };

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>QASM Input</div>
          <textarea value={qasm} onChange={e => setQasm(e.target.value)}
            style={{ width: "100%", height: 180, background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: 8, fontSize: 11, fontFamily: "monospace", resize: "vertical" }} />
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Framework</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {FRAMEWORKS.map(f => (
                <button key={f} onClick={() => setFramework(f)}
                  style={{ padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: framework === f ? 700 : 400, background: framework === f ? (fwColor[f] ?? "#6366f1") : "#0f172a", color: "#e2e8f0", fontSize: 13 }}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label style={{ fontSize: 12, color: "#64748b" }}>Shots: {nShots}</label>
            <input type="range" min={100} max={65536} step={100} value={nShots} onChange={e => setNShots(Number(e.target.value))} style={{ width: 120 }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#64748b", cursor: "pointer" }}>
            <input type="checkbox" checked={viz} onChange={e => setViz(e.target.checked)} />
            Include visualization
          </label>
          <button onClick={run} disabled={loading}
            style={{ marginTop: 16, width: "100%", padding: "8px 0", background: fwColor[framework] ?? "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Generating…" : `Generate ${framework} Code`}
          </button>
        </div>
        {result && (
          <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Install</div>
            <code style={{ fontSize: 11, color: "#34d399", display: "block", background: "#0f172a", padding: 8, borderRadius: 6 }}>{result.install_command}</code>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 10, marginBottom: 4 }}>Run</div>
            <code style={{ fontSize: 11, color: "#fbbf24", display: "block", background: "#0f172a", padding: 8, borderRadius: 6 }}>{result.run_command}</code>
            {result.notes.map((n, i) => <div key={i} style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>ℹ {n}</div>)}
          </div>
        )}
      </div>

      <div style={{ flex: 1 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}
        {result && (
          <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>
                {result.framework} &middot; {result.n_qubits} qubits &middot; {result.n_gates} gates
              </div>
              <button onClick={copy}
                style={{ padding: "6px 14px", background: copied ? "#34d399" : "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre style={{ background: "#0f172a", padding: 16, borderRadius: 6, overflowX: "auto", fontSize: 12, color: "#e2e8f0", fontFamily: "monospace", lineHeight: 1.6, maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
              {result.code}
            </pre>
          </div>
        )}
        {!result && !loading && (
          <div style={{ color: "#475569", textAlign: "center", padding: 80 }}>
            Paste QASM and select a framework to generate runnable code
          </div>
        )}
      </div>
    </div>
  );
}
