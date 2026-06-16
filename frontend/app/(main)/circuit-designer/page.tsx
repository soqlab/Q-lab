"use client";

import { useEffect, useState, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DesignRequest = {
  description: string;
  n_qubits?: number;
  backend?: string;
  complexity: "simple" | "intermediate" | "advanced";
  include_measurements: boolean;
  optimization_goal?: "depth" | "gate_count" | "fidelity" | "balanced";
};

type DesignResult = {
  design_id: string;
  description: string;
  qasm_circuit: string;
  python_code: string;
  circuit_info: {
    n_qubits: number;
    depth: number;
    gate_counts: Record<string, number>;
    total_gates: number;
    estimated_depth: number;
  };
  explanation: string;
  usage_tips: string[];
  suggested_backends: string[];
  created_at: string;
};

const EXAMPLES = [
  "Design a 4-qubit Grover search circuit for the target state |1010⟩",
  "Create a VQE ansatz with 3 layers of hardware-efficient gates for 5 qubits",
  "Build a quantum teleportation circuit with error detection",
  "Design a QAOA circuit for 6-node MaxCut problem, p=2 layers",
  "Create a quantum Fourier transform for 4 qubits",
  "Build a Bell state preparation circuit with parity checks",
  "Design a Bernstein-Vazirani circuit for a 5-bit secret string",
  "Create a quantum phase estimation circuit for a simple unitary",
];

// ---------------------------------------------------------------------------
// Syntax-highlighted QASM block
// ---------------------------------------------------------------------------

function syntaxHighlightQASM(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(OPENQASM\s+[\d.]+)/g, '<span style="color:#f472b6">$1</span>')
    .replace(/(include\s+"[^"]+";)/g, '<span style="color:#a78bfa">$1</span>')
    .replace(/\b(qreg|creg)\b/g, '<span style="color:#60a5fa">$1</span>')
    .replace(/\b(measure|barrier|reset)\b/g, '<span style="color:#fbbf24">$1</span>')
    .replace(/\b(h|cx|cy|cz|x|y|z|s|t|sdg|tdg|rx|ry|rz|u1|u2|u3|swap|ccx|p)\b(?=\s)/g, '<span style="color:#34d399">$1</span>')
    .replace(/-?[\d.]+/g, '<span style="color:#fb923c">$&</span>')
    .replace(/(\/\/[^\n]*)/g, '<span style="color:#6b7280">$1</span>');
}

function syntaxHighlightPython(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\b(from|import|def|class|return|if|else|elif|for|while|with|as|in|not|and|or|True|False|None)\b/g, '<span style="color:#f472b6">$1</span>')
    .replace(/(["\'])(.*?)\1/g, '<span style="color:#fbbf24">$1$2$1</span>')
    .replace(/(#[^\n]*)/g, '<span style="color:#6b7280">$1</span>')
    .replace(/-?[\d.]+/g, '<span style="color:#fb923c">$&</span>');
}

// ---------------------------------------------------------------------------
// Code block with copy button
// ---------------------------------------------------------------------------

function CodeBlock({ code, lang }: { code: string; lang: "qasm" | "python" }) {
  const [copied, setCopied] = useState(false);
  const highlighted = lang === "qasm" ? syntaxHighlightQASM(code) : syntaxHighlightPython(code);

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div style={{ position: "relative", background: "#0a0f1e", borderRadius: 8, border: "1px solid #1e293b", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", background: "#111827", borderBottom: "1px solid #1e293b" }}>
        <span style={{ color: "#475569", fontSize: "0.72rem", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {lang === "qasm" ? "OpenQASM 2.0" : "Python (Qiskit)"}
        </span>
        <button
          onClick={copy}
          style={{ background: copied ? "#14532d" : "#1e293b", border: `1px solid ${copied ? "#166534" : "#334155"}`, borderRadius: 4, color: copied ? "#4ade80" : "#94a3b8", padding: "2px 10px", fontSize: "0.72rem", cursor: "pointer" }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre
        style={{ margin: 0, padding: "14px 16px", overflowX: "auto", fontSize: "0.78rem", lineHeight: 1.7, fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", color: "#e2e8f0" }}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function Skeleton({ h }: { h: number }) {
  return <div style={{ height: h, borderRadius: 8, background: "#1e293b", animation: "pulse 1.5s infinite" }} />;
}

// ---------------------------------------------------------------------------
// Recent design card
// ---------------------------------------------------------------------------

function RecentCard({ d, onLoad }: { d: DesignResult; onLoad: (d: DesignResult) => void }) {
  return (
    <button
      onClick={() => onLoad(d)}
      style={{ textAlign: "left", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "0.75rem 1rem", cursor: "pointer", width: "100%" }}
    >
      <div style={{ color: "#e2e8f0", fontSize: "0.82rem", fontWeight: 500, marginBottom: 2 }}>
        {d.description.slice(0, 72)}{d.description.length > 72 ? "…" : ""}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: "#475569", fontSize: "0.72rem" }}>{d.circuit_info.n_qubits}q</span>
        <span style={{ color: "#475569", fontSize: "0.72rem" }}>depth {d.circuit_info.depth}</span>
        <span style={{ color: "#475569", fontSize: "0.72rem" }}>{d.created_at.slice(0, 10)}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CircuitDesignerPage() {
  // Form state
  const [description, setDescription] = useState("");
  const [nQubits, setNQubits] = useState<number | "">(4);
  const [backend, setBackend] = useState("");
  const [complexity, setComplexity] = useState<"simple" | "intermediate" | "advanced">("intermediate");
  const [optimizationGoal, setOptimizationGoal] = useState<"depth" | "gate_count" | "fidelity" | "balanced">("balanced");
  const [includeMeasurements, setIncludeMeasurements] = useState(true);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [recentDesigns, setRecentDesigns] = useState<DesignResult[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load recent designs on mount
  useEffect(() => {
    fetch("/api/v1/circuit-designer/designs")
      .then(r => r.json())
      .then((data: DesignResult[]) => setRecentDesigns(data.slice(0, 5)))
      .catch(() => {});
  }, []);

  async function design() {
    const desc = description.trim();
    if (!desc) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSubmitMsg(null);
    try {
      const body: DesignRequest = {
        description: desc,
        complexity,
        include_measurements: includeMeasurements,
        optimization_goal: optimizationGoal,
      };
      if (nQubits !== "") body.n_qubits = Number(nQubits);
      if (backend.trim()) body.backend = backend.trim();

      const res = await fetch("/api/v1/circuit-designer/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      const d = await res.json() as DesignResult;
      setResult(d);
      setRecentDesigns(prev => [d, ...prev.filter(x => x.design_id !== d.design_id)].slice(0, 5));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function submitRun(designId: string) {
    setSubmitMsg(null);
    try {
      const res = await fetch(`/api/v1/circuit-designer/design/${encodeURIComponent(designId)}/submit-run`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { message: string };
      setSubmitMsg(data.message);
    } catch (e) {
      setSubmitMsg(e instanceof Error ? e.message : "Error submitting run");
    }
  }

  function loadExample(ex: string) {
    setDescription(ex);
    textareaRef.current?.focus();
  }

  function loadDesign(d: DesignResult) {
    setResult(d);
    setDescription(d.description);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const totalGates = result
    ? Object.values(result.circuit_info.gate_counts).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0" }}>AI Circuit Designer</h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Describe a quantum circuit in natural language and get valid OpenQASM 2.0 + Qiskit code.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: "1.5rem", alignItems: "start" }}>
        {/* ===== LEFT PANEL: Input form ===== */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Description textarea */}
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <label style={{ color: "#94a3b8", fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 6 }}>
              Describe the circuit you want
            </label>
            <textarea
              ref={textareaRef}
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) void design(); }}
              placeholder="e.g. Design a 4-qubit Grover search circuit for |1010⟩..."
              rows={5}
              style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "0.75rem", boxSizing: "border-box", fontSize: "0.9rem", lineHeight: 1.55, resize: "vertical", fontFamily: "inherit" }}
            />

            {/* N Qubits */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <div>
                <label style={{ color: "#64748b", fontSize: "0.75rem", display: "block", marginBottom: 4 }}>Qubits (optional)</label>
                <input
                  type="number"
                  min={1} max={30}
                  value={nQubits}
                  onChange={e => setNQubits(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="auto"
                  style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.45rem 0.65rem", boxSizing: "border-box", fontSize: "0.85rem" }}
                />
              </div>
              <div>
                <label style={{ color: "#64748b", fontSize: "0.75rem", display: "block", marginBottom: 4 }}>Backend (optional)</label>
                <input
                  value={backend}
                  onChange={e => setBackend(e.target.value)}
                  placeholder="ibm_sherbrooke"
                  style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.45rem 0.65rem", boxSizing: "border-box", fontSize: "0.85rem" }}
                />
              </div>
            </div>

            {/* Complexity radio */}
            <div style={{ marginTop: 12 }}>
              <label style={{ color: "#64748b", fontSize: "0.75rem", display: "block", marginBottom: 6 }}>Complexity</label>
              <div style={{ display: "flex", gap: 6 }}>
                {(["simple", "intermediate", "advanced"] as const).map(c => (
                  <button key={c} onClick={() => setComplexity(c)} style={{
                    flex: 1,
                    padding: "0.35rem",
                    borderRadius: 6,
                    border: `1px solid ${complexity === c ? "#4f46e5" : "#334155"}`,
                    background: complexity === c ? "#1e1b4b" : "#0f172a",
                    color: complexity === c ? "#a5b4fc" : "#64748b",
                    fontSize: "0.78rem",
                    cursor: "pointer",
                    fontWeight: complexity === c ? 600 : 400,
                    textTransform: "capitalize",
                  }}>{c}</button>
                ))}
              </div>
            </div>

            {/* Optimization goal radio */}
            <div style={{ marginTop: 12 }}>
              <label style={{ color: "#64748b", fontSize: "0.75rem", display: "block", marginBottom: 6 }}>Optimization goal</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(["depth", "gate_count", "fidelity", "balanced"] as const).map(g => (
                  <button key={g} onClick={() => setOptimizationGoal(g)} style={{
                    padding: "0.3rem 0.7rem",
                    borderRadius: 6,
                    border: `1px solid ${optimizationGoal === g ? "#4f46e5" : "#334155"}`,
                    background: optimizationGoal === g ? "#1e1b4b" : "#0f172a",
                    color: optimizationGoal === g ? "#a5b4fc" : "#64748b",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    fontWeight: optimizationGoal === g ? 600 : 400,
                    textTransform: "capitalize",
                  }}>{g.replace("_", " ")}</button>
                ))}
              </div>
            </div>

            {/* Include measurements toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <button
                onClick={() => setIncludeMeasurements(v => !v)}
                style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: includeMeasurements ? "#4f46e5" : "#334155",
                  border: "none", cursor: "pointer", position: "relative", flexShrink: 0,
                }}
              >
                <span style={{
                  position: "absolute", top: 3, left: includeMeasurements ? 20 : 3,
                  width: 16, height: 16, borderRadius: "50%", background: "#fff",
                  transition: "left 0.15s",
                }} />
              </button>
              <label style={{ color: "#94a3b8", fontSize: "0.82rem", cursor: "pointer" }} onClick={() => setIncludeMeasurements(v => !v)}>
                Include measurements
              </label>
            </div>

            {/* Design button */}
            <button
              onClick={() => void design()}
              disabled={loading || !description.trim()}
              style={{
                width: "100%", marginTop: 14,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                background: loading || !description.trim() ? "#312e81" : "#4f46e5",
                color: "#fff", border: "none", borderRadius: 8,
                padding: "0.75rem", cursor: loading || !description.trim() ? "not-allowed" : "pointer",
                fontWeight: 700, fontSize: "0.95rem",
                opacity: loading || !description.trim() ? 0.55 : 1,
              }}
            >
              {loading ? (
                <>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #818cf8", borderTopColor: "transparent", animation: "spin 0.7s linear infinite", display: "inline-block" }} />
                  Designing…
                </>
              ) : "Design Circuit"}
            </button>
            <p style={{ color: "#334155", fontSize: "0.7rem", textAlign: "center", marginTop: 6 }}>Ctrl+Enter to submit</p>
          </div>

          {/* Example chips */}
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
            <p style={{ color: "#64748b", fontSize: "0.78rem", fontWeight: 600, marginBottom: 8 }}>Try an example</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {EXAMPLES.map((ex, i) => (
                <button key={i} onClick={() => loadExample(ex)} style={{
                  textAlign: "left", background: "#0f172a", border: "1px solid #1e293b",
                  borderRadius: 6, padding: "0.45rem 0.75rem", cursor: "pointer", color: "#94a3b8",
                  fontSize: "0.78rem", lineHeight: 1.4,
                }}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ===== RIGHT PANEL: Results ===== */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {error && (
            <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", fontSize: "0.85rem" }}>
              {error}
            </div>
          )}

          {loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Skeleton h={60} />
              <Skeleton h={180} />
              <Skeleton h={220} />
              <Skeleton h={120} />
            </div>
          )}

          {!loading && !result && !error && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#334155" }}>
              <svg viewBox="0 0 64 64" width="64" height="64" style={{ opacity: 0.12, marginBottom: 16 }}>
                <rect x="2" y="2" width="60" height="60" rx="8" fill="none" stroke="#94a3b8" strokeWidth="3" />
                <line x1="16" y1="24" x2="48" y2="24" stroke="#94a3b8" strokeWidth="3" />
                <circle cx="16" cy="24" r="4" fill="#94a3b8" />
                <circle cx="48" cy="24" r="4" fill="#94a3b8" />
                <line x1="16" y1="40" x2="48" y2="40" stroke="#94a3b8" strokeWidth="3" />
                <circle cx="16" cy="40" r="4" fill="#94a3b8" />
                <circle cx="48" cy="40" r="4" fill="#94a3b8" />
                <line x1="32" y1="24" x2="32" y2="40" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 2" />
              </svg>
              <p style={{ fontSize: "0.9rem" }}>Describe a circuit on the left and click Design.</p>
            </div>
          )}

          {result && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Circuit info strip */}
              <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <Badge label="Qubits" value={String(result.circuit_info.n_qubits)} color="#818cf8" />
                  <Badge label="Depth" value={String(result.circuit_info.depth || result.circuit_info.estimated_depth)} color="#34d399" />
                  <Badge label="Total Gates" value={String(totalGates)} color="#fbbf24" />
                  {Object.entries(result.circuit_info.gate_counts).slice(0, 5).map(([g, n]) => (
                    <Badge key={g} label={g} value={String(n)} color="#94a3b8" />
                  ))}
                </div>
              </div>

              {/* QASM code */}
              <div>
                <p style={{ color: "#64748b", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6 }}>OpenQASM Circuit</p>
                <CodeBlock code={result.qasm_circuit} lang="qasm" />
              </div>

              {/* Python code */}
              <div>
                <p style={{ color: "#64748b", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6 }}>Qiskit Python Code</p>
                <CodeBlock code={result.python_code} lang="python" />
              </div>

              {/* Explanation */}
              <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                <p style={{ color: "#64748b", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6 }}>Explanation</p>
                <p style={{ color: "#cbd5e1", fontSize: "0.88rem", lineHeight: 1.65, margin: 0 }}>{result.explanation}</p>
              </div>

              {/* Usage tips */}
              {result.usage_tips.length > 0 && (
                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <p style={{ color: "#64748b", fontSize: "0.78rem", fontWeight: 600, marginBottom: 8 }}>Usage Tips</p>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {result.usage_tips.map((tip, i) => (
                      <li key={i} style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: 4, lineHeight: 1.5 }}>{tip}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggested backends */}
              {result.suggested_backends.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span style={{ color: "#475569", fontSize: "0.78rem" }}>Suggested backends:</span>
                  {result.suggested_backends.map(b => (
                    <span key={b} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "2px 10px", fontSize: "0.78rem", color: "#94a3b8", fontFamily: "monospace" }}>{b}</span>
                  ))}
                </div>
              )}

              {/* Submit to Q-Lab */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={() => void submitRun(result.design_id)}
                  style={{ background: "#0f4c75", border: "1px solid #1a6fa8", borderRadius: 8, color: "#93c5fd", padding: "0.5rem 1.2rem", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
                >
                  Submit to Q-Lab
                </button>
                {submitMsg && (
                  <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{submitMsg}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent designs */}
      {recentDesigns.length > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <h2 style={{ color: "#94a3b8", fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Recent Designs</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
            {recentDesigns.map(d => (
              <RecentCard key={d.design_id} d={d} onLoad={loadDesign} />
            ))}
          </div>
        </div>
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Badge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#0f172a", borderRadius: 6, padding: "4px 10px", border: "1px solid #1e293b" }}>
      <span style={{ color: "#475569", fontSize: "0.72rem" }}>{label}</span>
      <span style={{ color, fontWeight: 700, fontSize: "0.82rem" }}>{value}</span>
    </div>
  );
}
