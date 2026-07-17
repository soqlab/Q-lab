"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { fetchPublicRun, healthColor, qlabApiPath, type QLabRun } from "../../../lib/api";

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}>
      <span style={{ color: "#5f6f80" }}>{label}</span>
      <span style={{ fontWeight: 500, maxWidth: "60%", textAlign: "right", wordBreak: "break-all" }}>{value ?? "—"}</span>
    </div>
  );
}

export default function PublicSharePage({ params }: { params: { token: string } }) {
  const [run, setRun] = useState<QLabRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPublicRun(params.token)
      .then(r => { setRun(r); setLoading(false); })
      .catch(err => { setError(err instanceof Error ? err.message : "Not found"); setLoading(false); });
  }, [params.token]);

  const fp = run?.fingerprint ?? {};
  const hc = healthColor(run?.health_score);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "Inter, Segoe UI, Arial, sans-serif" }}>
      {/* Top bar */}
      <header style={{
        background: "#0d1b2a", color: "#fff", padding: "14px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px" }}>Q-Lab</span>
          <span style={{ background: "#1d6f8f", color: "#fff", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12 }}>
            Shared Run
          </span>
        </div>
        <a href="/" style={{ color: "#94a3b8", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
          <ExternalLink size={14} /> Open Q-Lab
        </a>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px" }}>
        {loading && <div style={{ textAlign: "center", color: "#5f6f80", padding: "80px 0", fontSize: 16 }}>Loading shared run…</div>}

        {error && (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <AlertTriangle size={48} style={{ color: "#e74c3c", marginBottom: 16 }} />
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Run not found</div>
            <div style={{ color: "#5f6f80" }}>{error}</div>
            <a href="/" style={{ display: "inline-block", marginTop: 20, color: "#1d6f8f" }}>Go to Q-Lab →</a>
          </div>
        )}

        {run && (
          <>
            {/* Header card */}
            <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "24px 28px", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
                <div>
                  <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
                    {run.circuit_name ?? run.run_id}
                  </h1>
                  <div style={{ color: "#5f6f80", fontSize: 13, marginTop: 6, display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <span>Backend: <strong style={{ color: "#374151" }}>{run.backend ?? "—"}</strong></span>
                    {run.project && <span>Project: <strong style={{ color: "#374151" }}>{run.project}</strong></span>}
                    <span>Status: <strong style={{ color: run.status === "completed" ? "#27ae60" : run.status === "failed" ? "#e74c3c" : "#f59e0b" }}>{run.status}</strong></span>
                  </div>
                </div>
                {run.health_score !== null && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 36, fontWeight: 800, color: hc }}>{run.health_score}</div>
                    <div style={{ fontSize: 11, color: "#9aa8b6" }}>Health score</div>
                  </div>
                )}
              </div>

              {run.tags.length > 0 && (
                <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
                  {run.tags.map(tag => (
                    <span key={tag} style={{ background: "#edf0f3", color: "#374151", borderRadius: 999, padding: "2px 10px", fontSize: 12 }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Two-column grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Fingerprint */}
              <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "20px 24px" }}>
                <h2 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Circuit Fingerprint</h2>
                <StatRow label="Qubits" value={fp.num_qubits} />
                <StatRow label="Classical bits" value={fp.num_clbits} />
                <StatRow label="Depth" value={fp.depth} />
                <StatRow label="Gate count" value={fp.size} />
                <StatRow label="Non-Clifford ratio" value={fp.non_clifford_ratio != null ? `${(fp.non_clifford_ratio * 100).toFixed(1)}%` : null} />
              </div>

              {/* Results */}
              <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "20px 24px" }}>
                <h2 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Results</h2>
                {Object.keys(run.results).length === 0 ? (
                  <div style={{ color: "#9aa8b6", fontSize: 13 }}>No results recorded.</div>
                ) : (
                  Object.entries(run.results).slice(0, 6).map(([k, v]) => (
                    <StatRow key={k} label={k} value={typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v)} />
                  ))
                )}
              </div>

              {/* Health breakdown */}
              {run.health_breakdown && Object.keys(run.health_breakdown).length > 0 && (
                <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "20px 24px" }}>
                  <h2 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Health Breakdown</h2>
                  {Object.entries(run.health_breakdown).map(([k, v]) => (
                    <StatRow key={k} label={k} value={v !== null ? String(v) : "—"} />
                  ))}
                </div>
              )}

              {/* Timing */}
              {Object.keys(run.timing).length > 0 && (
                <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "20px 24px" }}>
                  <h2 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Timing</h2>
                  {Object.entries(run.timing).map(([k, v]) => (
                    <StatRow key={k} label={k} value={typeof v === "string" ? v : JSON.stringify(v)} />
                  ))}
                </div>
              )}
            </div>

            {/* Circuit diagram */}
            {run.qasm && (
              <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "20px 24px", marginTop: 16 }}>
                <h2 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Circuit Diagram</h2>
                <div style={{ overflow: "auto", maxHeight: 360, background: "#f7f8fa", borderRadius: 8 }}>
                  <img
                    src={qlabApiPath(`/api/v1/runs/${run.run_id}/circuit.svg`)}
                    alt="Circuit diagram"
                    style={{ display: "block", maxWidth: "none" }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              </div>
            )}

            {/* Footer CTA */}
            <div style={{
              marginTop: 24, background: "linear-gradient(135deg, #0d1b2a 0%, #1d4e6f 100%)",
              borderRadius: 12, padding: "24px 28px",
              display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16,
            }}>
              <div>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Track your own quantum experiments</div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>Q-Lab automatically captures every Qiskit run — circuit, calibration, results, and more.</div>
              </div>
              <a
                href="/register"
                style={{ background: "#27ae60", color: "#fff", padding: "10px 22px", borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: "none" }}
              >
                Get started free →
              </a>
            </div>

            {/* Share meta */}
            <div style={{ marginTop: 16, textAlign: "center", fontSize: 12, color: "#9aa8b6" }}>
              Shared on {new Date(run.created_at).toLocaleDateString()} via Q-Lab · Read-only view
            </div>
          </>
        )}
      </main>
    </div>
  );
}
