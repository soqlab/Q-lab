"use client";
import { useEffect, useState } from "react";
import { ReproResult, checkReproducibility, listReproducibilityResults } from "../../../lib/api";
import { RefreshCw, CheckCircle, XCircle, BarChart2 } from "lucide-react";

const GRADE_COLOR: Record<string, string> = {
  A: "#10b981", B: "#3b82f6", C: "#f59e0b", D: "#f97316", F: "#ef4444",
};
const GRADE_DESC: Record<string, string> = {
  A: "Excellent reproducibility (≥95%)",
  B: "Good — minor shot noise (≥85%)",
  C: "Moderate — some variation (≥70%)",
  D: "Poor — check backend stability (≥50%)",
  F: "Unreliable — investigate immediately (<50%)",
};

function TVDHistogram({ tvds }: { tvds: number[] }) {
  const bins = 10;
  const max = Math.max(...tvds, 0.01);
  const counts = Array(bins).fill(0);
  for (const v of tvds) {
    const bin = Math.min(Math.floor((v / max) * bins), bins - 1);
    counts[bin]++;
  }
  const maxCount = Math.max(...counts, 1);
  const W = 340; const H = 100; const PAD = 28;
  const bw = (W - PAD * 2) / bins;
  return (
    <svg width={W} height={H} style={{ display: "block", width: "100%" }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" strokeWidth={1} />
      {counts.map((c, i) => {
        const bh = (c / maxCount) * (H - PAD * 2);
        const color = i / bins < 0.3 ? "#10b981" : i / bins < 0.6 ? "#f59e0b" : "#ef4444";
        return (
          <rect key={i} x={PAD + i * bw + 1} y={H - PAD - bh} width={bw - 2} height={bh} fill={color} rx={2} />
        );
      })}
      <text x={PAD} y={H - PAD + 14} fill="#475569" fontSize={9} textAnchor="middle">0</text>
      <text x={W - PAD} y={H - PAD + 14} fill="#475569" fontSize={9} textAnchor="middle">{max.toFixed(3)}</text>
      <text x={(PAD + W - PAD) / 2} y={H - 2} fill="#475569" fontSize={9} textAnchor="middle">TVD</text>
    </svg>
  );
}

export default function ReproducibilityPage() {
  const [runId, setRunId] = useState("");
  const [nReruns, setNReruns] = useState(5);
  const [result, setResult] = useState<ReproResult | null>(null);
  const [history, setHistory] = useState<ReproResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listReproducibilityResults().then(data => { setHistory(data); if (data.length > 0) setResult(data[0]); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleCheck = async () => {
    if (!runId.trim()) { setError("Enter a run ID."); return; }
    setChecking(true); setError(null);
    try {
      const r = await checkReproducibility({ run_id: runId.trim(), n_reruns: nReruns });
      setResult(r); setHistory(prev => [r, ...prev]);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setChecking(false); }
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <RefreshCw size={28} color="#3b82f6" /> Reproducibility Engine
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Re-runs a past experiment and computes Total Variation Distance (TVD) between runs. Grades reproducibility A–F — no other platform does this.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
        <div>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>Check Reproducibility</h3>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 10 }}>
              Run ID
              <input value={runId} onChange={e => setRunId(e.target.value)} placeholder="run_abc123"
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box", fontFamily: "monospace" }} />
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 14 }}>
              Reruns: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{nReruns}</span>
              <input type="range" min={3} max={30} step={1} value={nReruns} onChange={e => setNReruns(Number(e.target.value))}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#3b82f6" }} />
            </label>
            <button onClick={handleCheck} disabled={checking}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.65rem", cursor: "pointer", fontWeight: 600, opacity: checking ? 0.6 : 1 }}>
              <RefreshCw size={15} /> {checking ? `Running ${nReruns} reruns…` : "Check Reproducibility"}
            </button>
          </div>

          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
            <h3 style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>History</h3>
            {loading ? <div style={{ color: "#475569", fontSize: "0.8rem" }}>Loading…</div> :
              history.length === 0 ? <div style={{ color: "#475569", fontSize: "0.8rem" }}>No checks yet.</div> :
              history.slice(0, 10).map(r => (
                <div key={r.result_id} onClick={() => { setResult(r); setRunId(r.original_run_id); }}
                  style={{ padding: "0.45rem 0.6rem", borderRadius: 6, marginBottom: 4, cursor: "pointer", background: result?.result_id === r.result_id ? "#0f172a" : "transparent" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#e2e8f0", fontSize: "0.8rem", fontFamily: "monospace" }}>{r.original_run_id.slice(0, 12)}…</span>
                    <span style={{ color: GRADE_COLOR[r.grade] ?? "#64748b", fontWeight: 700, fontSize: "0.82rem" }}>Grade {r.grade}</span>
                  </div>
                  <div style={{ color: "#475569", fontSize: "0.7rem" }}>TVD={r.mean_tvd.toFixed(4)} · {r.n_reruns} runs</div>
                </div>
              ))
            }
          </div>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ background: "#1e293b", borderRadius: 12, border: `1px solid ${GRADE_COLOR[result.grade] ?? "#334155"}40`, padding: "1.5rem", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "3.5rem", fontWeight: 900, color: GRADE_COLOR[result.grade] ?? "#e2e8f0", lineHeight: 1 }}>
                      {result.grade}
                    </div>
                    <div style={{ color: "#64748b", fontSize: "0.75rem" }}>Grade</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "1.1rem", marginBottom: 4 }}>
                      {(result.reproducibility_score * 100).toFixed(1)}% Reproducible
                    </div>
                    <div style={{ color: "#64748b", fontSize: "0.82rem", marginBottom: 10 }}>{GRADE_DESC[result.grade]}</div>
                    <div style={{ height: 10, background: "#0f172a", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${result.reproducibility_score * 100}%`, height: "100%", background: GRADE_COLOR[result.grade] ?? "#3b82f6", borderRadius: 99 }} />
                    </div>
                  </div>
                  {result.reproducibility_score >= 0.85
                    ? <CheckCircle size={32} color="#10b981" />
                    : <XCircle size={32} color="#ef4444" />}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Mean TVD", value: result.mean_tvd.toFixed(4), color: "#3b82f6" },
                  { label: "Std TVD", value: result.std_tvd.toFixed(4), color: "#8b5cf6" },
                  { label: "Reruns", value: result.n_reruns, color: "#f59e0b" },
                  { label: "Repro Score", value: `${(result.reproducibility_score * 100).toFixed(1)}%`, color: GRADE_COLOR[result.grade] ?? "#e2e8f0" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.25rem", fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem" }}>
                  <BarChart2 size={16} color="#3b82f6" /> TVD Distribution Across {result.n_reruns} Reruns
                </h3>
                <TVDHistogram tvds={result.trial_tvds} />
                <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: "0.75rem" }}>
                  <span style={{ color: "#10b981" }}>■ Low TVD (similar)</span>
                  <span style={{ color: "#f59e0b" }}>■ Medium</span>
                  <span style={{ color: "#ef4444" }}>■ High TVD (divergent)</span>
                </div>
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {result.trial_tvds.map((v, i) => (
                    <span key={i} style={{ fontFamily: "monospace", fontSize: "0.72rem", color: v < 0.05 ? "#10b981" : v < 0.15 ? "#f59e0b" : "#ef4444", background: "#0f172a", borderRadius: 4, padding: "1px 5px" }}>
                      {v.toFixed(4)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, color: "#475569" }}>
              <RefreshCw size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Enter a run ID to check how reproducible that experiment is.</p>
              <p style={{ fontSize: "0.85rem", marginTop: 4 }}>TVD &lt; 0.05 across reruns = Grade A reproducibility.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
