"use client";
import { useState } from "react";
import { estimateProviderCost, getCostHistory, CostEstimateResult } from "@/lib/api";

export default function CostOraclePage() {
  const [nQubits, setNQubits] = useState(5);
  const [depth, setDepth] = useState(20);
  const [shots, setShots] = useState(8192);
  const [nCircuits, setNCircuits] = useState(10);
  const [result, setResult] = useState<CostEstimateResult | null>(null);
  const [history, setHistory] = useState<{ history: object[]; total_usd: number; by_provider: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function estimate() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await estimateProviderCost({ n_qubits: nQubits, circuit_depth: depth, n_shots: shots, n_circuits: nCircuits });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function loadHistory() {
    try {
      const h = await getCostHistory();
      setHistory(h);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 896, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Cost Oracle</h1>
      <p style={{ color: "var(--muted)" }}>Estimate and compare quantum cloud execution costs across providers before submitting jobs.</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, fontSize: 12, color: "var(--muted)" }}>
        <span style={{ color: "#6366f1", fontWeight: 600 }}>ⓘ</span>
        Prices last verified <strong style={{ color: "var(--text)" }}>August 2024</strong> against IBM Quantum, IonQ, Braket, and Quantinuum published rates. Verify current pricing before budgeting production workloads.{" "}
        <a href="https://quantum.ibm.com/pricing" target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", marginLeft: 4 }}>IBM</a>
        <a href="https://ionq.com/pricing" target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", marginLeft: 4 }}>IonQ</a>
        <a href="https://aws.amazon.com/braket/pricing/" target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", marginLeft: 4 }}>Braket</a>
      </div>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {([
            ["Qubits", nQubits, setNQubits, 1, 500, 1],
            ["Circuit Depth", depth, setDepth, 1, 10000, 1],
            ["Shots", shots, setShots, 100, 100000, 100],
            ["# Circuits", nCircuits, setNCircuits, 1, 1000, 1],
          ] as [string, number, (n: number) => void, number, number, number][]).map(([label, val, set, min, max, step]) => (
            <div key={label}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{label}</label>
              <input type="number" min={min} max={max} step={step} value={val}
                onChange={e => set(Number(e.target.value))}
                className="input" style={{ width: "100%", marginTop: 4 }} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={estimate} disabled={loading}
            className="button" style={{ opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "Estimating..." : "Estimate Cost"}
          </button>
          <button onClick={loadHistory} className="button secondary">
            View Spend History
          </button>
        </div>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "rgba(16,185,129,0.1)", borderRadius: 8, padding: 16, border: "1px solid var(--ok)" }}>
              <div style={{ fontSize: 12, color: "var(--ok)", textTransform: "uppercase", marginBottom: 4 }}>Cheapest Option</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ok)" }}>{result.cheapest_provider}</div>
              <div style={{ fontSize: 24, fontFamily: "ui-monospace,monospace", color: "var(--ok)" }}>${result.cheapest_cost_usd.toFixed(4)}</div>
            </div>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>All Providers Total</div>
              <div style={{ fontSize: 24, fontFamily: "ui-monospace,monospace", color: "var(--text)" }}>${result.total_if_all_providers_usd.toFixed(2)}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{result.n_shots.toLocaleString()} shots × {result.n_circuits} circuits</div>
            </div>
          </div>

          <div style={{ background: "var(--surface)", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)", color: "var(--muted)", fontSize: 12, textTransform: "uppercase" }}>
                  {["Provider", "Cost/Circuit", "Total", "Queue (min)", "Free Tier"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "12px 16px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(result.providers ?? []).map((p, i) => (
                  <tr key={p.provider_id} style={{ borderBottom: "1px solid var(--line)", background: i === 0 ? "rgba(16,185,129,0.1)" : undefined }}>
                    <td style={{ padding: "8px 16px", fontWeight: 500 }}>{p.provider_name}</td>
                    <td style={{ padding: "8px 16px", fontFamily: "ui-monospace,monospace" }}>${p.cost_per_circuit_usd.toFixed(5)}</td>
                    <td style={{ padding: "8px 16px", fontFamily: "ui-monospace,monospace", fontWeight: 600 }}>${p.cost_total_usd.toFixed(4)}</td>
                    <td style={{ padding: "8px 16px", color: "var(--muted)" }}>{p.estimated_queue_min}</td>
                    <td style={{ padding: "8px 16px" }}>{p.free_tier ? <span style={{ color: "var(--ok)" }}>Yes</span> : <span style={{ color: "var(--muted)" }}>No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(result.recommendations ?? []).length > 0 && (
            <div style={{ background: "rgba(245,158,11,0.1)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
              {(result.recommendations ?? []).map((r, i) => (
                <div key={i} style={{ color: "#f59e0b", fontSize: 13 }}>• {r}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {history && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontWeight: 600 }}>Spend History</h2>
          <div style={{ fontSize: 24, fontFamily: "ui-monospace,monospace", color: "var(--strong)" }}>${history.total_usd.toFixed(4)} total</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(history.by_provider).map(([provider, cost]) => (
              <div key={provider} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, color: "var(--muted)", width: 128, flexShrink: 0 }}>{provider}</span>
                <div style={{ flex: 1, background: "var(--line)", borderRadius: 999, height: 8 }}>
                  <div style={{ background: "var(--strong)", height: 8, borderRadius: 999, width: `${(cost / Math.max(history.total_usd, 0.0001)) * 100}%` }} />
                </div>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 13 }}>${(cost as number).toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
