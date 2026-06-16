"use client";
import { useState } from "react";
import { analyzeChannelCapacity, ChannelCapacityResult } from "@/lib/api";

const CHANNELS = ["depolarizing", "amplitude_damp", "phase_damp", "erasure", "pauli"];

export default function ChannelCapacityPage() {
  const [channel, setChannel] = useState("depolarizing");
  const [pErr, setPErr] = useState(0.05);
  const [nUses, setNUses] = useState(100);
  const [useEntanglement, setUseEntanglement] = useState(true);
  const [result, setResult] = useState<ChannelCapacityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await analyzeChannelCapacity({ channel, p_err: pErr, n_uses: nUses, uses_entanglement: useEntanglement })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Channel Configuration</div>
          <label style={{ fontSize: 11, color: "#64748b" }}>Channel Type</label>
          <select value={channel} onChange={e => setChannel(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 12, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {CHANNELS.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Error Rate: {pErr.toFixed(3)}</div>
            <input type="range" min={0} max={0.5} step={0.01} value={pErr} onChange={e => setPErr(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Channel Uses: {nUses}</div>
            <input type="range" min={1} max={1000} step={1} value={nUses} onChange={e => setNUses(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#64748b", cursor: "pointer", marginBottom: 12 }}>
            <input type="checkbox" checked={useEntanglement} onChange={e => setUseEntanglement(e.target.checked)} />
            Use Entanglement
          </label>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Analyzing…" : "Analyze Channel"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                ["Classical Capacity", `${result.classical_capacity_bits_per_use.toFixed(4)} bits/use`, "#34d399"],
                ["Quantum Capacity", `${result.quantum_capacity_qubits_per_use.toFixed(4)} qubits/use`, "#6366f1"],
                ["EA Capacity", `${result.entanglement_assisted_capacity.toFixed(4)} bits/use`, "#f59e0b"],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: String(c) }}>{v}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>Capacity Comparison (per use)</div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 100 }}>
                {[
                  ["Classical", result.classical_capacity_bits_per_use, "#34d399"],
                  ["Quantum", result.quantum_capacity_qubits_per_use, "#6366f1"],
                  ["EA", result.entanglement_assisted_capacity, "#f59e0b"],
                  ["Coherent Info", result.coherent_information, "#a78bfa"],
                ].map(([l, v, c]) => (
                  <div key={String(l)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "70%", background: String(c), borderRadius: 2, height: `${Math.max(4, Number(v) * 90)}px` }} />
                    <div style={{ fontSize: 10, color: "#64748b" }}>{l}</div>
                    <div style={{ fontSize: 11, color: "#e2e8f0" }}>{Number(v).toFixed(3)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Total Over {nUses} Uses</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Classical bits: <span style={{ color: "#34d399", fontWeight: 700 }}>{result.total_classical_bits.toFixed(1)}</span></div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Quantum bits: <span style={{ color: "#6366f1", fontWeight: 700 }}>{result.total_quantum_bits.toFixed(1)}</span></div>
                <div style={{ fontSize: 12, color: "#64748b" }}>eBits needed: <span style={{ color: "#f59e0b", fontWeight: 700 }}>{result.total_ebits_needed.toFixed(1)}</span></div>
              </div>

              <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Threshold</div>
                {result.threshold_error_rate !== null ? (
                  <>
                    <div style={{ fontSize: 12, color: "#64748b" }}>Threshold: {result.threshold_error_rate}</div>
                    <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 6, background: result.above_threshold ? "#14532d" : "#7f1d1d", color: result.above_threshold ? "#34d399" : "#f87171", fontSize: 13, fontWeight: 700 }}>
                      {result.above_threshold ? "✓ Below threshold" : "✗ Above threshold"}
                    </div>
                  </>
                ) : <div style={{ fontSize: 12, color: "#64748b" }}>N/A</div>}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>{result.interpretation}</div>
            </div>
          </>
        )}
        {!result && !loading && <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Select a channel and analyze its capacity</div>}
      </div>
    </div>
  );
}
