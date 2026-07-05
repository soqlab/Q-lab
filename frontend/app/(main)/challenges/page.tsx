"use client";
import { useState, useEffect } from "react";
import { listChallenges, getChallengeLeaderboard, submitToChallenge, Challenge, ChallengeSubmission } from "@/lib/api";

const DIFFICULTY_STYLES: Record<string, React.CSSProperties> = {
  medium: { color: "#f59e0b", background: "rgba(245,158,11,0.1)" },
  hard: { color: "#f97316", background: "rgba(249,115,22,0.1)" },
  expert: { color: "var(--danger)", background: "rgba(239,68,68,0.1)" },
};

export default function ChallengesPage() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selected, setSelected] = useState<Challenge | null>(null);
  const [leaderboard, setLeaderboard] = useState<object[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitValue, setSubmitValue] = useState("");
  const [submitLabel, setSubmitLabel] = useState("My Team");
  const [mySubmission, setMySubmission] = useState<ChallengeSubmission | null>(null);

  useEffect(() => {
    listChallenges()
      .then(r => { setChallenges(r.challenges); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  async function selectChallenge(c: Challenge) {
    setSelected(c); setMySubmission(null);
    try {
      const lb = await getChallengeLeaderboard(c.challenge_id);
      setLeaderboard(lb.entries);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function submit() {
    if (!selected || !submitValue) return;
    setSubmitting(true); setError("");
    try {
      const r = await submitToChallenge(selected.challenge_id, { value: Number(submitValue), label: submitLabel });
      setMySubmission(r);
      const lb = await getChallengeLeaderboard(selected.challenge_id);
      setLeaderboard(lb.entries);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div style={{ padding: 24, color: "var(--muted)" }}>Loading challenges...</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1152, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Community Challenges</h1>
      <p style={{ color: "var(--muted)" }}>Compete on curated quantum computing benchmarks, track your rank against global researchers, and claim prizes.</p>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(challenges ?? []).map(c => (
            <div key={c.challenge_id}
              onClick={() => selectChallenge(c)}
              style={{
                background: "var(--surface)",
                borderRadius: 8,
                padding: 20,
                cursor: "pointer",
                border: selected?.challenge_id === c.challenge_id ? "1px solid var(--strong)" : "1px solid transparent",
              }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 6,
                      ...(DIFFICULTY_STYLES[c.difficulty] ?? { color: "var(--muted)", background: "var(--line)" }),
                    }}>
                      {c.difficulty}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{c.title}</span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--muted)", WebkitLineClamp: 2, display: "-webkit-box", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.description}</p>
                  <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                    <span>{c.participants} participants</span>
                    <span>· Metric: {c.metric}</span>
                    <span>· Target: {c.target_value}</span>
                  </div>
                </div>
              </div>
              {c.leader && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--strong)" }}>Leader: {c.leader} ({c.leader_value})</div>
              )}
              <div style={{ marginTop: 8, fontSize: 12, color: "#f59e0b" }}>{c.prize}</div>
            </div>
          ))}
        </div>

        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              <h2 style={{ fontWeight: 600 }}>{selected.title}</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
                <div><span style={{ color: "var(--muted)" }}>Baseline:</span> <span style={{ fontFamily: "ui-monospace,monospace" }}>{selected.baseline_value}</span></div>
                <div><span style={{ color: "var(--muted)" }}>Target:</span> <span style={{ fontFamily: "ui-monospace,monospace", color: "var(--ok)" }}>{selected.target_value}</span></div>
                <div><span style={{ color: "var(--muted)" }}>Qubits:</span> {selected.n_qubits_min}–{selected.n_qubits_max}</div>
                <div><span style={{ color: "var(--muted)" }}>Deadline:</span> {selected.deadline.slice(0, 10)}</div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ fontSize: 13, color: "var(--muted)" }}>Your {selected.metric} value</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" step="any" value={submitValue} onChange={e => setSubmitValue(e.target.value)}
                    placeholder="0.00" style={{ flex: 1, background: "var(--surface)", color: "var(--text)", fontFamily: "ui-monospace,monospace", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }} />
                  <input value={submitLabel} onChange={e => setSubmitLabel(e.target.value)}
                    placeholder="Team name" style={{ width: 128, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }} />
                </div>
                <button onClick={submit} disabled={submitting}
                  style={{ width: "100%", padding: "8px 0", background: "var(--strong)", borderRadius: 6, fontWeight: 500, opacity: submitting ? 0.5 : 1, cursor: submitting ? "not-allowed" : "pointer", border: "none", color: "var(--text)" }}>
                  {submitting ? "Submitting..." : "Submit Score"}
                </button>
              </div>

              {mySubmission && (
                <div style={{ background: "rgba(99,102,241,0.15)", border: "1px solid var(--strong)", borderRadius: 6, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "var(--strong)" }}>Rank #{mySubmission.rank}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{mySubmission.percentile.toFixed(1)}th percentile</div>
                </div>
              )}
            </div>

            {leaderboard && (
              <div style={{ background: "var(--surface)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontWeight: 500, fontSize: 13 }}>Leaderboard</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--line)", color: "var(--muted)", fontSize: 12 }}>
                        {["#", "Team", selected.metric, "Backend"].map(h => <th key={h} style={{ textAlign: "left", padding: "8px 16px" }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {(leaderboard as { rank: number; label: string; value: number; backend: string }[]).map((e, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--line)", background: i === 0 ? "rgba(245,158,11,0.05)" : undefined }}>
                          <td style={{ padding: "8px 16px", fontFamily: "ui-monospace,monospace", color: "var(--muted)" }}>{e.rank ?? i + 1}</td>
                          <td style={{ padding: "8px 16px" }}>{e.label}</td>
                          <td style={{ padding: "8px 16px", fontFamily: "ui-monospace,monospace" }}>{e.value}</td>
                          <td style={{ padding: "8px 16px", color: "var(--muted)", fontSize: 12 }}>{e.backend}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
