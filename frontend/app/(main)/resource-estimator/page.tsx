"use client";
import { useState, useEffect } from "react";
import { estimateResources, ResourceEstimateResult } from "@/lib/api";

const ALGORITHMS = ["shor_2048", "shor_1024", "grover_n30", "chemistry_feo", "chemistry_h2o", "qpe_phase", "hhl_1000", "custom"];

export default function ResourceEstimatorPage() {
  const [algorithm, setAlgorithm] = useState("shor_2048");
  const [pPhysical, setPPhysical] = useState(0.001);
  const [result, setResult] = useState<ResourceEstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try { setResult(await estimateResources({ algorithm, p_physical: pPhysical })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, []);

  const milestone2030 = result?.milestones.find(m => m.year === 2030);
  const milestone2035 = result?.milestones.find(m => m.year === 2035);

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>Configuration</div>
          <label style={{ fontSize: 12, color: "#64748b" }}>Algorithm</label>
          <select value={algorithm} onChange={e => setAlgorithm(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 12, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {ALGORITHMS.map(a => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
          </select>
          <label style={{ fontSize: 12, color: "#64748b" }}>Physical Error Rate: {pPhysical}</label>
          <input type="range" min={0.0001} max={0.01} step={0.0001} value={pPhysical} onChange={e => setPPhysical(Number(e.target.value))}
            style={{ width: "100%", marginTop: 4 }} />
          <button onClick={run} disabled={loading}
            style={{ marginTop: 16, width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Estimating…" : "Estimate Resources"}
          </button>
        </div>

        {result && (
          <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Key Metrics</div>
            {[
              ["Code Distance", result.code_distance],
              ["Phys/Logical", result.physical_per_logical],
              ["T Factories", result.n_t_factories],
              ["Total Hours", result.total_time_hours.toFixed(0)],
              ["Total Years", result.total_time_years.toFixed(1)],
            ].map(([l, v]) => (
              <div key={String(l)} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1e293b" }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                ["Total Physical Qubits", result.total_physical_qubits.toLocaleString(), "#6366f1"],
                ["Speedup vs Classical", result.speedup_vs_classical, "#34d399"],
                ["Current Gap Factor", `${result.current_gap_factor.toFixed(0)}×`, "#fbbf24"],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ background: "#1e293b", borderRadius: 8, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: String(c) }}>{v}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>Hardware Roadmap — Can We Run It?</div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
                {result.milestones.map(m => (
                  <div key={m.year} style={{ minWidth: 80, background: "#0f172a", borderRadius: 6, padding: 12, textAlign: "center", border: `1px solid ${m.can_run ? "#34d399" : "#334155"}` }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{m.year}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{m.physical_qubits.toLocaleString()}Q</div>
                    <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: m.can_run ? "#34d399" : "#f87171" }}>{m.can_run ? "✓ Yes" : "✗ No"}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Recommendations</div>
              {result.recommendations.map((r, i) => (
                <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #0f172a", fontSize: 13, color: "#cbd5e1" }}>• {r}</div>
              ))}
            </div>
          </>
        )}
        {!result && !loading && (
          <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Select an algorithm and click Estimate Resources</div>
        )}
      </div>
    </div>
  );
}
