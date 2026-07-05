"use client";
import { useState } from "react";
import { submitToProviders, listProviders, MultiProviderResult } from "@/lib/api";

export default function ProvidersPage() {
  const [qasm, setQasm] = useState('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];');
  const [shots, setShots] = useState(1024);
  const [result, setResult] = useState<MultiProviderResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await submitToProviders({ qasm, n_shots: shots });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Multi-Provider Execution</h1>
      <p style={{ color: "var(--muted)" }}>Submit your circuit to IBM, IonQ, Rigetti, Quantinuum, Google and IQM simultaneously — compare fidelity, cost, and consensus.</p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "block", fontSize: 13, color: "var(--muted)" }}>OpenQASM 2.0</label>
        <textarea
          style={{ width: "100%", height: 160, background: "var(--surface)", color: "var(--ok)", fontFamily: "ui-monospace,monospace", fontSize: 13, padding: 12, borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box", resize: "vertical" }}
          value={qasm} onChange={e => setQasm(e.target.value)}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Shots</label>
          <input type="number" min={1} max={100000} value={shots}
            onChange={e => setShots(Number(e.target.value))}
            style={{ width: 128, background: "var(--surface)", color: "var(--text)", padding: "4px 12px", borderRadius: 6, border: "1px solid var(--line)" }} />
          <button onClick={run} disabled={loading}
            style={{ marginLeft: "auto", padding: "8px 24px", background: "var(--strong)", borderRadius: 6, fontWeight: 500, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer", color: "var(--text)", border: "none" }}>
            {loading ? "Submitting..." : "Submit to All Providers"}
          </button>
        </div>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {([
              ["Best Fidelity", result.best_fidelity_provider],
              ["Lowest Cost", result.lowest_cost_provider],
              ["Fastest", result.fastest_provider],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label} style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: "var(--strong)", marginTop: 4 }}>{val}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Agreement Score</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, background: "var(--line)", borderRadius: 999, height: 12 }}>
                <div style={{ background: "var(--strong)", height: 12, borderRadius: 999, width: `${result.agreement_score * 100}%` }} />
              </div>
              <span style={{ color: "var(--text)", fontFamily: "ui-monospace,monospace" }}>{(result.agreement_score * 100).toFixed(1)}%</span>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)", color: "var(--muted)" }}>
                  {["Provider", "Backend", "Status", "Fidelity", "Cost (USD)", "Queue"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(result.jobs ?? []).map(j => (
                  <tr key={j.job_id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 500 }}>{j.provider_name}</td>
                    <td style={{ padding: "8px 12px", color: "var(--muted)", fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{j.backend}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 12, background: j.success ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: j.success ? "var(--ok)" : "var(--danger)" }}>
                        {j.status}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", fontFamily: "ui-monospace,monospace" }}>{(j.fidelity_estimate * 100).toFixed(2)}%</td>
                    <td style={{ padding: "8px 12px", fontFamily: "ui-monospace,monospace" }}>${j.cost_usd.toFixed(4)}</td>
                    <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{j.queue_position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
