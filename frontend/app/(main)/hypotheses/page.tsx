"use client";
import { useState, useEffect } from "react";
import { listHypotheses, createHypothesis, updateHypothesis, Hypothesis } from "@/lib/api";

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  proposed:     { background: "var(--line)",               color: "var(--text)" },
  testing:      { background: "rgba(59,130,246,0.1)",      color: "var(--info-text)" },
  supported:    { background: "rgba(16,185,129,0.1)",      color: "var(--ok)" },
  refuted:      { background: "rgba(239,68,68,0.1)",       color: "var(--danger)" },
  inconclusive: { background: "rgba(245,158,11,0.1)",      color: "#f59e0b" },
};

export default function HypothesesPage() {
  const [hyps, setHyps] = useState<Hypothesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [prediction, setPrediction] = useState("");
  const [selected, setSelected] = useState<Hypothesis | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await listHypotheses();
      setHyps(r.hypotheses);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function submit() {
    if (!title || !statement) return;
    try {
      await createHypothesis({ title, statement, prediction });
      setTitle(""); setStatement(""); setPrediction(""); setShowForm(false);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function advance(hyp: Hypothesis) {
    const nextStatus: Record<string, string> = { proposed: "testing", testing: "supported" };
    const next = nextStatus[hyp.status];
    if (!next) return;
    try {
      await updateHypothesis(hyp.hyp_id, { status: next });
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  if (loading) return <div style={{ padding: 24, color: "var(--muted)" }}>Loading hypotheses...</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Hypotheses Tracker</h1>
        <button onClick={() => setShowForm(!showForm)} className="button">
          + New Hypothesis
        </button>
      </div>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: 12 }}>
          {error}
        </div>
      )}

      {showForm && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontWeight: 600 }}>Formulate Hypothesis</h2>
          <input
            placeholder="Title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="input"
            style={{ width: "100%" }}
          />
          <textarea
            placeholder="Statement (falsifiable claim)"
            value={statement}
            onChange={e => setStatement(e.target.value)}
            className="input"
            style={{ width: "100%", height: 96, resize: "vertical" }}
          />
          <textarea
            placeholder="Prediction (what we expect to observe)"
            value={prediction}
            onChange={e => setPrediction(e.target.value)}
            className="input"
            style={{ width: "100%", height: 80, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={submit} className="button" style={{ background: "rgba(16,185,129,0.8)", fontSize: 13 }}>Create</button>
            <button onClick={() => setShowForm(false)} className="button secondary" style={{ fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(hyps ?? []).map(h => (
          <div
            key={h.hyp_id}
            style={{
              background: "var(--surface)",
              borderRadius: 8,
              padding: 20,
              cursor: "pointer",
              border: selected?.hyp_id === h.hyp_id ? "1px solid var(--strong)" : "1px solid transparent",
            }}
            onClick={() => setSelected(selected?.hyp_id === h.hyp_id ? null : h)}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    ...(STATUS_STYLES[h.status] ?? { background: "var(--line)", color: "var(--text)" }),
                  }}>
                    {h.status}
                  </span>
                  <span style={{ fontWeight: 600 }}>{h.title}</span>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 13 }}>{h.statement}</p>
              </div>
              <div style={{ textAlign: "right", fontSize: 13 }}>
                <div style={{ color: "var(--strong)", fontFamily: "ui-monospace,monospace" }}>
                  {(h.confidence * 100).toFixed(0)}%
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>confidence</div>
              </div>
            </div>

            {selected?.hyp_id === h.hyp_id && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                {h.prediction && (
                  <div style={{ fontSize: 13 }}>
                    <span style={{ color: "var(--muted)" }}>Prediction: </span>{h.prediction}
                  </div>
                )}
                {h.null_hypothesis && (
                  <div style={{ fontSize: 13 }}>
                    <span style={{ color: "var(--muted)" }}>Null: </span>{h.null_hypothesis}
                  </div>
                )}
                <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                  <span style={{ color: "var(--ok)" }}>For: {(h.evidence_for ?? []).length}</span>
                  <span style={{ color: "var(--danger)" }}>Against: {(h.evidence_against ?? []).length}</span>
                  <span style={{ color: "var(--info-text)" }}>Runs: {(h.linked_run_ids ?? []).length}</span>
                </div>
                {h.status === "proposed" || h.status === "testing" ? (
                  <button
                    onClick={e => { e.stopPropagation(); advance(h); }}
                    className="button"
                    style={{ fontSize: 12, alignSelf: "flex-start", background: "rgba(59,130,246,0.8)" }}
                  >
                    Advance to {h.status === "proposed" ? "Testing" : "Supported"}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
