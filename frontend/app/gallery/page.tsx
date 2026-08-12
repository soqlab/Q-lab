"use client";

import { useEffect, useState } from "react";
import { qlabApiPath } from "../../lib/api";

interface GalleryRun {
  share_token: string; circuit_name: string; backend: string | null;
  status: string; health_score: number | null; qubits: number | null;
  depth: number | null; project: string | null; created_at: string | null; url: string;
}

function HealthDot({ score }: { score: number | null }) {
  if (score === null) return null;
  const color = score >= 80 ? "#10b981" : score >= 55 ? "#f59e0b" : "#ef4444";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
      {score}
    </span>
  );
}

export default function GalleryPage() {
  const [runs, setRuns] = useState<GalleryRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const PAGE = 24;

  useEffect(() => {
    setLoading(true);
    fetch(qlabApiPath(`/api/v1/public/gallery?limit=${PAGE}&offset=${offset}`))
      .then(r => r.json())
      .then(d => { setRuns(d.items ?? []); setTotal(d.total ?? 0); setLoading(false); })
      .catch(() => setLoading(false));
  }, [offset]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "Inter, Segoe UI, Arial, sans-serif" }}>
      {/* Header */}
      <header style={{ background: "#0d1b2a", borderBottom: "1px solid #1e2d3d", padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <a href="/" style={{ color: "#fff", textDecoration: "none", fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px" }}>Q-Lab</a>
          <span style={{ marginLeft: 14, color: "#64748b", fontSize: 13 }}>Public Experiment Gallery</span>
        </div>
        <a href="/register" style={{ background: "#6366f1", color: "#fff", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
          Track yours free →
        </a>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 800, color: "var(--text)" }}>
            Quantum Experiments — Open Gallery
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
            {total.toLocaleString()} shared experiments from the Q-Lab community. Circuit results, health scores, and calibration data — publicly accessible.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "var(--muted)" }}>Loading experiments…</div>
        ) : runs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "var(--muted)" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚛️</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No public experiments yet</div>
            <div style={{ marginBottom: 20 }}>Be the first to share a Qiskit run with Q-Lab.</div>
            <a href="/register" style={{ background: "#6366f1", color: "#fff", padding: "10px 24px", borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
              Get started free →
            </a>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, marginBottom: 28 }}>
              {runs.map(r => (
                <a
                  key={r.share_token}
                  href={r.url}
                  style={{
                    display: "block", padding: "18px 20px", background: "var(--panel)",
                    border: "1px solid var(--line)", borderRadius: 12, textDecoration: "none",
                    transition: "border-color 0.15s, transform 0.15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#6366f1"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--line)"; (e.currentTarget as HTMLElement).style.transform = ""; }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", lineHeight: 1.3, maxWidth: "78%" }}>
                      {r.circuit_name}
                    </div>
                    <HealthDot score={r.health_score} />
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {r.backend && (
                      <span style={{ fontSize: 11, fontWeight: 600, background: "#6366f118", color: "#6366f1", borderRadius: 999, padding: "2px 8px" }}>
                        {r.backend}
                      </span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 600, background: r.status === "completed" ? "#10b98118" : "#ef444418", color: r.status === "completed" ? "#10b981" : "#ef4444", borderRadius: 999, padding: "2px 8px" }}>
                      {r.status}
                    </span>
                    {r.project && (
                      <span style={{ fontSize: 11, background: "var(--surface)", color: "var(--muted)", borderRadius: 999, padding: "2px 8px" }}>
                        {r.project}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)" }}>
                    {r.qubits != null && <span>⚛️ {r.qubits} qubits</span>}
                    {r.depth != null && <span>📐 depth {r.depth}</span>}
                    {r.created_at && <span style={{ marginLeft: "auto" }}>{new Date(r.created_at).toLocaleDateString()}</span>}
                  </div>
                </a>
              ))}
            </div>

            {/* Pagination */}
            {total > PAGE && (
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}
                  style={{ padding: "8px 18px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", cursor: offset > 0 ? "pointer" : "not-allowed", opacity: offset > 0 ? 1 : 0.4, color: "var(--text)", fontSize: 13 }}>
                  ← Previous
                </button>
                <span style={{ padding: "8px 14px", fontSize: 13, color: "var(--muted)" }}>
                  {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
                </span>
                <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}
                  style={{ padding: "8px 18px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", cursor: offset + PAGE < total ? "pointer" : "not-allowed", opacity: offset + PAGE < total ? 1 : 0.4, color: "var(--text)", fontSize: 13 }}>
                  Next →
                </button>
              </div>
            )}
          </>
        )}

        {/* SEO footer CTA */}
        <div style={{ marginTop: 48, textAlign: "center", padding: "32px 24px", background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(99,102,241,0.02))", borderRadius: 16, border: "1px solid rgba(99,102,241,0.15)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", marginBottom: 8 }}>Track your quantum experiments with Q-Lab</div>
          <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20, maxWidth: 520, margin: "0 auto 20px" }}>
            Automatically capture every Qiskit circuit run — calibration, health scores, AI insights, and QPU cost comparison across IBM, IonQ, and Rigetti.
          </div>
          <a href="/register" style={{ display: "inline-block", background: "#6366f1", color: "#fff", padding: "12px 28px", borderRadius: 10, fontWeight: 700, fontSize: 15, textDecoration: "none" }}>
            Get started free →
          </a>
        </div>
      </main>
    </div>
  );
}
