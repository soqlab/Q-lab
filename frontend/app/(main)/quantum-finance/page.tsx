"use client";
import { useState } from "react";
import { runQuantumFinance, QuantumFinanceResult } from "@/lib/api";

export default function QuantumFinancePage() {
  const [assetPrice, setAssetPrice] = useState(100);
  const [strikePrice, setStrikePrice] = useState(105);
  const [volatility, setVolatility] = useState(0.2);
  const [riskFreeRate, setRiskFreeRate] = useState(0.05);
  const [timeToExpiry, setTimeToExpiry] = useState(1.0);
  const [nQubits, setNQubits] = useState(5);
  const [nAssets, setNAssets] = useState(4);
  const [budget, setBudget] = useState(2);
  const [result, setResult] = useState<QuantumFinanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try {
      setResult(await runQuantumFinance({ asset_price: assetPrice, strike_price: strikePrice, volatility, risk_free_rate: riskFreeRate, time_to_expiry: timeToExpiry, n_qubits: nQubits, n_assets: nAssets, budget }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Option Pricing</div>
          {([
            ["Asset Price ($)", assetPrice, setAssetPrice, 50, 500, 1],
            ["Strike Price ($)", strikePrice, setStrikePrice, 50, 500, 1],
            ["Volatility (σ)", volatility, setVolatility, 0.05, 1, 0.01],
            ["Risk-Free Rate", riskFreeRate, setRiskFreeRate, 0, 0.2, 0.005],
            ["Time (years)", timeToExpiry, setTimeToExpiry, 0.1, 5, 0.1],
            ["Qubits", nQubits, setNQubits, 3, 10, 1],
          ] as [string, number, (x: number) => void, number, number, number][]).map(([l, v, s, min, max, step]) => (
            <div key={String(l)} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{l}: {Number(v).toFixed(Number(step) < 1 ? 3 : 0)}</div>
              <input type="range" min={Number(min)} max={Number(max)} step={Number(step)} value={Number(v)}
                onChange={e => (s as (x: number) => void)(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          ))}
          <div style={{ marginTop: 4, marginBottom: 4, borderTop: "1px solid #334155", paddingTop: 12, fontSize: 13, color: "#94a3b8" }}>Portfolio</div>
          {([["Assets", nAssets, setNAssets, 2, 8, 1], ["Budget", budget, setBudget, 1, 6, 1]] as [string, number, (x: number) => void, number, number, number][]).map(([l, v, s, min, max, step]) => (
            <div key={String(l)} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{l}: {v}</div>
              <input type="range" min={Number(min)} max={Number(max)} step={Number(step)} value={Number(v)}
                onChange={e => (s as (x: number) => void)(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          ))}
          <button onClick={run} disabled={loading}
            style={{ marginTop: 8, width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Computing…" : "Run Quantum Finance"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                ["Black-Scholes", `$${result.black_scholes_price.toFixed(2)}`, "#e2e8f0"],
                ["Quantum AE Estimate", `$${result.quantum_price_estimate.toFixed(2)}`, "#6366f1"],
                ["Classical MC", `$${result.classical_mc_price.toFixed(2)}`, "#94a3b8"],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: String(c) }}>{v}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Quantum Speedup</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: result.quantum_advantage_achieved ? "#34d399" : "#f87171" }}>
                  {result.speedup_factor.toFixed(1)}×
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Quantum AE paths: {result.quantum_n_paths_needed.toLocaleString()}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Classical MC paths: {result.classical_n_paths_needed.toLocaleString()}</div>
                <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: result.quantum_advantage_achieved ? "#14532d" : "#7f1d1d", color: result.quantum_advantage_achieved ? "#34d399" : "#f87171", fontSize: 12, fontWeight: 700 }}>
                  {result.quantum_advantage_achieved ? "✓ Advantage Achieved" : "✗ No Advantage"}
                </div>
              </div>

              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Portfolio (QAOA)</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {result.optimal_portfolio.map((selected, i) => (
                    <div key={i} style={{ width: 32, height: 32, borderRadius: 6, background: selected ? "#6366f1" : "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#e2e8f0" }}>
                      A{i+1}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Return: <span style={{ color: "#34d399", fontWeight: 700 }}>{(result.expected_return * 100).toFixed(1)}%</span></div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Sharpe: <span style={{ color: "#fbbf24", fontWeight: 700 }}>{result.sharpe_ratio.toFixed(2)}</span></div>
                <div style={{ fontSize: 12, color: "#64748b" }}>QAOA ratio: <span style={{ color: "#a78bfa", fontWeight: 700 }}>{result.qaoa_approximation_ratio.toFixed(3)}</span></div>
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Asset Returns</div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 80 }}>
                {result.asset_returns.map((r, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", background: result.optimal_portfolio[i] ? "#6366f1" : "#334155", borderRadius: 2, height: `${r * 300}px` }} />
                    <div style={{ fontSize: 10, color: "#64748b" }}>A{i+1}</div>
                    <div style={{ fontSize: 10, color: "#e2e8f0" }}>{(r * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>{result.interpretation}</div>
            </div>
          </>
        )}
        {!result && !loading && <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Configure parameters to price options and optimize portfolio</div>}
      </div>
    </div>
  );
}


