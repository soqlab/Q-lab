"use client";
import { useEffect, useState } from "react";
import { CircuitDNAResult, DNACompareResult, DNASignaturePoint, fingerprintCircuit, compareCircuitDNA, listDNA } from "../../../lib/api";
import { Fingerprint, Copy, Check, GitCompare, Search } from "lucide-react";

type DNAListItem = { dna_id: string; dna_hash: string; circuit_name: string; n_qubits: number; n_gates: number; created_at: string };

const PRESET_A = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

const PRESET_B = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
x q[0];
x q[0];
measure q -> c;`;

function DNASignatureBar({ label, prob, idx }: { label: string; prob: number; idx: number }) {
  const HUE = (idx * 47) % 360;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
      <span style={{ color: "#64748b", fontFamily: "monospace", fontSize: "0.68rem", width: 36, textAlign: "right" }}>{label}</span>
      <div style={{ flex: 1, height: 14, background: "#0f172a", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${prob * 100}%`, height: "100%", background: `hsl(${HUE}, 70%, 55%)`, borderRadius: 3 }} />
      </div>
      <span style={{ color: "#94a3b8", fontSize: "0.68rem", width: 40, textAlign: "right" }}>{(prob * 100).toFixed(1)}%</span>
    </div>
  );
}

function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(hash); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background: "#0f172a", border: "1px solid #334155", color: copied ? "#10b981" : "#3b82f6", borderRadius: 6, padding: "0.25rem 0.5rem", cursor: "pointer", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 4 }}>
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function DNAPage() {
  const [qasm, setQasm] = useState(PRESET_A);
  const [circuitName, setCircuitName] = useState("Bell State");
  const [qasmB, setQasmB] = useState(PRESET_B);
  const [nameB, setNameB] = useState("Bell + Cancellation");
  const [result, setResult] = useState<CircuitDNAResult | null>(null);
  const [compareResult, setCompareResult] = useState<DNACompareResult | null>(null);
  const [history, setHistory] = useState<DNAListItem[]>([]);
  const [mode, setMode] = useState<"fingerprint" | "compare">("fingerprint");
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDNA().then(setHistory).catch(() => {}).finally(() => setLoadingHistory(false));
  }, []);

  const handleFingerprint = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fingerprintCircuit({ qasm, circuit_name: circuitName });
      setResult(r);
      setHistory(prev => [{ dna_id: r.dna_id, dna_hash: r.dna_hash, circuit_name: r.circuit_name, n_qubits: r.n_qubits, n_gates: r.n_gates, created_at: r.created_at }, ...prev]);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const handleCompare = async () => {
    setComparing(true); setError(null);
    try {
      const r = await compareCircuitDNA([
        { qasm, circuit_name: circuitName },
        { qasm: qasmB, circuit_name: nameB },
      ]);
      setCompareResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setComparing(false); }
  };

  const isEquivalent = compareResult ? compareResult.equivalent_groups.length < compareResult.circuits.length : false;
  const fullyEquivalent = compareResult ? compareResult.equivalent_groups.length === 1 : false;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Fingerprint size={28} color="#8b5cf6" /> Circuit DNA Fingerprinting
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          SHA-256 fingerprint from simulated output distributions. Functionally equivalent circuits produce identical DNA hashes regardless of gate ordering or redundant gates.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem" }}>
        <button onClick={() => setMode("fingerprint")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.5rem 1.1rem", borderRadius: 8, border: `2px solid ${mode === "fingerprint" ? "#8b5cf6" : "#334155"}`, background: mode === "fingerprint" ? "#8b5cf622" : "#1e293b", color: mode === "fingerprint" ? "#8b5cf6" : "#94a3b8", cursor: "pointer", fontWeight: 600 }}>
          <Fingerprint size={15} /> Fingerprint
        </button>
        <button onClick={() => setMode("compare")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.5rem 1.1rem", borderRadius: 8, border: `2px solid ${mode === "compare" ? "#3b82f6" : "#334155"}`, background: mode === "compare" ? "#3b82f622" : "#1e293b", color: mode === "compare" ? "#3b82f6" : "#94a3b8", cursor: "pointer", fontWeight: 600 }}>
          <GitCompare size={15} /> Compare Two Circuits
        </button>
      </div>

      {mode === "fingerprint" ? (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.5rem" }}>
          <div>
            <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 8 }}>
                Circuit Name
                <input value={circuitName} onChange={e => setCircuitName(e.target.value)}
                  style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
              </label>
              <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 12 }}>
                QASM
                <textarea value={qasm} onChange={e => setQasm(e.target.value)} rows={10}
                  style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box", resize: "vertical" }} />
              </label>
              <button onClick={handleFingerprint} disabled={loading}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, padding: "0.65rem", cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
                <Fingerprint size={15} /> {loading ? "Fingerprinting (3×100 shots)…" : "Fingerprint Circuit"}
              </button>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
              <h3 style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>DNA Library</h3>
              {loadingHistory ? <div style={{ color: "#475569", fontSize: "0.8rem" }}>Loading…</div> :
                history.slice(0, 8).map(r => (
                  <div key={r.dna_id}
                    style={{ padding: "0.45rem 0.6rem", borderRadius: 6, marginBottom: 4, cursor: "pointer", background: result?.dna_id === r.dna_id ? "#0f172a" : "transparent" }}>
                    <div style={{ color: "#e2e8f0", fontSize: "0.82rem" }}>{r.circuit_name}</div>
                    <div style={{ color: "#475569", fontFamily: "monospace", fontSize: "0.68rem" }}>{r.dna_hash}</div>
                  </div>
                ))
              }
            </div>
          </div>

          <div>
            {result ? (
              <div>
                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #8b5cf640", padding: "1.25rem", marginBottom: "1rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginBottom: 6 }}>Circuit DNA Hash</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <code style={{ color: "#8b5cf6", fontFamily: "monospace", fontSize: "1rem", fontWeight: 700, letterSpacing: "0.05em", flex: 1, wordBreak: "break-all" }}>{result.dna_hash}</code>
                    <CopyHash hash={result.dna_hash} />
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <span style={{ color: "#64748b", fontSize: "0.78rem" }}>n_qubits: <span style={{ color: "#e2e8f0" }}>{result.n_qubits}</span></span>
                    <span style={{ color: "#64748b", fontSize: "0.78rem" }}>n_gates: <span style={{ color: "#e2e8f0" }}>{result.n_gates}</span></span>
                    <span style={{ color: "#64748b", fontSize: "0.78rem" }}>shots: <span style={{ color: "#e2e8f0" }}>{result.total_shots_used}</span></span>
                    <span style={{ color: result.is_unique ? "#10b981" : "#f59e0b", fontSize: "0.78rem" }}>{result.is_unique ? "✓ Unique" : "≡ Duplicate found"}</span>
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem", marginBottom: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 10, fontSize: "0.9rem" }}>Output Distribution Signature</h3>
                  {result.distribution_signature.map((pt: DNASignaturePoint, i: number) => (
                    <DNASignatureBar key={pt.bitstring} label={pt.bitstring} prob={pt.probability} idx={i} />
                  ))}
                </div>

                {result.functionally_equivalent.length > 0 && (
                  <div style={{ background: "#10b98118", borderRadius: 12, border: "1px solid #10b98140", padding: "1rem" }}>
                    <h3 style={{ color: "#10b981", fontWeight: 600, marginBottom: 8, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
                      <Search size={16} /> Functionally Equivalent Circuits ({result.functionally_equivalent.length})
                    </h3>
                    {result.functionally_equivalent.map(eq => (
                      <div key={eq.dna_id} style={{ background: "#0f172a", borderRadius: 6, padding: "0.5rem 0.75rem", marginBottom: 6 }}>
                        <div style={{ color: "#e2e8f0", fontSize: "0.85rem" }}>{eq.circuit_name}</div>
                        <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{eq.n_gates} gates · {new Date(eq.created_at).toLocaleDateString()}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, color: "#475569" }}>
                <Fingerprint size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
                <p>Fingerprint a circuit to generate its unique DNA hash.</p>
                <p style={{ fontSize: "0.85rem", marginTop: 4 }}>Functionally equivalent circuits share the same hash.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            {[
              { label: "Circuit A", name: circuitName, setName: setCircuitName, value: qasm, setValue: setQasm },
              { label: "Circuit B", name: nameB, setName: setNameB, value: qasmB, setValue: setQasmB },
            ].map(c => (
              <div key={c.label} style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                <div style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 8 }}>{c.label}</div>
                <input value={c.name} onChange={e => c.setName(e.target.value)} placeholder="Circuit name"
                  style={{ display: "block", width: "100%", marginBottom: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.4rem 0.6rem", boxSizing: "border-box" }} />
                <textarea value={c.value} onChange={e => c.setValue(e.target.value)} rows={8}
                  style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", boxSizing: "border-box", resize: "vertical" }} />
              </div>
            ))}
          </div>

          <button onClick={handleCompare} disabled={comparing}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.65rem 1.5rem", cursor: "pointer", fontWeight: 600, opacity: comparing ? 0.6 : 1, marginBottom: "1.5rem" }}>
            <GitCompare size={16} /> {comparing ? "Comparing (3×100 shots each)…" : "Compare DNA"}
          </button>

          {compareResult && (
            <div>
              <div style={{ background: `linear-gradient(135deg, ${fullyEquivalent ? "#10b98118" : "#f9713618"}, #1e293b)`, borderRadius: 12, border: `1px solid ${fullyEquivalent ? "#10b98140" : "#f9713640"}`, padding: "1.5rem", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: "2.5rem" }}>{fullyEquivalent ? "🟰" : "≠"}</div>
                  <div>
                    <div style={{ color: fullyEquivalent ? "#10b981" : "#f97316", fontWeight: 800, fontSize: "1.25rem" }}>
                      {fullyEquivalent ? "Functionally Equivalent" : "Functionally Distinct"}
                    </div>
                    <div style={{ color: "#64748b", fontSize: "0.82rem" }}>{compareResult.summary}</div>
                  </div>
                  <div style={{ marginLeft: "auto" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>Unique groups</div>
                    <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "1.5rem", textAlign: "center" }}>{compareResult.equivalent_groups.length}</div>
                  </div>
                </div>

                {!compareResult.all_unique && compareResult.equivalent_groups.map((g, i) => (
                  <div key={i} style={{ background: "#10b98118", borderRadius: 8, padding: "0.5rem 0.75rem", marginTop: 8 }}>
                    <div style={{ color: "#10b981", fontSize: "0.78rem", fontWeight: 600 }}>Equivalent Group {i + 1} — hash: {g.dna_hash}</div>
                    <div style={{ color: "#64748b", fontSize: "0.75rem" }}>{g.circuits.join(", ")}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                {compareResult.circuits.map((c, i) => (
                  <div key={i} style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginBottom: 4 }}>{c.circuit_name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <code style={{ color: "#8b5cf6", fontFamily: "monospace", fontSize: "0.78rem", wordBreak: "break-all", flex: 1 }}>{c.dna_hash}</code>
                      <CopyHash hash={c.dna_hash} />
                    </div>
                    {c.signature.slice(0, 6).map((pt: DNASignaturePoint, j: number) => (
                      <DNASignatureBar key={pt.bitstring} label={pt.bitstring} prob={pt.probability} idx={j} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
