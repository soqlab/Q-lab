"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { fetchShadowTomo, ShadowTomoResult } from "../../../../lib/api";

export default function ShadowTomoPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<ShadowTomoResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchShadowTomo(runId)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "No measurement data"))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading) return null;
  if (error) return null; // silently skip if no counts data

  if (!data) return null;

  const entangled = data.entanglement_indicator > 0.05;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Layers size={16} aria-hidden="true" />
          Observable Estimation
        </h2>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
          {data.n_shots.toLocaleString()} shots · {data.n_qubits} qubits
        </span>
      </div>

      <div style={{ padding: "12px 18px" }}>
        {/* Summary row */}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
          <StatBox label="Rényi-2 entropy" value={data.renyi2_entropy.toFixed(3)} />
          <StatBox label="Global parity" value={data.global_parity.toFixed(3)} />
          <StatBox
            label="Entanglement indicator"
            value={data.entanglement_indicator.toFixed(3)}
            accent={entangled ? "#7c3aed" : undefined}
          />
          <StatBox
            label="Success prob."
            value={`${(data.success_probability * 100).toFixed(1)}%`}
            accent={data.success_probability > 0.5 ? "#22c55e" : "#e74c3c"}
          />
        </div>

        {entangled && (
          <div style={{
            padding: "8px 12px", background: "#f5f0ff", border: "1px solid #d8b4fe",
            borderRadius: 6, fontSize: 12, color: "#6b21a8", marginBottom: 12,
          }}>
            Entanglement indicator {data.entanglement_indicator.toFixed(3)} &gt; 0.05 — correlations
            cannot be explained by a product state.
          </div>
        )}

        {/* Per-qubit Z expectations */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
            Per-qubit ⟨Z⟩ expectations
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {data.z_expectations.map((z, i) => (
              <ZBar key={i} qubit={i} value={z} />
            ))}
          </div>
        </div>

        {/* ZZ correlations */}
        {Object.keys(data.zz_correlations).length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
              Two-qubit ⟨ZZ⟩ correlations
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(data.zz_correlations).map(([k, v]) => (
                <div key={k} style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  background: "var(--panel-2)", borderRadius: 6, padding: "6px 10px",
                  minWidth: 64,
                }}>
                  <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>{k}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: Math.abs(v) > 0.5 ? "#7c3aed" : "var(--text)" }}>
                    {v.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>{data.note}</div>
      </div>
    </section>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</span>
    </div>
  );
}

function ZBar({ qubit, value }: { qubit: number; value: number }) {
  const pct = ((value + 1) / 2) * 100; // map [-1,1] → [0,100]
  const color = value > 0.3 ? "#22c55e" : value < -0.3 ? "#e74c3c" : "#f59e0b";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 40, gap: 2 }}>
      <span style={{ fontSize: 10, color: "var(--muted)" }}>Q{qubit}</span>
      <div style={{ width: 32, height: 60, background: "var(--line)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", bottom: 0, width: "100%",
          height: `${Math.max(pct, 2)}%`, background: color, borderRadius: 4,
          transition: "height 0.3s",
        }} />
        <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "var(--muted)", opacity: 0.5 }} />
      </div>
      <span style={{ fontSize: 9, color, fontWeight: 600 }}>{value.toFixed(2)}</span>
    </div>
  );
}
